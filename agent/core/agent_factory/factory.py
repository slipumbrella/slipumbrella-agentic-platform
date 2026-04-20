"""
AgentFactory — creates agent instances from AgentSpec definitions.

Responsibilities (SRP):
  - Resolve instruction templates from AgentRegistry.
  - Wrap tools with session injection.
  - Build an OpenAIChatClient agent via the framework.

Does NOT own session lifecycle or orchestration logic.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from collections.abc import Callable
from typing import Any

import json as _json

import httpx
from openai import AsyncOpenAI

import agent.core.agent_factory.templates  # noqa: F401 — side-effect: registers templates
from agent.core.agent_factory.registry import AgentRegistry
from agent.core.context_manager import MemoryContextProvider
from agent.core.llm_config import get_llm_config
from agent.core.observability import LoggingMiddleware
from agent.core.session_manager import Session
from agent.core.spec import AgentSpec
from agent.db.history_provider import PostgresHistoryProvider
from agent.services.tools.planning_tools import (
    generate_plan_tool,
    update_planning_state_tool,
    list_available_models,
    list_available_tools_tool,
    error_tool,
    query_vector_db,
    rename_session_tool,
)
from agent.services.tools.knowledge_tools import (
    list_uploaded_files_tool,
    get_evaluation_result_tool,
)
from agent.services.tools.gworkspace import (
    gdocs_read_tool,
    gdocs_append_tool,
    gsheets_read_tool,
    gsheets_write_tool,
    gslides_read_tool,
    gslides_add_slide_tool,
)
from agent.services.tools.artifact_tools import (
    save_artifact_tool,
    list_artifacts_tool,
)
from agent.services.tools.line_tools import (
    send_line_message_tool,
    read_line_messages_tool,
    send_line_image_tool,
    broadcast_line_message_tool,
    send_line_flex_message_tool,
)
from agent.services.tools.image_tools import generate_image_tool
from agent.services.tools.prompt_tools import generate_batch_optimized_prompts_tool
from agent.services.tools.math_tools import advanced_math_tool
from agent.services.tools.academic_tools import (
    search_academic_papers_tool,
    search_openalex_tool,
    search_arxiv_tool,
)
from agent.services.tools.web_tools import web_search_tool, web_research_tool
from agent_framework import Agent, FunctionTool
from agent_framework.openai import OpenAIChatClient, OpenAIChatOptions

# LLM request timeout: 5 s to connect, 120 s to read the full (streaming) response.
_LLM_TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=10.0)

# Tools that may only be used by agents whose role has them in registry tool_refs.
# Even if the builder assigns them to other agents, they will be silently dropped.
_EXCLUSIVE_TOOLS: dict[str, str] = {
    "send_line_message": "LineAgent",
    "read_line_messages": "LineAgent",
    "send_line_image": "LineAgent",
    "broadcast_line_message": "LineAgent",
    "send_line_flex_message": "LineAgent",
}

# Models that do not support stream_options (e.g. hunter-alpha via Stealth, GLM, Minimax, DeepSeek).
_MODELS_WITHOUT_STREAM_OPTIONS = ("hunter-alpha", "glm", "minimax", "deepseek")

# ---------------------------------------------------------------------------
# Monkey-patch: fix compatibility issues between agent_framework and the
# Stealth provider (hunter-alpha via OpenRouter).
#
# Problems patched:
#   1. _prepare_message_for_openai: text_reasoning blocks cause IndexError on
#      empty all_messages, and echoing reasoning_details back causes 400s.
#   2. _prepare_message_for_openai: `name` field on assistant messages is
#      rejected by some providers — restrict it to user-role only.
#   3. _inner_get_response: hardcoded `stream_options: {"include_usage": True}`
#      is not supported by Stealth and causes 400s on tool-bearing agents.
# ---------------------------------------------------------------------------
_original_prepare_message = OpenAIChatClient._prepare_message_for_openai  # type: ignore[attr-defined]


def _patched_prepare_message_for_openai(self, message):  # type: ignore[no-untyped-def]
    """Drop reasoning tokens, merge contents, and ensure 'content' field presence."""
    if message.role in ("system", "developer"):
        return _original_prepare_message(self, message)

    msg: dict[str, Any] = {"role": message.role}
    # Only attach `name` for user messages — assistant/tool name fields
    # are rejected by Stealth and many other OpenRouter-hosted providers.
    if message.author_name and message.role == "user":
        msg["name"] = message.author_name

    text_parts: list[str] = []
    tool_calls: list[Any] = []
    tool_result_messages: list[dict[str, Any]] = []

    for content in message.contents:
        if content.type in ("function_approval_request", "function_approval_response"):
            continue

        match content.type:
            case "function_call":
                tool_calls.append(self._prepare_content_for_openai(content))
            case "function_result":
                tool_result_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": content.call_id,
                        "content": content.result if content.result is not None else "",
                    }
                )
            case "text_reasoning":
                # Discard entirely — reasoning tokens must never be echoed back.
                pass
            case _:
                # Handle standard content (text, images, etc.)
                prepared = self._prepare_content_for_openai(content)
                if isinstance(prepared, dict) and prepared.get("type") == "text":
                    text_parts.append(prepared.get("text", ""))
                elif isinstance(prepared, str):
                    text_parts.append(prepared)
                else:
                    # Fallback for complex content types (e.g. image_url)
                    if "content" not in msg:
                        msg["content"] = []
                    msg["content"].append(prepared)
    if tool_result_messages:
        return tool_result_messages

    if tool_calls:
        msg["tool_calls"] = tool_calls

    # For assistant/user roles, flatten text parts if we don't have complex content already
    if msg.get("role") != "tool":
        if text_parts:
            text_str = "\n".join(text_parts)
            if isinstance(msg.get("content"), list):
                msg["content"].insert(0, {"type": "text", "text": text_str})
            else:
                msg["content"] = text_str

        # PROVIDER COMPATIBILITY FIX:
        # StepFun and some other providers via OpenRouter require 'content'
        # to be present (even if empty) when tool_calls are provided.
        if "tool_calls" in msg and "content" not in msg:
            msg["content"] = ""

    # Only return if we actually have something to send
    if "content" in msg or "tool_calls" in msg:
        return [msg]
    return []


def _patched_inner_get_response(self, *, messages, options, stream=False, **kwargs):  # type: ignore[no-untyped-def]
    """Strip `stream_options` and add detailed logging for debugging."""
    from collections.abc import AsyncIterable as _AsyncIterable
    import openai as _openai
    from agent_framework.exceptions import ChatClientException as _ChatClientException
    from agent_framework.openai._exceptions import (
        OpenAIContentFilterException as _ContentFilterEx,
    )

    options_dict = self._prepare_options(messages, options)

    # Use a logger that can be traced for debugging LLM requests
    _logger = logging.getLogger("agent.core.agent_factory.factory")
    if _logger.isEnabledFor(logging.DEBUG):
        _logger.debug(
            f"OpenAI Request (stream={stream}): {_json.dumps(options_dict, indent=2)}"
        )

    if stream:
        # Conditionally add stream_options to get usage data.
        # Some providers (e.g. hunter-alpha via Stealth, GLM) reject it.
        model_name = (options_dict.get("model") or "").lower()
        _needs_usage = not any(m in model_name for m in _MODELS_WITHOUT_STREAM_OPTIONS)

        async def _stream() -> _AsyncIterable:  # type: ignore[type-arg]
            client = await self._ensure_client()
            try:
                stream_kwargs = dict(options_dict)
                if _needs_usage:
                    stream_kwargs["stream_options"] = {"include_usage": True}
                async for chunk in await client.chat.completions.create(
                    stream=True, **stream_kwargs
                ):
                    if len(chunk.choices) == 0 and chunk.usage is None:
                        continue
                    yield self._parse_response_update_from_openai(chunk)
            except _openai.BadRequestError as ex:
                _logger.error(
                    f"OpenAI BadRequest (stream=True): {getattr(ex, 'body', ex)}"
                )
                if ex.code == "content_filter":
                    raise _ContentFilterEx(
                        f"{type(self)} service encountered a content error: {ex}",
                        inner_exception=ex,
                    ) from ex
                raise _ChatClientException(
                    f"{type(self)} service failed to complete the prompt: {ex}",
                    inner_exception=ex,
                ) from ex
            except Exception as ex:
                _logger.error(f"OpenAI Error (stream=True): {ex}")
                raise _ChatClientException(
                    f"{type(self)} service failed to complete the prompt: {ex}",
                    inner_exception=ex,
                ) from ex

        return self._build_response_stream(
            _stream(), response_format=options.get("response_format")
        )

    async def _get_response():  # type: ignore[no-untyped-def]
        client = await self._ensure_client()
        try:
            return self._parse_response_from_openai(
                await client.chat.completions.create(stream=False, **options_dict),
                options,
            )
        except _openai.BadRequestError as ex:
            _logger.error(
                f"OpenAI BadRequest (stream=False): {getattr(ex, 'body', ex)}"
            )
            if ex.code == "content_filter":
                raise _ContentFilterEx(
                    f"{type(self)} service encountered a content error: {ex}",
                    inner_exception=ex,
                ) from ex
            raise _ChatClientException(
                f"{type(self)} service failed to complete the prompt: {ex}",
                inner_exception=ex,
            ) from ex
        except Exception as ex:
            _logger.error(f"OpenAI Error (stream=False): {ex}")
            raise _ChatClientException(
                f"{type(self)} service failed to complete the prompt: {ex}",
                inner_exception=ex,
            ) from ex

    return _get_response()


# Patch stream_options out via _prepare_options post-hook instead, since
# _inner_get_response injects it after _prepare_options returns.
_original_prepare_options = OpenAIChatClient._prepare_options  # type: ignore[attr-defined]


def _patched_prepare_options(self, messages, options):  # type: ignore[no-untyped-def]
    """Remove parameters injected by _inner_get_response for provider compat."""
    result = _original_prepare_options(self, messages, options)
    # Strip parallel_tool_calls which causes 400s on providers that don't support it.
    # We do this for ALL providers to be safe, as the framework unconditionally injects it.
    result.pop("parallel_tool_calls", None)
    return result


OpenAIChatClient._prepare_message_for_openai = _patched_prepare_message_for_openai  # type: ignore[assignment]
OpenAIChatClient._inner_get_response = _patched_inner_get_response  # type: ignore[assignment]
OpenAIChatClient._prepare_options = _patched_prepare_options  # type: ignore[assignment]


class AgentFactory:
    """Creates fully-configured agent instances from an ``AgentSpec``."""

    def __init__(self, session: Session | None = None) -> None:
        self.logger = logging.getLogger(__name__)
        self._config = get_llm_config()
        # Maps tool name → FunctionTool, class type, or plain callable.
        # `Any` in the value type is unavoidable here: agent_framework
        # FunctionTool internally uses Callable[..., Any] for func.
        self._tool_registry: dict[str, FunctionTool | type | Callable[..., Any]] = (
            self._build_tool_registry()
        )
        # Optional default session — can be overridden per create_agent call.
        self.current_session: Session | None = session
        # Single shared AsyncOpenAI client for all agents created by this factory.
        # All agents share the same httpx connection pool, so once CoreAgent
        # resolves DNS and opens a connection the first time, every subsequent
        # agent (including BuilderAgent running as a tool) reuses that connection
        # without needing a new DNS lookup via run_in_executor.
        self._shared_async_openai = AsyncOpenAI(
            api_key=self._config.api_key,
            base_url=self._config.base_url,
            timeout=_LLM_TIMEOUT,
        )

    # ------------------------------------------------------------------
    # Tool registry
    # ------------------------------------------------------------------

    def _build_tool_registry(
        self,
    ) -> dict[str, FunctionTool | type | Callable[..., Any]]:
        """Return the mapping of tool name → callable/FunctionTool."""
        return {
            # Planning tools
            "generate_plan": generate_plan_tool,
            "update_planning_state": update_planning_state_tool,
            "list_available_models": list_available_models,
            "list_available_tools": list_available_tools_tool,
            "error_tool": error_tool,
            "query_vector_db": query_vector_db,
            "rename_session": rename_session_tool,
            # Knowledge-base tools
            "list_uploaded_files": list_uploaded_files_tool,
            "get_evaluation_result": get_evaluation_result_tool,
            # Google Docs
            "gdocs_read": gdocs_read_tool,
            "gdocs_append": gdocs_append_tool,
            # Google Sheets
            "gsheets_read": gsheets_read_tool,
            "gsheets_write": gsheets_write_tool,
            # Google Slides
            "gslides_read": gslides_read_tool,
            "gslides_add_slide": gslides_add_slide_tool,
            # Local Artifacts
            "save_artifact": save_artifact_tool,
            "list_artifacts": list_artifacts_tool,
            # LINE Messaging
            "send_line_message": send_line_message_tool,
            "read_line_messages": read_line_messages_tool,
            "send_line_image": send_line_image_tool,
            "broadcast_line_message": broadcast_line_message_tool,
            "send_line_flex_message": send_line_flex_message_tool,
            # Image generation
            "generate_image": generate_image_tool,
            "generate_batch_optimized_prompts": generate_batch_optimized_prompts_tool,
            "advanced_math": advanced_math_tool,
            # Academic tools
            "search_academic_papers": search_academic_papers_tool,
            "search_openalex": search_openalex_tool,
            "search_arxiv": search_arxiv_tool,
            # Web tools
            "web_search": web_search_tool,
            "web_research": web_research_tool,
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_agent(
        self,
        agent_spec: AgentSpec,
        context_providers: list[object] | None = None,
        session: Session | None = None,
        extra_tools: list[FunctionTool] | None = None,
    ) -> Agent[OpenAIChatOptions[None]]:
        """
        Create and return a framework agent for the given *agent_spec*.

        Parameters
        ----------
        agent_spec:
            The specification describing the agent's role, goal, and tools.
        context_providers:
            Additional ``BaseContextProvider`` instances to attach to the agent.
            ``MemoryContextProvider`` is appended automatically when a session
            is available and not already present in the list.
        session:
            Application-level session to inject into tools and context providers.
            Falls back to ``self.current_session`` when not supplied.
        """
        active_session = session or self.current_session

        # ── Context providers ──────────────────────────────────────────
        providers: list[object] = list(context_providers) if context_providers else []
        if active_session and not any(
            isinstance(p, MemoryContextProvider) for p in providers
        ):
            providers.append(MemoryContextProvider(active_session))

        # ── History provider (PostgreSQL-backed) ───────────────────────
        if active_session:
            providers.append(
                PostgresHistoryProvider(
                    session_id=active_session.session_id,
                    agent_name=agent_spec.role,
                    snapshot_repository=active_session.repositories.snapshots,
                )
            )

        self.logger.info(f"Creating agent: {agent_spec.role} (ID: {agent_spec.id})")

        # ── Instructions from template ─────────────────────────────────
        template_func = AgentRegistry.get(agent_spec.role) or AgentRegistry.get(
            "BaseAgent"
        )
        if template_func is None:
            raise RuntimeError(
                f"No template found for role '{agent_spec.role}' and no 'BaseAgent' fallback registered."
            )
        instructions: str = template_func(agent_spec.goal, agent_spec.context)

        # ── Tools ─────────────────────────────────────────────────────
        default_tool_refs = AgentRegistry.get_tool_refs(agent_spec.role)
        requested_tools: list[str] = list(
            dict.fromkeys(default_tool_refs + agent_spec.tools)
        )
        # Drop exclusive tools from agents that aren't the designated role.
        # This is a hard enforcement layer — the LLM cannot bypass it via the plan.
        filtered_tools: list[str] = []
        for name in requested_tools:
            required_role = _EXCLUSIVE_TOOLS.get(name)
            if required_role and agent_spec.role != required_role:
                self.logger.warning(
                    f"Tool '{name}' is exclusive to role '{required_role}' "
                    f"— dropping from agent '{agent_spec.role}' (id={agent_spec.id})."
                )
                continue
            filtered_tools.append(name)
        tools = [
            wrapped
            for name in filtered_tools
            if (wrapped := self._wrap_tool(name, active_session)) is not None
        ]
        if extra_tools:
            tools.extend(extra_tools)

        # ── Agent client ───────────────────────────────────────────────
        # Use the per-agent model if specified; fall back to the global config.
        model = (
            agent_spec.model if getattr(agent_spec, "model", "") else self._config.model
        )
        client = OpenAIChatClient(
            model_id=model,
            async_client=self._shared_async_openai,
        )

        agent = client.as_agent(
            name=agent_spec.role,
            instructions=instructions,
            context_providers=providers,
            tools=tools,
            middleware=[LoggingMiddleware()],
        )
        # Attach spec id for persistence traceability.
        agent.spec_id = agent_spec.id  # type: ignore[attr-defined]
        return agent  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _wrap_tool(
        self, tool_name: str, session: Session | None
    ) -> FunctionTool | Callable[..., Any] | None:
        """
        Retrieve a tool by name and return it wrapped with session injection.
        Returns ``None`` if the tool is not found (logs a warning).
        """
        tool_entry = self._tool_registry.get(tool_name)
        if tool_entry is None:
            self.logger.warning(f"Tool '{tool_name}' not found in registry — skipping.")
            return None

        if isinstance(tool_entry, FunctionTool):
            return self._wrap_function_tool(tool_entry, tool_name, session)

        if isinstance(tool_entry, type):
            return self._wrap_class_tool(tool_entry, tool_name)

        if callable(tool_entry):
            return self._wrap_plain_callable(tool_entry, tool_name, session)

        if self.logger.isEnabledFor(logging.DEBUG):
            self.logger.warning(
                f"Tool '{tool_name}' has unrecognised type {type(tool_entry)} — skipping."
            )
        return None

    def _wrap_function_tool(
        self, ft: FunctionTool, name: str, session: Session | None
    ) -> FunctionTool:
        """
        Re-wrap a FunctionTool with a session-injecting closure, preserving the
        original schema, description, and max_invocations so the LLM gets the
        full JSON schema.
        """
        original_func = ft.func
        if original_func is None:
            raise ValueError(f"FunctionTool '{ft.name}' has no callable func set.")

        def _emit_tool_status(tool_name: str, phase: str) -> None:
            if session is None or session.session_type != "planning":
                return
            if tool_name == "error_tool":
                return

            emoji = "🔨" if phase == "start" else "✅"
            verb = "Calling" if phase == "start" else "Finished"
            session.stream_events.put_nowait(
                {
                    "type": "builder_think",
                    "chunk": f"{emoji} {verb} {tool_name} tool\n",
                }
            )

        if asyncio.iscoroutinefunction(original_func):

            async def _async_session_func(
                *args: Any, _f=original_func, _sess=session, **kwargs: Any
            ) -> Any:
                if _sess is not None:
                    kwargs.setdefault("session", _sess)
                _emit_tool_status(ft.name, "start")
                try:
                    return await _f(*args, **kwargs)
                finally:
                    _emit_tool_status(ft.name, "done")

            _async_session_func.__name__ = ft.name
            wrapped_func: Any = _async_session_func
        else:

            def _sync_session_func(
                *args: Any, _f=original_func, _sess=session, **kwargs: Any
            ) -> Any:  # type: ignore[misc]
                if _sess is not None:
                    kwargs.setdefault("session", _sess)
                _emit_tool_status(ft.name, "start")
                try:
                    return _f(*args, **kwargs)
                finally:
                    _emit_tool_status(ft.name, "done")

            _sync_session_func.__name__ = ft.name
            wrapped_func = _sync_session_func

        wrapped = FunctionTool(
            name=ft.name,
            description=ft.description,
            input_model=ft.input_model,
            max_invocations=ft.max_invocations,
            func=wrapped_func,
        )
        self.logger.info(
            f"Registered FunctionTool '{name}' with session injection "
            f"(schema={ft.input_model.__name__ if ft.input_model else 'inferred'}, "
            f"max_invocations={ft.max_invocations})."
        )
        return wrapped

    def _wrap_class_tool(self, tool_cls: type, name: str) -> Callable[..., Any] | None:
        """Instantiate a class-based tool and return it (or its .invoke wrapper)."""
        instance = tool_cls()
        if not hasattr(instance, "invoke"):
            self.logger.warning(
                f"Class tool '{name}' has no .invoke() method — skipping."
            )
            return None

        @functools.wraps(instance.invoke)
        def _invoke_wrapper(*args: Any, _inst=instance, **kwargs: Any) -> Any:
            return _inst.invoke(*args, **kwargs)

        _invoke_wrapper.__name__ = name
        return _invoke_wrapper

    def _wrap_plain_callable(
        self, fn: Callable[..., Any], name: str, session: Session | None
    ) -> Callable[..., Any]:
        """Wrap a plain function with session injection."""

        @functools.wraps(fn)
        def _wrapper(*args: Any, _f=fn, _sess=session, **kwargs: Any) -> Any:
            if _sess is not None:
                kwargs.setdefault("session", _sess)
            return _f(*args, **kwargs)

        _wrapper.__name__ = name
        self.logger.info(f"Registered plain callable '{name}' with session injection.")
        return _wrapper
