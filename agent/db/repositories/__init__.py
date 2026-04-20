from __future__ import annotations

from dataclasses import dataclass

import asyncpg

from agent.db.repositories.artifact_repository import ArtifactRepository
from agent.db.repositories.attachment_repository import AttachmentRepository
from agent.db.repositories.embedding_repository import EmbeddingRepository
from agent.db.repositories.line_message_repository import LineMessageRepository
from agent.db.repositories.model_repository import ModelRepository
from agent.db.repositories.plan_repository import PlanRepository
from agent.db.repositories.session_repository import SessionRepository
from agent.db.repositories.snapshot_repository import SnapshotRepository
from agent.db.repositories.evaluation_repository import EvaluationRepository


@dataclass(slots=True)
class DatabaseRepositories:
    sessions: SessionRepository
    plans: PlanRepository
    embeddings: EmbeddingRepository
    snapshots: SnapshotRepository
    attachments: AttachmentRepository
    artifacts: ArtifactRepository
    line_messages: LineMessageRepository
    models: ModelRepository
    evaluations: EvaluationRepository

    @classmethod
    def from_pool(cls, pool: asyncpg.Pool) -> "DatabaseRepositories":
        return cls(
            sessions=SessionRepository(pool),
            plans=PlanRepository(pool),
            embeddings=EmbeddingRepository(pool),
            snapshots=SnapshotRepository(pool),
            attachments=AttachmentRepository(pool),
            artifacts=ArtifactRepository(pool),
            line_messages=LineMessageRepository(pool),
            models=ModelRepository(pool),
            evaluations=EvaluationRepository(pool),
        )


__all__ = [
    "ArtifactRepository",
    "AttachmentRepository",
    "EvaluationRepository",
    "DatabaseRepositories",
    "EmbeddingRepository",
    "LineMessageRepository",
    "ModelRepository",
    "PlanRepository",
    "SessionRepository",
    "SnapshotRepository",
]