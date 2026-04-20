from __future__ import annotations

import logging
import uuid

from agent.db.repositories.common import PoolRepository

logger = logging.getLogger(__name__)


class ArtifactRepository(PoolRepository):
    async def save_artifact(
        self,
        team_id: str,
        file_id: str,
        file_type: str,
        title: str,
        url: str,
        source_session_id: str | None = None,
        source_planning_session_id: str | None = None,
        resolution_source: str | None = None,
        created_by_agent_id: str | None = None,
        created_by_agent_role: str | None = None,
        created_by_tool_name: str | None = None,
    ) -> str:
        """Save an artifact. If the same file_id already exists for the team, update it instead of creating a duplicate."""
        sql = """
            INSERT INTO artifacts (
                team_id,
                file_id,
                file_type,
                title,
                url,
                source_session_id,
                source_planning_session_id,
                resolution_source,
                created_by_agent_id,
                created_by_agent_role,
                created_by_tool_name
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (team_id, file_id) DO UPDATE
            SET title = EXCLUDED.title,
                url = EXCLUDED.url,
                source_session_id = EXCLUDED.source_session_id,
                source_planning_session_id = EXCLUDED.source_planning_session_id,
                resolution_source = EXCLUDED.resolution_source,
                created_by_agent_id = EXCLUDED.created_by_agent_id,
                created_by_agent_role = EXCLUDED.created_by_agent_role,
                created_by_tool_name = EXCLUDED.created_by_tool_name
            RETURNING id
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                sql,
                team_id,
                file_id,
                file_type,
                title,
                url,
                source_session_id,
                source_planning_session_id,
                resolution_source,
                created_by_agent_id,
                created_by_agent_role,
                created_by_tool_name,
            )
        artifact_id = str(row["id"])
        logger.info("Artifact saved: %s '%s' (id=%s, team=%s)", file_type, title, artifact_id, team_id)
        return artifact_id

    async def save_local_artifact(
        self,
        team_id: str,
        title: str,
        content: str,
        source_session_id: str | None = None,
        source_planning_session_id: str | None = None,
        resolution_source: str | None = None,
        created_by_agent_id: str | None = None,
        created_by_agent_role: str | None = None,
        created_by_tool_name: str | None = None,
    ) -> str:
        file_id = f"local-{uuid.uuid4()}"
        file_type = "local_doc"
        url = f"/artifacts/{file_id}"

        sql = """
            INSERT INTO artifacts (
                team_id,
                file_id,
                file_type,
                title,
                url,
                content,
                source_session_id,
                source_planning_session_id,
                resolution_source,
                created_by_agent_id,
                created_by_agent_role,
                created_by_tool_name
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                sql,
                team_id,
                file_id,
                file_type,
                title,
                url,
                content,
                source_session_id,
                source_planning_session_id,
                resolution_source,
                created_by_agent_id,
                created_by_agent_role,
                created_by_tool_name,
            )
        artifact_id = str(row["id"])
        logger.info("Local artifact saved: '%s' (id=%s, team=%s)", title, artifact_id, team_id)
        return artifact_id

    async def save_r2_image_artifact(
        self,
        team_id: str,
        key: str,
        title: str,
        public_url: str,
        source_session_id: str | None = None,
        source_planning_session_id: str | None = None,
        resolution_source: str | None = None,
        created_by_agent_id: str | None = None,
        created_by_agent_role: str | None = None,
        created_by_tool_name: str | None = None,
    ) -> str:
        sql = """
            INSERT INTO artifacts (
                team_id,
                file_id,
                file_type,
                title,
                url,
                source_session_id,
                source_planning_session_id,
                resolution_source,
                created_by_agent_id,
                created_by_agent_role,
                created_by_tool_name
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                sql,
                team_id,
                key,
                "r2_image",
                title,
                public_url,
                source_session_id,
                source_planning_session_id,
                resolution_source,
                created_by_agent_id,
                created_by_agent_role,
                created_by_tool_name,
            )
        artifact_id = str(row["id"])
        logger.info("R2 image artifact saved: '%s' (id=%s, team=%s)", title, artifact_id, team_id)
        return artifact_id

    async def get_artifacts_by_team(self, team_id: str) -> list[dict[str, str]]:
        sql = """
            SELECT
                id,
                team_id,
                file_id,
                file_type,
                title,
                url,
                created_at,
                source_session_id,
                source_planning_session_id,
                resolution_source,
                created_by_agent_id,
                created_by_agent_role,
                created_by_tool_name
            FROM artifacts
            WHERE team_id = $1::uuid
            ORDER BY created_at ASC
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(sql, team_id)
        return [
            {
                "id": str(row["id"]),
                "team_id": str(row["team_id"]),
                "file_id": row["file_id"],
                "file_type": row["file_type"],
                "title": row["title"],
                "url": row["url"],
                "source_session_id": row["source_session_id"],
                "source_planning_session_id": row["source_planning_session_id"],
                "resolution_source": row["resolution_source"],
                "created_by_agent_id": row["created_by_agent_id"],
                "created_by_agent_role": row["created_by_agent_role"],
                "created_by_tool_name": row["created_by_tool_name"],
                "created_at": row["created_at"].isoformat(),
            }
            for row in rows
        ]