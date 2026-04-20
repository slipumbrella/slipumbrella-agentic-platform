from typing import Any

from agent_framework import Workflow

from agent.core.spec import PlanSpec
from agent.core.agent_factory.factory import AgentFactory
from agent.core.orchestration.orchestrator import (
    SequentialOrchestrator,
    ConcurrentOrchestrator,
    GroupChatOrchestrator,
    HandoffOrchestrator,
    MagenticOrchestrator,
)


class OrchestrationBuilder:
    def __init__(self, factory: AgentFactory, checkpoint_storage: Any | None = None) -> None:
        self.factory = factory
        self.checkpoint_storage = checkpoint_storage

    def build(self, plan: PlanSpec) -> Workflow:
        """
        Build and return the framework Workflow object for the given plan.
        """
        method = plan.orchestration.lower()

        orchestrators = {
            "sequential": SequentialOrchestrator,
            "concurrent": ConcurrentOrchestrator,
            "group_chat": GroupChatOrchestrator,
            "groupchat": GroupChatOrchestrator,
            "handoff": HandoffOrchestrator,
            "magentic": MagenticOrchestrator,
        }
        orchestrator_cls = orchestrators.get(method, SequentialOrchestrator)
        orchestrator = orchestrator_cls(
            self.factory,
            checkpoint_storage=self.checkpoint_storage,
        )
        workflow = orchestrator.build_workflow(plan)
        setattr(workflow, "_egco_session_agents", list(orchestrator.agent_registry))
        return workflow
