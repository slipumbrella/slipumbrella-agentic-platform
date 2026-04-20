from __future__ import annotations

import json
import logging
from typing import Any

from agent.db.repositories.common import PoolRepository, count_affected_rows

logger = logging.getLogger(__name__)


class SnapshotRepository(PoolRepository):
    async def ensure_unique_index(self) -> None:
        sql = """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_session_snapshots_session_type
            ON session_snapshots (session_id, snapshot_type)
        """
        async with self.pool.acquire() as conn:
            await conn.execute(sql)
        logger.info("Ensured unique index on session_snapshots(session_id, snapshot_type)")

    async def save_snapshot(
        self,
        session_id: str,
        snapshot_type: str,
        data: dict[str, Any],
    ) -> str:
        sql = """
            INSERT INTO session_snapshots (id, session_id, snapshot_type, data, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
            ON CONFLICT (session_id, snapshot_type)
                DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
            RETURNING id::text
        """
        async with self.pool.acquire() as conn:
            row_id = await conn.fetchval(sql, session_id, snapshot_type, json.dumps(data))
        logger.info("Snapshot saved: session=%s type=%s", session_id, snapshot_type)
        return row_id

    async def load_latest_snapshot(
        self,
        session_id: str,
        snapshot_type: str,
    ) -> dict[str, Any] | None:
        sql = """
            SELECT data FROM session_snapshots
            WHERE session_id = $1 AND snapshot_type = $2
            ORDER BY updated_at DESC
            LIMIT 1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(sql, session_id, snapshot_type)
        if row is None:
            return None
        raw = row["data"]
        return json.loads(raw) if isinstance(raw, str) else dict(raw)

    async def delete_snapshots(self, session_id: str) -> int:
        sql = "DELETE FROM session_snapshots WHERE session_id = $1"
        async with self.pool.acquire() as conn:
            result = await conn.execute(sql, session_id)
        count = count_affected_rows(result)
        logger.info("Deleted %s snapshots for session=%s", count, session_id)
        return count

    async def load_raw_snapshot(self, session_id: str, snapshot_type: str) -> dict[str, Any] | None:
        return await self.load_latest_snapshot(session_id, snapshot_type)

    async def save_raw_snapshot(self, session_id: str, snapshot_type: str, data_json: str) -> None:
        sql = """
            INSERT INTO session_snapshots (id, session_id, snapshot_type, data, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3::jsonb, NOW(), NOW())
            ON CONFLICT (session_id, snapshot_type)
                DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        """
        async with self.pool.acquire() as conn:
            await conn.execute(sql, session_id, snapshot_type, data_json)

    async def delete_snapshot(self, session_id: str, snapshot_type: str) -> bool:
        sql = "DELETE FROM session_snapshots WHERE session_id = $1 AND snapshot_type = $2"
        async with self.pool.acquire() as conn:
            result = await conn.execute(sql, session_id, snapshot_type)
        return count_affected_rows(result) > 0