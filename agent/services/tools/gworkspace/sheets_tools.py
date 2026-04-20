"""Google Sheets agent tools."""

import asyncio
import json
import logging
from typing import Union

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from pydantic import BaseModel
from agent_framework import tool

from agent.services.tools.artifact_context import save_workspace_artifact
from agent.services.tools.gworkspace.auth import get_credentials, share_file_if_configured

logger = logging.getLogger(__name__)


# ── Input schemas ─────────────────────────────────────────────────────────────

class GSheetsCreateInput(BaseModel):
    title: str


class GSheetsReadInput(BaseModel):
    spreadsheet_id: str
    range: str


class GSheetsWriteInput(BaseModel):
    spreadsheet_id: str
    range: str
    values: list[list[Union[str, int, float]]]


# ── Helper ────────────────────────────────────────────────────────────────────

def _handle_http_error(exc: HttpError, resource_id: str) -> str:
    status = int(exc.resp.status) if exc.resp else 0
    if status == 404:
        return f"Resource not found: {resource_id}"
    if status == 403:
        return "Permission denied — ensure the service account has editor access to this resource"
    if status == 400:
        return f"Invalid request: {exc} — check the range format (e.g. Sheet1!A1:C10)"
    if status == 429:
        return "Google API quota exceeded — retry later"
    return f"Google API error ({status}): {exc}"


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool(
    name="gsheets_create",
    description=(
        "Create a new Google Spreadsheet with the given title. "
        "Returns the spreadsheet ID and a shareable URL."
    ),
    schema=GSheetsCreateInput,
    max_invocations=10,
)
async def gsheets_create_tool(title: str, **kwargs) -> str:
    def _create():
        creds = get_credentials()
        service = build("sheets", "v4", credentials=creds)
        sheet = service.spreadsheets().create(body={"properties": {"title": title}}).execute()
        share_file_if_configured(sheet["spreadsheetId"])
        return sheet["spreadsheetId"]

    try:
        sheet_id = await asyncio.to_thread(_create)
        url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
        session = kwargs.get("session")
        if session:
            try:
                await save_workspace_artifact(
                    session,
                    file_id=sheet_id,
                    file_type="gsheet",
                    title=title,
                    url=url,
                    tool_name="gsheets_create",
                )
            except Exception:
                logger.warning("Failed to save artifact for sheet %s", sheet_id, exc_info=True)
        return f"Spreadsheet created: {title} — ID: {sheet_id} — URL: {url}"
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, "new spreadsheet")
    except Exception as exc:
        logger.error("gsheets_create unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"


@tool(
    name="gsheets_read",
    description=(
        "Read cell values from a Google Spreadsheet range. "
        "Range format: 'Sheet1!A1:C10'. Returns a JSON 2D array of cell values."
    ),
    schema=GSheetsReadInput,
    max_invocations=10,
)
async def gsheets_read_tool(spreadsheet_id: str, range: str, **kwargs) -> str:
    def _read():
        creds = get_credentials()
        service = build("sheets", "v4", credentials=creds)
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=range
        ).execute()
        return result.get("values", [])

    try:
        values = await asyncio.to_thread(_read)
        session = kwargs.get("session")
        if session:
            try:
                url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
                await save_workspace_artifact(
                    session,
                    file_id=spreadsheet_id,
                    file_type="gsheet",
                    title=spreadsheet_id,
                    url=url,
                    tool_name="gsheets_read",
                )
            except Exception:
                logger.warning(
                    "Failed to save artifact for sheet %s", spreadsheet_id, exc_info=True
                )
        return json.dumps(values)
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, spreadsheet_id)
    except Exception as exc:
        logger.error("gsheets_read unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"


@tool(
    name="gsheets_write",
    description=(
        "Write values to a Google Spreadsheet range. "
        "Range format: 'Sheet1!A1:C2'. values is a 2D array of strings, integers, or floats."
    ),
    schema=GSheetsWriteInput,
    max_invocations=10,
)
async def gsheets_write_tool(
    spreadsheet_id: str,
    range: str,
    values: list[list[Union[str, int, float]]],
    **kwargs,
) -> str:
    def _write():
        creds = get_credentials()
        service = build("sheets", "v4", credentials=creds)
        result = service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=range,
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
        return result.get("updatedCells", 0)

    try:
        updated = await asyncio.to_thread(_write)
        session = kwargs.get("session")
        if session:
            try:
                url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
                await save_workspace_artifact(
                    session,
                    file_id=spreadsheet_id,
                    file_type="gsheet",
                    title=spreadsheet_id,
                    url=url,
                    tool_name="gsheets_write",
                )
            except Exception:
                logger.warning(
                    "Failed to save artifact for sheet %s", spreadsheet_id, exc_info=True
                )
        return f"Updated {updated} cells in {range}"
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, spreadsheet_id)
    except Exception as exc:
        logger.error("gsheets_write unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"
