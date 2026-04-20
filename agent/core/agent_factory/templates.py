import json
from agent.core.agent_factory.registry import AgentRegistry
from agent.prompts.researcher import RESEARCHER_PROMPT
from agent.prompts.coder import CODER_PROMPT
from agent.prompts.base_agent import BASE_AGENT_PROMPT
from agent.prompts.core_agent import CORE_AGENT_PROMPT
from agent.prompts.builder_agent import BUILDER_AGENT_PROMPT
from agent.prompts.line_agent import LINE_AGENT_PROMPT


@AgentRegistry.register("Researcher")
def researcher_template(goal: str, context: dict) -> str:
    if goal.strip().startswith("# Role:"):
        return goal
    return RESEARCHER_PROMPT.format(goal=goal, context=context)


@AgentRegistry.register("Coder")
def coder_template(goal: str, context: dict) -> str:
    if goal.strip().startswith("# Role:"):
        return goal
    return CODER_PROMPT.format(goal=goal, context=context)


@AgentRegistry.register("BaseAgent")
def base_template(goal: str, context: dict) -> str:
    if goal.strip().startswith("# Role:"):
        return goal
    return BASE_AGENT_PROMPT.format(goal=goal, context=context)


@AgentRegistry.register(
    "CoreAgent",
    tool_refs=[
        "list_available_tools",
        "list_available_models",
        "get_current_plan",
        "handoff_to_BuilderAgent",
        "rename_session",
        "list_uploaded_files",
        "get_evaluation_result",
        "query_vector_db",
        "search_academic_papers",
        "search_openalex",
        "search_arxiv",
        "web_search",
        "web_research",
    ],
)
def core_agent_template(goal: str, context: dict) -> str:
    context_str = json.dumps(context, indent=2) if context else "None provided"
    return CORE_AGENT_PROMPT.format(goal=goal, context=context_str)


@AgentRegistry.register(
    "BuilderAgent",
    tool_refs=["generate_batch_optimized_prompts", "get_current_plan"],
)
def builder_agent_template(goal: str, context: dict) -> str:
    context_str = json.dumps(context, indent=2) if context else "None provided"
    return BUILDER_AGENT_PROMPT.format(context=context_str)


@AgentRegistry.register(
    "LineAgent", tool_refs=["send_line_message", "read_line_messages"]
)
def line_agent_template(goal: str, context: dict) -> str:
    if goal.strip().startswith("# Role:"):
        return goal
    tone = context.get("tone", "Professional")
    group_context = context.get("group_context", "General Assistant")
    return LINE_AGENT_PROMPT.format(goal=goal, tone=tone, group_context=group_context)
