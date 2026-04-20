"""Google Slides agent tools."""

import asyncio
import json
import logging
import uuid

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from pydantic import BaseModel
from agent_framework import tool

from agent.services.tools.artifact_context import save_workspace_artifact
from agent.services.tools.gworkspace.auth import get_credentials, share_file_if_configured

logger = logging.getLogger(__name__)


# ── Input schemas ─────────────────────────────────────────────────────────────

class GSlidesCreateInput(BaseModel):
    title: str


class GSlidesReadInput(BaseModel):
    presentation_id: str


class GSlidesAddSlideInput(BaseModel):
    presentation_id: str
    title: str
    body: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_slide_text(page_elements: list) -> list[str]:
    """Extract all non-empty text strings from a slide's pageElements list."""
    texts = []
    for elem in page_elements:
        shape = elem.get("shape", {})
        text_obj = shape.get("text", {})
        for text_elem in text_obj.get("textElements", []):
            content = text_elem.get("textRun", {}).get("content", "")
            if content.strip():
                texts.append(content.strip())
    return texts


def _handle_http_error(exc: HttpError, resource_id: str) -> str:
    status = int(exc.resp.status) if exc.resp else 0
    if status == 404:
        return f"Resource not found: {resource_id}"
    if status == 403:
        return "Permission denied — ensure the service account has editor access to this resource"
    if status == 400:
        return f"Invalid request: {exc} — check your inputs"
    if status == 429:
        return "Google API quota exceeded — retry later"
    return f"Google API error ({status}): {exc}"


# ── Tools ─────────────────────────────────────────────────────────────────────

@tool(
    name="gslides_create",
    description=(
        "Create a new Google Slides presentation with the given title. "
        "Returns the presentation ID and a shareable URL."
    ),
    schema=GSlidesCreateInput,
    max_invocations=10,
)
async def gslides_create_tool(title: str, **kwargs) -> str:
    def _create():
        creds = get_credentials()
        service = build("slides", "v1", credentials=creds)
        pres = service.presentations().create(body={"title": title}).execute()
        share_file_if_configured(pres["presentationId"])
        return pres["presentationId"]

    try:
        pres_id = await asyncio.to_thread(_create)
        url = f"https://docs.google.com/presentation/d/{pres_id}/edit"
        session = kwargs.get("session")
        if session:
            try:
                await save_workspace_artifact(
                    session,
                    file_id=pres_id,
                    file_type="gslide",
                    title=title,
                    url=url,
                    tool_name="gslides_create",
                )
            except Exception:
                logger.warning("Failed to save artifact for presentation %s", pres_id, exc_info=True)
        return f"Presentation created: {title} — ID: {pres_id} — URL: {url}"
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, "new presentation")
    except Exception as exc:
        logger.error("gslides_create unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"


@tool(
    name="gslides_read",
    description=(
        "Read all slides in a Google Slides presentation. "
        "Returns a JSON array where each element has: index, title, body_text, notes."
    ),
    schema=GSlidesReadInput,
    max_invocations=10,
)
async def gslides_read_tool(presentation_id: str, **kwargs) -> str:
    def _read():
        creds = get_credentials()
        service = build("slides", "v1", credentials=creds)
        return service.presentations().get(presentationId=presentation_id).execute()

    try:
        pres = await asyncio.to_thread(_read)
        session = kwargs.get("session")
        if session:
            try:
                title = pres.get("title", presentation_id)
                url = f"https://docs.google.com/presentation/d/{presentation_id}/edit"
                await save_workspace_artifact(
                    session,
                    file_id=presentation_id,
                    file_type="gslide",
                    title=title,
                    url=url,
                    tool_name="gslides_read",
                )
            except Exception:
                logger.warning(
                    "Failed to save artifact for presentation %s", presentation_id, exc_info=True
                )
        slides = []
        for i, slide in enumerate(pres.get("slides", [])):
            texts = _extract_slide_text(slide.get("pageElements", []))
            title = texts[0] if texts else ""
            body = " ".join(texts[1:]) if len(texts) > 1 else ""
            notes_page = slide.get("slideProperties", {}).get("notesPage", {})
            notes_texts = _extract_slide_text(notes_page.get("pageElements", []))
            slides.append({
                "index": i,
                "title": title,
                "body_text": body,
                "notes": " ".join(notes_texts),
            })
        return json.dumps(slides)
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, presentation_id)
    except Exception as exc:
        logger.error("gslides_read unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"


@tool(
    name="gslides_add_slide",
    description=(
        "Add a new slide with a title and body text to an existing Google Slides presentation. "
        "Returns the index of the newly added slide."
    ),
    schema=GSlidesAddSlideInput,
    max_invocations=10,
)
async def gslides_add_slide_tool(presentation_id: str, title: str, body: str, **kwargs) -> str:
    def _add():
        creds = get_credentials()
        service = build("slides", "v1", credentials=creds)

        # Generate valid object IDs: [a-zA-Z0-9_-]{5,50}
        slide_id = "s" + uuid.uuid4().hex[:9]
        title_id = slide_id + "_t"
        body_id = slide_id + "_b"

        # batchUpdate: create slide, then add title and body text boxes
        requests = [
            {
                "createSlide": {
                    "objectId": slide_id,
                    "slideLayoutReference": {"predefinedLayout": "BLANK"},
                }
            },
            {
                "createShape": {
                    "objectId": title_id,
                    "shapeType": "TEXT_BOX",
                    "elementProperties": {
                        "pageObjectId": slide_id,
                        "size": {
                            "width": {"magnitude": 6000000, "unit": "EMU"},
                            "height": {"magnitude": 900000, "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": 1, "scaleY": 1,
                            "translateX": 457200, "translateY": 274638,
                            "unit": "EMU",
                        },
                    },
                }
            },
            {"insertText": {"objectId": title_id, "insertionIndex": 0, "text": title}},
            {
                "createShape": {
                    "objectId": body_id,
                    "shapeType": "TEXT_BOX",
                    "elementProperties": {
                        "pageObjectId": slide_id,
                        "size": {
                            "width": {"magnitude": 6000000, "unit": "EMU"},
                            "height": {"magnitude": 3000000, "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": 1, "scaleY": 1,
                            "translateX": 457200, "translateY": 1400000,
                            "unit": "EMU",
                        },
                    },
                }
            },
            {"insertText": {"objectId": body_id, "insertionIndex": 0, "text": body}},
        ]

        service.presentations().batchUpdate(
            presentationId=presentation_id, body={"requests": requests}
        ).execute()

        # Count slides to determine index of the new slide
        pres = service.presentations().get(presentationId=presentation_id).execute()
        return len(pres.get("slides", [])) - 1, pres.get("title", presentation_id)

    try:
        index, pres_title = await asyncio.to_thread(_add)
        session = kwargs.get("session")
        if session:
            try:
                url = f"https://docs.google.com/presentation/d/{presentation_id}/edit"
                await save_workspace_artifact(
                    session,
                    file_id=presentation_id,
                    file_type="gslide",
                    title=pres_title,
                    url=url,
                    tool_name="gslides_add_slide",
                )
            except Exception:
                logger.warning(
                    "Failed to save artifact for presentation %s", presentation_id, exc_info=True
                )
        return f"Slide added at index {index} in presentation {presentation_id}"
    except RuntimeError as exc:
        return f"Google credentials not configured: {exc}"
    except HttpError as exc:
        return _handle_http_error(exc, presentation_id)
    except Exception as exc:
        logger.error("gslides_add_slide unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"
