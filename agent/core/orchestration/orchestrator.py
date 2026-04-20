import logging
from abc import ABC, abstractmethod
from typing import Any, cast

from agent_framework import Workflow, SupportsAgentRun
from agent_framework.orchestrations import (
    SequentialBuilder,
    ConcurrentBuilder,
    GroupChatBuilder,
    HandoffBuilder,
    MagenticBuilder,
)

from agent.core.spec import PlanSpec
from agent.core.agent_factory.factory import AgentFactory

# JSON compliance instruction appended to the group-chat orchestrator agent to reduce the
# likelihood of empty or malformed AgentOrchestrationOutput responses from the LLM.
_JSON_COMPLIANCE_INSTRUCTION = (
    "\n\n## CRITICAL: Structured Output Requirement\n"
    "You MUST always respond with a valid JSON object in this exact format — "
    "never empty text, plain prose, or partial JSON:\n"
    '{"terminate": <true|false>, "reason": "<explanation>", '
    '"next_speaker": "<participant name or null if terminating>", '
    '"final_message": "<optional final message or null>"}\n'
    "Returning empty text or malformed JSON will crash the workflow immediately."
)


class BaseOrchestrator(ABC):
    _MAX_HANDOFF_TURNS: int = 20

    def __init__(self, factory: AgentFactory, checkpoint_storage: Any | None = None) -> None:
        self.factory = factory
        self.logger = logging.getLogger(__name__)
        self.agents: list[SupportsAgentRun] = []
        self.agent_registry: list[tuple[str, SupportsAgentRun]] = []
        self.checkpoint_storage = checkpoint_storage

    def _create_agents(self, plan: PlanSpec) -> list[SupportsAgentRun]:
        """Instantiate all agents in the plan using AgentFactory."""
        agents: list[SupportsAgentRun] = []
        registry: list[tuple[str, SupportsAgentRun]] = []
        for agent_spec in plan.ordered_agents:
            session = self.factory.current_session
            agent = self.factory.create_agent(agent_spec, session=session)
            try:
                agent.spec_id = agent_spec.id  # type: ignore[attr-defined]
            except AttributeError:
                pass
            self.logger.debug(
                f"Created agent {agent_spec.role} with tools: {agent_spec.tools}")
            agents.append(agent)
            registry.append((agent_spec.id, agent))
        self.agents = agents
        self.agent_registry = registry
        return agents

    def _resolve_agent(self, plan: PlanSpec, target_spec_id: str | None) -> SupportsAgentRun:
        if not target_spec_id:
            raise ValueError("Target agent ID is required")

        for agent_spec, agent in zip(plan.ordered_agents, self.agents, strict=False):
            if agent_spec.id == target_spec_id:
                return agent
        raise ValueError(f"Agent {target_spec_id} not found in workflow")

    def _build_leader_gated_handoff(
        self,
        plan: PlanSpec,
        fallback_builder_type: type,  # SequentialBuilder or ConcurrentBuilder
        name_tag: str,
    ) -> Workflow:
        """Build a leader-gated HandoffWorkflow.

        Args:
            plan: The PlanSpec containing agent definitions.
            fallback_builder_type: SequentialBuilder or ConcurrentBuilder — used when
                the leader is the only agent.
            name_tag: "sequential" or "concurrent" — used in log messages and workflow name.

        Returns:
            A Workflow where the explicit leader starts and decides whether to hand off
            to non-leader agents.
        """
        leader_spec = plan.explicit_leaders[0]
        leader_agent = self._resolve_agent(plan, leader_spec.id)
        non_leader_specs = [s for s in plan.ordered_agents if s.id != leader_spec.id]
        non_leader_agents = [self._resolve_agent(plan, s.id) for s in non_leader_specs]

        if not non_leader_agents:
            self.logger.info(
                f"Leader-gated {name_tag}: only leader present "
                f"(leader={leader_spec.role}), building plain {name_tag}"
            )
            return fallback_builder_type(  # type: ignore[call-arg]
                participants=list(self.agents),
                checkpoint_storage=self.checkpoint_storage,
            ).build()

        self.logger.info(
            f"Building Leader-Gated {name_tag.capitalize()} Workflow "
            f"(leader={leader_spec.role}, workers={[s.role for s in non_leader_specs]})"
        )
        all_participants: list[SupportsAgentRun] = [leader_agent] + non_leader_agents
        max_turns = self._MAX_HANDOFF_TURNS  # capture for closure; avoids late-binding issues
        return (
            HandoffBuilder(
                name=f"leader_gated_{name_tag}",
                participants=all_participants,
                termination_condition=lambda conv: (
                    len(conv) > max_turns
                    or (
                        len(conv) > 0
                        and "done" in getattr(conv[-1], "text", "").lower()
                    )
                ),
                checkpoint_storage=self.checkpoint_storage,
            )
            .with_start_agent(leader_agent)
            .build()
        )

    @abstractmethod
    def build_workflow(self, plan: PlanSpec) -> Workflow:
        """Build and return the framework Workflow object for the given plan."""
        ...


