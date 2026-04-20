from __future__ import annotations

import logging
from typing import Any

from agent.db.repositories.common import PoolRepository, count_affected_rows

logger = logging.getLogger(__name__)


class AttachmentRepository(PoolRepository):
    async def get_attachments(self, reference_id: str) -> list[dict[str, Any]]:
        sql = """
            SELECT original_filename, file_key, is_embedded, created_at
            FROM attachments
            WHERE reference_id = $1::uuid
            ORDER BY created_at DESC
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(sql, reference_id)
        return [dict(r) for r in rows]

    async def change_attachment_reference_id(self, old_session_id: str, new_session_id: str) -> int:
        sql = "UPDATE attachments SET reference_id = $1::uuid WHERE reference_id = $2::uuid"
        async with self.pool.acquire() as conn:
            result = await conn.execute(sql, new_session_id, old_session_id)
        count = count_affected_rows(result)
        logger.info(
            "Updated %s attachment reference_ids from %s to %s",
            count,
            old_session_id,
            new_session_id,
        )
        return count