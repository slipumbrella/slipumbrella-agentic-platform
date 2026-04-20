from __future__ import annotations

import json
import logging
from typing import Any

from agent.db.repositories.common import PoolRepository, count_affected_rows

logger = logging.getLogger(__name__)


class EvaluationRepository(PoolRepository):
    async def get_latest_evaluation(self, reference_id: str) -> dict[str, Any] | None:
        sql = """
            WITH candidate_references AS (
                SELECT $1::text AS reference_id_text
                UNION
                SELECT s.planning_session_id
                FROM sessions s
                WHERE s.session_id = $1::text
                  AND s.planning_session_id IS NOT NULL
                UNION
                SELECT s.session_id
                FROM sessions s
                WHERE s.planning_session_id = $1::text
            )
            SELECT
                e.reference_id,
                e.overall_score,
                e.metrics,
                e.status,
                e.error_message,
                e.test_cases_count,
                e.created_at
            FROM evaluations e
            WHERE e.reference_id::text IN (
                SELECT cr.reference_id_text
                FROM candidate_references cr
            )
            ORDER BY e.created_at DESC
            LIMIT 1
        """
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(sql, reference_id)

        if not row:
            return None

        result = dict(row)
        # Handle JSONB metrics — asyncpg might return dict or str
        metrics = result.get("metrics")
        if isinstance(metrics, str):
            try:
                result["metrics"] = json.loads(metrics)
            except Exception as e:
                logger.warning("Failed to parse evaluation metrics JSON: %s", e)
        return result

    async def change_evaluation_reference_id(
        self, old_session_id: str, new_session_id: str
    ) -> int:
        sql = "UPDATE evaluations SET reference_id = $1::uuid WHERE reference_id = $2::uuid"
        async with self.pool.acquire() as conn:
            result = await conn.execute(sql, new_session_id, old_session_id)
        count = count_affected_rows(result)
        logger.info(
            "Updated %s evaluation reference_ids from %s to %s",
            count,
            old_session_id,
            new_session_id,
        )
        return count
