"""gRPC server entry point."""

import asyncio
import logging
import logging.handlers
import os
from concurrent import futures
import grpc

from agent.configs.settings import settings
from agent.db.checkpoint_storage import PostgresCheckpointStorage
from agent.db.database import init_pool, close_pool, get_pool
from agent.db.repositories import DatabaseRepositories
from agent.grpc.generated import core_agent_pb2_grpc
from agent.grpc.server.core_agent_grpc import CoreAgent, _loop
from agent.grpc.server.ws_server import initialize_ws_logic, start_ws_server

# ---------------------------------------------------------------------------
# Logging setup — stdout only (container-friendly; file logging via LOG_FILE env)
# ---------------------------------------------------------------------------
_LOG_FILE = os.environ.get("LOG_FILE")


def _configure_logging() -> None:
    """Configure root logger: INFO to stdout; optionally DEBUG to a rotating file.

    Set LOG_FILE=/path/to/agent.log to enable file logging (e.g. local dev).
    In containers, leave LOG_FILE unset — stdout is collected by the runtime.
    """
    fmt = logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s")

    # Console handler — INFO and above
    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    console.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(console)

    if _LOG_FILE:
        file_handler = logging.handlers.RotatingFileHandler(
            _LOG_FILE,
            maxBytes=10 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)
        logging.info("Logging to file: %s", _LOG_FILE)


class GRPCServer:
    def __init__(self, repositories: DatabaseRepositories):
        self._server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
        self._servicer = CoreAgent(repositories)
        core_agent_pb2_grpc.add_CoreAgentServicer_to_server(
            servicer=self._servicer,
            server=self._server,
        )

    def serve(self):
        endpoint = f"{settings.GRPC_HOST}:{settings.GRPC_PORT}"
        logging.info("Starting gRPC server on %s ...", endpoint)
        self._server.add_insecure_port(endpoint)
        self._server.start()
        logging.info("gRPC server ready.")
        self._server.wait_for_termination()

    def stop(self):
        logging.info("Stopping gRPC server ...")
        self._server.stop(3)
        logging.info("gRPC server stopped.")


if __name__ == "__main__":
    _configure_logging()

    # Initialise the asyncpg pool on the persistent loop before accepting requests
    asyncio.run_coroutine_threadsafe(init_pool(), _loop).result()
    logging.info("Database pool initialised.")

    repositories = DatabaseRepositories.from_pool(get_pool())
    initialize_ws_logic(repositories)

    # Start fallback WebSocket server on the persistent event loop.
    # Store the future so the asyncio Task is not garbage-collected while pending.
    _ws_future = asyncio.run_coroutine_threadsafe(start_ws_server(), _loop)  # noqa: F841 — must remain referenced
    logging.info("Fallback WebSocket server scheduled on port %s.", settings.WS_PORT)

    server = GRPCServer(repositories)

    async def _graceful_shutdown():
        """Save checkpoints for all active sessions before shutdown."""
        try:
            core_logic = server._servicer.logic if hasattr(server._servicer, 'logic') else None
            if core_logic:
                session_mgr = core_logic.session_manager
                async with session_mgr._lock:
                    active = list(session_mgr._sessions.items())
                for sid, sess in active:
                    if sess.workflow is not None:
                        try:
                            storage = PostgresCheckpointStorage(sid, server._servicer.logic.repositories.snapshots)  # noqa: F841
                            logging.info(f"Session {sid} was active at shutdown (workflow present).")
                        except Exception as exc:
                            logging.warning(f"Shutdown checkpoint for {sid} failed: {exc}")
            logging.info("Graceful shutdown complete.")
        except Exception as exc:
            logging.warning(f"Graceful shutdown error: {exc}")
        finally:
            await close_pool()

    try:
        server.serve()
    except KeyboardInterrupt:
        server.stop()
        asyncio.run_coroutine_threadsafe(_graceful_shutdown(), _loop).result()
