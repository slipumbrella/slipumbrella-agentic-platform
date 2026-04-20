import uuid
from typing import Any, Dict, List, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

OrchestrationMode = Literal[
    "sequential",
    "concurrent",
    "group_chat",
    "handoff",
    "magentic",
]


class AgentSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique ID for the agent instance (auto-generated if omitted)",
    )
    role: str = Field(..., description="Role name, e.g. Researcher, Coder, BuilderAgent")
    goal: str = Field(..., description="Description of what this agent should achieve")
    tools: List[str] = Field(default_factory=list, description="List of tool names to attach")
    context: Dict[str, Any] = Field(default_factory=dict, description="Extra input the agent may need")
    model: str = Field(default="", description="OpenRouter model ID; empty = use global config fallback at execution time")
    order: int = Field(default=0, description="Execution order for this agent inside the plan")
    is_leader: bool = Field(default=False, alias="isLeader", description="Whether this agent is the leader/manager for the orchestration")


class PlanSpec(BaseModel):
    orchestration: OrchestrationMode = Field(
        ...,
        description="Workflow orchestration strategy: sequential, concurrent, group_chat, handoff, or magentic",
    )
    agents: List[AgentSpec] = Field(..., description="Ordered list of agents to instantiate")
    inputs: Dict[str, Any] = Field(default_factory=dict, description="General input/context for the workflow")

    @model_validator(mode="after")
    def normalize_and_validate_agents(self) -> "PlanSpec":
        normalized_agents: list[AgentSpec] = []
        seen_orders: set[int] = set()

        for index, agent in enumerate(self.agents, start=1):
            order = agent.order if agent.order > 0 and agent.order not in seen_orders else index
            seen_orders.add(order)
            normalized_agents.append(agent.model_copy(update={"order": order}))

        normalized_agents.sort(key=lambda item: (item.order, item.role.casefold(), item.id))
        self.agents = normalized_agents

        if self.orchestration == "group_chat":
            self.agents = [agent.model_copy(update={"is_leader": False}) for agent in self.agents]

        if self.max_leaders >= 0 and len(self.explicit_leaders) > self.max_leaders:
            raise ValueError(
                f"{self.orchestration} orchestration supports at most {self.max_leaders} leader(s)"
            )

        return self

    @property
    def supports_direct_targeting(self) -> bool:
        return self.orchestration in {"sequential", "concurrent"}

    @property
    def supports_leader_gating(self) -> bool:
        return self.orchestration in {"sequential", "concurrent", "handoff", "magentic"}

    @property
    def max_leaders(self) -> int:
        return {"sequential": 1, "concurrent": 1, "group_chat": 0, "handoff": 1, "magentic": 1}[self.orchestration]

    @property
    def explicit_leaders(self) -> list[AgentSpec]:
        return [agent for agent in self.agents if agent.is_leader]

    @property
    def ordered_agents(self) -> list[AgentSpec]:
        return list(self.agents)

    @property
    def leader(self) -> AgentSpec | None:
        leaders = self.explicit_leaders
        if leaders:
            return sorted(leaders, key=lambda agent: (agent.order, agent.role.casefold(), agent.id))[0]
        if self.supports_leader_gating and self.agents:
            return self.agents[0]
        return None

class VectorDBQueryInput(BaseModel):
    query: str = Field(..., description="The query string to search the vector database")

__all__ = ["AgentSpec", "PlanSpec", "OrchestrationMode", "VectorDBQueryInput"]