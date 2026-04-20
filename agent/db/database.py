"""Database pool lifecycle for the agent service."""

from __future__ import annotations

import logging
from typing import Optional, Any

import asyncpg

from agent.configs.settings import settings
from agent.db.repositories import DatabaseRepositories

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def init_pool() -> None:
    """Create the module-level connection pool. Call once at application startup."""
    global _pool
    _pool = await asyncpg.create_pool(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        database=settings.DB_NAME,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        min_size=settings.DB_POOL_MIN,
        max_size=settings.DB_POOL_MAX,
    )
    logger.info(
        "asyncpg pool created: %s:%s/%s (pool %s-%s)",
        settings.DB_HOST,
        settings.DB_PORT,
        settings.DB_NAME,
        settings.DB_POOL_MIN,
        settings.DB_POOL_MAX,
    )

    repositories = DatabaseRepositories.from_pool(_pool)
    await repositories.snapshots.ensure_unique_index()


async def close_pool() -> None:
    """Gracefully close the connection pool. Call on server shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("asyncpg pool closed.")


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError(
            "Database pool is not initialised. Call await init_pool() at startup."
        )
    return _pool


async def get_attachments(reference_id: str) -> list[dict[str, Any]]:
    """Fetch all uploaded attachments for a given session/agent."""
    pool = get_pool()
    repos = DatabaseRepositories.from_pool(pool)
    return await repos.attachments.get_attachments(reference_id)


async def get_latest_evaluation(reference_id: str) -> dict[str, Any] | None:
    """Fetch the most recent RAG evaluation result for a session."""
    pool = get_pool()
    repos = DatabaseRepositories.from_pool(pool)
    return await repos.evaluations.get_latest_evaluation(reference_id)


async def save_r2_image_artifact(
    team_id: str,
    key: str,
    title: str,
    public_url: str,
    *,
    repositories: DatabaseRepositories | None = None,
) -> str:
    """
    Compatibility wrapper for image artifact persistence.

    Prefer an already-constructed repository bundle when available so callers
    with session-scoped repositories keep their existing behavior.
    """
    repos = repositories or DatabaseRepositories.from_pool(get_pool())
    return await repos.artifacts.save_r2_image_artifact(
        team_id=team_id,
        key=key,
        title=title,
        public_url=public_url,
    )
