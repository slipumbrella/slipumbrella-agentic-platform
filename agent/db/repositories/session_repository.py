from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from agent.db.repositories.common import PoolRepository

logger = logging.getLogger(__name__)


class SessionRepository(PoolRepository):
    async def create_session(
        self,
        session_id: str | None = None,
        session_type: str = "planning",
        metadata: dict[str, Any] | None = None,
        planning_session_id: str | None = None,
    ) -> str:
        if not session_id:
            session_id = str(uuid.uuid4())
        if metadata is None:
            metadata = {}

        team_id = metadata.get("team_id")
        sql = """
            INSERT INTO sessions (session_id, type, metadata, planning_session_id, team_id, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (session_id) DO NOTHING
        """
        async with self.pool.acquire() as conn:
            await conn.execute(
                sql,
                session_id,
                session_type,
                json.dumps(metadata),
                planning_session_id,
                team_id,
            )

        logger.info("Session created in DB: %s type=%s team=%s", session_id, session_type, team_id)
        return session_id

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        sql = """
            SELECT s.session_id, s.type, s.metadata, s.planning_session_id, s.created_at, s.team_id,
                   t.line_channel_access_token
            FROM sessions s
            LEFT JOIN teams t ON s.team_id = t.id
            WHERE s.session_id = $1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(sql, session_id)
        return dict(row) if row else None

    async def update_session_metadata(self, session_id: str, metadata: dict[str, Any]) -> None:
        sql = "UPDATE sessions SET metadata = $1 WHERE session_id = $2"
        async with self.pool.acquire() as conn:
            await conn.execute(sql, json.dumps(metadata), session_id)

    async def get_chat_session_title(self, session_id: str) -> str | None:
        sql = "SELECT title FROM chat_sessions WHERE id = $1::uuid"
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(sql, session_id)
        if row is None:
            return None
        title = row["title"]
        return title if isinstance(title, str) and title.strip() else None

    async def update_chat_session_title(self, session_id: str, title: str) -> None:
        sql = "UPDATE chat_sessions SET title = $1 WHERE id = $2::uuid"
        safe_title = title[:40]
        async with self.pool.acquire() as conn:
            await conn.execute(sql, safe_title, session_id)
        logger.info("chat_sessions title updated: session=%s title=%s", session_id, safe_title)

    async def get_latest_team_assignment(self, session_ids: list[str]) -> dict[str, Any] | None:
        filtered_session_ids = [session_id for session_id in session_ids if session_id]
        if not filtered_session_ids:
            return None

        sql = """
                        SELECT session_id, team_id, assigned_at
            FROM session_team_assignments
            WHERE session_id = ANY($1::text[])
                            AND revoked_at IS NULL
            ORDER BY assigned_at DESC
            LIMIT 1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(sql, filtered_session_ids)
        return dict(row) if row else None