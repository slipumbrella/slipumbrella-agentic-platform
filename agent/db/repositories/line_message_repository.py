from __future__ import annotations

from typing import Any

from agent.db.repositories.common import PoolRepository


class LineMessageRepository(PoolRepository):
    async def save_line_message(
        self,
        team_id: str,
        line_user_id: str,
        content: str,
        message_type: str = "text",
        display_name: str = "",
    ) -> None:
        sql = """
            INSERT INTO line_messages (id, team_id, line_user_id, content, message_type, display_name, received_at)
            VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, NOW())
        """
        async with self.pool.acquire() as conn:
            await conn.execute(sql, team_id, line_user_id, content, message_type, display_name)

    async def get_line_messages_by_team(
        self,
        team_id: str,
        limit: int = 10,
        line_user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if line_user_id:
            sql = """
                SELECT id, team_id, line_user_id, display_name, message_type, content, reply_token, received_at
                FROM line_messages
                WHERE team_id = $1::uuid AND line_user_id = $3
                ORDER BY received_at DESC
                LIMIT $2
            """
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(sql, team_id, limit, line_user_id)
        else:
            sql = """
                SELECT id, team_id, line_user_id, display_name, message_type, content, reply_token, received_at
                FROM line_messages
                WHERE team_id = $1::uuid
                ORDER BY received_at DESC
                LIMIT $2
            """
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(sql, team_id, limit)

        return [
            {
                "id": str(row["id"]),
                "team_id": str(row["team_id"]),
                "line_user_id": row["line_user_id"],
                "display_name": row["display_name"],
                "message_type": row["message_type"],
                "content": row["content"],
                "reply_token": row["reply_token"],
                "received_at": row["received_at"].isoformat() if row["received_at"] else None,
            }
            for row in rows
        ]