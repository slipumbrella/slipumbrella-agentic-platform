from __future__ import annotations

import json
import logging

import asyncpg

from agent.configs.settings import settings
from agent.db.repositories.common import PoolRepository, count_affected_rows

logger = logging.getLogger(__name__)


def _fallback_title(file_key: str | None, original_filename: str | None) -> str:
    if original_filename:
        return original_filename
    if file_key:
        normalized = file_key.replace("\\", "/")
        return normalized.rsplit("/", 1)[-1]
    return "unknown"


def _extract_source_url(meta: object) -> str | None:
    if isinstance(meta, dict):
        source_url = meta.get("source_url")
        return source_url if isinstance(source_url, str) and source_url.strip() else None
    if isinstance(meta, str):
        try:
            parsed = json.loads(meta)
        except json.JSONDecodeError:
            return None
        return _extract_source_url(parsed)
    return None


def _build_citation_markdown(title: str, url: str | None) -> str:
    return f"[{title}]({url})" if url else title


class EmbeddingRepository(PoolRepository):
    async def _fresh_conn(self) -> asyncpg.Connection:
        return await asyncpg.connect(
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            database=settings.DB_NAME,
            user=settings.DB_USER,
            password=settings.DB_PASSWORD,
        )

    async def retrieve_session_chunks(self, session_id: str) -> list[str]:
        sql = """
            SELECT content
            FROM embeddings
            WHERE reference_id = $1::uuid
              AND content IS NOT NULL
              AND content <> ''
            ORDER BY chunk_index ASC, created_at ASC
        """
        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(sql, session_id)
        except Exception:
            conn = await self._fresh_conn()
            try:
                rows = await conn.fetch(sql, session_id)
            finally:
                await conn.close()
        return [row["content"] for row in rows]

    async def search_similar_chunks(
        self,
        session_id: str,
        query_vector: list[float],
        top_k: int = 5,
    ) -> list[str]:
        vector_literal = "[" + ",".join(str(value) for value in query_vector) + "]"
        sql = """
            SELECT content
            FROM embeddings
            WHERE reference_id = $1::uuid
              AND content IS NOT NULL
              AND content <> ''
            ORDER BY vector <-> $2::vector
            LIMIT $3
        """
        try:
            try:
                async with self.pool.acquire() as conn:
                    rows = await conn.fetch(sql, session_id, vector_literal, top_k)
            except Exception:
                conn = await self._fresh_conn()
                try:
                    rows = await conn.fetch(sql, session_id, vector_literal, top_k)
                finally:
                    await conn.close()
            return [row["content"] for row in rows]
        except Exception as exc:
            logger.warning(
                "search_similar_chunks: vector search failed (%s), falling back to retrieve_session_chunks",
                exc,
            )
            return await self.retrieve_session_chunks(session_id)

    async def search_similar_chunks_with_metadata(
        self,
        session_id: str,
        query_vector: list[float],
        top_k: int = 5,
    ) -> list[dict[str, object]]:
        logger.info("Performing vector search for session_id=%s with top_k=%d", session_id, top_k)
        vector_literal = "[" + ",".join(str(value) for value in query_vector) + "]"
        sql = """
            SELECT
                e.file_key,
                e.chunk_index,
                e.content,
                a.original_filename,
                a.meta
            FROM embeddings e
            LEFT JOIN attachments a ON a.id = e.attachment_id
            WHERE e.reference_id = $1::uuid
              AND e.content IS NOT NULL
              AND e.content <> ''
            ORDER BY e.vector <-> $2::vector
            LIMIT $3
        """
        try:
            try:
                async with self.pool.acquire() as conn:
                    rows = await conn.fetch(sql, session_id, vector_literal, top_k)
            except Exception:
                conn = await self._fresh_conn()
                try:
                    rows = await conn.fetch(sql, session_id, vector_literal, top_k)
                finally:
                    await conn.close()
            return [
                {
                    "file_key": row["file_key"],
                    "chunk_index": row["chunk_index"],
                    "content": row["content"],
                    "title": _fallback_title(row["file_key"], row["original_filename"]),
                    "url": _extract_source_url(row["meta"]),
                    "citation_markdown": _build_citation_markdown(
                        _fallback_title(row["file_key"], row["original_filename"]),
                        _extract_source_url(row["meta"]),
                    ),
                }
                for row in rows
            ]
        except Exception as exc:
            logger.warning(
                "search_similar_chunks_with_metadata: vector search failed (%s), falling back to content-only chunks",
                exc,
            )
            contents = await self.retrieve_session_chunks(session_id)
            return [
                {
                    "file_key": "unknown",
                    "chunk_index": index,
                    "content": content,
                    "title": "unknown",
                    "url": None,
                    "citation_markdown": "unknown",
                }
                for index, content in enumerate(contents)
            ]

    async def change_embedding_reference_id(self, old_session_id: str, new_session_id: str) -> int:
        sql = "UPDATE embeddings SET reference_id = $1::uuid WHERE reference_id = $2::uuid"
        async with self.pool.acquire() as conn:
            result = await conn.execute(sql, new_session_id, old_session_id)
        count = count_affected_rows(result)
        logger.info(
            "Updated %s embedding reference_ids from %s to %s",
            count,
            old_session_id,
            new_session_id,
        )
        return count
