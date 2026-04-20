"""Google Drive agent tools — artifact listing."""

import json
import logging

from pydantic import BaseModel
from agent_framework import tool

from agent.services.tools.artifact_context import list_team_artifacts

logger = logging.getLogger(__name__)


class GDriveListArtifactsInput(BaseModel):
    pass  # uses the injected session — no user input required


@tool(
    name="gdrive_list_artifacts",
    description=(
        "List all Google Workspace files (Docs, Sheets, Slides) available to the current team workspace. "
        "Returns a JSON array with file_id, file_type, title, url, and created_at for each artifact."
    ),
    schema=GDriveListArtifactsInput,
    max_invocations=10,
)
async def gdrive_list_artifacts_tool(**kwargs) -> str:
    session = kwargs.get("session")
    if not session:
        return "No active session — cannot retrieve artifacts."

    try:
        artifacts = await list_team_artifacts(session)
        if not artifacts:
            return "No artifacts found for this team."
        return json.dumps(artifacts, default=str)
    except Exception as exc:
        logger.error("gdrive_list_artifacts unexpected error", exc_info=True)
        return f"Unexpected error: {exc}"
