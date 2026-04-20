"""
Session manager — maintains in-memory session state backed by PostgreSQL.
Refactored using Pydantic for declarative data validation and cleaning.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional, List, Literal
from pydantic import BaseModel, Field, field_validator, model_validator

from agent_framework import AgentSession, SupportsAgentRun, Workflow
from agent.core.types import SidebandEventDict
from agent.db.repositories import DatabaseRepositories

SESSION_TTL_SECONDS = 3600  # 1 hour
PlanningStatus = Literal["collecting_requirements", "plan_ready"]
ExecutionRunStatus = Literal["active", "stopping", "stopped", "completed", "failed"]


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ─── Pydantic Data Models ───────────────────────────────────────────────

class PlanningMemoryState(BaseModel):
    subject: Optional[str] = None
    target_outcome: Optional[str] = None
    scope: Optional[str] = None
    audience: Optional[str] = None
    constraints: List[str] = Field(default_factory=list)
    required_tools: List[str] = Field(default_factory=list)
    confirmed_decisions: List[str] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    last_updated_at: Optional[str] = None

    @field_validator("subject", "target_outcome", "scope", "audience", mode="before")
    @classmethod
    def empty_string_to_none(cls, v: Any) -> Optional[str]:
        """Standardizes strings: empty or whitespace-only becomes None."""
        if isinstance(v, str):
            cleaned = v.strip()
            return cleaned if cleaned else None
        return v

    @field_validator("constraints", "required_tools", "confirmed_decisions", "open_questions", mode="before")
    @classmethod
    def unique_list_normalizer(cls, v: Any) -> List[str]:
        """Deduplicates lists and cleans whitespace from each entry."""
        if not isinstance(v, list):
            return []
        seen = set()
        items = []
        for item in v:
            if isinstance(item, str) and (cleaned := item.strip()):
                if cleaned.casefold() not in seen:
                    seen.add(cleaned.casefold())
                    items.append(cleaned)
        return items

    def merge_updates(self, updates: dict[str, Any]) -> list[str]:
        """Updates fields and returns a list of keys that actually changed."""
        old_data = self.model_dump()
        # model_copy(update=...) triggers validation/normalization automatically
        updated_model = self.model_copy(update=updates, deep=True)
        new_data = updated_model.model_dump()

        changed_fields = [f for f, v in new_data.items() if v != old_data[f]]
        
        for field in changed_fields:
            setattr(self, field, new_data[field])

        # Always track the timestamp if any business data changed
        if changed_fields and "last_updated_at" in updates:
            self.last_updated_at = updates["last_updated_at"]
            if "last_updated_at" not in changed_fields:
                changed_fields.append("last_updated_at")
            
        return changed_fields

    def missing_required_fields(self) -> list[str]:
        """Return required confirmed planning fields that are still missing."""
        missing: list[str] = []
        if not self.subject:
            missing.append("subject")
        if not self.target_outcome:
            missing.append("target_outcome")
        return missing

class PlanningSessionState(BaseModel):
    status: PlanningStatus = "collecting_requirements"
    plan_created: bool = False
    plan_id: Optional[str] = None
    planning_memory: PlanningMemoryState = Field(default_factory=PlanningMemoryState)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_metadata(cls, data: Any) -> Any:
        if isinstance(data, dict) and "status" not in data and "planning_status" in data:
            normalized = dict(data)
            normalized["status"] = normalized["planning_status"]
            return normalized
        return data

    @model_validator(mode="after")
    def sync_status(self) -> "PlanningSessionState":
        """Ensures status is 'plan_ready' if a plan has been created."""
        if self.plan_created and self.status != "plan_ready":
            self.status = "plan_ready"
        return self

    def to_metadata(self) -> dict[str, Any]:
        data = self.model_dump()
        data["planning_status"] = data["status"]
        return data


class ModelAssignmentDraft(BaseModel):
    baseline: dict[str, str] = Field(default_factory=dict)
    overrides: dict[str, str] = Field(default_factory=dict)
    confirmed: bool = False
    reviewed_at: Optional[str] = None
    confirmed_at: Optional[str] = None

    @field_validator("baseline", "overrides", mode="before")
    @classmethod
    def normalize_assignment_map(cls, value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}

        cleaned: dict[str, str] = {}
        for key, item in value.items():
            if not isinstance(key, str) or not isinstance(item, str):
                continue
            agent_id = key.strip()
            model_id = item.strip()
            if agent_id and model_id:
                cleaned[agent_id] = model_id
        return cleaned

    def confirmed_overrides(self) -> dict[str, str]:
        if not self.confirmed:
            return {}
        return dict(self.overrides)


class ExecutionRunState(BaseModel):
    run_id: str
    status: ExecutionRunStatus = "active"
    started_at: str = Field(default_factory=_utcnow_iso)
    stop_requested_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: Optional[str] = None

    @property
    def is_terminal(self) -> bool:
        return self.status in {"stopped", "completed", "failed"}

# ─── Session Class ──────────────────────────────────────────────────────

class Session:
    """
    Application-level session wrapper.
    Persistent fields are stored in PostgreSQL; transient state lives in memory.
    """
    def __init__(
        self,
        session_id: str,
        repositories: DatabaseRepositories,
        session_type: str = "planning",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.session_id = session_id
        self.repositories = repositories
        self.session_type: str = session_type
        self.metadata: dict[str, Any] = metadata.copy() if metadata else {}
        
        # Replaces manual dictionary parsing with Pydantic validation
        self.planning_state = PlanningSessionState.model_validate(self.metadata)
        self.model_assignment_draft = ModelAssignmentDraft.model_validate(
            self.metadata.get("model_assignment_draft", {})
        )

        # In-memory transient state
        self.agents: dict[str, SupportsAgentRun] = {}
        self.agent_sessions: dict[str, AgentSession] = {}
        self.context: dict[str, str] = {}
        self.workflow: Workflow | None = None
        self.planning_agent: SupportsAgentRun | None = None
        self.planning_agent_session: AgentSession | None = None
        self.active_run: ExecutionRunState | None = None
        self.stream_events: asyncio.Queue[SidebandEventDict] = asyncio.Queue()
        self._chat_lock: asyncio.Lock = asyncio.Lock()
        self._last_accessed: float = time.monotonic()

    def touch(self) -> None:
        self._last_accessed = time.monotonic()

    @property
    def is_expired(self) -> bool:
        return (time.monotonic() - self._last_accessed) > SESSION_TTL_SECONDS

    def add_agent(self, agent_id: str, agent_instance: SupportsAgentRun) -> None:
        self.agents[agent_id] = agent_instance

    def get_agent(self, agent_id: str) -> SupportsAgentRun | None:
        return self.agents.get(agent_id)

    @property
    def is_plan_created(self) -> bool:
        return self.planning_state.plan_created

    async def mark_plan_created(self, plan_id: str | int) -> None:
        """Update state and persist to DB metadata."""
        self.planning_state.plan_created = True
        self.planning_state.plan_id = str(plan_id)
        # Re-trigger status sync validator
        self.planning_state = PlanningSessionState.model_validate(self.planning_state.model_dump())
        await self.update_metadata_async(self.planning_state.to_metadata())

    async def update_planning_memory_async(self, updates: dict[str, Any]) -> list[str]:
        """Merge memory updates and persist if changes occurred."""
        changed_fields = self.planning_state.planning_memory.merge_updates(updates)
        if changed_fields:
            await self.update_metadata_async(self.planning_state.to_metadata())
        return changed_fields

    def reset_planning_runtime(self) -> None:
        self.planning_agent = None
        self.planning_agent_session = None
        self.agents.clear()
        self.agent_sessions.clear()

    def clear_execution_runtime(self) -> None:
        self.workflow = None
        self.agents.clear()
        self.agent_sessions.clear()
        self.active_run = None
        self.stream_events = asyncio.Queue()

    def start_execution_run(self, run_id: str) -> ExecutionRunState:
        run = ExecutionRunState(run_id=run_id)
        self.active_run = run
        return run

    def request_run_stop(self, run_id: str) -> tuple[str, str]:
        run = self.active_run
        if run is None:
            return "not_found", "No active run found for this execution session."
        if run.run_id != run_id:
            return "not_found", "The targeted run is no longer active."
        if run.status == "active":
            run.status = "stopping"
            run.stop_requested_at = _utcnow_iso()
            return "accepted", "Stop requested."
        if run.status == "stopping":
            return "accepted", "Stop already requested."
        return run.status, f"Run already {run.status}."

    def should_stop_run(self, run_id: str) -> bool:
        run = self.active_run
        return bool(run and run.run_id == run_id and run.status == "stopping")

    def mark_run_terminal(
        self,
        run_id: str,
        status: Literal["stopped", "completed", "failed"],
        *,
        error: str | None = None,
    ) -> ExecutionRunState | None:
        run = self.active_run
        if run is None or run.run_id != run_id:
            return None

        run.status = status
        run.finished_at = _utcnow_iso()
        run.error = error
        return run.model_copy(deep=True)

    def get_or_create_planning_agent_session(self, agent: SupportsAgentRun) -> AgentSession:
        if self.planning_agent_session is None:
            self.planning_agent_session = agent.create_session(session_id=self.session_id)
        return self.planning_agent_session

    def get_or_create_agent_session(self, agent_id: str, agent: SupportsAgentRun) -> AgentSession:
        existing = self.agent_sessions.get(agent_id)
        if existing is not None:
            return existing
        created = agent.create_session(session_id=f"{self.session_id}:{agent_id}")
        self.agent_sessions[agent_id] = created
        return created

    def set_context(self, key: str, value: str) -> None:
        self.context[key] = value

    def get_context(self, key: str) -> str | None:
        return self.context.get(key)

    def get_confirmed_model_assignments(self) -> dict[str, str]:
        return self.model_assignment_draft.confirmed_overrides()

    async def update_metadata_async(self, updates: dict[str, Any]) -> None:
        """Merge updates into metadata and persist to the DB."""
        self.metadata.update(updates)
        self.planning_state = PlanningSessionState.model_validate(self.metadata)
        self.model_assignment_draft = ModelAssignmentDraft.model_validate(
            self.metadata.get("model_assignment_draft", {})
        )
        self.metadata.update(self.planning_state.to_metadata())
        await self.repositories.sessions.update_session_metadata(self.session_id, self.metadata)

# ─── Session Manager ────────────────────────────────────────────────────

class SessionManager:
    """Async-safe manager for Session objects with PostgreSQL backing."""
    def __init__(self, repositories: DatabaseRepositories) -> None:
        self.repositories = repositories
        self._sessions: dict[str, Session] = {}
        self._lock = asyncio.Lock()
        self.logger = logging.getLogger(__name__)

    async def create_session(
        self,
        session_id: str | None = None,
        session_type: str = "planning",
        metadata: dict[str, Any] | None = None,
        planning_session_id: str | None = None,
    ) -> Session:
        metadata = metadata or {}
        session_id = await self.repositories.sessions.create_session(
            session_id, session_type, metadata, planning_session_id
        )
        session = Session(session_id, self.repositories, session_type, metadata)
        async with self._lock:
            self._sessions[session_id] = session
        return session

    async def get_session(self, session_id: str, force_reload: bool = False) -> Session | None:
        async with self._lock:
            cached_session = self._sessions.get(session_id)

        if cached_session and not force_reload:
            cached_session.touch()
            return cached_session

        row = await self.repositories.sessions.get_session(session_id)
        if row:
            # Re-hydration logic as before
            import json as _json
            metadata_raw = row.get("metadata", "{}")
            metadata = _json.loads(metadata_raw) if isinstance(metadata_raw, str) else metadata_raw
            
            # Re-inject SQL columns into metadata for tools
            if row.get("team_id"):
                metadata["team_id"] = str(row["team_id"])
            if row.get("line_channel_access_token"): 
                metadata["line_channel_access_token"] = row["line_channel_access_token"]
            if row.get("planning_session_id"):
                metadata["planning_session_id"] = row["planning_session_id"]

            session = Session(
                session_id, 
                self.repositories, 
                row.get("type", "planning"), 
                metadata
            )
            async with self._lock:
                self._sessions[session_id] = session
            return session
        return None

    async def get_or_create_session(self, session_id: Optional[str], **kwargs) -> Session:
        if session_id:
            session = await self.get_session(session_id)
            if session:
                return session
        return await self.create_session(session_id, **kwargs)

    async def evict_expired(self) -> int:
        async with self._lock:
            expired = [sid for sid, s in self._sessions.items() if s.is_expired]
            for sid in expired:
                del self._sessions[sid]
        return len(expired)
