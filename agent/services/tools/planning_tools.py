"""
Planning tools — tools available to the BuilderAgent during the planning phase.

``generate_plan`` is the sole plan-persistence tool in this module. It is decorated with
``@tool(schema=PlanSpec)`` so the LLM receives the full Pydantic JSON schema,
and it persists the plan to PostgreSQL via the async DB layer.
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Annotated, cast

from agent_framework import tool
from pydantic import BaseModel, Field

from agent.core.session_manager import Session
from agent.core.spec import PlanSpec, AgentSpec, VectorDBQueryInput
from agent.core.types import (
    SidebandPlanCreatedDict,
    PlanCreatedDataDict,
    AgentInfoDict,
    SidebandSessionRenamedDict,
)
from agent.services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)


def _apply_confirmed_model_assignments(
    agents: list[AgentSpec | dict[str, object]],
    confirmed_assignments: dict[str, str],
) -> list[AgentSpec | dict[str, object]]:
    if not confirmed_assignments:
        return agents

    updated_agents: list[AgentSpec | dict[str, object]] = []
    for agent in agents:
        if isinstance(agent, dict):
            agent_id = str(agent.get("id", "") or "").strip()
            agent_role = str(agent.get("role", "") or "").strip()
            override = confirmed_assignments.get(agent_id) or confirmed_assignments.get(agent_role)
            if override:
                updated = dict(agent)
                updated["model"] = override
                updated_agents.append(updated)
                continue
        else:
            override = confirmed_assignments.get(agent.id) or confirmed_assignments.get(agent.role)
            if override:
                updated_agents.append(agent.model_copy(update={"model": override}))
                continue
        updated_agents.append(agent)
    return updated_agents


class PlanningMemoryUpdateInput(BaseModel):
    subject: Annotated[
        str | None,
        Field(description="Confirmed subject or domain of the project, if explicitly established."),
    ] = None
    target_outcome: Annotated[
        str | None,
        Field(description="Confirmed target outcome or deliverable, if explicitly established."),
    ] = None
    scope: Annotated[
        str | None,
        Field(description="Confirmed scope boundaries for the project, if explicitly established."),
    ] = None
    audience: Annotated[
        str | None,
        Field(description="Confirmed target audience or operating context, if explicitly established."),
    ] = None
    constraints: Annotated[
        list[str] | None,
        Field(description="Confirmed constraints the planner must respect."),
    ] = None
    required_tools: Annotated[
        list[str] | None,
        Field(description="Confirmed required tools or capabilities for the project."),
    ] = None
    confirmed_decisions: Annotated[
        list[str] | None,
        Field(description="Confirmed decisions already made with the user."),
    ] = None
    open_questions: Annotated[
        list[str] | None,
        Field(description="Explicitly identified open questions that still need confirmation."),
    ] = None


@tool(
    name="update_planning_state",
    description=(
        "Persist confirmed planning facts for the current session. Call this only when the user has "
        "clearly confirmed a fact or decision. Do not store guesses or ambiguous assumptions."
    ),
    schema=PlanningMemoryUpdateInput,
    max_invocations=20,
)
async def update_planning_state_tool(
    subject: str | None = None,
    target_outcome: str | None = None,
    scope: str | None = None,
    audience: str | None = None,
    constraints: list[str] | None = None,
    required_tools: list[str] | None = None,
    confirmed_decisions: list[str] | None = None,
    open_questions: list[str] | None = None,
    **kwargs: object,
) -> str:
    _raw_session = kwargs.get("session")
    session: Session | None = _raw_session if isinstance(_raw_session, Session) else None
    if session is None:
        logger.warning("update_planning_state called without a session — state not saved.")
        return "No session available — planning state not saved."

    updates: dict[str, Any] = {
        key: value
        for key, value in {
            "subject": subject,
            "target_outcome": target_outcome,
            "scope": scope,
            "audience": audience,
            "constraints": constraints,
            "required_tools": required_tools,
            "confirmed_decisions": confirmed_decisions,
            "open_questions": open_questions,
        }.items()
        if value is not None
    }
    updates["last_updated_at"] = datetime.now(timezone.utc).isoformat()

    changed_fields = await session.update_planning_memory_async(updates)
    visible_fields = [field_name for field_name in changed_fields if field_name != "last_updated_at"]
    if not visible_fields:
        return "Planning state is already up to date with these confirmed facts. No further action needed for these fields."

    return f"Planning state updated. Stored confirmed fields: {', '.join(visible_fields)}."


@tool(
    name="generate_plan",
    description=(
        "Saves a fully-structured execution plan to the database. "
        "Call this tool after you have designed the agent team and chosen "
        "the orchestration strategy. If validation fails, fix the issues and call again. "
        "The plan will be confirmed with the user."
    ),
    schema=PlanSpec,
    max_invocations=20,
)
async def generate_plan_tool(
    orchestration: str,
    agents: list[
        AgentSpec | dict[str, object]
    ],  # Pydantic coerces dicts → AgentSpec via PlanSpec
    inputs: dict[str, Any] | None = None,
    **kwargs: object,  # 'session' injected by AgentFactory at runtime; not visible to LLM
) -> str:
    """Validate and persist a PlanSpec, then return a human-readable confirmation."""
    from pydantic import ValidationError

    normalized_inputs: dict[str, Any] = {}
    for key, value in (inputs or {}).items():
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                normalized_inputs[key] = cleaned
        elif value is not None:
            normalized_inputs[key] = value

    # Resolve session_id injected by AgentFactory
    _raw_session = kwargs.get("session")
    session: Session | None = _raw_session if isinstance(_raw_session, Session) else None
    if session is not None:
        session_id: str = session.session_id or str(uuid.uuid4())
    else:
        logger.warning("generate_plan called without a session — using ephemeral UUID.")
        session_id = str(uuid.uuid4())

    confirmed_assignments = (
        session.get_confirmed_model_assignments() if session is not None else {}
    )
    agents = _apply_confirmed_model_assignments(agents, confirmed_assignments)

    # Validate model IDs against the DB catalog before accepting the plan.
    try:
        if session is None:
            return "No session available — cannot validate model IDs."
        available_models = await session.repositories.models.query_openrouter_models()
        valid_ids: set[str] = {m["id"] for m in available_models}
    except Exception as exc:
        logger.warning(
            "generate_plan: could not fetch model catalog for validation: %s", exc
        )
        valid_ids = set()  # skip validation if DB unavailable

    if valid_ids:
        bad_models = [
            f"agent '{a['role'] if isinstance(a, dict) else a.role}' uses '{a['model'] if isinstance(a, dict) else a.model}'"
            for a in agents
            if (a["model"] if isinstance(a, dict) else a.model) not in valid_ids
            and (a["model"] if isinstance(a, dict) else a.model)  # skip empty
        ]
        if bad_models:
            valid_sample = ", ".join(list(valid_ids)[:5])
            return (
                f"Invalid model IDs detected — these are not in the available models catalog: "
                f"{'; '.join(bad_models)}. "
                f"Call list_available_models and use only the exact 'id' values returned. "
                f"Example valid IDs: {valid_sample}."
            )

    previous_plan_id = session.planning_state.plan_id if session is not None else None
    if previous_plan_id:
        logger.info(
            "generate_plan revision requested: session=%s replacing_plan_id=%s",
            session_id,
            previous_plan_id,
        )

    if session is not None:
        planning_backfill = {
            field_name: normalized_inputs[field_name]
            for field_name in ("subject", "target_outcome")
            if isinstance(normalized_inputs.get(field_name), str)
            and normalized_inputs.get(field_name)
            and not getattr(session.planning_state.planning_memory, field_name)
        }
        if planning_backfill:
            planning_backfill["last_updated_at"] = datetime.now(timezone.utc).isoformat()
            await session.update_planning_memory_async(planning_backfill)

        missing_fields = [
            field_name
            for field_name in session.planning_state.planning_memory.missing_required_fields()
            if not isinstance(normalized_inputs.get(field_name), str)
            or not normalized_inputs.get(field_name)
        ]
        if missing_fields:
            return (
                "Cannot save plan yet; missing confirmed planning fields: "
                f"{', '.join(missing_fields)}. "
                "Capture them with `update_planning_state` before calling `generate_plan`."
            )

    try:
        plan = PlanSpec(
            orchestration=orchestration,  # type: ignore[arg-type]  Literal validated by Pydantic
            agents=cast(
                list[AgentSpec], agents
            ),  # Pydantic validates dicts→AgentSpec at runtime
            inputs=normalized_inputs,
        )
    except ValidationError as exc:
        error_detail = "; ".join(
            f"{'.'.join(str(loc) for loc in e['loc'])}: {e['msg']}"
            for e in exc.errors()
        )
        logger.warning("generate_plan validation failed: %s", error_detail)
        return (
            f"Plan validation failed — please fix these fields and call the tool again: "
            f"{error_detail}. "
            "Make sure every agent has 'role' and 'goal', and 'orchestration' is one of: "
            "sequential, concurrent, group_chat, handoff, magentic."
        )

    # Validate exclusively reserved LINE tools
    line_violations = []
    for agent_spec in plan.agents:
        if agent_spec.role != "LineAgent":
            if any(t in ["send_line_message", "read_line_messages"] for t in agent_spec.tools):
                line_violations.append(agent_spec.role)
    if line_violations:
        logger.warning(f"generate_plan validation failed: LINE tools assigned to {line_violations}")
        return (
            f"Plan validation failed: Agents {', '.join(line_violations)} were assigned 'send_line_message' or 'read_line_messages'. "
            "These tools are STRICTLY reserved for the 'LineAgent' role. "
            "Please remove these tools from all other agents and call generate_plan again."
        )

    logger.info(
        "generate_plan called: orchestration=%s agents=[%s] session=%s",
        plan.orchestration,
        ", ".join(a.role for a in plan.agents),
        session_id,
    )

    try:
        if session is None:
            raise RuntimeError("generate_plan requires a session with injected repositories")
        plan_id = await session.repositories.plans.save_plan(session_id, plan)
        if session is not None:
            await session.mark_plan_created(plan_id)
            sideband_event = SidebandPlanCreatedDict(
                type="plan_created",
                data=PlanCreatedDataDict(
                    plan_id=str(plan_id),
                    orchestration=plan.orchestration,
                    agents=[
                        AgentInfoDict(
                            id=a.id,
                            role=a.role,
                            goal=a.goal,
                            tools=a.tools,
                            model=a.model,
                            order=a.order,
                            isLeader=a.is_leader,
                        )
                        for a in plan.agents
                    ],
                ),
            )
            session.stream_events.put_nowait(sideband_event)
    except Exception as exc:
        logger.error("generate_plan DB error: %s", exc, exc_info=True)
        raise

    revision_note = (
        f" Replaced previous active plan: {previous_plan_id}."
        if previous_plan_id
        else ""
    )
    return (
        f"Plan saved to session [{session_id}] as the active plan. "
        f"Plan ID: {plan_id}."
        f"{revision_note} "
        f"Orchestration: {plan.orchestration}. "
        f"Agents defined: {len(plan.agents)}. "
        "A saved plan now exists for this session. The agent cannot create the team for you. When you are ready to execute this saved plan, click the Create Team button yourself in the UI."
    )


class ErrorToolInput(BaseModel):
    error_message: Annotated[
        str, Field(description="The error message to log for debugging.")
    ]


@tool(
    name="get_current_plan",
    description=(
        "Retrieves the active execution plan for the current session. "
        "Returns the orchestration strategy and the full list of defined agents, "
        "including their roles, goals, tools, and assigned models. "
        "Use this to review the plan or verify model overrides before making further changes."
    ),
)
async def get_current_plan(**kwargs: object) -> str:
    """Load the latest plan for the session and return it as a formatted string."""
    _raw_session = kwargs.get("session")
    session: Session | None = _raw_session if isinstance(_raw_session, Session) else None
    if session is None:
        return "No session available — cannot retrieve plan."

    plan_data, agents_data = await session.repositories.plans.load_latest_plan(
        session.session_id
    )
    if not plan_data:
        return "No plan has been generated for this session yet."

    import json

    # We merge confirmed model assignments into the output so the agent sees the latest truth
    confirmed_assignments = session.get_confirmed_model_assignments()

    agents = []
    for row in agents_data or []:
        # Handle JSON fields in the DB row
        tools = row.get("tools", [])
        if isinstance(tools, str):
            try:
                tools = json.loads(tools)
            except Exception:
                tools = []

        agent_id = str(row["id"])
        model = str(row.get("model") or "")
        
        # Apply confirmed override if present
        if agent_id in confirmed_assignments:
            model = confirmed_assignments[agent_id]

        agents.append(
            {
                "id": agent_id,
                "role": str(row["role"]),
                "goal": str(row["goal"]),
                "tools": tools,
                "model": model,
                "is_leader": bool(row.get("is_leader")),
                "order": int(row.get("order_index") or 0),
            }
        )

    result = {
        "orchestration": str(plan_data["orchestration"]),
        "agents": agents,
        "inputs": plan_data.get("inputs") or {},
    }

    return json.dumps(result, indent=2, ensure_ascii=False)


@tool(
    name="list_available_models",
    description=(
        "Returns the list of LLM models available for assignment to agents in the plan. "
        "Each entry contains: id (use this as the model value), name, tags, selection_hint (high-level recommendation), "
        "advanced_info (detailed pricing & reasoning context), description (long-form capabilities), "
        "context_length, input_price, output_price, and is_reasoning (bool). "
        "Call this BEFORE generating a plan. Read the description and selection_hint carefully to match "
        "each model to the task complexity and role of your agents — do not assign models arbitrarily."
    ),
)
async def list_available_models(**kwargs: object) -> str:
    """Query active models from the openrouter_models table."""
    import json
    from decimal import Decimal

    _raw_session = kwargs.get("session")
    session: Session | None = _raw_session if isinstance(_raw_session, Session) else None
    if session is None:
        return "No session available — cannot query models."

    models = await session.repositories.models.query_openrouter_models()

    # Convert Decimal pricing to float for JSON serialisation
    for model in models:
        for key, value in model.items():
            if isinstance(value, Decimal):
                model[key] = float(value)

    return (
        json.dumps(models, ensure_ascii=False)
        + "\n\nIMPORTANT: Model list retrieved. Your ONLY valid next action is to call `generate_plan` with these model IDs. Do NOT respond to the user before calling `generate_plan`."
    )


@tool(
    name="error_tool",
    description="A tool to report errors back to the log. Call this if you encounter an error during planning that you want to log for debugging purposes.",
    schema=ErrorToolInput,
    max_invocations=5,
)
async def error_tool(**kwargs: object):
    logger.error("Error reported From the Agent using error_tool: %s", kwargs)
    return f"Error logged: {kwargs}"


class RenameSessionInput(BaseModel):
    title: Annotated[
        str,
        Field(
            description="A short, descriptive session title (≤ 40 characters, plain language, no quotes or markdown)."
        ),
    ]


@tool(
    name="rename_session",
    description=(
        "Set a short, descriptive title for this planning session based on the "
        "user's topic. Call this on your FIRST response, once you understand "
        "what the user wants to build. Title must be ≤ 40 characters, plain "
        "language, no quotes or markdown."
    ),
    schema=RenameSessionInput,
    max_invocations=1,
)
async def rename_session_tool(title: str, **kwargs: object) -> str:
    """Generate a short session title and persist it to the database."""
    _raw_session = kwargs.get("session")
    session: Session | None = _raw_session if isinstance(_raw_session, Session) else None
    if session is None:
        logger.warning("rename_session called without a session — title not saved.")
        return "No session available — title not saved."

    session_id: str = session.session_id
    if not session_id:
        logger.warning("rename_session called with no session_id — title not saved.")
        return "No session_id — title not saved."

    title = title[:40].strip()

    try:
        await session.repositories.sessions.update_chat_session_title(session_id, title)
        await session.update_metadata_async({"session_title": title})
    except Exception as exc:
        logger.error("rename_session DB error: %s", exc, exc_info=True)
        return f"Failed to save title: {exc}"

    sideband = SidebandSessionRenamedDict(
        type="session_renamed",
        session_id=session_id,
        title=title,
    )
    session.stream_events.put_nowait(sideband)

    logger.info("Session %s renamed to: %s", session_id, title)
    return f"Session title updated to: {title}"


@tool(
    name="query_vector_db",
    description=(
        "Query the vector database for documents relevant to the current session. "
        "Returns the most relevant text chunks from uploaded files, attributed to their source file. "
        "Call this to retrieve knowledge before generating answers or plans."
    ),
    schema=VectorDBQueryInput,
)
async def query_vector_db(query: str, **kwargs: object) -> str:
    _raw_session = kwargs.get("session")
    session: Session | None = _raw_session if isinstance(_raw_session, Session) else None
    session_id: str = session.session_id if session is not None else ""
    if session is None or not session_id:
        return "No session available — cannot query vector DB without a session_id."

    embedding_service = EmbeddingService()

    logger.info("Embedding query for vector DB search")
    try:
        query_embedding = await embedding_service.embed_query(
            session_id, 
            query
        )
    except Exception as exc:
        logger.error("query_vector_db: embed_query failed: %s", exc, exc_info=True)
        return f"Failed to generate embedding for query '{query}': {exc}"

    chunks = await session.repositories.embeddings.search_similar_chunks_with_metadata(
        session_id, query_embedding, top_k=5
    )

    if not chunks:
        return f"No relevant documents found for query: '{query}'"

    lines = [f"Top {len(chunks)} relevant chunk(s) for query: '{query}'\n"]
    for i, chunk in enumerate(chunks, 1):
        citation = str(chunk.get("citation_markdown") or "").strip()
        content = str(chunk.get("content", ""))
        if not citation:
            file_key = str(chunk.get("file_key", "unknown"))
            citation = file_key.split("/")[-1] if "/" in file_key else file_key
        lines.append(f"[{i}] Source: {citation}")
        lines.append(content)
        lines.append("")

    return "\n".join(lines)


# Internal/meta tools that should never be assigned to sub-agents.
_INTERNAL_TOOLS: frozenset[str] = frozenset(
    {
        "generate_plan",
        "update_planning_state",
        "get_current_plan",
        "rename_session",
        "error_tool",
        "list_available_models",
        "list_available_tools",
        "save_artifact",
        "list_artifacts",
        "send_line_message",
        "read_line_messages",
        "generate_batch_optimized_prompts",
        "list_uploaded_files",
        "get_evaluation_result",
        "gdocs_create",
        "gsheets_create",
        "gslides_create",
        "gdrive_list_artifacts",
    }
)

_KNOWLEDGE_TOOLS: frozenset[str] = frozenset(
    {
        "query_vector_db",
        "list_uploaded_files",
        "get_evaluation_result",
    }
)


def _tool_category(name: str) -> str:
    if name.startswith(("gdocs_", "gsheets_", "gslides_", "gdrive_")):
        return "Google Workspace"
    if name in {"search_academic_papers", "search_openalex", "search_arxiv"}:
        return "Academic Research"
    if name in _KNOWLEDGE_TOOLS:
        return "Knowledge & Context"
    return "General / Utilities"


@tool(
    name="list_available_tools",
    description=(
        "Returns the full catalog of tools that can be assigned to sub-agents in a plan. "
        "Each entry includes: name, description, category, and full JSON parameter schema. "
        "Call this BEFORE calling generate_plan so you assign only real, valid tool names. "
        "Never invent tool names that were not returned by this tool."
    ),
    max_invocations=1,
)
async def list_available_tools_tool(**kwargs: object) -> str:
    """
    Enumerate all assignable FunctionTools by lazy-importing the tool modules.

    SYNC: keep this import list in sync with factory.py _build_tool_registry.
    Any new tool module added to the registry must be imported here too.
    """
    import json as _json
    from agent_framework import FunctionTool as _FunctionTool

    # Lazy imports — these modules are already in sys.modules at call time
    # because factory.py imported them at startup. No circular risk.
    from agent.services.tools import knowledge_tools as _kt
    from agent.services.tools import gworkspace as _gw
    from agent.services.tools import math_tools as _mt
    from agent.services.tools import academic_tools as _at
    from agent.services.tools import web_tools as _wt

    # Collect FunctionTool objects from each module.
    # planning_tools-scope tools (already in this module's namespace):
    candidate_tools: list[_FunctionTool] = [
        query_vector_db,  # type: ignore[list-item]
    ]
    # knowledge_tools
    candidate_tools += [
        _kt.list_uploaded_files_tool,
        _kt.get_evaluation_result_tool,
    ]
    # gworkspace tools
    candidate_tools += [
        _gw.gdocs_read_tool,
        _gw.gdocs_append_tool,
        _gw.gsheets_read_tool,
        _gw.gsheets_write_tool,
        _gw.gslides_read_tool,
        _gw.gslides_add_slide_tool,
    ]
    # math tools
    candidate_tools += [
        _mt.advanced_math_tool,
    ]
    # academic tools
    candidate_tools += [
        _at.search_academic_papers_tool,
        _at.search_openalex_tool,
        _at.search_arxiv_tool,
    ]
    # web tools
    candidate_tools += [
        _wt.web_search_tool,
        _wt.web_research_tool,
    ]

    grouped_result = {}
    for ft in candidate_tools:
        name = getattr(ft, "name", None) or getattr(ft, "__name__", "unknown")
        if name in _INTERNAL_TOOLS:
            continue
        description = getattr(ft, "description", "") or ""
        input_model = getattr(ft, "input_model", None)
        schema = input_model.model_json_schema() if input_model is not None else {}
        # Remove noisy metadata keys agents don't need
        schema.pop("title", None)
        
        category = _tool_category(name)
        if category not in grouped_result:
            grouped_result[category] = []
            
        grouped_result[category].append(
            {
                "name": name,
                "description": description,
                "parameters": schema,
            }
        )

    return _json.dumps(grouped_result, indent=2, ensure_ascii=False)
