from __future__ import annotations

from typing import Any

from agent.db.repositories.common import PoolRepository


class ModelRepository(PoolRepository):
    async def query_openrouter_models(self) -> list[dict[str, Any]]:
        sql = (
            "SELECT id, name, tags, selection_hint, advanced_info, description, "
            "context_length, input_price, output_price, is_reasoning "
            "FROM openrouter_models WHERE is_active = TRUE ORDER BY name"
        )
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(sql)
        return [dict(row) for row in rows]