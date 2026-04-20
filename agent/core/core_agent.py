import asyncio
import contextlib
import json
import logging
import re
import uuid
import pydantic_core
from collections.abc import AsyncGenerator, Callable
from datetime import datetime, timezone
from typing import Any, Awaitable, Optional, cast

from agent_framework import (
    AgentSession,
    Workflow,
    SupportsAgentRun,
    AgentResponseUpdate,
)

from agent.core.llm_config import get_llm_config
from agent.core.spec import PlanSpec, AgentSpec
from agent.core.agent_factory.factory import AgentFactory
from agent.core.orchestration.builder import OrchestrationBuilder
from agent.core.session_manager import SessionManager, Session, ExecutionRunState
from agent.core.context_manager import MemoryContextProvider
from agent.core.types import (
    StreamEventDict,
    ChunkEventDict,
    AgentInfoDict,
    SidebandWorkflowEventDict,
    UsageEventDict,
    WorkflowPresentationPromptEventDict,
)
from agent.db.checkpoint_storage import PostgresCheckpointStorage
from agent.db.repositories import DatabaseRepositories

# ─── Internal Utilities ─────────────────────────────────────────────────


class _ThinkingFilter:
    """Strips <think>...</think> and <thinking>...</thinking> blocks from streamed text.

    Handles both tag variants produced by different LLMs.  Checked longest-first
    so <thinking> is matched before <think> when they share a common prefix.
    """

    _OPEN_TAGS = ("<thinking>", "<think>")

    def __init__(self) -> None:
        self._in_thinking = False
        self._close_tag = ""
        self._buf = ""

    def feed(self, chunk: str) -> str:
        output_parts: list[str] = []
        for char in chunk:
            if not self._in_thinking:
                self._buf += char
                matched = False
                for open_tag in self._OPEN_TAGS:
                    if self._buf == open_tag:
                        self._in_thinking = True
                        self._close_tag = open_tag.replace("<", "</")
                        self._buf = ""
                        matched = True
                        break
                    if open_tag.startswith(self._buf):
                        matched = True
                        break
                if not matched:
                    output_parts.append(self._buf)
                    self._buf = ""
            else:
                self._buf += char
                if self._buf.endswith(self._close_tag):
                    self._in_thinking = False
                    self._close_tag = ""
                    self._buf = ""
        return "".join(output_parts)

    def flush(self) -> str:
        """Emit any non-thinking buffered content at end of stream."""
        if not self._in_thinking:
            result = self._buf
            self._buf = ""
            return result
        return ""


class _EchoFilter:
    """Strips the user-prompt echo when an LLM begins its response by repeating the input."""

    def __init__(self, original_message: str) -> None:
        prompt = original_message.replace("\r\n", "\n").strip()
        self._prompt = prompt
        self._buf = ""
        self._decided = not bool(prompt)  # no-op when prompt is empty

    def feed(self, chunk: str) -> str:
        if self._decided:
            return chunk
        self._buf += chunk
        if len(self._buf) < len(self._prompt):
            if self._prompt.casefold().startswith(self._buf.casefold()):
                return ""  # Still accumulating — could be an echo
            self._decided = True
            result, self._buf = self._buf, ""
            return result
        # Have enough characters to decide.
        self._decided = True
        if self._buf.casefold().startswith(self._prompt.casefold()):
            result = self._buf[len(self._prompt) :].lstrip("\n\r ")
            self._buf = ""
            return result
        result, self._buf = self._buf, ""
        return result

    def flush(self) -> str:
        if not self._decided:
            self._decided = True
            result, self._buf = self._buf, ""
            return result
        return ""


