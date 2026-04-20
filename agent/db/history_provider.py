from __future__ import annotations
import logging
from typing import Any, Optional, Sequence

from pydantic import BaseModel, Field, model_validator

from agent_framework import BaseHistoryProvider, Message
from agent.db.repositories.snapshot_repository import SnapshotRepository

logger = logging.getLogger(__name__)

# ─── Pydantic History Models ─────────────────────────────────────────────

class MessageModel(BaseModel):
    """Schema for a single persisted chat message payload."""
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def validate_content_safety(cls, data: Any) -> Any:
        """Normalise and sanitize payloads before persistence."""
        if isinstance(data, MessageModel):
            return data
        if isinstance(data, dict) and "payload" in data:
            return {"payload": _sanitize_value(data["payload"])}
        if isinstance(data, dict):
            return {"payload": _sanitize_value(data)}
        return {"payload": {"role": "unknown", "content": str(_sanitize_value(data))}}

class HistoryState(BaseModel):
    """Schema for the full history snapshot stored in JSONB."""
    messages: list[MessageModel] = Field(default_factory=list)


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _sanitize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        if isinstance(value, str) and "<" in value and "object at 0x" in value:
            return "[Error: Non-serializable content stripped]"
        return value
    if hasattr(value, "model_dump"):
        try:
            return _sanitize_value(value.model_dump(exclude_none=True))
        except Exception:
            return str(value)
    return str(value)


def _message_to_payload(msg: Any) -> dict[str, Any]:
    if hasattr(msg, "to_dict"):
        try:
            dumped = msg.to_dict()
            if isinstance(dumped, dict):
                return _sanitize_value(dumped)
        except Exception:
            pass

    if hasattr(msg, "model_dump"):
        try:
            dumped = msg.model_dump(exclude_none=True)
            if isinstance(dumped, dict):
                return _sanitize_value(dumped)
        except Exception:
            pass

    payload: dict[str, Any] = {
        "role": getattr(msg, "role", "unknown"),
        "content": _sanitize_value(getattr(msg, "content", "") or getattr(msg, "text", "")),
    }

    for attr in ("name", "tool_call_id", "call_id", "arguments", "result", "author_name"):
        value = getattr(msg, attr, None)
        if value is not None:
            payload[attr] = _sanitize_value(value)

    return payload


def _payload_to_message(payload: dict[str, Any]) -> Message:
    role = str(payload.get("role", "unknown"))

    contents = payload.get("contents")
    if not isinstance(contents, list):
        content = payload.get("content")
        text = payload.get("text")
        if content is not None:
            contents = [content]
        elif text is not None:
            contents = [text]
        else:
            contents = []

    author_name = payload.get("author_name")
    if not isinstance(author_name, str):
        name = payload.get("name")
        author_name = name if isinstance(name, str) else None

    message_id = payload.get("message_id")
    if not isinstance(message_id, str):
        message_id = None

    additional_properties = payload.get("additional_properties")
    if not isinstance(additional_properties, dict):
        additional_properties = {
            key: value
            for key, value in payload.items()
            if key
            not in {
                "type",
                "role",
                "contents",
                "content",
                "text",
                "author_name",
                "name",
                "message_id",
                "raw_representation",
            }
        }

    raw_representation = payload.get("raw_representation")

    return Message(
        role=role,
        contents=contents,
        author_name=author_name,
        message_id=message_id,
        additional_properties=additional_properties,
        raw_representation=raw_representation,
    )

# ─── Refactored History Provider ─────────────────────────────────────────

class PostgresHistoryProvider(BaseHistoryProvider):
    """Persists agent conversation history to PostgreSQL using Pydantic."""

    def __init__(
        self,
        session_id: str,
        snapshot_repository: SnapshotRepository,
        agent_name: str = "default",
    ) -> None:
        super().__init__(
            source_id=f"pg-history-{agent_name}",
            load_messages=True,
            store_inputs=True,
            store_context_messages=False,
            store_outputs=True,
        )
        self.session_id = session_id
        self.snapshot_repository = snapshot_repository
        self.agent_name = agent_name
        self._snapshot_type = f"history:{agent_name}"

    async def get_messages(self, session_id: str | None, **kwargs: Any) -> list[Message]:
        """Load and validate persisted messages from DB."""
        try:
            raw_data = await self.snapshot_repository.load_raw_snapshot(self.session_id, self._snapshot_type)
            if not raw_data:
                return []
            
            history = HistoryState.model_validate(raw_data)
            result: list[Message] = []
            for msg in history.messages:
                try:
                    result.append(_payload_to_message(msg.payload))
                except Exception:
                    fallback = {
                        "role": str(msg.payload.get("role", "unknown")),
                        "content": str(msg.payload.get("content", "")),
                    }
                    result.append(_payload_to_message(fallback))
            return result
            
        except Exception as exc:
            logger.warning(f"Failed to load history for {self.agent_name}: {exc}")
            return []

    async def save_messages(
        self,
        session_id: str | None,
        messages: Sequence[Message],
        **kwargs: Any,
    ) -> None:
        """Append and persist messages to DB."""
        if not messages:
            return

        existing_msgs = await self.get_messages(session_id)

        history = HistoryState(
            messages=[MessageModel(payload=_message_to_payload(msg)) for msg in [*existing_msgs, *messages]]
        )
        try:
            await self.snapshot_repository.save_raw_snapshot(
                self.session_id, 
                self._snapshot_type, 
                history.model_dump_json()
            )
        except Exception as exc:
            logger.warning(f"Failed to save history for {self.agent_name}: {exc}")