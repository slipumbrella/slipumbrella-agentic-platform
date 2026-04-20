"""
PostgreSQL-backed CheckpointStorage for the agent-framework.
Implements CheckpointStorageProtocol using Pydantic for state serialization.
"""

from __future__ import annotations
from dataclasses import asdict
import logging
from typing import Any, List, Optional, Dict
from pydantic import BaseModel, Field

from agent_framework import WorkflowCheckpoint, CheckpointStorage
from agent_framework._workflows._checkpoint import CheckpointID
from agent_framework.exceptions import WorkflowCheckpointException

from agent.db.repositories.snapshot_repository import SnapshotRepository

logger = logging.getLogger(__name__)


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _sanitize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "model_dump"):
        try:
            dumped = value.model_dump(exclude_none=True)
            return _sanitize_value(dumped)
        except Exception:
            return str(value)
    if hasattr(value, "to_dict"):
        try:
            dumped = value.to_dict()
            return _sanitize_value(dumped)
        except Exception:
            return str(value)
    return str(value)

# ─── Pydantic Checkpoint Model ──────────────────────────────────────────

class CheckpointModel(BaseModel):
    """
    Schema for persisting WorkflowCheckpoint.
    Pydantic handles the complex nested dictionaries (messages, state) 
    without needing manual recursive cleaning.
    """
    checkpoint_id: str
    workflow_name: str
    graph_signature_hash: str
    previous_checkpoint_id: Optional[str] = None
    timestamp: str
    iteration_count: int = 0
    version: str = "1.0"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    # The framework state contains JSON-compatible types [cite: 317, 326]
    messages: Dict[str, Any] = Field(default_factory=dict)
    state: Dict[str, Any] = Field(default_factory=dict)
    pending_request_info_events: Dict[str, Any] = Field(default_factory=dict)

# ─── Refactored Storage Class ───────────────────────────────────────────

class PostgresCheckpointStorage(CheckpointStorage):
    """
    Implements CheckpointStorageProtocol backed by session_snapshots. 
    """

    def __init__(self, session_id: str, snapshot_repository: SnapshotRepository) -> None:
        self.session_id = session_id
        self.snapshot_repository = snapshot_repository

    async def save(self, checkpoint: WorkflowCheckpoint) -> CheckpointID:
        """Serializes and upserts the checkpoint. [cite: 317]"""
        # WorkflowCheckpoint is a slotted dataclass; instances do not expose __dict__.
        checkpoint_data = _sanitize_value(asdict(checkpoint))
        model = CheckpointModel.model_validate(checkpoint_data)
        await self.snapshot_repository.save_snapshot(
            self.session_id, "checkpoint", model.model_dump()
        )
        logger.debug(f"Checkpoint saved: {checkpoint.checkpoint_id}")
        return checkpoint.checkpoint_id

    async def load(self, checkpoint_id: CheckpointID) -> WorkflowCheckpoint:
        """Loads and reconstructs the WorkflowCheckpoint. [cite: 325, 326]"""
        data = await self.snapshot_repository.load_latest_snapshot(self.session_id, "checkpoint")
        if data is None:
            raise WorkflowCheckpointException(f"No checkpoint found for session {self.session_id}")
        
        # Validate data via Pydantic before handing back to framework
        model = CheckpointModel.model_validate(data)
        return WorkflowCheckpoint(**model.model_dump())

    async def get_latest(self, *, workflow_name: str) -> Optional[WorkflowCheckpoint]:
        """Retrieves the most recent checkpoint for a specific workflow. [cite: 326]"""
        data = await self.snapshot_repository.load_latest_snapshot(self.session_id, "checkpoint")
        if data is None:
            return None
            
        model = CheckpointModel.model_validate(data)
        if workflow_name and model.workflow_name != workflow_name:
            return None
        return WorkflowCheckpoint(**model.model_dump())

    async def list_checkpoints(self, *, workflow_name: str) -> List[WorkflowCheckpoint]:
        latest = await self.get_latest(workflow_name=workflow_name)
        return [latest] if latest else []

    async def delete(self, checkpoint_id: CheckpointID) -> bool:
        return await self.snapshot_repository.delete_snapshot(self.session_id, "checkpoint")

    async def list_checkpoint_ids(self, *, workflow_name: str) -> List[CheckpointID]:
        latest = await self.get_latest(workflow_name=workflow_name)
        return [latest.checkpoint_id] if latest else []