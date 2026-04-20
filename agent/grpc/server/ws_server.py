"""
Emergency fallback WebSocket server — exposes the same event protocol as the
Go backend WS endpoints, but connects directly to CoreAgent without going
through gRPC.

Runs on port 50052 (configurable via WS_PORT env/setting).
Uses the same persistent asyncio event loop as the gRPC servicer.
"""

import asyncio
import json
import logging

from websockets.asyncio.server import serve, ServerConnection

from agent.configs.settings import settings
from agent.core.core_agent import CoreAgent as CoreAgentLogic
from agent.core.types import BuilderThinkEventDict, ChunkEventDict, PlanCreatedEventDict
from agent.db.repositories import DatabaseRepositories

logger = logging.getLogger(__name__)

_logic: CoreAgentLogic | None = None


def initialize_ws_logic(repositories: DatabaseRepositories) -> None:
    global _logic
    _logic = CoreAgentLogic(repositories)


async def _handle_connection(websocket: ServerConnection) -> None:
    """Handle a single WebSocket connection."""
    if _logic is None:
        await websocket.send(json.dumps({"type": "error", "error": "WebSocket server is not initialized"}))
        return

    async for raw in websocket:
        try:
            msg: dict[str, object] = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            await websocket.send(json.dumps({"type": "error", "error": "Invalid JSON"}))
            continue

        msg_type = str(msg.get("type", ""))
        if msg_type == "ping":
            await websocket.send(json.dumps({"type": "pong"}))
            continue

        if msg_type != "chat":
            await websocket.send(json.dumps({"type": "error", "error": "Unknown message type"}))
            continue

        session_id = str(msg.get("session_id", ""))
        message = str(msg.get("message", ""))
        target_agent_id = str(msg.get("target_agent_id", ""))

        try:
            async for item in _logic.chat_stream(
                message=message,
                session_id=session_id,
                target_agent_id=target_agent_id,
            ):
                if item.get("type") == "plan_created":
                    plan_item: PlanCreatedEventDict = item  # type: ignore[assignment]
                    await websocket.send(json.dumps({
                        "type": "plan_created",
                        "plan_created": plan_item["data"],
                    }))
                elif item.get("type") == "builder_think":
                    think_item: BuilderThinkEventDict = item  # type: ignore[assignment]
                    await websocket.send(json.dumps({
                        "type": "builder_think",
                        "chunk": think_item["chunk"],
                        "agent_id": think_item["agent_id"],
                    }))
                elif item.get("type") in {"workflow_started", "workflow_node_updated", "workflow_completed", "workflow_failed"}:
                    await websocket.send(json.dumps({
                        "type": item.get("type", ""),
                        "data": item.get("data", {}),
                        "session_id": item.get("session_id", session_id),
                        "agent_id": item.get("agent_id", "CoreAgent"),
                    }))
                else:
                    chunk_item: ChunkEventDict = item  # type: ignore[assignment]
                    chunk = chunk_item.get("chunk", "")  # type: ignore[attr-defined]
                    if chunk:
                        await websocket.send(json.dumps({
                            "type": "chunk",
                            "chunk": chunk,
                            "agent_id": chunk_item.get("agent_id", "CoreAgent"),
                        }))
        except Exception as exc:
            logger.error("WS chat error: %s", exc, exc_info=True)
            await websocket.send(json.dumps({"type": "error", "error": str(exc)}))

        await websocket.send(json.dumps({"type": "done"}))


async def start_ws_server():
    """Start the fallback WebSocket server."""
    host = settings.WS_HOST
    port = settings.WS_PORT
    logger.info("Starting fallback WebSocket server on ws://%s:%s", host, port)
    async with serve(_handle_connection, host, port):
        await asyncio.Future()  # run forever
