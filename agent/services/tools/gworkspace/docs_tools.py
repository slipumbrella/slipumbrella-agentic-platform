"""Google Docs agent tools."""

import asyncio
import logging

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from pydantic import BaseModel
from agent_framework import tool

from agent.services.tools.artifact_context import save_workspace_artifact

from agent.services.tools.gworkspace.auth import (
    get_credentials,
    share_file_if_configured,
)

logger = logging.getLogger(__name__)


# ── Input schemas ─────────────────────────────────────────────────────────────


class GDocsCreateInput(BaseModel):
    title: str
    content: str


class GDocsReadInput(BaseModel):
    doc_id: str


class GDocsAppendInput(BaseModel):
    doc_id: str
    content: str


# ── Helpers ───────────────────────────────────────────────────────────────────


def _extract_text(doc: dict) -> str:
    """Extract all plain text from a Docs API document response."""
    texts = []
    for block in doc.get("body", {}).get("content", []):
        para = block.get("paragraph", {})
        for elem in para.get("elements", []):
            text = elem.get("textRun", {}).get("content", "")
            if text:
                texts.append(text)
    return "".join(texts)


def _handle_http_error(exc: HttpError, resource_id: str) -> str:
    status = int(exc.resp.status) if exc.resp else 0
    if status == 404:
        return f"Resource not found: {resource_id}"
    if status == 403:
        return (
            "Permission denied (403). Possible causes: "
            "1. Google Docs/Drive API not enabled in GCP Console. "
            "2. Service Account lacks 'Editor' access to the GOOGLE_DRIVE_FOLDER_ID. "
            "3. Missing required OAuth scopes."
        )
    if status == 400:
        return f"Invalid request: {exc} — check your inputs"
    if status == 429:
        return "Google API quota exceeded — retry later"
    return f"Google API error ({status}): {exc}"


# ── Tools ─────────────────────────────────────────────────────────────────────


@tool(
    name="gdocs_create",
    description=(
        "Create a new Google Doc with the given title and initial text content. "
        "Returns the document ID and a shareable URL."
    ),
    schema=GDocsCreateInput,
    max_invocations=10,
)
async def gdocs_create_tool(title: str, content: str, **kwargs) -> str:
    def _create():
        creds = get_credentials()
        service = build("docs", "v1", credentials=creds)
        doc = service.documents().create(body={"title": title}).execute()
        doc_id = doc["documentId"]
        service.documents().batchUpdate(
            documentId=doc_id,
            body={
                "requests": [
                    {"insertText": {"location": {"index": 1}, "text": content}}
                ]
            },
        ).execute()
        share_file_if_configured(doc_id)
        return doc_id

    try:
        doc_id = await asyncio.to_thread(_create)
        url = f"https://docs.google.com/document/d/{doc_id}/edit"
        session = kwargs.get("session")
        if session:
            try:
                await save_workspace_artifact(
                    session,
                    file_id=doc_id,
                    file_type="gdoc",
                    title=title,
                    url=url,
                    tool_name="gdocs_create",
                )
            except Exception:
                logger.warning(
                    "Failed to save artifact for doc %s", doc_id, exc_info=True
                )
        return f"Doc created: {title} — ID: {doc_id} — URL: {url}"
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, "new document")
    except Exception as exc:
        logger.error("gdocs_create unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"


@tool(
    name="gdocs_read",
    description=(
        "Read the full plain-text content of a Google Doc by its document ID. "
        "Returns all text from the document."
    ),
    schema=GDocsReadInput,
    max_invocations=10,
)
async def gdocs_read_tool(doc_id: str, **kwargs) -> str:
    def _read():
        creds = get_credentials()
        service = build("docs", "v1", credentials=creds)
        return service.documents().get(documentId=doc_id).execute()

    try:
        doc = await asyncio.to_thread(_read)
        session = kwargs.get("session")
        if session:
            try:
                title = doc.get("title", doc_id)
                url = f"https://docs.google.com/document/d/{doc_id}/edit"
                await save_workspace_artifact(
                    session,
                    file_id=doc_id,
                    file_type="gdoc",
                    title=title,
                    url=url,
                    tool_name="gdocs_read",
                )
            except Exception:
                logger.warning(
                    "Failed to save artifact for doc %s", doc_id, exc_info=True
                )
        return _extract_text(doc)
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, doc_id)
    except Exception as exc:
        logger.error("gdocs_read unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"


@tool(
    name="gdocs_append",
    description=(
        "Append text content to the end of an existing Google Doc. "
        "Provide the document ID and the text to append."
    ),
    schema=GDocsAppendInput,
    max_invocations=10,
)
async def gdocs_append_tool(doc_id: str, content: str, **kwargs) -> str:
    def _append():
        creds = get_credentials()
        service = build("docs", "v1", credentials=creds)
        doc = service.documents().get(documentId=doc_id).execute()
        end_index = doc["body"]["content"][-1]["endIndex"] - 1
        service.documents().batchUpdate(
            documentId=doc_id,
            body={
                "requests": [
                    {
                        "insertText": {
                            "location": {"index": end_index},
                            "text": "\n" + content,
                        }
                    }
                ]
            },
        ).execute()
        return doc.get("title", doc_id)

    try:
        title = await asyncio.to_thread(_append)
        session = kwargs.get("session")
        if session:
            try:
                url = f"https://docs.google.com/document/d/{doc_id}/edit"
                await save_workspace_artifact(
                    session,
                    file_id=doc_id,
                    file_type="gdoc",
                    title=title,
                    url=url,
                    tool_name="gdocs_append",
                )
            except Exception:
                logger.warning(
                    "Failed to save artifact for doc %s", doc_id, exc_info=True
                )
        return f"Content appended to doc {doc_id}"
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, doc_id)
    except Exception as exc:
        logger.error("gdocs_append unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"
