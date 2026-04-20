"""Async web search and page-research tools for agent use."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import re
from typing import Annotated, Any
from urllib.parse import parse_qs, unquote, urlparse

import aiohttp
from agent_framework import tool
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from agent.configs.settings import settings

try:
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover - dependency guard for runtime environments
    BeautifulSoup = None  # type: ignore[assignment]

try:
    from ddgs import DDGS
except ImportError:  # pragma: no cover - dependency guard for runtime environments
    DDGS = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 86400
_MAX_PAGE_TEXT_CHARS = 30000
_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
_BASE_REQUEST_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
_USER_AGENT_POOL: list[tuple[str, str]] = [
    (
        "chrome_windows",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ),
    (
        "chrome_macos",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ),
    (
        "firefox_windows",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    ),
    (
        "safari_macos",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ),
    (
        "openai_searchbot",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; "
        "OAI-SearchBot/1.3; +https://openai.com/searchbot",
    ),
    (
        "gpt_bot",
        "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); "
        "compatible; GPTBot/1.3; +https://openai.com/gptbot",
    ),
    (
        "chatgpt_user_bot",
        "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); "
        "compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    ),
]
_WEB_RESEARCH_SYSTEM_PROMPT = (
    "You are a strict data extractor. Use only the provided page text. "
    "Answer only with the minimum text needed to address the target question. "
    "Do not use outside knowledge, do not infer unstated facts, and do not add commentary. "
    'If the answer is not present in the page text, return exactly "Information not found on this page."'
)


class WebSearchInput(BaseModel):
    """Input schema for the web search tool."""

    query: Annotated[
        str,
        Field(
            description="The web search query to run against DuckDuckGo.",
            examples=["latest EGCO sustainability report", "redis asyncio tutorial"],
        ),
    ]
    max_results: Annotated[
        int,
        Field(
            description="The exact number of normalized results to return.",
            ge=1,
            le=20,
            default=5,
        ),
    ] = 5


class WebResearchInput(BaseModel):
    """Input schema for the web research tool."""

    url: Annotated[
        str,
        Field(
            description="The full page URL to fetch and inspect.",
            examples=["https://example.com/report"],
        ),
    ]
    target_question: Annotated[
        str,
        Field(
            description=(
                "The specific question to answer from the fetched page. "
                "Keep it narrow and factual."
            ),
            examples=["What deadline is listed on the page?"],
        ),
    ]


class WebToolCache:
    """Small Redis-backed cache wrapper for web tools."""

    def __init__(self) -> None:
        self._redis = Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            decode_responses=True,
        )

    async def get(self, key: str) -> str | None:
        """Read a cache entry, returning ``None`` on cache errors."""
        try:
            return await self._redis.get(key)
        except Exception as exc:
            logger.warning("Web tool cache read failed for %s: %s", key, exc)
            return None

    async def set(self, key: str, value: str) -> None:
        """Write a cache entry, suppressing cache errors."""
        try:
            await self._redis.set(key, value, ex=_CACHE_TTL_SECONDS)
        except Exception as exc:
            logger.warning("Web tool cache write failed for %s: %s", key, exc)


def _json_error(message: str) -> str:
    """Return a clean JSON error payload for agent consumption."""
    return json.dumps({"error": message})


def _normalize_search_results(raw_results: list[dict[str, Any]], max_results: int) -> str:
    """Normalize DuckDuckGo search results into a compact JSON payload."""
    normalized: list[dict[str, str]] = []
    for item in raw_results[:max_results]:
        normalized.append(
            {
                "title": str(item.get("title") or ""),
                "link": str(item.get("link") or item.get("href") or ""),
                "body": str(item.get("body") or item.get("snippet") or ""),
            }
        )

    while len(normalized) < max_results:
        normalized.append({"title": "", "link": "", "body": ""})

    return json.dumps(normalized)


def _resolve_duckduckgo_result_href(href: str) -> str:
    """Resolve DuckDuckGo redirect links to their real target URL."""
    raw_href = href.strip()
    if not raw_href:
        return ""
    if raw_href.startswith("//"):
        raw_href = f"https:{raw_href}"
    parsed = urlparse(raw_href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        uddg = parse_qs(parsed.query).get("uddg", [])
        if uddg:
            return unquote(uddg[0])
    return raw_href


def _randomized_user_agent_profiles() -> list[tuple[str, str]]:
    """Return shuffled UA profiles with no-UA as last fallback."""
    randomized = list(_USER_AGENT_POOL)
    random.shuffle(randomized)
    randomized.append(("none", ""))
    return randomized


def _headers_for_user_agent(user_agent: str) -> dict[str, str]:
    """Build request headers for a selected user-agent profile."""
    headers = dict(_BASE_REQUEST_HEADERS)
    if user_agent:
        headers["User-Agent"] = user_agent
    return headers


async def _fetch_with_user_agent_pool(
    url: str,
    *,
    params: dict[str, str] | None = None,
    allow_redirects: bool = True,
) -> str:
    """Fetch text content, rotating user-agent profiles on failures."""
    timeout = aiohttp.ClientTimeout(total=30)
    last_exc: Exception | None = None

    for attempt, (profile_name, user_agent) in enumerate(
        _randomized_user_agent_profiles(),
        start=1,
    ):
        try:
            headers = _headers_for_user_agent(user_agent)
            async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                async with session.get(url, params=params, allow_redirects=allow_redirects) as response:
                    response.raise_for_status()
                    return await response.text()
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "web request failed, rotating user-agent profile "
                "url=%s attempt=%s profile=%s error=%s",
                url,
                attempt,
                profile_name,
                exc,
            )

    if last_exc is None:  # pragma: no cover - defensive guard
        raise RuntimeError("web request failed with unknown error")
    raise last_exc


def _extract_results_from_duckduckgo_html(html: str, max_results: int) -> list[dict[str, str]]:
    """Parse a small result set from DuckDuckGo-style HTML."""
    normalized: list[dict[str, str]] = []

    if BeautifulSoup is not None:
        soup = BeautifulSoup(html, "html.parser")
        for anchor in soup.select("a.result__a, a[href]"):
            href = _resolve_duckduckgo_result_href(str(anchor.get("href") or ""))
            title = anchor.get_text(" ", strip=True)
            if not href or not title:
                continue
            if href.startswith(("http://", "https://")):
                normalized.append({"title": title, "link": href, "body": ""})
            if len(normalized) >= max_results:
                break
        return normalized

    for href, title in re.findall(r'<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>', html, flags=re.I | re.S):
        clean_href = _resolve_duckduckgo_result_href(href)
        clean_title = re.sub(r"<[^>]+>", " ", title)
        clean_title = re.sub(r"\s+", " ", clean_title).strip()
        if clean_title and clean_href.startswith(("http://", "https://")):
            normalized.append({"title": clean_title, "link": clean_href, "body": ""})
        if len(normalized) >= max_results:
            break
    return normalized


async def _search_with_duckduckgo_html(query: str, max_results: int) -> str:
    """Fallback DuckDuckGo HTML search when duckduckgo-search is unavailable."""
    params = {"q": query}
    html = await _fetch_with_user_agent_pool(
        "https://duckduckgo.com/html/",
        params=params,
        allow_redirects=True,
    )

    normalized = _extract_results_from_duckduckgo_html(html, max_results)
    if not normalized:
        raise RuntimeError("DuckDuckGo HTML fallback returned no parseable results")

    while len(normalized) < max_results:
        normalized.append({"title": "", "link": "", "body": ""})
    return json.dumps(normalized)


def _search_with_ddgs_sync(query: str, max_results: int) -> list[dict[str, Any]]:
    """Run the current synchronous DuckDuckGo client."""
    if DDGS is None:  # pragma: no cover - guarded by caller
        raise RuntimeError("DuckDuckGo sync client is unavailable")
    client = DDGS()
    return client.text(query, max_results=max_results)


def _research_cache_key(url: str, target_question: str) -> str:
    """Build the deterministic research cache key from URL and question."""
    digest = hashlib.sha256(f"{url}|{target_question}".encode("utf-8")).hexdigest()
    return f"web_research:{digest}"


def _clean_page_text(html: str) -> str:
    """Extract the relevant text from raw HTML and trim it for model input."""
    if BeautifulSoup is not None:
        soup = BeautifulSoup(html, "html.parser")
        for tag_name in ("script", "style", "nav", "header", "footer"):
            for node in soup.find_all(tag_name):
                node.decompose()
        text = soup.get_text(separator=" ", strip=True)
    else:  # pragma: no cover - exercised only when optional dependency is absent
        text = html
        for tag_name in ("script", "style", "nav", "header", "footer"):
            text = re.sub(
                rf"<{tag_name}\b[^>]*>.*?</{tag_name}>",
                " ",
                text,
                flags=re.IGNORECASE | re.DOTALL,
            )
        text = re.sub(r"<[^>]+>", " ", text)

    text = re.sub(r"\s+", " ", text).strip()
    return text[:_MAX_PAGE_TEXT_CHARS]


async def _fetch_page_html(url: str) -> str:
    """Fetch raw HTML asynchronously with aiohttp."""
    return await _fetch_with_user_agent_pool(url)


async def _summarize_page_text(target_question: str, page_text: str) -> str:
    """Ask the OpenRouter-backed LLM to extract an answer from the page text."""
    client = AsyncOpenAI(
        api_key=settings.OPENROUTER_API_KEY,
        base_url=_OPENROUTER_BASE_URL,
        max_retries=0,
    )
    try:
        response = await client.chat.completions.create(
            model=settings.MODEL,
            temperature=0.0,
            messages=[
                {"role": "system", "content": _WEB_RESEARCH_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Target question: {target_question}\n\n"
                        "Page text:\n"
                        f"{page_text}\n\n"
                        'Return only the answer or exactly "Information not found on this page."'
                    ),
                },
            ],
        )
        return response.choices[0].message.content or "Information not found on this page."
    finally:
        await client.close()


@tool(
    name="web_search",
    description=(
        "Search the public web with DuckDuckGo and return compact JSON results with title, link, "
        "and snippet text. Use this first when you need candidate pages to inspect before deeper research."
    ),
    schema=WebSearchInput,
    max_invocations=10,
)
async def web_search_tool(query: str, max_results: int = 5, **kwargs: object) -> str:
    """
    Search the web asynchronously and return normalized JSON search results.

    Call this tool when you need a small list of candidate pages for follow-up
    browsing. The result is always a JSON string. On success it is a JSON array
    of exactly ``max_results`` objects containing ``title``, ``link``, and
    ``body``. On failure it is a JSON object with an ``error`` field.
    """
    cache = WebToolCache()
    cache_key = f"search:{query}"

    cached = await cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        if DDGS is not None:
            raw_results = await asyncio.to_thread(_search_with_ddgs_sync, query, max_results)
            normalized = _normalize_search_results(raw_results, max_results)
        else:
            logger.warning("DuckDuckGo Python client unavailable; falling back to HTML search")
            normalized = await _search_with_duckduckgo_html(query, max_results)
        await cache.set(cache_key, normalized)
        return normalized
    except Exception as exc:
        logger.exception("web_search failed for query=%r: %s", query, exc)
        return _json_error(str(exc))


@tool(
    name="web_research",
    description=(
        "Fetch one web page, strip noisy HTML sections, and ask an OpenRouter LLM to answer a narrow "
        "question using only that page's text. Use this after you already know which URL you want to inspect."
    ),
    schema=WebResearchInput,
    max_invocations=10,
)
async def web_research_tool(url: str, target_question: str, **kwargs: object) -> str:
    """
    Research a single web page asynchronously and extract only the answer you need.

    Call this tool when you already have a URL and need a factual answer from
    that page alone. The tool fetches the HTML, removes noisy sections, truncates
    the remaining text to protect the context window, and prompts the LLM with a
    strict extraction instruction. On success it returns a plain string answer.
    On failure it returns a JSON object with an ``error`` field.
    """
    cache = WebToolCache()
    cache_key = _research_cache_key(url, target_question)

    cached = await cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        html = await _fetch_page_html(url)
        page_text = _clean_page_text(html)
        answer = await _summarize_page_text(target_question, page_text)
        await cache.set(cache_key, answer)
        return answer
    except Exception as exc:
        logger.exception("web_research failed for url=%r: %s", url, exc)
        return _json_error(str(exc))
