from __future__ import annotations

import json
import logging
from typing import Any

from agent.db.repositories.common import PoolRepository

logger = logging.getLogger(__name__)


class PlanRepository(PoolRepository):
    async def save_plan(self, session_id: str, plan: Any) -> int:
        plan_sql = """
            INSERT INTO plans (session_id, orchestration, inputs, created_at)
            VALUES ($1, $2, $3, NOW())
            RETURNING id
        """
        agent_sql = """
            INSERT INTO agents (id, plan_id, role, goal, tools, context, model, order_index, is_leader)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                plan_id: int = await conn.fetchval(
                    plan_sql,
                    session_id,
                    plan.orchestration,
                    json.dumps(plan.inputs if isinstance(plan.inputs, dict) else {}),
                )

                for agent in plan.agents:
                    logger.debug("Saving agent [%s] with model [%s]", agent.id, agent.model)
                    await conn.execute(
                        agent_sql,
                        agent.id,
                        plan_id,
                        agent.role,
                        agent.goal,
                        json.dumps(agent.tools if isinstance(agent.tools, list) else []),
                        json.dumps(agent.context if isinstance(agent.context, dict) else {}),
                        agent.model,
                        agent.order,
                        agent.is_leader,
                    )

        logger.info("Plan saved: plan_id=%s for session=%s", plan_id, session_id)
        return plan_id

    async def load_latest_plan(
        self,
        session_id: str,
    ) -> tuple[dict[str, Any] | None, list[dict[str, Any]] | None]:
        plan_sql = """
            SELECT id, session_id, orchestration, inputs, created_at
            FROM plans
            WHERE session_id = $1
            ORDER BY id DESC
            LIMIT 1
        """
        agent_sql = """
            SELECT id, plan_id, role, goal, tools, context, model, order_index, is_leader
            FROM agents
            WHERE plan_id = $1
            ORDER BY COALESCE(order_index, 0) ASC, id ASC
        """

        async with self.pool.acquire() as conn:
            plan_row = await conn.fetchrow(plan_sql, session_id)
            if plan_row is None:
                return None, None

            agent_rows = await conn.fetch(agent_sql, plan_row["id"])

        return dict(plan_row), [dict(row) for row in agent_rows]