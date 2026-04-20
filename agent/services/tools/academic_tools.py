"""
Academic search tools — let agents search academic papers via OpenAlex API (primary)
and arXiv API (secondary) with Redis caching for performance.

OpenAlex: Comprehensive academic database across all disciplines
arXiv: Preprint repository for physics, computer science, mathematics, biology

Call search_academic_papers for general academic searches.
Call search_arxiv for recent preprints in STEM fields.
Results are cached in Redis for 24 hours to reduce API calls.
"""

import hashlib
import json
import logging
from typing import Annotated, Any

import httpx
from agent_framework import tool
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from agent.configs.settings import settings

logger = logging.getLogger(__name__)

# Cache TTL: 24 hours
_CACHE_TTL = 86400
_MAX_COMBINED_OUTPUT_CHARS = 12000
_MAX_TOOL_OUTPUT_CHARS = 6000


class AcademicSearchCache:
    """Redis-backed cache for academic search results."""

    def __init__(self) -> None:
        self._redis = Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            decode_responses=True,
        )
        self._logger = logging.getLogger(__name__)

    def _get_cache_key(self, api: str, query: str, **kwargs: Any) -> str:
        """Create a unique cache key based on API and query parameters."""
        # Sort kwargs for consistent key generation
        sorted_kwargs = sorted(kwargs.items())
        key_data = f"{api}:{query}:{sorted_kwargs}"
        hash_digest = hashlib.md5(key_data.encode()).hexdigest()
        return f"academic:cache:{api}:{hash_digest}"

    async def get_by_key(self, cache_key: str) -> str | None:
        """Retrieve a raw cached string by key."""
        try:
            cached = await self._redis.get(cache_key)
            return cached or None
        except Exception as exc:
            self._logger.warning(f"Academic cache read failed: {exc}")
            return None

    async def set_by_key(self, cache_key: str, value: str) -> None:
        """Store a raw cached string by key."""
        try:
            await self._redis.set(cache_key, value, ex=_CACHE_TTL)
        except Exception as exc:
            self._logger.warning(f"Academic cache write failed: {exc}")

    async def get(self, api: str, query: str, **kwargs: Any) -> list[dict[str, Any]] | None:
        """Retrieve cached results if available."""
        try:
            cache_key = self._get_cache_key(api, query, **kwargs)
            cached = await self._redis.get(cache_key)
            if cached:
                self._logger.info(f"Cache hit for {api} query: {query[:50]}...")
                return json.loads(cached)
        except Exception as exc:
            self._logger.warning(f"Academic cache read failed: {exc}")
        return None

    async def set(
        self, api: str, query: str, results: list[dict[str, Any]], **kwargs: Any
    ) -> None:
        """Cache search results with TTL."""
        try:
            cache_key = self._get_cache_key(api, query, **kwargs)
            await self._redis.set(cache_key, json.dumps(results), ex=_CACHE_TTL)
            self._logger.info(f"Cached {len(results)} results for {api} query: {query[:50]}...")
        except Exception as exc:
            self._logger.warning(f"Academic cache write failed: {exc}")


# ---------------------------------------------------------------------------
# OpenAlex API Search Tool
# ---------------------------------------------------------------------------

class SearchOpenAlexInput(BaseModel):
    query: Annotated[
        str,
        Field(
            description="Search query for academic papers (keywords, title, author, etc.)",
            examples=["machine learning in healthcare", "quantum computing"],
        ),
    ]
    limit: Annotated[
        int,
        Field(
            description="Maximum number of results to return (1-100)",
            ge=1,
            le=100,
            default=10,
        ),
    ] = 10