def _strip_thinking_from_text(text: str) -> str:
    """Remove <think>…</think> and <thinking>…</thinking> blocks from a complete string."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(
        r"<thinking>.*?</thinking>", "", text, flags=re.DOTALL | re.IGNORECASE
    )
    return text.strip()


def _extract_text_payload(value: object) -> str:
    if isinstance(value, str):
        return value

    if isinstance(value, dict):
        for key in ("text", "content"):
            direct = value.get(key)
            if isinstance(direct, str) and direct:
                return direct

        for key in ("contents", "messages", "items", "outputs"):
            nested_list = value.get(key)
            if isinstance(nested_list, list):
                parts = [_extract_text_payload(item) for item in nested_list]
                joined = _join_text_fragments(parts)
                if joined:
                    return joined

        for key in (
            "message",
            "data",
            "response",
            "output",
            "result",
            "final_response",
        ):
            nested_value = value.get(key)
            nested_text = _extract_text_payload(nested_value)
            if nested_text:
                return nested_text

        return ""

    if isinstance(value, list):
        parts = [_extract_text_payload(item) for item in value]
        return _join_text_fragments(parts)

    text = getattr(value, "text", None)
    if isinstance(text, str) and text:
        return text

    content = getattr(value, "content", None)
    if isinstance(content, str) and content:
        return content

    contents = getattr(value, "contents", None)
    if isinstance(contents, list):
        parts = [_extract_text_payload(item) for item in contents]
        return _join_text_fragments(parts)

    return ""


def _join_text_fragments(parts: list[str]) -> str:
    fragments = [part for part in parts if isinstance(part, str) and part]
    if not fragments:
        return ""

    joined = fragments[0]
    for fragment in fragments[1:]:
        joined += _separator_between_fragments(joined, fragment) + fragment
    return joined


def _separator_between_fragments(left: str, right: str) -> str:
    if not left or not right:
        return ""

    left_trimmed = left.rstrip()
    right_trimmed = right.lstrip()
    if not left_trimmed or not right_trimmed:
        return ""

    if left.endswith(("\n", " ", "\t")) or right.startswith(("\n", " ", "\t")):
        return ""

    if left_trimmed in {"---", "***", "___"}:
        return "\n\n"

    last_rendered_line = (
        left_trimmed.splitlines()[-1] if left_trimmed.splitlines() else left_trimmed
    )
    if last_rendered_line.startswith("#"):
        return "\n\n"

    markdown_block_starts = ("#", "- ", "* ", "> ", "```")
    if right_trimmed.startswith(markdown_block_starts):
        return "\n\n"

    ordered_list_prefix = right_trimmed.split(" ", 1)[0]
    if ordered_list_prefix[:-1].isdigit() and ordered_list_prefix.endswith("."):
        return "\n\n"

    if right_trimmed[:1] in ".,!?;:%)]}":
        return ""

    if left_trimmed[-1:] in "([{":
        return ""

    return " "


def _extract_reply(outputs: list[object]) -> str:
    if not outputs:
        return ""
    last = outputs[-1]
    text = _extract_text_payload(last)
    if text:
        return text
    if isinstance(last, (str, int, float, bool)):
        return str(last)
    return ""


def _resolve_agent_id(session: Session, author_name: str) -> str:
    if not author_name:
        return "CoreAgent"
    for spec_id, agent_instance in session.agents.items():
        name = getattr(agent_instance, "name", "") or getattr(
            agent_instance, "role", ""
        )
        if name.lower() == author_name.lower():
            return spec_id
    return author_name


async def _cancel_task(task: asyncio.Task[object] | None) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, StopAsyncIteration):
        pass


def _normalize_title_text(value: str) -> str:
    return " ".join(
        "".join(
            char if char.isalnum() or char.isspace() else " " for char in value
        ).split()
    )


def _truncate_title(value: str, limit: int = 40) -> str:
    if len(value) <= limit:
        return value
    truncated = value[:limit].rstrip()
    if " " in truncated:
        truncated = truncated.rsplit(" ", 1)[0].rstrip()
    return truncated or value[:limit].rstrip()


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truncate_text(value: str, limit: int = 240) -> str:
    normalized = " ".join(value.split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def _extract_last_assistant_text(conv: list[dict[str, Any]]) -> str:
    """Return the text of the last assistant message in a full_conversation list.

    Each message in *conv* has shape:
        {"role": str, "type": str, "contents": [{"type": str, "text": str, ...}], ...}

    Returns an empty string if no assistant text message is found.
    """
    for message in reversed(conv):
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        text_parts: list[str] = []
        for content in message.get("contents", []):
            if isinstance(content, dict) and content.get("type") == "text":
                text = str(content.get("text") or "").strip()
                if text:
                    text_parts.append(text)
        joined = _join_text_fragments(text_parts)
        if joined:
            return joined
    return ""


def _extract_last_assistant_text_from_messages(messages: list[object]) -> str:
    """Return the text of the last assistant message from framework Message objects."""
    for message in reversed(messages):
        role = getattr(message, "role", None)
        if str(role or "").lower() != "assistant":
            continue

        text = _extract_text_payload(message)
        if text:
            return text
    return ""


def _assistant_text_candidates(conv: list[object]) -> list[str]:
    candidates: list[str] = []

    if conv and isinstance(conv[0], dict):
        for message in conv:
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            text_parts: list[str] = []
            for content in message.get("contents", []):
                if isinstance(content, dict) and content.get("type") == "text":
                    text = str(content.get("text") or "").strip()
                    if text:
                        text_parts.append(text)
            joined = _join_text_fragments(text_parts)
            if joined:
                candidates.append(joined)
        return candidates

    for message in conv:
        role = getattr(message, "role", None)
        if str(role or "").lower() != "assistant":
            continue
        text = _extract_text_payload(message)
        if text:
            candidates.append(text)
    return candidates


def _strip_recovery_preamble(text: str) -> str:
    normalized = text.replace("\r\n", "\n").strip()
    if not normalized:
        return ""

    lower_prefix = normalized[:400].casefold()
    recovery_markers = (
        "i apologize",
        "technical issue",
        "saving the artifact",
        "content below",
        "copy it directly",
        "copy it into your document",
    )
    if not any(marker in lower_prefix for marker in recovery_markers):
        return normalized

    heading_positions = [
        index
        for index in (
            normalized.find("\n# "),
            normalized.find("\n## "),
            normalized.find("# "),
            normalized.find("## "),
        )
        if index >= 0
    ]
    if not heading_positions:
        return normalized

    first_heading = min(heading_positions)
    candidate = normalized[first_heading:].lstrip("\n-")
    return candidate.lstrip() or normalized


def _strip_prompt_echo(text: str, original_message: str) -> str:
    normalized = text.replace("\r\n", "\n").strip()
    prompt = original_message.replace("\r\n", "\n").strip()
    if not normalized or not prompt:
        return normalized

    if not normalized.casefold().startswith(prompt.casefold()):
        return normalized

    remainder = normalized[len(prompt) :].lstrip()
    if not remainder:
        return normalized

    trimmed = remainder.lstrip("-\n ")
    return trimmed or normalized


def _response_candidate_score(text: str, *, original_message: str = "") -> int:
    normalized = text.replace("\r\n", "\n").strip()
    if not normalized:
        return -10_000

    lowered = normalized.casefold()
    score = min(len(normalized), 5000)

    if normalized.startswith("#") or "\n#" in normalized:
        score += 250
    if "|" in normalized:
        score += 120
    if "\n- " in normalized or "\n1. " in normalized:
        score += 120

    if lowered.startswith("i apologize"):
        score -= 2000
    if "technical issue" in lowered or "saving the artifact" in lowered:
        score -= 2000
    if "copy it directly" in lowered or "copy it into your document" in lowered:
        score -= 800
    if "would you like me to" in lowered:
        score -= 150
    if "verified against" in lowered and len(normalized) < 240:
        score -= 900
    if original_message and lowered.startswith(original_message.strip().casefold()):
        score -= 2500
    if len(normalized) < 80:
        score -= 200

    return score


def _select_preferred_response_text(
    candidates: list[str],
    *,
    original_message: str = "",
) -> str:
    best_text = ""
    best_score = -10_000

    for candidate in candidates:
        cleaned = _strip_recovery_preamble(candidate)
        if original_message:
            cleaned = _strip_prompt_echo(cleaned, original_message)
        score = _response_candidate_score(cleaned, original_message=original_message)
        if score > best_score:
            best_text = cleaned
            best_score = score

    return best_text


def _extract_preferred_assistant_text(conv: list[object]) -> str:
    candidates = _assistant_text_candidates(conv)
    if not candidates:
        return ""
    return _select_preferred_response_text(candidates)


def _should_keep_thinking_item(
    content_type: str,
    text: str,
    tool_name: str,
    arguments: str,
) -> bool:
    normalized_text = text.strip()
    normalized_tool = tool_name.strip()
    normalized_arguments = arguments.strip()

    if content_type == "text":
        return bool(normalized_text)
    if content_type == "text_reasoning":
        return bool(normalized_text)
    if content_type in {"function_call", "tool_call"}:
        return bool(normalized_tool or normalized_arguments or normalized_text)
    if content_type in {"function_result", "tool_result"}:
        return bool(normalized_text or normalized_arguments or normalized_tool)
    return bool(normalized_text or normalized_arguments or normalized_tool)


def _build_thinking_items_from_messages(messages: list[object]) -> list[dict[str, Any]]:
    """Convert framework Message objects to ThinkingItemDict-shaped dicts."""
    items: list[dict[str, Any]] = []
    for message in messages:
        role = str(getattr(message, "role", "") or "")
        if not role:
            continue

        pending_text_parts: list[str] = []

        def _flush_pending_text() -> None:
            joined_text = _join_text_fragments(pending_text_parts)
            if not joined_text:
                pending_text_parts.clear()
                return
            items.append(
                {
                    "role": role,
                    "content_type": "text",
                    "text": joined_text,
                    "tool_name": "",
                    "arguments": "",
                }
            )
            pending_text_parts.clear()

        contents = getattr(message, "contents", None)
        if not isinstance(contents, list):
            continue

        for content in contents:
            content_type = str(getattr(content, "type", "") or "")
            if not content_type:
                continue

            if content_type == "text":
                text = str(getattr(content, "text", "") or "")
                if text:
                    pending_text_parts.append(text)
                continue

            _flush_pending_text()
            text = str(getattr(content, "text", "") or "")
            tool_name = str(getattr(content, "name", "") or "")
            arguments = str(getattr(content, "arguments", "") or "")
            if _should_keep_thinking_item(content_type, text, tool_name, arguments):
                items.append(
                    {
                        "role": role,
                        "content_type": content_type,
                        "text": text,
                        "tool_name": tool_name,
                        "arguments": arguments,
                    }
                )

        _flush_pending_text()

    return items


def _build_thinking_items(conv: list[object]) -> list[dict[str, Any]]:
    """Convert a full_conversation list to a flat list of ThinkingItemDict-shaped dicts.

    Each conversation message may have multiple content items; each becomes one
    ThinkingItemDict.  Empty content lists are skipped entirely.

    Returns an empty list if *conv* is empty or malformed.
    """
    if conv and not isinstance(conv[0], dict):
        return _build_thinking_items_from_messages(conv)

    items: list[dict[str, Any]] = []
    for message in conv:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "")
        pending_text_parts: list[str] = []

        def _flush_pending_text() -> None:
            joined_text = _join_text_fragments(pending_text_parts)
            if not joined_text:
                pending_text_parts.clear()
                return
            items.append(
                {
                    "role": role,
                    "content_type": "text",
                    "text": joined_text,
                    "tool_name": "",
                    "arguments": "",
                }
            )
            pending_text_parts.clear()

        for content in message.get("contents", []):
            if not isinstance(content, dict):
                continue
            content_type = str(content.get("type") or "")
            if not content_type:
                continue
            if content_type == "text":
                text = str(content.get("text") or "")
                if text:
                    pending_text_parts.append(text)
                continue

            _flush_pending_text()
            text = str(content.get("text") or "")
            tool_name = str(content.get("name") or "")
            arguments = str(content.get("arguments") or "")
            if _should_keep_thinking_item(content_type, text, tool_name, arguments):
                items.append(
                    {
                        "role": role,
                        "content_type": content_type,
                        "text": text,
                        "tool_name": tool_name,
                        "arguments": arguments,
                    }
                )
        _flush_pending_text()
    return items


def _extract_response_text(value: object) -> str:
    text = _extract_text_payload(value)
    if text:
        return text

    nested_agent_response = getattr(value, "agent_response", None)
    if nested_agent_response is not None:
        nested_text = _extract_response_text(nested_agent_response)
        if nested_text:
            return nested_text

    full_conversation = getattr(value, "full_conversation", None)
    if isinstance(full_conversation, list):
        assistant_text = _extract_preferred_assistant_text(full_conversation)
        if assistant_text:
            return assistant_text

    response_text = getattr(value, "text", None)
    if isinstance(response_text, str) and response_text:
        return response_text

    messages = getattr(value, "messages", None)
    if isinstance(messages, list):
        parts: list[str] = []
        for message in messages:
            message_text = getattr(message, "text", None)
            if isinstance(message_text, str) and message_text:
                parts.append(message_text)
                continue
            message_contents = getattr(message, "contents", None)
            if isinstance(message_contents, list):
                extracted = _extract_text_payload(message_contents)
                if extracted:
                    parts.append(extracted)
        if parts:
            return "".join(parts)

    if isinstance(value, (str, int, float, bool)):
        return str(value)
    return ""


def _extract_workflow_result_payload(value: object) -> tuple[str, str, object]:
    get_outputs = getattr(value, "get_outputs", None)
    if callable(get_outputs):
        try:
            outputs = get_outputs()
        except Exception:
            outputs = None

        if isinstance(outputs, list):
            for output in reversed(outputs):
                text = _extract_response_text(output)
                model_id = str(getattr(output, "model_id", "") or "")
                usage_details = getattr(output, "usage_details", None)
                if text:
                    return text, model_id, usage_details
                if model_id or usage_details is not None:
                    return "", model_id, usage_details

    return (
        _extract_response_text(value),
        str(getattr(value, "model_id", "") or ""),
        getattr(value, "usage_details", None),
    )


def _embedded_trace_response_count(text: str, node_responses: list[str]) -> int:
    normalized_text = " ".join(text.split())
    if not normalized_text:
        return 0

    count = 0
    for response in node_responses:
        normalized_response = " ".join(response.split())
        if len(normalized_response) < 24:
            continue
        if normalized_response == normalized_text:
            continue
        occurrences = normalized_text.count(normalized_response)
        if occurrences > 0:
            count += occurrences
    return count


def _contains_embedded_node_response(text: str, node_responses: list[str]) -> bool:
    normalized_text = " ".join(text.split())
    if not normalized_text:
        return False

    for response in node_responses:
        normalized_response = " ".join(response.split())
        if len(normalized_response) < 24:
            continue
        if normalized_response == normalized_text:
            continue
        if (
            normalized_text.startswith(normalized_response)
            and len(normalized_text) > len(normalized_response) + 40
        ):
            return True
        if normalized_response in normalized_text and len(normalized_text) > int(
            len(normalized_response) * 1.25
        ):
            return True
    return False


def _prune_trace_thinking_items(
    items: list[dict[str, Any]],
    response_text: str,
) -> list[dict[str, Any]]:
    normalized_response = " ".join(response_text.split())
    if not normalized_response:
        return items

    pruned_items: list[dict[str, Any]] = []
    for item in items:
        role = str(item.get("role") or "")
        content_type = str(item.get("content_type") or "")
        text = str(item.get("text") or "")
        normalized_text = " ".join(text.split())

        if role == "assistant" and content_type == "text" and normalized_text:
            if normalized_text == normalized_response:
                continue
            if len(normalized_text) >= 120 and (
                normalized_text in normalized_response
                or normalized_response in normalized_text
            ):
                continue

        pruned_items.append(item)

    return pruned_items


def _should_replace_trace_response(existing: str, candidate: str) -> bool:
    normalized_existing = " ".join(existing.split())
    normalized_candidate = " ".join(candidate.split())

    if not normalized_candidate:
        return False
    if not normalized_existing:
        return True
    if normalized_candidate == normalized_existing:
        return False
    if normalized_candidate.startswith(normalized_existing):
        return True
    if normalized_existing in normalized_candidate and len(normalized_candidate) > len(
        normalized_existing
    ):
        return True
    return False


def _coerce_usage_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return 0
        try:
            return int(float(stripped))
        except ValueError:
            return 0
    return 0


def _extract_usage_counts(details: object) -> tuple[int, int]:
    if not isinstance(details, dict):
        return 0, 0

    input_tokens = _coerce_usage_int(
        details.get("input_token_count") or details.get("inputTokenCount")
    )
    output_tokens = _coerce_usage_int(
        details.get("output_token_count") or details.get("outputTokenCount")
    )
    return input_tokens, output_tokens


def _build_usage_event(
    sid: str,
    aid: str,
    *,
    model_id: str = "",
    usage_details: object = None,
) -> UsageEventDict | None:
    input_tokens, output_tokens = _extract_usage_counts(usage_details)
    if input_tokens <= 0 and output_tokens <= 0:
        return None

    return UsageEventDict(
        type="usage_event",
        session_id=sid,
        agent_id=aid,
        model_id=model_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


TRACE_INDEX_LIMIT = 5
TRACE_INDEX_KEY = "workflow_trace_index"
RECENT_TRACE_CONTEXT_KEY = "recent_workflow_traces"
CURRENT_TRACE_CONTEXT_KEY = "current_workflow_trace"
TRACE_INPUT_NODE_ID = "input-conversation"
TRACE_END_NODE_ID = "end"
PENDING_PRESENTATION_KEY = "__pending_presentation__"

# ─── Core Agent Implementation ──────────────────────────────────────────


class CoreAgent:
    def __init__(self, repositories: DatabaseRepositories) -> None:
        self.logger = logging.getLogger(__name__)
        self.config = get_llm_config()
        self.repositories = repositories
        self.session_manager = SessionManager(repositories)

    @staticmethod
    def _is_generic_session_title(title: str | None) -> bool:
        if not title:
            return True
        normalized = _normalize_title_text(title).casefold()
        return normalized in {"", "new chat session"}

    @staticmethod
    def _message_has_clear_topic(message: str) -> bool:
        normalized = _normalize_title_text(message).casefold()
        if not normalized:
            return False
        return normalized not in {
            "hi",
            "hello",
            "hey",
            "hi there",
            "hello there",
            "good morning",
            "good afternoon",
            "good evening",
        }

    def _derive_session_title(self, session: Session, message: str) -> str | None:
        subject = session.planning_state.planning_memory.subject
        source = subject or message
        cleaned = _normalize_title_text(source)
        if not cleaned:
            return None

        lowered = cleaned.casefold()
        prefixes = (
            "i want to build ",
            "i want to create ",
            "i want ",
            "help me build ",
            "help me create ",
            "help me ",
            "let s focus on ",
            "focus on ",
            "focusing on ",
            "build ",
            "create ",
        )
        for prefix in prefixes:
            if lowered.startswith(prefix):
                cleaned = cleaned[len(prefix) :].strip()
                break

        if not cleaned:
            return None

        titled = cleaned.title()
        return _truncate_title(titled, 40)

    async def _maybe_rename_planning_session(
        self, session: Session, message: str
    ) -> None:
        if not self._message_has_clear_topic(message):
            return

        cached_title = session.metadata.get("session_title")
        existing_title = (
            cached_title
            if isinstance(cached_title, str) and cached_title.strip()
            else None
        )
        if existing_title is None:
            existing_title = await session.repositories.sessions.get_chat_session_title(
                session.session_id
            )

        if existing_title and not self._is_generic_session_title(existing_title):
            if existing_title != cached_title:
                await session.update_metadata_async({"session_title": existing_title})
            return

        title = self._derive_session_title(session, message)
        if not title:
            return

        await session.repositories.sessions.update_chat_session_title(
            session.session_id, title
        )
        await session.update_metadata_async({"session_title": title})
        session.stream_events.put_nowait(
            {
                "type": "session_renamed",
                "session_id": session.session_id,
                "title": title,
            }
        )

    def _ensure_planning_runtime(self, session: Session) -> SupportsAgentRun:
        if session.planning_agent:
            return session.planning_agent

        factory = AgentFactory(session=session)
        memory_provider = MemoryContextProvider(session)

        builder_spec = AgentSpec(
            id="BuilderAgent",
            role="BuilderAgent",
            goal="Design and save an execution plan based on requirements.",
            tools=[
                "generate_plan",
                "list_available_models",
                "list_uploaded_files",
                "get_evaluation_result",
                "get_current_plan",
                "list_available_tools",
                "error_tool",
            ],
        )
        builder_agent = factory.create_agent(builder_spec, [memory_provider], session)

        def _think_callback(update: AgentResponseUpdate) -> None:
            if session.is_plan_created:
                return
            for content in getattr(update, "contents", None) or []:
                if chunk := getattr(content, "text", None):
                    session.stream_events.put_nowait(
                        {"type": "builder_think", "chunk": chunk}
                    )

        builder_tool = builder_agent.as_tool(
            name="BuilderAgent", stream_callback=_think_callback
        )
        core_spec = AgentSpec(
            id="CoreAgent",
            role="CoreAgent",
            goal="Gather requirements.",
            tools=[
                "update_planning_state",
                "rename_session",
                "list_available_models",
                "list_uploaded_files",
                "get_evaluation_result",
                "get_current_plan",
                "error_tool",
            ],
        )
        core_agent_instance = factory.create_agent(
            core_spec, [memory_provider], session, extra_tools=[builder_tool]
        )

        session.add_agent("CoreAgent", core_agent_instance)
        session.add_agent("BuilderAgent", builder_agent)
        session.planning_agent = core_agent_instance
        session.get_or_create_planning_agent_session(core_agent_instance)
        return core_agent_instance

    def _decode_json_field(self, value: Any, fallback: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return fallback
        return value if value is not None else fallback

    def _build_plan_spec(
        self,
        plan_data: dict[str, Any],
        agents_data: list[dict[str, Any]] | None,
        *,
        default_tools: set[str] | None = None,
    ) -> PlanSpec:
        defaults = list(default_tools or set())
        agent_specs: list[AgentSpec] = []
        for row in agents_data or []:
            tools = self._decode_json_field(row.get("tools"), [])
            context = self._decode_json_field(row.get("context"), {})
            merged_tools = list(dict.fromkeys(list(tools) + defaults))
            agent_specs.append(
                AgentSpec(
                    id=row["id"],
                    role=row["role"],
                    goal=row["goal"],
                    tools=merged_tools,
                    context=context,
                    model=row.get("model") or "",
                    order=int(row.get("order_index") or row.get("order") or 0),
                    isLeader=bool(row.get("is_leader") or row.get("isLeader") or False),
                )
            )

        return PlanSpec(
            orchestration=plan_data["orchestration"],
            agents=agent_specs,
            inputs=self._decode_json_field(plan_data.get("inputs"), {}),
        )

    def _register_workflow_agents(
        self, session: Session, workflow: Workflow, plan: PlanSpec
    ) -> None:
        registered_agent_ids: set[str] = set()
        workflow_agents = getattr(workflow, "_egco_session_agents", None)
        if isinstance(workflow_agents, list):
            for entry in workflow_agents:
                if not isinstance(entry, tuple) or len(entry) != 2:
                    continue
                agent_id, agent_instance = entry
                if (
                    not isinstance(agent_id, str)
                    or not agent_id
                    or agent_instance is None
                ):
                    continue
                session.add_agent(agent_id, agent_instance)
                registered_agent_ids.add(agent_id)

        for spec in plan.ordered_agents:
            if spec.id in registered_agent_ids:
                continue
            for orch_agent in getattr(workflow, "executors", {}).values():
                wrapped = getattr(orch_agent, "_agent", None) or orch_agent
                if getattr(wrapped, "name", "") == spec.role:
                    session.add_agent(spec.id, wrapped)
                    break

    def _apply_confirmed_model_assignments(
        self, plan: PlanSpec, session: Session
    ) -> None:
        """Applies confirmed model assignments from session metadata to the PlanSpec."""
        overrides = session.get_confirmed_model_assignments()
        self.logger.debug(
            "Applying model overrides for session [%s]. Confirmed overrides: %s",
            session.session_id,
            overrides,
        )
        if not overrides:
            return
        for agent in plan.agents:
            if agent.id in overrides:
                new_model = overrides[agent.id]
                if agent.model != new_model:
                    old_model = agent.model
                    agent.model = new_model
                    self.logger.info(
                        "Overrode model for agent [%s] (%s): %s -> %s",
                        agent.id,
                        agent.role,
                        old_model,
                        agent.model,
                    )
                else:
                    self.logger.debug(
                        "Confirmed model matches set for agent [%s] (%s). Current model: %s",
                        agent.id,
                        agent.role,
                        agent.model,
                    )
            else:
                self.logger.debug(
                    "No override specified for agent [%s] (%s). Current model: %s",
                    agent.id,
                    agent.role,
                    agent.model,
                )

    async def _load_plan_for_session(
        self,
        session: Session,
        *,
        default_tools: set[str] | None = None,
    ) -> PlanSpec | None:
        candidate_session_ids = [session.session_id]
        planning_session_id = session.metadata.get("planning_session_id")
        if (
            isinstance(planning_session_id, str)
            and planning_session_id
            and planning_session_id not in candidate_session_ids
        ):
            candidate_session_ids.append(planning_session_id)

        for candidate_id in candidate_session_ids:
            plan_data, agents_data = await self.repositories.plans.load_latest_plan(
                candidate_id
            )
            if plan_data:
                plan = self._build_plan_spec(
                    plan_data, agents_data, default_tools=default_tools
                )

                # Apply confirmed model assignments if this is a planning session or related to one
                planning_id = planning_session_id or (
                    session.session_id if session.session_type == "planning" else None
                )
                if planning_id:
                    # Always force reload to ensure we capture the absolute latest user choice from Dashboard
                    planning_session = await self.session_manager.get_session(
                        str(planning_id), force_reload=True
                    )
                    if planning_session:
                        self._apply_confirmed_model_assignments(plan, planning_session)

                return plan

        return None

    def _build_session_workflow(self, session: Session, plan: PlanSpec) -> Workflow:
        storage = PostgresCheckpointStorage(
            session.session_id, self.repositories.snapshots
        )
        factory = AgentFactory(session=session)
        workflow = OrchestrationBuilder(factory, checkpoint_storage=storage).build(plan)
        self._register_workflow_agents(session, workflow, plan)
        session.workflow = workflow
        return workflow

    def _resolve_execution_mode(self, plan: PlanSpec, target_agent_id: str = "") -> str:
        if target_agent_id:
            if not plan.supports_direct_targeting:
                raise ValueError(
                    f"Direct agent targeting is not supported for {plan.orchestration} orchestration."
                )
            return "direct_target"

        if plan.supports_leader_gating:
            return "leader_gate"
        return "workflow"

    def _find_plan_agent(self, plan: PlanSpec, executor_id: str) -> AgentSpec | None:
        for spec in plan.ordered_agents:
            if spec.id == executor_id:
                return spec

        normalized_executor = executor_id.casefold()
        role_matches = [
            spec
            for spec in plan.ordered_agents
            if spec.role.casefold() == normalized_executor
        ]
        if len(role_matches) == 1:
            return role_matches[0]

        return None

    def _get_trace_index(self, session: Session) -> list[dict[str, Any]]:
        raw_index = session.metadata.get(TRACE_INDEX_KEY)
        if not isinstance(raw_index, list):
            return []
        return [entry for entry in raw_index if isinstance(entry, dict)]

    async def _refresh_recent_trace_context(self, session: Session) -> None:
        trace_index = self._get_trace_index(session)
        if not trace_index:
            session.context.pop(RECENT_TRACE_CONTEXT_KEY, None)
            return

        lines = ["Recent workflow traces:"]
        for entry in trace_index[:TRACE_INDEX_LIMIT]:
            summary = str(entry.get("summary") or "No summary available")
            status = str(entry.get("status") or "unknown")
            orchestration = str(entry.get("orchestration") or "unknown")
            completed_at = str(
                entry.get("completed_at") or entry.get("started_at") or ""
            )
            lines.append(
                f"- [{status}] {orchestration} at {completed_at}: {_truncate_text(summary, 180)}"
            )

        session.set_context(RECENT_TRACE_CONTEXT_KEY, "\n".join(lines))

    def _create_trace_payload(
        self, session: Session, plan: PlanSpec, message: str
    ) -> dict[str, Any]:
        started_at = _utcnow_iso()
        normalized_message = _truncate_text(message or "Workflow run", 160)
        run_id = self._current_run_id(session)
        ordered_nodes = [
            {
                "agent_id": spec.id,
                "agent_role": spec.role,
                "is_leader": bool(spec.is_leader),
                "order": spec.order,
                "status": "pending",
                "preview": "",
                "response": "",
                "error": "",
                "started_at": None,
                "completed_at": None,
            }
            for spec in plan.ordered_agents
        ]
        return {
            "trace_id": str(uuid.uuid4()),
            "execution_session_id": session.session_id,
            "run_id": run_id,
            "orchestration": plan.orchestration,
            "status": "running",
            "summary": f"Running {plan.orchestration} workflow for: {normalized_message}",
            "started_at": started_at,
            "completed_at": None,
            "nodes": [
                {
                    "agent_id": TRACE_INPUT_NODE_ID,
                    "agent_role": "Input conversation",
                    "is_leader": False,
                    "order": 0,
                    "status": "completed",
                    "preview": _truncate_text(message or "Workflow run", 180),
                    "response": message or "Workflow run",
                    "error": "",
                    "started_at": started_at,
                    "completed_at": started_at,
                },
                *ordered_nodes,
                {
                    "agent_id": TRACE_END_NODE_ID,
                    "agent_role": "Final response",
                    "is_leader": False,
                    "order": len(ordered_nodes) + 1,
                    "status": "pending",
                    "preview": "",
                    "response": "",
                    "error": "",
                    "started_at": None,
                    "completed_at": None,
                },
            ],
        }

    def _is_boundary_trace_node(self, node: dict[str, Any]) -> bool:
        return str(node.get("agent_id") or "") in {
            TRACE_INPUT_NODE_ID,
            TRACE_END_NODE_ID,
        }

    def _get_end_trace_node(self, trace_payload: dict[str, Any]) -> dict[str, Any]:
        return self._ensure_trace_node(trace_payload, None, TRACE_END_NODE_ID)

    async def _persist_trace(
        self, session: Session, trace_payload: dict[str, Any]
    ) -> None:
        await self.repositories.snapshots.save_snapshot(
            session.session_id,
            f"workflow_trace:{trace_payload['trace_id']}",
            trace_payload,
        )

    async def _update_trace_index(
        self, session: Session, trace_payload: dict[str, Any]
    ) -> None:
        trace_id = str(trace_payload.get("trace_id", ""))
        index_entry = {
            "trace_id": trace_id,
            "status": trace_payload.get("status", "unknown"),
            "summary": trace_payload.get("summary", ""),
            "orchestration": trace_payload.get("orchestration", ""),
            "started_at": trace_payload.get("started_at"),
            "completed_at": trace_payload.get("completed_at"),
        }
        existing = [
            entry
            for entry in self._get_trace_index(session)
            if entry.get("trace_id") != trace_id
        ]
        await session.update_metadata_async(
            {TRACE_INDEX_KEY: [index_entry, *existing][:TRACE_INDEX_LIMIT]}
        )

    def _trace_event_data(
        self,
        trace_payload: dict[str, Any],
        node: dict[str, Any] | None = None,
        *,
        error: str = "",
    ) -> dict[str, Any]:
        event_data: dict[str, Any] = {
            "trace_id": str(trace_payload.get("trace_id", "")),
            "execution_session_id": str(trace_payload.get("execution_session_id", "")),
            "orchestration": str(trace_payload.get("orchestration", "")),
            "summary": str(trace_payload.get("summary", "")),
            "status": str(trace_payload.get("status", "unknown")),
        }
        if node is not None:
            event_data.update(
                {
                    "agent_id": str(node.get("agent_id", "")),
                    "agent_role": str(node.get("agent_role", "")),
                    "is_leader": bool(node.get("is_leader") or False),
                    "order": int(node.get("order") or 0),
                    "preview": str(node.get("preview") or ""),
                    "response": str(node.get("response") or ""),
                    "error": str(node.get("error") or ""),
                    "started_at": str(node.get("started_at") or ""),
                    "completed_at": str(node.get("completed_at") or ""),
                    "thinking": node.get("thinking") or [],
                }
            )
        else:
            event_data["nodes"] = [
                {
                    "agent_id": str(candidate.get("agent_id", "")),
                    "agent_role": str(candidate.get("agent_role", "")),
                    "is_leader": bool(candidate.get("is_leader") or False),
                    "order": int(candidate.get("order") or 0),
                    "status": str(candidate.get("status") or ""),
                    "preview": str(candidate.get("preview") or ""),
                    "response": str(candidate.get("response") or ""),
                    "error": str(candidate.get("error") or ""),
                    "started_at": str(candidate.get("started_at") or ""),
                    "completed_at": str(candidate.get("completed_at") or ""),
                    "thinking": candidate.get("thinking") or [],
                }
                for candidate in trace_payload.get("nodes", [])
                if isinstance(candidate, dict)
            ]

        if error:
            event_data["error"] = error

        completed_at = trace_payload.get("completed_at")
        if completed_at:
            event_data["completed_at"] = str(completed_at)
        return event_data

    def _current_run(self, session: Session) -> ExecutionRunState | None:
        if session.session_type != "execution":
            return None
        return session.active_run

    def _current_run_id(self, session: Session) -> str:
        current_run = self._current_run(session)
        return current_run.run_id if current_run is not None else ""

    def _with_run_id(
        self, event: dict[str, Any], run_id: str | None
    ) -> StreamEventDict:
        if run_id:
            return cast(StreamEventDict, {**event, "run_id": run_id})
        return cast(StreamEventDict, event)

    def _should_stop_run(self, session: Session, run_id: str) -> bool:
        return bool(run_id) and session.should_stop_run(run_id)

    def _direct_run_started_event(
        self,
        sid: str,
        run_id: str,
        agent_id: str,
    ) -> StreamEventDict:
        return self._with_run_id(
            {
                "type": "workflow_started",
                "session_id": sid,
                "agent_id": agent_id,
                "data": {
                    "trace_id": "",
                    "execution_session_id": sid,
                    "orchestration": "direct",
                    "status": "started",
                    "summary": "Direct execution started.",
                    "started_at": _utcnow_iso(),
                },
            },
            run_id,
        )

    async def _build_workflow_stopped_event(
        self,
        session: Session,
        sid: str,
        run_id: str,
        *,
        orchestration: str,
        trace_payload: dict[str, Any] | None = None,
        agent_id: str = "CoreAgent",
    ) -> StreamEventDict:
        run_state = session.mark_run_terminal(run_id, "stopped")
        stopped_at = run_state.finished_at if run_state is not None else _utcnow_iso()
        summary = f"{orchestration.title()} workflow stopped."

        if trace_payload is not None:
            trace_payload["status"] = "stopped"
            trace_payload["completed_at"] = stopped_at
            trace_payload["summary"] = summary
            await self._persist_trace(session, trace_payload)
            await self._update_trace_index(session, trace_payload)
            data = self._trace_event_data(trace_payload)
        else:
            data = {
                "trace_id": "",
                "execution_session_id": sid,
                "orchestration": orchestration,
                "summary": summary,
                "status": "stopped",
            }

        data["stopped_at"] = str(stopped_at)
        data["run_id"] = run_id
        return self._with_run_id(
            {
                "type": "workflow_stopped",
                "session_id": sid,
                "agent_id": agent_id,
                "data": data,
            },
            run_id,
        )

    def _queue_workflow_event(
        self,
        session: Session,
        event_type: str,
        trace_payload: dict[str, Any],
        node: dict[str, Any] | None = None,
        *,
        error: str = "",
    ) -> None:
        session.stream_events.put_nowait(
            cast(
                SidebandWorkflowEventDict,
                {
                    "type": event_type,
                    "data": self._trace_event_data(trace_payload, node, error=error),
                },
            )
        )

    def _ensure_trace_node(
        self,
        trace_payload: dict[str, Any],
        plan: PlanSpec | None,
        executor_id: str,
    ) -> dict[str, Any]:
        nodes = trace_payload["nodes"]
        for node in nodes:
            if node.get("agent_id") == executor_id:
                return node

        if executor_id == TRACE_INPUT_NODE_ID:
            node = {
                "agent_id": TRACE_INPUT_NODE_ID,
                "agent_role": "Input conversation",
                "is_leader": False,
                "order": 0,
                "status": "completed",
                "preview": "",
                "response": "",
                "error": "",
                "started_at": None,
                "completed_at": None,
            }
            nodes.append(node)
            return node

        if executor_id == TRACE_END_NODE_ID:
            node = {
                "agent_id": TRACE_END_NODE_ID,
                "agent_role": "Final response",
                "is_leader": False,
                "order": len(nodes) + 1,
                "status": "pending",
                "preview": "",
                "response": "",
                "error": "",
                "started_at": None,
                "completed_at": None,
            }
            nodes.append(node)
            return node

        plan_agent = (
            self._find_plan_agent(plan, executor_id) if plan is not None else None
        )
        if plan_agent is not None:
            for node in nodes:
                if node.get("agent_id") == plan_agent.id:
                    return node

            node = {
                "agent_id": plan_agent.id,
                "agent_role": plan_agent.role,
                "is_leader": bool(plan_agent.is_leader),
                "order": plan_agent.order,
                "status": "pending",
                "preview": "",
                "response": "",
                "error": "",
                "started_at": None,
                "completed_at": None,
            }
        else:
            node = {
                "agent_id": executor_id,
                "agent_role": executor_id,
                "is_leader": False,
                "order": len(nodes) + 1,
                "status": "pending",
                "preview": "",
                "response": "",
                "error": "",
                "started_at": None,
                "completed_at": None,
            }
        nodes.append(node)
        return node

    def _resolve_checkpoint_executor_state(
        self,
        plan: PlanSpec,
        node: dict[str, Any],
        executor_id: str,
        executor_state: dict[str, Any],
    ) -> dict[str, Any]:
        if not executor_state:
            return {}

        candidate_keys: list[str] = []

        def _add_candidate(value: object) -> None:
            if not isinstance(value, str):
                return
            stripped = value.strip()
            if stripped and stripped not in candidate_keys:
                candidate_keys.append(stripped)

        _add_candidate(executor_id)
        _add_candidate(node.get("agent_id"))
        _add_candidate(node.get("agent_role"))

        plan_agent = self._find_plan_agent(plan, executor_id)
        if plan_agent is None:
            node_agent_id = str(node.get("agent_id") or "")
            if node_agent_id:
                plan_agent = self._find_plan_agent(plan, node_agent_id)

        if plan_agent is not None:
            _add_candidate(plan_agent.id)
            _add_candidate(plan_agent.role)

        for candidate in candidate_keys:
            state = executor_state.get(candidate)
            if isinstance(state, dict):
                return state

        normalized_candidates = [
            (candidate.casefold(), _normalize_title_text(candidate).casefold())
            for candidate in candidate_keys
        ]

        for raw_key, state in executor_state.items():
            if not isinstance(state, dict):
                continue
            state_key = str(raw_key)
            state_key_casefold = state_key.casefold()
            state_key_normalized = _normalize_title_text(state_key).casefold()
            for candidate_casefold, candidate_normalized in normalized_candidates:
                if state_key_casefold == candidate_casefold:
                    return state
                if (
                    candidate_normalized
                    and state_key_normalized == candidate_normalized
                ):
                    return state

        return {}

    def _apply_trace_response_text(
        self, node: dict[str, Any], response_text: str
    ) -> bool:
        if not isinstance(response_text, str):
            return False

        preserved_response = response_text.replace("\r\n", "\n").strip()
        if not preserved_response:
            return False

        existing_response = str(node.get("response") or "")
        if not _should_replace_trace_response(existing_response, preserved_response):
            return False

        node["response"] = preserved_response
        node["preview"] = _truncate_text(preserved_response, 180)
        return True

    def _append_trace_response_text(
        self, node: dict[str, Any], response_text: str
    ) -> bool:
        if not isinstance(response_text, str):
            return False

        preserved_response = response_text.replace("\r\n", "\n")
        if preserved_response == "":
            return False

        existing_response = str(node.get("response") or "")
        normalized_candidate = preserved_response.strip()
        if normalized_candidate and _should_replace_trace_response(
            existing_response,
            normalized_candidate,
        ):
            return self._apply_trace_response_text(node, preserved_response)

        if preserved_response in existing_response:
            return False

        combined_response = (
            _join_text_fragments([existing_response, preserved_response])
            if existing_response
            else preserved_response
        )
        if combined_response == existing_response:
            return False

        node["response"] = combined_response
        node["preview"] = _truncate_text(combined_response, 180)
        return True

    def _compose_trace_context(self, trace_payload: dict[str, Any]) -> str:
        lines = [
            f"Workflow trace {trace_payload.get('trace_id', '')}",
            f"Orchestration: {trace_payload.get('orchestration', '')}",
            f"Status: {trace_payload.get('status', '')}",
        ]
        for node in trace_payload.get("nodes", []):
            if self._is_boundary_trace_node(node):
                continue
            role = node.get("agent_role", "Unknown")
            status = node.get("status", "unknown")
            preview = (
                node.get("preview")
                or node.get("response")
                or node.get("error")
                or "No output"
            )
            lines.append(f"- {role} [{status}]: {_truncate_text(str(preview), 180)}")
        return "\n".join(lines)

    def _backfill_trace_node_from_executor_state(
        self,
        plan: PlanSpec,
        node: dict[str, Any],
        executor_state: dict[str, Any],
    ) -> bool:
        if self._is_boundary_trace_node(node):
            return False

        agent_state = self._resolve_checkpoint_executor_state(
            plan,
            node,
            str(node.get("agent_id") or node.get("agent_role") or ""),
            executor_state,
        )
        if not agent_state:
            return False

        changed = False
        full_conv = agent_state.get("full_conversation", [])
        last_text = (
            _extract_preferred_assistant_text(full_conv)
            if isinstance(full_conv, list)
            else ""
        )

        if last_text:
            changed = self._apply_trace_response_text(node, last_text) or changed
        elif not node.get("preview") and node.get("response"):
            node["preview"] = _truncate_text(str(node["response"]), 180)
            changed = True

        if isinstance(full_conv, list):
            thinking_items = _build_thinking_items(full_conv)
        else:
            thinking_items = []

        thinking_items = _prune_trace_thinking_items(
            thinking_items,
            str(node.get("response") or last_text or ""),
        )

        if thinking_items and thinking_items != node.get("thinking"):
            node["thinking"] = thinking_items
            changed = True
        elif not thinking_items and node.get("thinking"):
            node["thinking"] = []
            changed = True

        return changed

    async def _backfill_trace_nodes_from_latest_checkpoint(
        self,
        checkpoint_storage: PostgresCheckpointStorage,
        plan: PlanSpec,
        trace_payload: dict[str, Any],
    ) -> bool:
        try:
            checkpoint = await checkpoint_storage.get_latest(workflow_name="")
        except Exception:
            checkpoint = None

        if checkpoint is None:
            return False

        raw_state = checkpoint.state if isinstance(checkpoint.state, dict) else {}
        executor_state = raw_state.get("_executor_state", {})
        if not isinstance(executor_state, dict):
            return False

        changed = False
        for node in trace_payload.get("nodes", []):
            if not isinstance(node, dict):
                continue
            if node.get("status") not in {"completed", "failed"}:
                continue
            changed = (
                self._backfill_trace_node_from_executor_state(
                    plan, node, executor_state
                )
                or changed
            )

        return changed

    def _fallback_trace_summary(self, trace_payload: dict[str, Any]) -> str:
        completed_nodes = [
            node
            for node in trace_payload.get("nodes", [])
            if node.get("status") == "completed"
            and not self._is_boundary_trace_node(node)
        ]
        failed_nodes = [
            node
            for node in trace_payload.get("nodes", [])
            if node.get("status") == "failed" and not self._is_boundary_trace_node(node)
        ]
        if trace_payload.get("status") == "failed":
            if failed_nodes:
                failed_node = failed_nodes[0]
                return (
                    f"Workflow failed in {trace_payload.get('orchestration', 'workflow')} during "
                    f"{failed_node.get('agent_role', 'an agent')}: {_truncate_text(str(failed_node.get('error') or 'unknown error'), 140)}"
                )
            return (
                f"Workflow failed in {trace_payload.get('orchestration', 'workflow')}."
            )
        if completed_nodes:
            lines = [
                f"{trace_payload.get('orchestration', 'Workflow').title()} workflow completed."
            ]
            lines.extend(
                f"{node.get('agent_role', 'Agent')}: {_truncate_text(str(node.get('response') or node.get('preview') or 'completed'), 90)}"
                for node in completed_nodes[:3]
            )
            return "\n".join(lines)
        return f"{trace_payload.get('orchestration', 'Workflow').title()} workflow completed."

    def _summary_conflicts_with_trace(
        self,
        summary: str,
        trace_payload: dict[str, Any],
    ) -> bool:
        normalized_summary = summary.strip()
        if not normalized_summary:
            return True

        lowered_summary = normalized_summary.casefold()
        substantive_nodes = [
            node
            for node in trace_payload.get("nodes", [])
            if isinstance(node, dict)
            and not self._is_boundary_trace_node(node)
            and node.get("status") == "completed"
            and str(node.get("response") or "").strip()
        ]
        if not substantive_nodes:
            return False

        conflict_markers = (
            "no output generated",
            "without generating user content",
            "no user content",
        )
        return any(marker in lowered_summary for marker in conflict_markers)

    def _select_end_response_text(
        self,
        message: str,
        final_response_text: str,
        trace_payload: dict[str, Any],
    ) -> str:
        node_responses = [
            str(node.get("response") or "")
            for node in trace_payload.get("nodes", [])
            if isinstance(node, dict)
            and not self._is_boundary_trace_node(node)
            and node.get("status") == "completed"
            and str(node.get("response") or "").strip()
        ]

        scored_candidates: list[tuple[int, str]] = []

        cleaned_final = _strip_prompt_echo(
            _strip_recovery_preamble(final_response_text),
            message,
        )
        if cleaned_final:
            if _embedded_trace_response_count(
                cleaned_final, node_responses
            ) < 2 and not _contains_embedded_node_response(
                cleaned_final, node_responses
            ):
                final_score = _response_candidate_score(
                    cleaned_final,
                    original_message=message,
                )
                scored_candidates.append((final_score, cleaned_final))

        for response in node_responses:
            cleaned_response = _strip_recovery_preamble(response)
            if not cleaned_response:
                continue
            score = _response_candidate_score(cleaned_response)
            scored_candidates.append((score, cleaned_response))

        if not scored_candidates:
            return ""

        scored_candidates.sort(key=lambda item: (item[0], len(item[1])), reverse=True)
        return scored_candidates[0][1]

    async def _run_ephemeral_leader_completion(
        self,
        session: Session,
        leader_spec: AgentSpec,
        prompt: str,
    ) -> str:
        ephemeral_spec = leader_spec.model_copy(update={"tools": []})
        agent = AgentFactory().create_agent(
            ephemeral_spec,
            context_providers=[MemoryContextProvider(session)],
            session=None,
        )
        response = await cast(
            Awaitable[object],
            agent.run(
                prompt,
                stream=False,
                session=agent.create_session(
                    session_id=f"{session.session_id}:ephemeral:{leader_spec.id}"
                ),
            ),
        )
        return _extract_response_text(response).strip()

    async def _decide_leader_route(
        self,
        session: Session,
        plan: PlanSpec,
        leader_spec: AgentSpec,
        message: str,
    ) -> str:
        # Fast path: keyword scan covers the clear-cut cases without an LLM round trip.
        lowered_message = message.casefold()
        workflow_markers = (
            "workflow",
            "coordinate",
            "all agents",
            "team",
            "together",
            "parallel",
            "step by step",
            "delegate",
            "compare",
            "review",
            "research",
            "analyze",
            "analyse",
            "summarize",
            "summarise",
            "investigate",
            "explain",
            "how does",
            "what is",
            "what are",
        )
        if any(marker in lowered_message for marker in workflow_markers):
            return "workflow"

        # Ambiguous message — ask the LLM to decide.
        await self._refresh_recent_trace_context(session)
        prompt = (
            f"You are the leader for a {plan.orchestration} execution team. "
            "Decide whether this user request needs a full multi-agent workflow or a direct leader reply. "
            "Return strict JSON with keys route and rationale. route must be either direct or workflow. "
            "Choose workflow when the task clearly needs coordinated work from multiple specialists, delegated execution, "
            "or a multi-step team process. Choose direct when the leader can answer alone in one concise reply.\n\n"
            f"User request: {message}"
        )
        raw = await self._run_ephemeral_leader_completion(session, leader_spec, prompt)
        try:
            start = raw.find("{")
            end = raw.rfind("}")
            if start >= 0 and end > start:
                parsed = json.loads(raw[start : end + 1])
                route = str(parsed.get("route", "")).strip().lower()
                if route in {"direct", "workflow"}:
                    return route
        except json.JSONDecodeError:
            pass
        return "direct"

    async def _generate_workflow_presentation_prompt(
        self,
        session: Session,
        plan: PlanSpec,
        leader_spec: AgentSpec,
        message: str,
    ) -> str:
        """Generate a friendly user-facing question about how to present the workflow results.

        Args:
            session: The current execution session.
            plan: The PlanSpec describing the workflow.
            leader_spec: The leader AgentSpec (used for the ephemeral completion).
            message: The original user message that triggered the leader gate.

        Returns:
            A short, plain-language question asking the user how they want results presented.
        """
        prompt = (
            f'The user asked: "{message}"\n\n'
            "You are about to coordinate a team of AI specialists to handle this request. "
            "Write one short, friendly sentence asking the user whether they would prefer to "
            "see the team's work as an interactive step-by-step workflow diagram, "
            "or as regular chat messages (one message per specialist). "
            "Use plain language — the user is not technical. "
            "Do not use the words 'workflow trace', 'nodes', or other technical terms."
        )
        raw = await self._run_ephemeral_leader_completion(session, leader_spec, prompt)
        return raw.strip().strip("\"'")

    def _generate_workflow_summary(
        self,
        plan: PlanSpec,
        trace_payload: dict[str, Any],
    ) -> str:
        # Build a concise summary purely from the already-collected trace data — no extra
        # LLM call needed. The full agent responses are available in end_node / nodes.
        return self._fallback_trace_summary(trace_payload)

    def _start_workflow_stream(self, workflow: Workflow, message: str) -> Any:
        run_stream = getattr(workflow, "run_stream", None)
        if callable(run_stream):
            try:
                return run_stream(message)
            except (AttributeError, NotImplementedError):
                pass
        return workflow.run(message, stream=True)

    async def _run_workflow_with_trace(
        self,
        session: Session,
        plan: PlanSpec,
        workflow: Workflow,
        message: str,
        sid: str,
    ) -> AsyncGenerator[StreamEventDict, None]:
        trace_payload = self._create_trace_payload(session, plan, message)
        summary_agent_id = plan.leader.id if plan.leader else "CoreAgent"
        run_id = self._current_run_id(session)

        # Checkpoint storage — lightweight stateless wrapper, safe to create per-run.
        checkpoint_storage = PostgresCheckpointStorage(
            session.session_id, self.repositories.snapshots
        )

        await self._persist_trace(session, trace_payload)
        self._queue_workflow_event(session, "workflow_started", trace_payload)
        self._queue_workflow_event(
            session,
            "workflow_node_updated",
            trace_payload,
            self._ensure_trace_node(trace_payload, plan, TRACE_INPUT_NODE_ID),
        )
        async for sideband in self._drain_sideband_events(session, sid):
            yield sideband
        if self._should_stop_run(session, run_id):
            yield await self._build_workflow_stopped_event(
                session,
                sid,
                run_id,
                orchestration=plan.orchestration,
                trace_payload=trace_payload,
                agent_id=summary_agent_id,
            )
            return

        workflow_failed_error = ""
        workflow_stream = None
        final_response_text = ""
        try:
            workflow_stream = self._start_workflow_stream(workflow, message)
            async for workflow_event in workflow_stream:
                event_type = getattr(workflow_event, "type", "")
                executor_id = getattr(workflow_event, "executor_id", "") or ""
                now = _utcnow_iso()
                node: dict[str, Any] | None = None
                should_persist_trace = False
                should_emit_node_update = False

                if event_type == "executor_invoked":
                    node = self._ensure_trace_node(trace_payload, plan, executor_id)
                    node["status"] = "running"
                    node["started_at"] = node.get("started_at") or now
                    should_persist_trace = True
                    should_emit_node_update = True
                elif event_type in {
                    "data",
                    "output",
                    "executor_completed",
                    "executor_failed",
                }:
                    node = self._ensure_trace_node(trace_payload, plan, executor_id)
                    node["started_at"] = node.get("started_at") or now
                    if event_type in {"data", "output"}:
                        response_text = _extract_response_text(
                            getattr(workflow_event, "data", None)
                        )
                        response_updated = self._append_trace_response_text(
                            node,
                            response_text,
                        )
                        if node.get("status") != "running":
                            node["status"] = "running"
                            should_emit_node_update = True
                        if response_updated:
                            should_emit_node_update = True
                    elif event_type == "executor_completed":
                        node["status"] = "completed"
                        node["completed_at"] = now

                        # Load checkpoint to get the agent's full conversation.
                        # The framework writes a checkpoint at each iteration boundary so it
                        # should reflect this executor's state by the time executor_completed fires.
                        try:
                            checkpoint = await checkpoint_storage.get_latest(
                                workflow_name=""
                            )
                        except Exception:
                            checkpoint = None

                        executor_state: dict[str, Any] = {}
                        if checkpoint is not None:
                            raw_state = (
                                checkpoint.state
                                if isinstance(checkpoint.state, dict)
                                else {}
                            )
                            executor_state = raw_state.get("_executor_state", {})

                        agent_state = self._resolve_checkpoint_executor_state(
                            plan,
                            node,
                            executor_id,
                            executor_state,
                        )

                        full_conv = agent_state.get("full_conversation", [])
                        last_text = (
                            _extract_preferred_assistant_text(full_conv)
                            if isinstance(full_conv, list)
                            else ""
                        )

                        # Prefer the checkpoint's final assistant message when it clearly
                        # improves on a partial streamed response.
                        if last_text:
                            self._apply_trace_response_text(node, last_text)
                        elif not node.get("preview") and node.get("response"):
                            node["preview"] = _truncate_text(str(node["response"]), 180)

                        # Build thinking chain from full conversation.
                        if isinstance(full_conv, list):
                            node["thinking"] = _prune_trace_thinking_items(
                                _build_thinking_items(full_conv),
                                str(node.get("response") or last_text or ""),
                            )
                        else:
                            node["thinking"] = []

                        should_persist_trace = True
                        should_emit_node_update = True
                    else:
                        error_details = getattr(
                            getattr(workflow_event, "details", None), "message", None
                        )
                        workflow_failed_error = str(
                            error_details
                            or getattr(workflow_event, "data", None)
                            or "Workflow node failed"
                        )
                        node["status"] = "failed"
                        node["error"] = workflow_failed_error
                        node["completed_at"] = now
                        trace_payload["status"] = "failed"
                        should_persist_trace = True
                        should_emit_node_update = True
                elif event_type == "failed":
                    error_details = getattr(
                        getattr(workflow_event, "details", None), "message", None
                    )
                    workflow_failed_error = str(
                        error_details
                        or getattr(workflow_event, "data", None)
                        or "Workflow failed"
                    )
                    trace_payload["status"] = "failed"
                    should_persist_trace = True

                if should_persist_trace:
                    if trace_payload.get("status") == "failed":
                        trace_payload["completed_at"] = now
                    await self._persist_trace(session, trace_payload)
                    async for sideband in self._drain_sideband_events(session, sid):
                        yield sideband

                if should_emit_node_update and node is not None:
                    self._queue_workflow_event(
                        session, "workflow_node_updated", trace_payload, node
                    )
                    async for sideband in self._drain_sideband_events(session, sid):
                        yield sideband

                if self._should_stop_run(session, run_id):
                    yield await self._build_workflow_stopped_event(
                        session,
                        sid,
                        run_id,
                        orchestration=plan.orchestration,
                        trace_payload=trace_payload,
                        agent_id=summary_agent_id,
                    )
                    return

            if self._should_stop_run(session, run_id):
                yield await self._build_workflow_stopped_event(
                    session,
                    sid,
                    run_id,
                    orchestration=plan.orchestration,
                    trace_payload=trace_payload,
                    agent_id=summary_agent_id,
                )
                return

            maybe_get_final_response = getattr(
                workflow_stream, "get_final_response", None
            )
            if callable(maybe_get_final_response):
                final_response = await cast(
                    Callable[[], Awaitable[object]], maybe_get_final_response
                )()
                (
                    final_response_text,
                    final_response_model_id,
                    final_response_usage_details,
                ) = _extract_workflow_result_payload(final_response)
                final_response_text = final_response_text.strip()
                if self._should_stop_run(session, run_id):
                    yield await self._build_workflow_stopped_event(
                        session,
                        sid,
                        run_id,
                        orchestration=plan.orchestration,
                        trace_payload=trace_payload,
                        agent_id=summary_agent_id,
                    )
                    return
                usage_event = _build_usage_event(
                    sid,
                    summary_agent_id,
                    model_id=final_response_model_id,
                    usage_details=final_response_usage_details,
                )
                if usage_event is not None:
                    yield self._with_run_id(dict(usage_event), run_id)

            if self._should_stop_run(session, run_id):
                yield await self._build_workflow_stopped_event(
                    session,
                    sid,
                    run_id,
                    orchestration=plan.orchestration,
                    trace_payload=trace_payload,
                    agent_id=summary_agent_id,
                )
                return

            if trace_payload.get("status") == "failed":
                checkpoint_backfilled = (
                    await self._backfill_trace_nodes_from_latest_checkpoint(
                        checkpoint_storage,
                        plan,
                        trace_payload,
                    )
                )
                if checkpoint_backfilled:
                    await self._persist_trace(session, trace_payload)
                trace_payload["summary"] = self._fallback_trace_summary(trace_payload)
                await self._persist_trace(session, trace_payload)
                await self._update_trace_index(session, trace_payload)
                self._queue_workflow_event(
                    session,
                    "workflow_failed",
                    trace_payload,
                    error=workflow_failed_error,
                )
                async for sideband in self._drain_sideband_events(session, sid):
                    yield sideband
                yield self._with_run_id(
                    {
                        "chunk": trace_payload["summary"],
                        "session_id": sid,
                        "agent_id": summary_agent_id,
                    },
                    run_id,
                )
                return

            trace_payload["status"] = "completed"
            trace_payload["completed_at"] = _utcnow_iso()
            checkpoint_backfilled = (
                await self._backfill_trace_nodes_from_latest_checkpoint(
                    checkpoint_storage,
                    plan,
                    trace_payload,
                )
            )
            end_node = self._get_end_trace_node(trace_payload)
            end_node["status"] = "completed"
            end_node["started_at"] = (
                end_node.get("started_at") or trace_payload["started_at"]
            )
            end_node["completed_at"] = str(trace_payload["completed_at"])
            end_response = self._select_end_response_text(
                message,
                final_response_text,
                trace_payload,
            )
            if end_response:
                self._apply_trace_response_text(end_node, end_response)

            generated_summary = self._generate_workflow_summary(plan, trace_payload)
            if self._should_stop_run(session, run_id):
                yield await self._build_workflow_stopped_event(
                    session,
                    sid,
                    run_id,
                    orchestration=plan.orchestration,
                    trace_payload=trace_payload,
                    agent_id=summary_agent_id,
                )
                return
            if self._summary_conflicts_with_trace(generated_summary, trace_payload):
                generated_summary = self._fallback_trace_summary(trace_payload)
            if generated_summary:
                end_node["preview"] = _truncate_text(generated_summary, 180)
            trace_payload["summary"] = generated_summary
            await self._persist_trace(session, trace_payload)
            await self._update_trace_index(session, trace_payload)
            if checkpoint_backfilled:
                for candidate in trace_payload.get("nodes", []):
                    if not isinstance(candidate, dict):
                        continue
                    if self._is_boundary_trace_node(candidate):
                        continue
                    self._queue_workflow_event(
                        session,
                        "workflow_node_updated",
                        trace_payload,
                        candidate,
                    )
            self._queue_workflow_event(
                session, "workflow_node_updated", trace_payload, end_node
            )
            self._queue_workflow_event(session, "workflow_completed", trace_payload)
            async for sideband in self._drain_sideband_events(session, sid):
                yield sideband
            # Prefer the actual best-agent answer (end_response) over the brief
            # generated summary so the chat bubble contains substantive content.
            final_chat_chunk = (
                end_response.strip()
                if end_response
                else trace_payload.get("summary", "")
            )
            yield self._with_run_id(
                {
                    "chunk": final_chat_chunk,
                    "session_id": sid,
                    "agent_id": summary_agent_id,
                },
                run_id,
            )
        except pydantic_core.ValidationError as exc:
            # The group-chat orchestrator agent returned empty or malformed JSON.
            # The existing except Exception already catches this, but we set a
            # clearer message so operators can diagnose the cause quickly.
            if self._should_stop_run(session, run_id):
                yield await self._build_workflow_stopped_event(
                    session,
                    sid,
                    run_id,
                    orchestration=plan.orchestration,
                    trace_payload=trace_payload,
                    agent_id=summary_agent_id,
                )
                return
            session.workflow = None
            trace_payload["status"] = "failed"
            trace_payload["completed_at"] = _utcnow_iso()
            trace_payload["summary"] = trace_payload.get(
                "summary"
            ) or self._fallback_trace_summary(trace_payload)
            workflow_failed_error = (
                "Group chat orchestrator returned malformed JSON. "
                "Check the orchestrator agent model and prompt configuration. "
                f"Detail: {_truncate_text(str(exc), 200)}"
            )
            await self._persist_trace(session, trace_payload)
            await self._update_trace_index(session, trace_payload)
            self._queue_workflow_event(
                session, "workflow_failed", trace_payload, error=workflow_failed_error
            )
            async for sideband in self._drain_sideband_events(session, sid):
                yield sideband
            yield self._with_run_id(
                {
                    "chunk": f"Workflow failed: {_truncate_text(workflow_failed_error, 180)}",
                    "session_id": sid,
                    "agent_id": summary_agent_id,
                },
                run_id,
            )
        except Exception as exc:
            if self._should_stop_run(session, run_id):
                yield await self._build_workflow_stopped_event(
                    session,
                    sid,
                    run_id,
                    orchestration=plan.orchestration,
                    trace_payload=trace_payload,
                    agent_id=summary_agent_id,
                )
                return
            session.workflow = None
            trace_payload["status"] = "failed"
            trace_payload["completed_at"] = _utcnow_iso()
            trace_payload["summary"] = trace_payload.get(
                "summary"
            ) or self._fallback_trace_summary(trace_payload)
            workflow_failed_error = str(exc)
            await self._persist_trace(session, trace_payload)
            await self._update_trace_index(session, trace_payload)
            self._queue_workflow_event(
                session, "workflow_failed", trace_payload, error=workflow_failed_error
            )
            async for sideband in self._drain_sideband_events(session, sid):
                yield sideband
            yield self._with_run_id(
                {
                    "chunk": f"Workflow failed: {_truncate_text(workflow_failed_error, 180)}",
                    "session_id": sid,
                    "agent_id": summary_agent_id,
                },
                run_id,
            )
        finally:
            maybe_aclose = getattr(workflow_stream, "aclose", None)
            if callable(maybe_aclose):
                with contextlib.suppress(Exception):
                    await cast(Callable[[], Awaitable[object]], maybe_aclose)()

    async def _run_workflow_chat_inline(
        self,
        session: Session,
        plan: PlanSpec,
        workflow: Workflow,
        message: str,
        sid: str,
    ) -> AsyncGenerator[StreamEventDict, None]:
        """Run the workflow in chat-inline mode: stream each agent's text as plain chunks.

        No workflow_started/node_updated/completed sideband events are emitted.
        Each agent's incremental text is yielded as a ChunkEventDict so the frontend
        creates a separate named bubble per agent (appendSupervisorChunk flushes on
        agent_id change).
        """
        workflow_stream: Any = None
        run_id = self._current_run_id(session)
        try:
            workflow_stream = self._start_workflow_stream(workflow, message)
            async for workflow_event in workflow_stream:
                event_type = getattr(workflow_event, "type", "")
                executor_id = str(getattr(workflow_event, "executor_id", "") or "")

                if event_type in {"data", "output"}:
                    response_text = _extract_response_text(
                        getattr(workflow_event, "data", None)
                    )
                    if response_text:
                        response_text = _strip_thinking_from_text(response_text)
                        response_text = _strip_prompt_echo(response_text, message)
                    if response_text:
                        plan_agent = self._find_plan_agent(plan, executor_id)
                        agent_id = plan_agent.id if plan_agent else executor_id
                        yield self._with_run_id(
                            {
                                "chunk": response_text,
                                "session_id": sid,
                                "agent_id": agent_id,
                            },
                            run_id,
                        )

                if self._should_stop_run(session, run_id):
                    yield await self._build_workflow_stopped_event(
                        session,
                        sid,
                        run_id,
                        orchestration=plan.orchestration,
                    )
                    return

        except Exception as exc:
            if self._should_stop_run(session, run_id):
                yield await self._build_workflow_stopped_event(
                    session,
                    sid,
                    run_id,
                    orchestration=plan.orchestration,
                )
                return
            self.logger.exception("Chat inline workflow error: %s", exc)
            session.workflow = None
            yield self._with_run_id(
                {
                    "chunk": f"An error occurred: {exc}",
                    "session_id": sid,
                    "agent_id": "System",
                },
                run_id,
            )
        finally:
            maybe_aclose = getattr(workflow_stream, "aclose", None)
            if callable(maybe_aclose):
                with contextlib.suppress(Exception):
                    await cast(Callable[[], Awaitable[object]], maybe_aclose)()

        # Drain remaining sideband events; suppress workflow trace events so the
        # frontend does not render a trace panel when in inline-chat presentation mode.
        async for sideband in self._drain_sideband_events(session, sid):
            if sideband.get("type") not in {
                "workflow_started",
                "workflow_node_updated",
                "workflow_completed",
                "workflow_failed",
            }:
                yield sideband

        if self._should_stop_run(session, run_id):
            yield await self._build_workflow_stopped_event(
                session,
                sid,
                run_id,
                orchestration=plan.orchestration,
            )

    async def _stream_execution_turn(
        self,
        session: Session,
        plan: PlanSpec,
        workflow: Workflow,
        message: str,
        sid: str,
        target_agent_id: str,
        presentation_mode: str = "",
    ) -> AsyncGenerator[StreamEventDict, None]:
        run_id = self._current_run_id(session)
        try:
            execution_mode = self._resolve_execution_mode(plan, target_agent_id)
        except ValueError as exc:
            yield self._with_run_id(
                {"chunk": str(exc), "session_id": sid, "agent_id": "System"},
                run_id,
            )
            return

        await self._refresh_recent_trace_context(session)

        if execution_mode == "direct_target":
            target_agent = session.get_agent(target_agent_id)
            if target_agent is None:
                yield self._with_run_id(
                    {
                        "chunk": f"Agent [{target_agent_id}] is not available in this execution session.",
                        "session_id": sid,
                        "agent_id": "System",
                    },
                    run_id,
                )
                return

            yield self._direct_run_started_event(sid, run_id, target_agent_id)

            async for event in self._stream_direct(
                session,
                target_agent,
                message,
                sid,
                target_agent_id,
                agent_session=session.get_or_create_agent_session(
                    target_agent_id, target_agent
                ),
            ):
                yield event
            return

        if execution_mode == "leader_gate":
            leader_spec = plan.leader
            if leader_spec is None:
                yield self._with_run_id(
                    {
                        "chunk": f"No leader is configured for {plan.orchestration} orchestration.",
                        "session_id": sid,
                        "agent_id": "System",
                    },
                    run_id,
                )
                return

            leader_agent = session.get_agent(leader_spec.id)
            if leader_agent is None:
                yield self._with_run_id(
                    {
                        "chunk": f"Leader [{leader_spec.role}] is not available in this execution session.",
                        "session_id": sid,
                        "agent_id": "System",
                    },
                    run_id,
                )
                return

            route = await self._decide_leader_route(session, plan, leader_spec, message)

            if route == "direct":
                yield self._direct_run_started_event(sid, run_id, leader_spec.id)
                async for event in self._stream_direct(
                    session,
                    leader_agent,
                    message,
                    sid,
                    leader_spec.id,
                    agent_session=session.get_or_create_agent_session(
                        leader_spec.id, leader_agent
                    ),
                ):
                    yield event
                return

            # route == "workflow" — ask the user how they want results presented
            # if no presentation_mode has been confirmed yet.
            if not presentation_mode:
                prompt_id = str(uuid.uuid4())
                if self._should_stop_run(session, run_id):
                    yield await self._build_workflow_stopped_event(
                        session,
                        sid,
                        run_id,
                        orchestration=plan.orchestration,
                        agent_id=leader_spec.id,
                    )
                    return
                question = await self._generate_workflow_presentation_prompt(
                    session, plan, leader_spec, message
                )
                if self._should_stop_run(session, run_id):
                    yield await self._build_workflow_stopped_event(
                        session,
                        sid,
                        run_id,
                        orchestration=plan.orchestration,
                        agent_id=leader_spec.id,
                    )
                    return
                yield (
                    cast(
                        WorkflowPresentationPromptEventDict,
                        {
                            "type": "workflow_presentation_prompt",
                            "prompt_id": prompt_id,
                            "question": question,
                            "original_message": message,
                            "session_id": sid,
                            "agent_id": leader_spec.id,
                        },
                    )
                    if not run_id
                    else self._with_run_id(
                        {
                            "type": "workflow_presentation_prompt",
                            "prompt_id": prompt_id,
                            "question": question,
                            "original_message": message,
                            "session_id": sid,
                            "agent_id": leader_spec.id,
                        },
                        run_id,
                    )
                )
                return

            if presentation_mode == "chat":
                async for event in self._run_workflow_chat_inline(
                    session, plan, workflow, message, sid
                ):
                    yield event
                return

        # presentation_mode == "workflow" (or non-leader-gate paths) fall through here.
        async for event in self._run_workflow_with_trace(
            session, plan, workflow, message, sid
        ):
            yield event

    async def _rebuild_workflow_from_plan(
        self, session: Session
    ) -> Optional[tuple[Workflow, PlanSpec]]:
        plan = await self._load_plan_for_session(session)
        if plan is None:
            return None

        return self._build_session_workflow(session, plan), plan

    async def build_execution_workflow(
        self, planning_session_id: str
    ) -> tuple[Workflow, str]:
        # Always force reload since model assignments are confirmed via the Go backend DB patch.
        planning_session = await self.session_manager.get_session(
            planning_session_id, force_reload=True
        )
        if not planning_session:
            raise ValueError(f"Planning session [{planning_session_id}] not found.")

        plan_data, agents_data = await self.repositories.plans.load_latest_plan(
            planning_session_id
        )
        if not plan_data:
            raise ValueError(f"No plan found for session [{planning_session_id}].")

        plan = self._build_plan_spec(plan_data, agents_data)
        self._apply_confirmed_model_assignments(plan, planning_session)

        if not plan.agents:
            raise ValueError("No agents defined in the saved plan.")

        # Persist the overridden plan back to the planning session so the DB is consistent with user choices
        await self.repositories.plans.save_plan(planning_session_id, plan)

        exec_session = await self.session_manager.create_session(
            session_type="execution",
            planning_session_id=planning_session_id,
        )
        exec_session.metadata["planning_session_id"] = planning_session_id

        # Save the plan to the new execution session as well
        await self.repositories.plans.save_plan(exec_session.session_id, plan)
        await self.repositories.embeddings.change_embedding_reference_id(
            old_session_id=planning_session_id,
            new_session_id=exec_session.session_id,
        )
        await self.repositories.attachments.change_attachment_reference_id(
            old_session_id=planning_session_id,
            new_session_id=exec_session.session_id,
        )
        await self.repositories.evaluations.change_evaluation_reference_id(
            old_session_id=planning_session_id,
            new_session_id=exec_session.session_id,
        )

        workflow = self._build_session_workflow(exec_session, plan)

        self.logger.info(
            "Execution workflow built: [%s] (exec_session=%s)",
            plan.orchestration,
            exec_session.session_id,
        )
        return workflow, exec_session.session_id

    async def chat_stream(
        self,
        message: str,
        session_id: str = "",
        target_agent_id: str = "",
        presentation_mode: str = "",
    ) -> AsyncGenerator[StreamEventDict, None]:
        session = await self.session_manager.get_or_create_session(
            session_id or None, session_type="planning"
        )
        current_id = session.session_id

        if session._chat_lock.locked():
            yield cast(
                ChunkEventDict,
                {"chunk": "Busy...", "session_id": current_id, "agent_id": "System"},
            )
            return

        async with session._chat_lock:
            if session.session_type == "planning":
                await self._maybe_rename_planning_session(session, message)
                agent = self._ensure_planning_runtime(session)
                async for event in self._stream_direct(
                    session, agent, message, current_id, "CoreAgent"
                ):
                    yield event
            else:
                session.clear_execution_runtime()
                workflow_and_plan = await self._rebuild_workflow_from_plan(session)
                if not workflow_and_plan:
                    return

                workflow, plan = workflow_and_plan
                run_state = session.start_execution_run(str(uuid.uuid4()))
                try:
                    async for event in self._stream_execution_turn(
                        session,
                        plan,
                        workflow,
                        message,
                        current_id,
                        target_agent_id,
                        presentation_mode,
                    ):
                        yield event
                except Exception as exc:
                    current_run = session.active_run
                    if (
                        current_run is not None
                        and current_run.run_id == run_state.run_id
                    ):
                        if current_run.status == "stopping":
                            session.mark_run_terminal(run_state.run_id, "stopped")
                        else:
                            session.mark_run_terminal(
                                run_state.run_id, "failed", error=str(exc)
                            )
                    raise
                finally:
                    current_run = session.active_run
                    if (
                        current_run is not None
                        and current_run.run_id == run_state.run_id
                    ):
                        if current_run.status == "active":
                            session.mark_run_terminal(run_state.run_id, "completed")
                        elif current_run.status == "stopping":
                            session.mark_run_terminal(run_state.run_id, "stopped")
                    session.clear_execution_runtime()

    async def stop_run(self, execution_session_id: str, run_id: str) -> dict[str, str]:
        if not execution_session_id:
            return {
                "execution_session_id": "",
                "run_id": run_id,
                "status": "invalid_request",
                "message": "execution_session_id is required.",
            }
        if not run_id:
            return {
                "execution_session_id": execution_session_id,
                "run_id": "",
                "status": "invalid_request",
                "message": "run_id is required.",
            }

        session = await self.session_manager.get_session(execution_session_id)
        if session is None or session.session_type != "execution":
            return {
                "execution_session_id": execution_session_id,
                "run_id": run_id,
                "status": "not_found",
                "message": "Execution session not found.",
            }

        status, message = session.request_run_stop(run_id)
        return {
            "execution_session_id": execution_session_id,
            "run_id": run_id,
            "status": status,
            "message": message,
        }

    async def _stream_direct(
        self,
        session: Session,
        agent: SupportsAgentRun,
        message: str,
        sid: str,
        aid: str,
        *,
        agent_session: AgentSession | None = None,
    ) -> AsyncGenerator[StreamEventDict, None]:
        update_task: asyncio.Task[AgentResponseUpdate] | None = None
        sideband_task: asyncio.Task[object] | None = None
        latest_usage_details: object = None
        run_id = self._current_run_id(session)
        try:
            stream = agent.run(
                message,
                stream=True,
                session=agent_session
                or session.get_or_create_planning_agent_session(agent),
            )

            stream_iter = stream.__aiter__()
            thinking_filter = _ThinkingFilter()
            echo_filter = _EchoFilter(message)
            update_task = asyncio.create_task(stream_iter.__anext__())
            sideband_task = asyncio.create_task(session.stream_events.get())

            while update_task is not None or sideband_task is not None:
                pending = [
                    task for task in (update_task, sideband_task) if task is not None
                ]
                if not pending:
                    break

                done, _ = await asyncio.wait(
                    pending, return_when=asyncio.FIRST_COMPLETED
                )

                if sideband_task in done:
                    raw_sideband = sideband_task.result()
                    yield self._with_run_id(
                        {**cast(dict[str, Any], raw_sideband), "session_id": sid},
                        run_id,
                    )
                    if self._should_stop_run(session, run_id):
                        yield await self._build_workflow_stopped_event(
                            session,
                            sid,
                            run_id,
                            orchestration="direct",
                            agent_id=aid,
                        )
                        return
                    sideband_task = (
                        asyncio.create_task(session.stream_events.get())
                        if update_task is not None or not session.stream_events.empty()
                        else None
                    )

                if update_task in done:
                    try:
                        update = update_task.result()
                    except StopAsyncIteration:
                        update_task = None
                        if (
                            session.stream_events.empty()
                            and sideband_task is not None
                            and not sideband_task.done()
                        ):
                            await _cancel_task(sideband_task)
                            sideband_task = None
                        continue

                    for content in getattr(update, "contents", []):
                        if usage_details := getattr(content, "usage_details", None):
                            latest_usage_details = usage_details
                        if raw_chunk := getattr(content, "text", ""):
                            raw_chunk = echo_filter.feed(raw_chunk)
                            filtered_chunk = (
                                thinking_filter.feed(raw_chunk) if raw_chunk else ""
                            )
                            if filtered_chunk:
                                yield self._with_run_id(
                                    {
                                        "chunk": filtered_chunk,
                                        "session_id": sid,
                                        "agent_id": aid,
                                    },
                                    run_id,
                                )
                            if self._should_stop_run(session, run_id):
                                yield await self._build_workflow_stopped_event(
                                    session,
                                    sid,
                                    run_id,
                                    orchestration="direct",
                                    agent_id=aid,
                                )
                                return
                    update_task = asyncio.create_task(stream_iter.__anext__())

            # Flush any content buffered by the streaming filters.
            _echo_remainder = echo_filter.flush()
            if _echo_remainder:
                _filtered_remainder = thinking_filter.feed(_echo_remainder)
                if _filtered_remainder:
                    yield self._with_run_id(
                        {
                            "chunk": _filtered_remainder,
                            "session_id": sid,
                            "agent_id": aid,
                        },
                        run_id,
                    )
            _think_remainder = thinking_filter.flush()
            if _think_remainder:
                yield self._with_run_id(
                    {"chunk": _think_remainder, "session_id": sid, "agent_id": aid},
                    run_id,
                )

            if self._should_stop_run(session, run_id):
                yield await self._build_workflow_stopped_event(
                    session,
                    sid,
                    run_id,
                    orchestration="direct",
                    agent_id=aid,
                )
                return

            maybe_get_final_response = getattr(stream, "get_final_response", None)
            if callable(maybe_get_final_response):
                final_response = await cast(
                    Callable[[], Awaitable[object]], maybe_get_final_response
                )()
                if self._should_stop_run(session, run_id):
                    yield await self._build_workflow_stopped_event(
                        session,
                        sid,
                        run_id,
                        orchestration="direct",
                        agent_id=aid,
                    )
                    return
                usage_event = _build_usage_event(
                    sid,
                    aid,
                    model_id=str(getattr(final_response, "model_id", "") or ""),
                    usage_details=getattr(final_response, "usage_details", None)
                    or latest_usage_details,
                )
                if usage_event is not None:
                    yield self._with_run_id(dict(usage_event), run_id)
            elif latest_usage_details is not None:
                usage_event = _build_usage_event(
                    sid, aid, usage_details=latest_usage_details
                )
                if usage_event is not None:
                    yield self._with_run_id(dict(usage_event), run_id)

            async for sideband in self._drain_sideband_events(session, sid):
                yield sideband
        except Exception:
            if session.session_type == "planning":
                session.reset_planning_runtime()
            else:
                current_run = session.active_run
                if current_run is not None:
                    if current_run.status == "active":
                        session.mark_run_terminal(
                            current_run.run_id,
                            "failed",
                            error="Execution stream failed.",
                        )
                    elif current_run.status == "stopping":
                        yield await self._build_workflow_stopped_event(
                            session,
                            sid,
                            current_run.run_id,
                            orchestration="direct",
                            agent_id=aid,
                        )
                        return
                session.workflow = None
            raise
        finally:
            await _cancel_task(update_task)
            await _cancel_task(sideband_task)

    async def get_agent_list(
        self, session_id: str = ""
    ) -> AsyncGenerator[AgentInfoDict, None]:
        if not session_id:
            return
        session = await self.session_manager.get_session(session_id)
        if not session:
            return

        if (
            not session.agents
            and session.workflow is None
            and session.planning_agent is None
        ):
            if session.session_type == "execution":
                await self._rebuild_workflow_from_plan(session)
            else:
                self._ensure_planning_runtime(session)

        plan = await self._load_plan_for_session(session)
        agent_specs_by_id = (
            {spec.id: spec for spec in plan.ordered_agents} if plan else {}
        )

        for agent_id, agent in session.agents.items():
            agent_spec = agent_specs_by_id.get(agent_id)
            yield AgentInfoDict(
                id=agent_id,
                role=getattr(agent, "name", agent_id),
                goal=getattr(agent, "goal", ""),
                tools=[],
                model=agent_spec.model if agent_spec else "",
                order=agent_spec.order if agent_spec else 0,
                isLeader=agent_spec.is_leader if agent_spec else False,
            )

    async def _drain_sideband_events(
        self, session: Session, sid: str
    ) -> AsyncGenerator[StreamEventDict, None]:
        """Drains events and safely injects session_id using type-safe dictionary merging."""
        run_id = self._current_run_id(session)
        while not session.stream_events.empty():
            try:
                raw = session.stream_events.get_nowait()
                enriched_event = {**raw, "session_id": sid}
                yield self._with_run_id(enriched_event, run_id)
            except asyncio.QueueEmpty:
                break
