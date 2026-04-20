"""
Shared TypedDict definitions for the agent service stream protocol.

These types describe the dict payloads yielded by ``CoreAgent.chat_stream``
and consumed by the gRPC servicer, WebSocket server, and tests.

Queue vs. Stream separation
----------------------------
Sideband dicts (e.g. ``SidebandPlanCreatedDict``) are placed onto 
``Session.stream_events`` by tools. They omit ``session_id`` and ``agent_id`` 
because tools are session-agnostic.

Enriched Event dicts (e.g. ``PlanCreatedEventDict``) are yielded by 
``chat_stream`` after ``_drain_sideband_events`` injects the IDs.
"""

from __future__ import annotations
from typing import TypedDict, List, Union, Optional, Any

# ─── 1. Base Interface ──────────────────────────────────────────────────

class BaseEventDict(TypedDict):
    """Common fields required by gRPC/WebSocket for routing and attribution."""
    session_id: str
    agent_id: str

# ─── 2. Metadata Structures ─────────────────────────────────────────────

class AgentInfoDict(TypedDict):
    """Agent metadata carried inside a PlanCreatedEventDict."""
    id: str
    role: str
    goal: str
    tools: list[str]
    model: str
    order: int
    isLeader: bool

class ThinkingItemDict(TypedDict):
    """One item in an agent's thinking chain (message or tool call/result)."""
    role: str            # "user" | "assistant" | "tool"
    content_type: str    # "text" | "function_call" | "function_result"
    text: str            # message text (empty string if not applicable)
    tool_name: str       # tool name (empty string if not applicable)
    arguments: str       # JSON-encoded args for function_call (empty string otherwise)


class PlanCreatedDataDict(TypedDict):
    """The structured data payload for a designed execution plan."""
    plan_id: str
    orchestration: str
    agents: list[AgentInfoDict]

# ─── 3. Enriched Events (Inherit from Base) ─────────────────────────────
# These are what CoreAgent.chat_stream actually yields to the servicer.

class ChunkEventDict(BaseEventDict):
    """Text-chunk event yielded during streaming LLM responses."""
    chunk: str

class PlanCreatedEventDict(BaseEventDict):
    """Enriched plan_created event containing the full team design."""
    type: str  # Literal["plan_created"]
    data: PlanCreatedDataDict

class SessionRenamedEventDict(TypedDict): 
    """Enriched session_renamed event. Note: usually only needs session_id."""
    type: str  # Literal["session_renamed"]
    session_id: str
    title: str

class UsageEventDict(BaseEventDict):
    """Token usage metrics emitted after an agent completes a run."""
    type: str  # Literal["usage_event"]
    model_id: str
    input_tokens: int
    output_tokens: int

class BuilderThinkEventDict(BaseEventDict):
    """Enriched 'thinking' tokens from the BuilderAgent design phase."""
    type: str  # Literal["builder_think"]
    chunk: str

class WorkflowNodeDataDict(TypedDict, total=False):
    trace_id: str
    execution_session_id: str
    orchestration: str
    summary: str
    status: str
    agent_id: str
    agent_role: str
    is_leader: bool
    from_agent_id: str
    order: int
    preview: str
    response: str
    error: str
    started_at: str
    completed_at: str
    thinking: list[ThinkingItemDict]

class WorkflowStartedEventDict(BaseEventDict):
    type: str
    data: WorkflowNodeDataDict

class WorkflowNodeUpdatedEventDict(BaseEventDict):
    type: str
    data: WorkflowNodeDataDict

class WorkflowCompletedEventDict(BaseEventDict):
    type: str
    data: WorkflowNodeDataDict

class WorkflowFailedEventDict(BaseEventDict):
    type: str
    data: WorkflowNodeDataDict

class WorkflowPresentationPromptEventDict(BaseEventDict):
    """Emitted when the leader decides a workflow is needed and asks the user how to present it."""
    type: str  # Literal["workflow_presentation_prompt"]
    prompt_id: str
    question: str
    original_message: str

# ─── 4. Sideband Types (The "Raw" payloads) ─────────────────────────────
# These lack session_id/agent_id and live in Session.stream_events.

class SidebandPlanCreatedDict(TypedDict):
    type: str
    data: PlanCreatedDataDict

class SidebandBuilderThinkDict(TypedDict):
    type: str
    chunk: str

class SidebandSessionRenamedDict(TypedDict):
    type: str
    session_id: str
    title: str

class SidebandWorkflowEventDict(TypedDict):
    type: str
    data: WorkflowNodeDataDict

# ─── 5. Unions for Type Hinting ─────────────────────────────────────────

# Types that can be found in the session.stream_events queue
SidebandEventDict = (
    SidebandPlanCreatedDict
    | SidebandSessionRenamedDict
    | UsageEventDict
    | SidebandBuilderThinkDict
    | SidebandWorkflowEventDict
)

# Types yielded by chat_stream and consumed by gRPC
StreamEventDict = (
    ChunkEventDict
    | PlanCreatedEventDict
    | SessionRenamedEventDict
    | UsageEventDict
    | BuilderThinkEventDict
    | WorkflowStartedEventDict
    | WorkflowNodeUpdatedEventDict
    | WorkflowCompletedEventDict
    | WorkflowFailedEventDict
    | WorkflowPresentationPromptEventDict
)

# Metadata for get_agent_list
class AgentListItemDict(TypedDict):
    role: str
    description: str