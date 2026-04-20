from __future__ import annotations

import asyncpg


class PoolRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool


def count_affected_rows(status: str) -> int:
    return int(status.split()[-1])