from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ArtifactContext:
    team_id: str
    source_session_id: str | None
    source_planning_session_id: str | None
    resolution_source: str
    created_by_agent_id: str | None = None
    created_by_agent_role: str | None = None


async def resolve_artifact_context(session: Any) -> ArtifactContext | None:
    if session is None:
        return None

    repositories = getattr(session, "repositories", None)
    metadata = getattr(session, "metadata", {}) or {}
    session_id = getattr(session, "session_id", None)
    planning_session_id = metadata.get("planning_session_id")
    direct_team_id = metadata.get("team_id")

    session_id = session_id if isinstance(session_id, str) and session_id else None
    planning_session_id = (
        planning_session_id
        if isinstance(planning_session_id, str) and planning_session_id
        else None
    )

    if direct_team_id:
        return ArtifactContext(
            team_id=str(direct_team_id),
            source_session_id=str(session_id) if session_id else None,
            source_planning_session_id=str(planning_session_id) if planning_session_id else None,
            resolution_source="direct_session_team",
        )

    session_ids = [sid for sid in [session_id, planning_session_id] if sid]
    if planning_session_id:
        try:
            planning_row = await repositories.sessions.get_session(str(planning_session_id))
        except (AttributeError, TypeError):
            planning_row = None
        if planning_row is not None and not planning_row.get("team_id"):
            return None

    try:
        latest_assignment = await repositories.sessions.get_latest_team_assignment(session_ids)
    except (AttributeError, TypeError):
        latest_assignment = None
    if latest_assignment and latest_assignment.get("team_id"):
        return ArtifactContext(
            team_id=str(latest_assignment["team_id"]),
            source_session_id=str(session_id) if session_id else None,
            source_planning_session_id=str(planning_session_id) if planning_session_id else None,
            resolution_source="lineage_assignment",
        )

    if planning_session_id:
        if planning_row and planning_row.get("team_id"):
            return ArtifactContext(
                team_id=str(planning_row["team_id"]),
                source_session_id=str(session_id) if session_id else None,
                source_planning_session_id=str(planning_session_id),
                resolution_source="planning_session_team",
            )

    return None


async def save_workspace_artifact(
    session: Any,
    *,
    file_id: str,
    file_type: str,
    title: str,
    url: str,
    tool_name: str,
) -> str:
    context = await resolve_artifact_context(session)
    if context is None:
        raise RuntimeError("No team assigned to session lineage — cannot save artifact.")

    return await session.repositories.artifacts.save_artifact(
        team_id=context.team_id,
        file_id=file_id,
        file_type=file_type,
        title=title,
        url=url,
        source_session_id=context.source_session_id,
        source_planning_session_id=context.source_planning_session_id,
        resolution_source=context.resolution_source,
        created_by_agent_id=context.created_by_agent_id,
        created_by_agent_role=context.created_by_agent_role,
        created_by_tool_name=tool_name,
    )


async def save_local_artifact(
    session: Any,
    *,
    title: str,
    content: str,
    tool_name: str,
) -> str:
    context = await resolve_artifact_context(session)
    if context is None:
        raise RuntimeError("No team assigned to session lineage — cannot save artifact.")

    return await session.repositories.artifacts.save_local_artifact(
        team_id=context.team_id,
        title=title,
        content=content,
        source_session_id=context.source_session_id,
        source_planning_session_id=context.source_planning_session_id,
        resolution_source=context.resolution_source,
        created_by_agent_id=context.created_by_agent_id,
        created_by_agent_role=context.created_by_agent_role,
        created_by_tool_name=tool_name,
    )


async def save_image_artifact(
    session: Any,
    *,
    key: str,
    title: str,
    public_url: str,
    tool_name: str,
) -> str:
    context = await resolve_artifact_context(session)
    if context is None:
        raise RuntimeError("No team assigned to session lineage — cannot save artifact.")

    return await session.repositories.artifacts.save_r2_image_artifact(
        team_id=context.team_id,
        key=key,
        title=title,
        public_url=public_url,
        source_session_id=context.source_session_id,
        source_planning_session_id=context.source_planning_session_id,
        resolution_source=context.resolution_source,
        created_by_agent_id=context.created_by_agent_id,
        created_by_agent_role=context.created_by_agent_role,
        created_by_tool_name=tool_name,
    )


async def list_team_artifacts(session: Any) -> list[dict[str, str]]:
    context = await resolve_artifact_context(session)
    if context is None:
        raise RuntimeError("No team assigned to session lineage — cannot list artifacts.")
    return await session.repositories.artifacts.get_artifacts_by_team(context.team_id)