@tool(
    name="search_openalex",
    description=(
        "Search academic papers across all disciplines using OpenAlex API. "
        "Returns paper titles, authors, publication year, journal/conference, abstract, and citations. "
        "Use this for comprehensive academic searches in any field. "
        "Results are cached for 24 hours. Call this before arXiv for general academic research."
    ),
    schema=SearchOpenAlexInput,
    max_invocations=10,
)
async def search_openalex_tool(query: str, limit: int = 10, **kwargs: object) -> str:
    """Search OpenAlex API for academic papers."""
    # Check cache first
    cache = AcademicSearchCache()
    cached_results = await cache.get("openalex", query, limit=limit)
    if cached_results:
        return _format_openalex_results(cached_results, query, from_cache=True)

    # API request
    url = "https://api.openalex.org/works"
    params = {
        "search": query,
        "per_page": min(limit, 100),
        "select": "id,title,display_name,authorships,publication_year,primary_location,abstract_inverted_index,cited_by_count,doi",
    }
    
    # Add optional API key and mailto (polite pool)
    if settings.OPENALEX_API_KEY:
        params["api_key"] = settings.OPENALEX_API_KEY
    if settings.OPENALEX_MAILTO:
        params["mailto"] = settings.OPENALEX_MAILTO

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPError as exc:
            logger.error(f"OpenAlex API error: {exc}")
            return f"Failed to search OpenAlex: {exc}"
        except Exception as exc:
            logger.error(f"OpenAlex unexpected error: {exc}")
            return f"OpenAlex search failed: {exc}"

    results = data.get("results", [])

    # Cache the results
    await cache.set("openalex", query, results, limit=limit)

    return _format_openalex_results(results, query, from_cache=False)


def _format_openalex_results(
    results: list[dict[str, Any]], query: str, from_cache: bool
) -> str:
    """Format OpenAlex API results for agent consumption."""
    if not results:
        return f"No papers found in OpenAlex for query: '{query}'"

    cache_note = " (from cache)" if from_cache else ""
    lines = [
        f"OpenAlex Search Results{cache_note} for: '{query}'",
        f"Found {len(results)} papers\n",
    ]

    for i, paper in enumerate(results, 1):
        title = paper.get("display_name") or paper.get("title", "Untitled")
        year = paper.get("publication_year", "n.d.")

        # Authors
        authors_list = paper.get("authorships", [])
        authors = []
        for a in authors_list[:3]:  # Show first 3 authors
            author_name = a.get("author", {}).get("display_name", "Unknown")
            authors.append(author_name)
        authors_str = ", ".join(authors)
        if len(authors_list) > 3:
            authors_str += " et al."

        # Venue
        primary_location = paper.get("primary_location", {}) or {}
        source = primary_location.get("source", {}) if isinstance(primary_location, dict) else {}
        venue_name = source.get("display_name") if isinstance(source, dict) else None

        # Citations
        citations = paper.get("cited_by_count", 0)

        # DOI
        doi = paper.get("doi")

        lines.append(f"[{i}] {title}")
        lines.append(f"    Authors: {authors_str}")
        lines.append(f"    Year: {year}")
        if venue_name:
            lines.append(f"    Venue: {venue_name}")
        lines.append(f"    Citations: {citations}")
        if doi:
            lines.append(f"    DOI: {doi}")
        
        # Abstract reconstruction
        abstract_data = paper.get("abstract_inverted_index")
        abstract = _reconstruct_openalex_abstract(abstract_data)
        if abstract:
            if len(abstract) > 300:
                abstract = abstract[:300] + "..."
            lines.append(f"    Abstract: {abstract}")

        lines.append("")

    return _cap_output("\n".join(lines), _MAX_TOOL_OUTPUT_CHARS)


def _reconstruct_openalex_abstract(inverted_index: dict[str, list[int]] | None) -> str | None:
    """Reconstruct a readable abstract from OpenAlex inverted index format."""
    if not inverted_index:
        return None
    
    # Inverted index structure: {"word": [positions]}
    try:
        # Create a list of words, ordered by their positions
        word_positions = []
        for word, positions in inverted_index.items():
            for pos in positions:
                word_positions.append((pos, word))
        
        # Sort by position
        word_positions.sort()
        
        # Join words
        return " ".join(word for pos, word in word_positions)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# arXiv API Search Tool
# ---------------------------------------------------------------------------

class SearchArxivInput(BaseModel):
    query: Annotated[
        str,
        Field(
            description="Search query for arXiv preprints (keywords, title, author)",
            examples=["deep learning", "quantum entanglement", "neural networks"],
        ),
    ]
    limit: Annotated[
        int,
        Field(
            description="Maximum number of results to return (1-50)",
            ge=1,
            le=50,
            default=10,
        ),
    ] = 10
    category: Annotated[
        str | None,
        Field(
            description="Optional arXiv category to filter by (e.g., 'cs.AI', 'physics', 'math', 'q-bio')",
            examples=["cs.AI", "cs.LG", "physics", "math", "q-bio"],
        ),
    ] = None