class SequentialOrchestrator(BaseOrchestrator):
    def build_workflow(self, plan: PlanSpec) -> Workflow:
        """Build a strict sequential workflow.

        The direct-vs-workflow decision for sequential plans happens earlier in
        ``CoreAgent._stream_execution_turn``. Once that branch decides to run the
        workflow, sequential orchestration should execute every participant in
        plan order via ``SequentialBuilder``.

        This keeps the runtime semantics aligned with the orchestration name:
        leaders can still answer directly when leader-gating selects ``direct``,
        but ``route == workflow`` means the full sequential path runs rather than
        introducing handoff semantics.
        """
        self.logger.info("Building Sequential Workflow")
        self._create_agents(plan)
        return SequentialBuilder(
            participants=list(self.agents),
            checkpoint_storage=self.checkpoint_storage,
        ).build()


class ConcurrentOrchestrator(BaseOrchestrator):
    def build_workflow(self, plan: PlanSpec) -> Workflow:
        """Build a strict concurrent workflow.

        As with sequential orchestration, the leader-gating decision happens
        before workflow execution begins. Once the runtime chooses the workflow
        branch, concurrent orchestration should fan out to all participants via
        ``ConcurrentBuilder`` rather than switching to handoff semantics.

        This keeps the meaning of ``concurrent`` stable: leaders may still reply
        directly when the gate selects ``direct``, but ``route == workflow`` means
        the full parallel path runs.
        """
        self.logger.info("Building Concurrent Workflow")
        self._create_agents(plan)
        return ConcurrentBuilder(
            participants=list(self.agents),
            checkpoint_storage=self.checkpoint_storage,
        ).build()


class GroupChatOrchestrator(BaseOrchestrator):
    def build_workflow(self, plan: PlanSpec) -> Workflow:
        self.logger.info("Building Group Chat Workflow")
        agents = self._create_agents(plan)
        if not agents:
            raise ValueError("Group chat orchestration requires at least one agent.")
        orchestrator_spec = plan.ordered_agents[0]
        orchestrator_agent = self._resolve_agent(plan, orchestrator_spec.id)

        # Append JSON compliance instruction to reduce empty/malformed LLM responses.
        # Agent instructions are stored in the mutable default_options dict.
        existing_instructions = orchestrator_agent.default_options.get("instructions") or ""
        orchestrator_agent.default_options["instructions"] = (
            existing_instructions + _JSON_COMPLIANCE_INSTRUCTION
        )

        participants = [agent for agent_spec, agent in zip(plan.ordered_agents, agents, strict=False) if agent_spec.id != orchestrator_spec.id] or agents
        return GroupChatBuilder(
            participants=participants,
            orchestrator_agent=cast(Any, orchestrator_agent),
            max_rounds=20,
            checkpoint_storage=self.checkpoint_storage,
        ).build()


_HANDOFF_TERMINATION_KEYWORDS = frozenset(
    {"done", "complete", "completed", "finished", "concluded", "task complete", "all done"}
)


def _handoff_should_terminate(conversation: list[object], max_turns: int) -> bool:
    """Return True when handoff should stop: keyword match or turn limit reached."""
    if len(conversation) >= max_turns:
        return True
    if not conversation:
        return False
    last_text = getattr(conversation[-1], "text", "") or ""
    lowered = last_text.lower().strip()
    return any(keyword in lowered for keyword in _HANDOFF_TERMINATION_KEYWORDS)


class HandoffOrchestrator(BaseOrchestrator):
    def build_workflow(self, plan: PlanSpec) -> Workflow:
        self.logger.info("Building Handoff Workflow")
        agents = self._create_agents(plan)
        if not agents:
            raise ValueError("Handoff orchestration requires at least one agent.")
        start_spec = plan.leader or plan.ordered_agents[0]
        start_agent = self._resolve_agent(plan, start_spec.id)
        max_turns = self._MAX_HANDOFF_TURNS
        return (
            HandoffBuilder(
                name="execution_handoff",
                participants=agents,
                termination_condition=lambda conv, _mt=max_turns: _handoff_should_terminate(conv, _mt),
                checkpoint_storage=self.checkpoint_storage,
            )
            .with_start_agent(start_agent)
            .build()
        )


class MagenticOrchestrator(BaseOrchestrator):
    def build_workflow(self, plan: PlanSpec) -> Workflow:
        self.logger.info("Building Magentic Workflow")
        if not plan.agents:
            raise ValueError("Magentic orchestration requires at least one agent.")
        agents = self._create_agents(plan)
        manager_spec = plan.leader or plan.ordered_agents[0]
        manager_agent = self._resolve_agent(plan, manager_spec.id)
        participants = [agent for agent_spec, agent in zip(plan.ordered_agents, agents, strict=False) if agent_spec.id != manager_spec.id] or agents
        return MagenticBuilder(
            participants=participants,
            manager_agent=manager_agent,
            max_round_count=10,
            max_stall_count=3,
            max_reset_count=2,
            checkpoint_storage=self.checkpoint_storage,
        ).build()
