import json
import logging

from agent_framework import BaseContextProvider, AgentSession, SessionContext
from dataclasses import dataclass, field

from agent.services.embedding_service import embedding_service
from agent.core.session_manager import ModelAssignmentDraft, PlanningSessionState, Session

@dataclass
class MemoryContextProvider(BaseContextProvider):
    session: Session
    source_id: str = "memory-context"
    logger: logging.Logger = field(default_factory=lambda: logging.getLogger(__name__), init=False, repr=False)

    async def _resolve_planning_state(self) -> PlanningSessionState:
        planning_session_id = self.session.metadata.get("planning_session_id")
        if not planning_session_id or planning_session_id == self.session.session_id:
            return self.session.planning_state

        try:
            row = await self.session.repositories.sessions.get_session(planning_session_id)
            if not row:
                return self.session.planning_state

            metadata_raw = row.get("metadata", {})
            metadata = json.loads(metadata_raw) if isinstance(metadata_raw, str) else metadata_raw
            return PlanningSessionState.model_validate(metadata or {})
        except Exception as exc:
            self.logger.warning("Planning memory lookup failed: %s", exc)
            return self.session.planning_state

    async def _resolve_confirmed_model_assignments(self) -> dict[str, str]:
        planning_session_id = self.session.metadata.get("planning_session_id")
        if not planning_session_id or planning_session_id == self.session.session_id:
            return self.session.get_confirmed_model_assignments()

        try:
            row = await self.session.repositories.sessions.get_session(planning_session_id)
            if not row:
                return self.session.get_confirmed_model_assignments()

            metadata_raw = row.get("metadata", {})
            metadata = json.loads(metadata_raw) if isinstance(metadata_raw, str) else metadata_raw
            draft = ModelAssignmentDraft.model_validate((metadata or {}).get("model_assignment_draft", {}))
            return draft.confirmed_overrides()
        except Exception as exc:
            self.logger.warning("Model assignment lookup failed: %s", exc)
            return self.session.get_confirmed_model_assignments()

    def _build_confirmed_planning_facts(self, planning_state: PlanningSessionState) -> str:
        planning_memory = planning_state.planning_memory
        confirmed_lines: list[str] = []
        open_question_lines: list[str] = []

        scalar_fields = [
            ("Subject", planning_memory.subject),
            ("Target Outcome", planning_memory.target_outcome),
            ("Scope", planning_memory.scope),
            ("Audience", planning_memory.audience),
            ("Last Updated", planning_memory.last_updated_at),
        ]
        list_fields = [
            ("Constraints", planning_memory.constraints),
            ("Required Tools", planning_memory.required_tools),
            ("Confirmed Decisions", planning_memory.confirmed_decisions),
        ]

        for label, value in scalar_fields:
            if value:
                confirmed_lines.append(f"- {label}: {value}")

        for label, values in list_fields:
            if values:
                confirmed_lines.append(f"- {label}: {', '.join(values)}")

        if planning_memory.open_questions:
            open_question_lines.append("\n# Outstanding Planning Questions:")
            open_question_lines.extend(
                f"- {question}" for question in planning_memory.open_questions
            )

        if not confirmed_lines and not open_question_lines:
            return ""

        sections: list[str] = []
        if confirmed_lines:
            sections.append("\n# Confirmed Planning Facts:\n" + "\n".join(confirmed_lines))
        if open_question_lines:
            sections.append("\n".join(open_question_lines))
        return "".join(sections)

    def _build_shared_runtime_context(self) -> str:
        context_data = self.session.context
        if not context_data:
            return ""

        memory_lines = ["\n# Shared Memory/Context:"]
        for key, value in context_data.items():
            memory_lines.append(f"- {key}: {value}")
        return "\n".join(memory_lines)

    def _build_model_assignment_context(self, assignments: dict[str, str]) -> str:
        if not assignments:
            return ""

        lines = ["\n# User-Confirmed Model Assignments:"]
        for agent_id, model_id in assignments.items():
            lines.append(f"- {agent_id}: {model_id}")
        lines.append(
            "Preserve these model selections in future plan revisions unless the user explicitly asks to change them."
        )
        return "\n".join(lines)

    async def before_run(
        self,
        *,
        agent: object,
        session: AgentSession,
        context: SessionContext,
        state: dict[str, object],
    ) -> None:
        """Inject planning memory, RAG chunks, and runtime context before each run."""
        self.logger.info(
            f"MemoryContextProvider before_run for session {self.session.session_id}"
        )

        # LINE history is intentionally NOT auto-injected here.
        # The LINE agent retrieves per-user history on demand via the
        # read_line_messages tool (passing line_user_id). Auto-injecting
        # here would flood every agent's context with all users' messages.

        # Retrieved chunks follow the active session reference_id. Execution startup
        # migrates embeddings from the planning session to the execution session.
        lookup_session_id = self.session.session_id

        # 3. Use the agent's goal as the query for similarity search
        agent_goal = getattr(agent, "goal", "") or ""
        chunks: list[str] = []
        if agent_goal and lookup_session_id:
            try:
                query_vector = await embedding_service.embed_query(
                    lookup_session_id, 
                    agent_goal
                )
                chunks = await self.session.repositories.embeddings.search_similar_chunks(
                    lookup_session_id, query_vector, top_k=5
                )
            except Exception as exc:
                self.logger.warning(f"RAG retrieval failed: {exc}")

        sections: list[str] = []

        planning_state = await self._resolve_planning_state()
        planning_str = self._build_confirmed_planning_facts(planning_state)
        if planning_str:
            sections.append(planning_str)

        model_assignments_str = self._build_model_assignment_context(
            await self._resolve_confirmed_model_assignments()
        )
        if model_assignments_str:
            sections.append(model_assignments_str)

        if chunks:
            sections.append("\n# Retrieved Context:\n" + "\n".join(f"- {c}" for c in chunks))
            self.logger.info(
                f"Injected {len(chunks)} chunks from session {lookup_session_id}"
            )

        shared_context_str = self._build_shared_runtime_context()
        if shared_context_str:
            sections.append(shared_context_str)

        if sections:
            context.extend_instructions(self.source_id, "".join(sections))

    async def after_run(
        self,
        *,
        agent: object,
        session: AgentSession,
        context: SessionContext,
        state: dict[str, object],
    ) -> None:
        """No-op: context is injected fresh before each run."""
        pass