@tool(
    name="search_arxiv",
    description=(
        "Search preprints on arXiv for physics, computer science, mathematics, and biology. "
        "Returns paper titles, authors, abstract, arXiv ID, category, and publication date. "
        "Use this for cutting-edge research and recent preprints in STEM fields. "
        "Results are cached for 24 hours. Specify category for focused searches (e.g., 'cs.AI' for AI papers)."
    ),
    schema=SearchArxivInput,
    max_invocations=10,
)
async def search_arxiv_tool(
    query: str, limit: int = 10, category: str | None = None, **kwargs: object
) -> str:
    """Search arXiv API for preprints."""
    # Check cache first
    cache = AcademicSearchCache()
    cached_results = await cache.get("arxiv", query, limit=limit, category=category)
    if cached_results:
        return _format_arxiv_results(cached_results, query, category, from_cache=True)

    # Build arXiv API query
    # arXiv API: https://export.arxiv.org/api/query
    base_query = f"all:{query}"
    if category:
        base_query = f"({base_query}) AND cat:{category}"

    url = "https://export.arxiv.org/api/query"
    params = {
        "search_query": base_query,
        "start": 0,
        "max_results": min(limit, 50),
        "sortBy": "relevance",
        "sortOrder": "descending",
    }

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            # Parse Atom XML response
            import xml.etree.ElementTree as ET
            root = ET.fromstring(response.text)
            namespace = {"atom": "http://www.w3.org/2005/Atom"}

            results = []
            for entry in root.findall("atom:entry", namespace):
                paper: dict[str, Any] = {}
                
                title_elem = entry.find("atom:title", namespace)
                paper["title"] = title_elem.text.strip() if title_elem is not None and title_elem.text else "Untitled"
                
                authors = [
                    author.text
                    for author in entry.findall("atom:author/atom:name", namespace)
                    if author.text
                ]
                paper["authors"] = authors
                
                summary_elem = entry.find("atom:summary", namespace)
                paper["summary"] = summary_elem.text.strip() if summary_elem is not None and summary_elem.text else ""
                
                id_elem = entry.find("atom:id", namespace)
                paper["arxiv_id"] = id_elem.text if id_elem is not None and id_elem.text else ""
                
                published_elem = entry.find("atom:published", namespace)
                paper["published"] = published_elem.text if published_elem is not None and published_elem.text else ""
                
                categories = [
                    cat.get("term")
                    for cat in entry.findall("atom:category", namespace)
                    if cat.get("term")
                ]
                paper["categories"] = categories
                
                results.append(paper)
        except httpx.HTTPError as exc:
            logger.error(f"arXiv API error: {exc}")
            return f"Failed to search arXiv: {exc}"
        except ET.ParseError as exc:
            logger.error(f"arXiv XML parse error: {exc}")
            return f"arXiv response parsing failed: {exc}"
        except Exception as exc:
            logger.error(f"arXiv unexpected error: {exc}")
            return f"arXiv search failed: {exc}"

    # Cache the results
    await cache.set("arxiv", query, results, limit=limit, category=category)

    return _format_arxiv_results(results, query, category, from_cache=False)


def _format_arxiv_results(
    results: list[dict[str, Any]], query: str, category: str | None, from_cache: bool
) -> str:
    """Format arXiv API results for agent consumption."""
    if not results:
        cat_note = f" in category '{category}'" if category else ""
        return f"No papers found on arXiv for query: '{query}'{cat_note}"

    cache_note = " (from cache)" if from_cache else ""
    cat_note = f" in category '{category}'" if category else ""
    lines = [
        f"arXiv Search Results{cache_note} for: '{query}'{cat_note}",
        f"Found {len(results)} preprints\n",
    ]

    for i, paper in enumerate(results, 1):
        title = paper.get("title", "Untitled")
        authors = ", ".join(paper.get("authors", [])[:3])
        if len(paper.get("authors", [])) > 3:
            authors += " et al."

        # Truncate abstract
        summary = paper.get("summary", "")
        if len(summary) > 300:
            summary = summary[:300] + "..."

        # arXiv ID and link
        arxiv_id = paper.get("arxiv_id", "")

        # Publication date
        published = paper.get("published", "")[:10] if paper.get("published") else ""

        # Categories
        categories = paper.get("categories", [])

        lines.append(f"[{i}] {title}")
        lines.append(f"    Authors: {authors}")
        lines.append(f"    Published: {published}")
        lines.append(f"    Categories: {', '.join(categories[:3])}")
        lines.append(f"    arXiv ID: {arxiv_id}")
        lines.append(f"    Abstract: {summary}")
        lines.append("")

    return _cap_output("\n".join(lines), _MAX_TOOL_OUTPUT_CHARS)


