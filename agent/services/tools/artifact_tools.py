"""Local artifact agent tools."""

import json
import logging

from pydantic import BaseModel
from agent_framework import tool

from agent.services.tools.artifact_context import list_team_artifacts, save_local_artifact

logger = logging.getLogger(__name__)

class SaveArtifactInput(BaseModel):
    title: str
    content: str

class ListArtifactsInput(BaseModel):
    pass

@tool(
    name="save_artifact",
    description=(
        "Save a generated artifact (document, code, analysis) for the current team workspace. "
        "Provide a descriptive title and the full text/markdown content."
    ),
    schema=SaveArtifactInput,
    max_invocations=10,
)
async def save_artifact_tool(title: str, content: str, **kwargs) -> str:
    session = kwargs.get("session")
    if not session:
        return "No active session — cannot save artifact."

    try:
        artifact_id = await save_local_artifact(
            session,
            title=title,
            content=content,
            tool_name="save_artifact",
        )
        return f"Artifact saved successfully: '{title}' (ID: {artifact_id})"
    except Exception as exc:
        logger.error("save_artifact unexpected error", exc_info=True)
        return f"Unexpected error saving artifact: {exc}"

@tool(
    name="list_artifacts",
    description=(
        "List all artifacts (files, documents) available to the current team workspace. "
        "Returns a JSON array with file_id, file_type, title, url, and created_at."
    ),
    schema=ListArtifactsInput,
    max_invocations=10,
)
async def list_artifacts_tool(**kwargs) -> str:
    session = kwargs.get("session")
    if not session:
        return "No active session — cannot list artifacts."

    try:
        artifacts = await list_team_artifacts(session)
        if not artifacts:
            return "No artifacts found for this team."
        return json.dumps(artifacts, default=str)
    except Exception as exc:
        logger.error("list_artifacts unexpected error", exc_info=True)
        return f"Unexpected error listing artifacts: {exc}"
