import hashlib
import json
import logging
from typing import Optional

import httpx
from redis.asyncio import Redis

from agent.configs.settings import settings

logger = logging.getLogger(__name__)

_MODEL = settings.OPENROUTER_EMBED_MODEL
_DIMS = 2048  # Match pgvector column limit in egco-capstone schema
_CACHE_TTL = 86400  # 1 day


class EmbeddingService:
    """Thin async wrapper around the OpenRouter/OpenAI-compatible embeddings API."""

    def __init__(self, api_key: Optional[str] = None, embed_url: Optional[str] = None) -> None:
        self._api_key = api_key or settings.OPENROUTER_API_KEY
        self._embed_url = embed_url or settings.OPENROUTER_EMBED_URL
        self._redis = self._new_redis_client()

    def _new_redis_client(self) -> Redis:
        return Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            decode_responses=True,
        )

    async def _reset_redis_client(self) -> None:
        old_client = self._redis
        self._redis = self._new_redis_client()
        try:
            await old_client.aclose()
        except Exception:
            # Best effort close; the old loop may already be closed.
            pass

    @staticmethod
    def _is_event_loop_closed_error(exc: Exception) -> bool:
        return "event loop is closed" in str(exc).lower()

    def _get_cache_key(self, session_id: str, text: str) -> str:
        """Create a unique cache key based on model, session and content hash."""
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        # Key format: embed:cache:{model}:{session_id}:{hash}
        return f"embed:cache:{_MODEL}:{session_id}:{h}"

    async def embed_query(self, session_id: str, text: str) -> list[float]:
        """
        Generate a vector embedding for *text* using OpenRouter.

        Raises
        ------
        httpx.HTTPStatusError
            If the API returns a non-2xx status.
        ValueError
            If the response does not contain the expected embedding data.
        """
        embeddings = await self.embed_queries(session_id, [text])
        if not embeddings:
            raise ValueError("No embeddings returned from API")
        return embeddings[0]

    async def embed_queries(self, session_id: str, texts: list[str]) -> list[list[float]]:
        """
        Generate vector embeddings for a list of *texts* using OpenRouter.
        Uses Redis to cache results, scoped by session_id.

        Raises
        ------
        httpx.HTTPStatusError
            If the API returns a non-2xx status.
        ValueError
            If the response does not contain the expected embedding data.
        """
        if not texts:
            return []

        # 1. Check cache first (scoped by session)
        cache_keys = [self._get_cache_key(session_id, t) for t in texts]
        cached_results = []
        try:
            cached_results = await self._redis.mget(cache_keys)
        except Exception as e:
            if self._is_event_loop_closed_error(e):
                logger.warning("Embedding cache read failed due to closed loop; resetting Redis client")
                await self._reset_redis_client()
                try:
                    cached_results = await self._redis.mget(cache_keys)
                except Exception as retry_e:
                    logger.warning(f"Embedding cache read failed after reset: {retry_e}")
                    cached_results = [None] * len(texts)
            else:
                logger.warning(f"Embedding cache read failed: {e}")
                cached_results = [None] * len(texts)

        final_results = [None] * len(texts)
        to_fetch_indices = []
        to_fetch_texts = []

        for i, val in enumerate(cached_results):
            if val:
                try:
                    final_results[i] = json.loads(val)
                    continue
                except Exception:
                    pass
            
            to_fetch_indices.append(i)
            to_fetch_texts.append(texts[i])

        # 2. Fetch missing results from API
        if to_fetch_texts:
            logger.info(f"Fetching {len(to_fetch_texts)} embeddings from API for session {session_id} (cache miss)")
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    self._embed_url,
                    json={
                        "model": _MODEL,
                        "input": to_fetch_texts,
                        "dimensions": _DIMS,
                    },
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://slipumbrella.com",
                        "X-Title": "slipumbrella embedding service",
                    },
                )
                response.raise_for_status()

            data = response.json().get("data")
            if not data or not isinstance(data, list):
                raise ValueError(f"Unexpected OpenRouter response shape: {response.text[:200]}")

            # 3. Process API response and store in cache
            pipe = self._redis.pipeline()
            for i, item in enumerate(data):
                # The API returns results in order, but includes "index" just in case.
                # However, our to_fetch_texts is already a subset.
                remote_idx = item.get("index", i)
                if remote_idx >= len(to_fetch_indices):
                    continue
                    
                local_idx = to_fetch_indices[remote_idx]
                vector = item["embedding"]
                final_results[local_idx] = vector
                
                # Update cache
                cache_key = cache_keys[local_idx]
                pipe.set(cache_key, json.dumps(vector), ex=_CACHE_TTL)
            
            try:
                await pipe.execute()
            except Exception as e:
                if self._is_event_loop_closed_error(e):
                    logger.warning("Embedding cache write failed due to closed loop; resetting Redis client")
                    await self._reset_redis_client()
                else:
                    logger.warning(f"Embedding cache write failed: {e}")
        
        # Final safety check
        if any(v is None for v in final_results):
            return [v for v in final_results if v is not None]

        return final_results


# Module-level singleton — callers should import this instance.
embedding_service = EmbeddingService()