def _cap_output(text: str, max_chars: int) -> str:
    """Cap tool output length to protect the agent context window."""
    if len(text) <= max_chars:
        return text
    truncated_suffix = "\n[truncated]"
    return text[: max_chars - len(truncated_suffix)] + truncated_suffix


def _combined_cache_key(query: str, limit: int, prefer_recent: bool) -> str:
    """Build a deterministic cache key for combined academic search results."""
    key_data = f"combined:{query}:{limit}:{prefer_recent}"
    return f"academic:cache:combined:{hashlib.md5(key_data.encode()).hexdigest()}"


def _split_limits(limit: int) -> tuple[int, int]:
    """Split a requested limit across OpenAlex and arXiv without exceeding it."""
    openalex_limit = max(1, (limit + 1) // 2)
    arxiv_limit = max(0, limit - openalex_limit)
    return openalex_limit, arxiv_limit


# ---------------------------------------------------------------------------
# Combined Academic Search Tool
# ---------------------------------------------------------------------------

class SearchAcademicPapersInput(BaseModel):
    query: Annotated[
        str,
        Field(
            description="Search query for academic papers",
            examples=["transformer architecture", "CRISPR gene editing"],
        ),
    ]
    limit: Annotated[
        int,
        Field(
            description="Total maximum number of results across both APIs (1-50)",
            ge=1,
            le=50,
            default=15,
        ),
    ] = 15
    prefer_recent: Annotated[
        bool,
        Field(
            description="If True, prioritize recent papers (last 3 years). Use for fast-moving fields.",
            default=False,
        ),
    ] = False


@tool(
    name="search_academic_papers",
    description=(
        "Search academic papers using both OpenAlex and arXiv APIs. "
        "Automatically chooses the best source based on the query and combines results. "
        "OpenAlex provides peer-reviewed papers across all disciplines. "
        "arXiv provides recent preprints for STEM fields. "
        "Results are cached for 24 hours. Use this as your default academic search tool."
    ),
    schema=SearchAcademicPapersInput,
    max_invocations=10,
)
async def search_academic_papers_tool(
    query: str, limit: int = 15, prefer_recent: bool = False, **kwargs: object
) -> str:
    """
    Search academic papers using both OpenAlex and arXiv APIs.
    Intelligently combines results from both sources.
    """
    import asyncio

    cache = AcademicSearchCache()
    combined_cache_key = _combined_cache_key(query, limit, prefer_recent)
    cached_combined = await cache.get_by_key(combined_cache_key)
    if cached_combined:
        return cached_combined

    # Determine split between APIs
    openalex_limit, arxiv_limit = _split_limits(limit)

    # Run both searches concurrently
    openalex_task = search_openalex_tool(query, openalex_limit)
    arxiv_task = search_arxiv_tool(query, arxiv_limit)

    openalex_result, arxiv_result = await asyncio.gather(
        openalex_task, arxiv_task, return_exceptions=True
    )

    # Handle errors gracefully
    if isinstance(openalex_result, Exception):
        logger.error(f"OpenAlex search failed in combined tool: {openalex_result}")
        openalex_result = f"OpenAlex unavailable: {openalex_result}"
    if isinstance(arxiv_result, Exception):
        logger.error(f"arXiv search failed in combined tool: {arxiv_result}")
        arxiv_result = f"arXiv unavailable: {arxiv_result}"

    # Combine results
    combined_lines = [
        "=== Academic Search Results (OpenAlex + arXiv) ===",
        f"Query: '{query}' (limit={limit}, recent={prefer_recent})\n",
        "--- OpenAlex Results ---",
        openalex_result,
        "",
        "--- arXiv Results ---",
        arxiv_result,
    ]

    combined_result = _cap_output("\n".join(combined_lines), _MAX_COMBINED_OUTPUT_CHARS)
    await cache.set_by_key(combined_cache_key, combined_result)
    return combined_result
