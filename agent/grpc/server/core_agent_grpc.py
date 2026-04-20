"""gRPC servicer for the CoreAgent service.

Uses a single persistent asyncio event loop running in a background daemon
thread.  All async CoreAgent methods are dispatched to that loop via
``asyncio.run_coroutine_threadsafe()``, keeping gRPC's synchronous
ThreadPoolExecutor happy while sharing the same asyncpg connection pool
across requests.
"""

import asyncio
import logging
import queue as sync_queue
import threading
from collections.abc import Coroutine
from typing import TypeVar

from agent.grpc.generated import core_agent_pb2_grpc, core_agent_pb2
from agent.core.core_agent import CoreAgent as CoreAgentLogic
from agent.core.types import (
    StreamEventDict,
    ChunkEventDict,
    PlanCreatedEventDict,
    UsageEventDict,
)
from agent.db.repositories import DatabaseRepositories
from agent.services.evaluation.rag_evaluator import RAGEvaluator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Persistent event loop — one loop for the whole process lifetime
# ---------------------------------------------------------------------------

_loop: asyncio.AbstractEventLoop = asyncio.new_event_loop()
_loop_thread = threading.Thread(
    target=_loop.run_forever, daemon=True, name="grpc-async-loop"
)
_loop_thread.start()


_T = TypeVar("_T")

# Default wall-clock timeout for blocking on the async loop from a gRPC thread.
# EvaluateRAG uses context.time_remaining() instead when available.
_DEFAULT_ASYNC_TIMEOUT = 540.0  # 9 minutes


def _run_async(coro: Coroutine[object, object, _T], timeout: float | None = _DEFAULT_ASYNC_TIMEOUT) -> _T:
    """Schedule *coro* on the persistent loop and block until it completes.

    *timeout* limits how long the calling gRPC thread will wait (seconds).
    Raises concurrent.futures.TimeoutError if the coroutine does not finish
    in time, which the caller should surface as a gRPC error rather than
    blocking the thread indefinitely.
    """
    return asyncio.run_coroutine_threadsafe(coro, _loop).result(timeout=timeout)  # type: ignore[return-value]


def _metadata_map(context) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in context.invocation_metadata() or []:
        key = str(getattr(item, "key", "")).lower()
        value = str(getattr(item, "value", ""))
        if key and key not in out:
            out[key] = value
    return out


def _serialize_thinking_items(items: object) -> list[core_agent_pb2.ThinkingItem]:
    if not isinstance(items, list):
        return []

    return [
        core_agent_pb2.ThinkingItem(
            role=str(item.get("role", "")),
            content_type=str(item.get("content_type", "")),
            text=str(item.get("text", "")),
            tool_name=str(item.get("tool_name", "")),
            arguments=str(item.get("arguments", "")),
        )
        for item in items
        if isinstance(item, dict)
    ]


def _serialize_workflow_nodes(items: object) -> list[core_agent_pb2.WorkflowTraceNode]:
    if not isinstance(items, list):
        return []

    return [
        core_agent_pb2.WorkflowTraceNode(
            agent_id=str(item.get("agent_id", "")),
            agent_role=str(item.get("agent_role", "")),
            is_leader=bool(item.get("is_leader", False)),
            order=int(item.get("order", 0) or 0),
            status=str(item.get("status", "")),
            preview=str(item.get("preview", "")),
            response=str(item.get("response", "")),
            error=str(item.get("error", "")),
            started_at=str(item.get("started_at", "")),
            completed_at=str(item.get("completed_at", "")),
            thinking=_serialize_thinking_items(item.get("thinking")),
        )
        for item in items
        if isinstance(item, dict)
    ]


# ---------------------------------------------------------------------------
# Servicer
# ---------------------------------------------------------------------------


class CoreAgent(core_agent_pb2_grpc.CoreAgentServicer):
    def __init__(self, repositories: DatabaseRepositories):
        self.logic = CoreAgentLogic(repositories)

    def Chat(self, request, context):
        """
        Server-streaming Chat handler.

        Schedules chat_stream() on the persistent loop; a Queue bridges the
        async producer to the synchronous gRPC yield loop so each token is
        forwarded immediately without blocking the event loop thread.
        """
        q: sync_queue.Queue[StreamEventDict | None] = sync_queue.Queue()

        async def _producer():
            try:
                async for item in self.logic.chat_stream(
                    message=request.message,
                    session_id=request.session_id,
                    target_agent_id=getattr(request, "target_agent_id", ""),
                    presentation_mode=getattr(request, "presentation_mode", ""),
                ):
                    q.put(item)
            except Exception as exc:
                logger.error("chat_stream error: %s", exc, exc_info=True)
            finally:
                q.put(None)  # sentinel — always sent even on error

        asyncio.run_coroutine_threadsafe(_producer(), _loop)

        while True:
            item = q.get()
            if item is None:
                break
            run_id = item.get("run_id", "")
            if item.get("type") == "plan_created":
                plan_item: PlanCreatedEventDict = item  # type: ignore[assignment]
                data = plan_item["data"]
                agents = [
                    core_agent_pb2.AgentInfo(
                        id=a["id"],
                        role=a["role"],
                        goal=a["goal"],
                        tools=a.get("tools", []),
                        model=a.get("model", ""),
                        order=a.get("order", 0),
                        is_leader=a.get("isLeader", False),
                    )
                    for a in data.get("agents", [])
                ]
                yield core_agent_pb2.ChatResponse(
                    session_id=plan_item.get("session_id", request.session_id),  # type: ignore[attr-defined]
                    agent_id=plan_item.get("agent_id", "CoreAgent"),  # type: ignore[attr-defined]
                    run_id=run_id,
                    plan_created=core_agent_pb2.PlanCreatedEvent(
                        plan_id=data.get("plan_id", ""),
                        orchestration=data.get("orchestration", ""),
                        agents=agents,
                    ),
                )
            elif item.get("type") == "session_renamed":
                yield core_agent_pb2.ChatResponse(
                    session_id=item.get("session_id", request.session_id),
                    agent_id="CoreAgent",
                    run_id=run_id,
                    session_renamed=core_agent_pb2.SessionRenamedEvent(
                        session_id=item.get("session_id", request.session_id),
                        title=item.get("title", ""),
                    ),
                )
            elif item.get("type") == "builder_think":
                yield core_agent_pb2.ChatResponse(
                    reply=item.get("chunk", ""),
                    session_id=item.get("session_id", request.session_id),
                    agent_id="BuilderAgent",
                    run_id=run_id,
                )
            elif item.get("type") == "usage_event":
                usage_item: UsageEventDict = item  # type: ignore[assignment]
                yield core_agent_pb2.ChatResponse(
                    session_id=usage_item.get("session_id", request.session_id),
                    agent_id=usage_item.get("agent_id", "CoreAgent"),
                    run_id=run_id,
                    token_usage=core_agent_pb2.TokenUsageEvent(
                        agent_id=usage_item.get("agent_id", "CoreAgent"),
                        model_id=usage_item.get("model_id", ""),
                        input_tokens=usage_item.get("input_tokens", 0),
                        output_tokens=usage_item.get("output_tokens", 0),
                    ),
                )
            elif item.get("type") == "workflow_started":
                data = item.get("data", {})
                yield core_agent_pb2.ChatResponse(
                    session_id=item.get("session_id", request.session_id),
                    agent_id=item.get("agent_id", "CoreAgent"),
                    run_id=run_id,
                    workflow_started=core_agent_pb2.WorkflowStartedEvent(
                        trace_id=data.get("trace_id", ""),
                        execution_session_id=data.get("execution_session_id", ""),
                        orchestration=data.get("orchestration", ""),
                        status=data.get("status", ""),
                        summary=data.get("summary", ""),
                    ),
                )
            elif item.get("type") == "workflow_node_updated":
                data = item.get("data", {})
                thinking_items = _serialize_thinking_items(data.get("thinking"))
                yield core_agent_pb2.ChatResponse(
                    session_id=item.get("session_id", request.session_id),
                    agent_id=data.get("agent_id", "CoreAgent"),
                    run_id=run_id,
                    workflow_node_updated=core_agent_pb2.WorkflowNodeUpdatedEvent(
                        trace_id=data.get("trace_id", ""),
                        execution_session_id=data.get("execution_session_id", ""),
                        orchestration=data.get("orchestration", ""),
                        status=data.get("status", ""),
                        summary=data.get("summary", ""),
                        agent_id=data.get("agent_id", ""),
                        agent_role=data.get("agent_role", ""),
                        order=data.get("order", 0),
                        preview=data.get("preview", ""),
                        response=data.get("response", ""),
                        error=data.get("error", ""),
                        started_at=data.get("started_at", ""),
                        completed_at=data.get("completed_at", ""),
                        is_leader=bool(data.get("is_leader", False)),
                        thinking=thinking_items,
                    ),
                )
            elif item.get("type") == "workflow_completed":
                data = item.get("data", {})
                yield core_agent_pb2.ChatResponse(
                    session_id=item.get("session_id", request.session_id),
                    agent_id=item.get("agent_id", "CoreAgent"),
                    run_id=run_id,
                    workflow_completed=core_agent_pb2.WorkflowCompletedEvent(
                        trace_id=data.get("trace_id", ""),
                        execution_session_id=data.get("execution_session_id", ""),
                        orchestration=data.get("orchestration", ""),
                        status=data.get("status", ""),
                        summary=data.get("summary", ""),
                        completed_at=data.get("completed_at", ""),
                        nodes=_serialize_workflow_nodes(data.get("nodes")),
                    ),
                )
            elif item.get("type") == "workflow_failed":
                data = item.get("data", {})
                yield core_agent_pb2.ChatResponse(
                    session_id=item.get("session_id", request.session_id),
                    agent_id=item.get("agent_id", "CoreAgent"),
                    run_id=run_id,
                    workflow_failed=core_agent_pb2.WorkflowFailedEvent(
                        trace_id=data.get("trace_id", ""),
                        execution_session_id=data.get("execution_session_id", ""),
                        orchestration=data.get("orchestration", ""),
                        status=data.get("status", ""),
                        summary=data.get("summary", ""),
                        error=data.get("error", ""),
                        completed_at=data.get("completed_at", ""),
                        nodes=_serialize_workflow_nodes(data.get("nodes")),
                    ),
                )
            elif item.get("type") == "workflow_stopped":
                data = item.get("data", {})
                yield core_agent_pb2.ChatResponse(
                    session_id=item.get("session_id", request.session_id),
                    agent_id=item.get("agent_id", "CoreAgent"),
                    run_id=run_id,
                    workflow_stopped=core_agent_pb2.WorkflowStoppedEvent(
                        trace_id=data.get("trace_id", ""),
                        execution_session_id=data.get("execution_session_id", ""),
                        orchestration=data.get("orchestration", ""),
                        status=data.get("status", ""),
                        summary=data.get("summary", ""),
                        stopped_at=data.get("stopped_at", ""),
                        run_id=data.get("run_id", run_id),
                        nodes=_serialize_workflow_nodes(data.get("nodes")),
                    ),
                )
            elif item.get("type") == "workflow_presentation_prompt":
                yield core_agent_pb2.ChatResponse(
                    session_id=item.get("session_id", request.session_id),
                    agent_id=item.get("agent_id", "CoreAgent"),
                    run_id=run_id,
                    workflow_presentation_prompt=core_agent_pb2.WorkflowPresentationPromptEvent(
                        prompt_id=item.get("prompt_id", ""),
                        question=item.get("question", ""),
                        original_message=item.get("original_message", ""),
                    ),
                )
            else:
                chunk_item: ChunkEventDict = item  # type: ignore[assignment]
                yield core_agent_pb2.ChatResponse(
                    reply=chunk_item.get("chunk", ""),  # type: ignore[attr-defined]
                    session_id=chunk_item.get("session_id", request.session_id),  # type: ignore[attr-defined]
                    agent_id=chunk_item.get("agent_id", "CoreAgent"),  # type: ignore[attr-defined]
                    run_id=run_id,
                )

    def GetAgentList(self, request, context):
        """Server-streaming agent list for a given session."""

        async def _collect():
            results = []
            async for agent in self.logic.get_agent_list(session_id=request.session_id):
                results.append(agent)
            return results

        try:
            agents = _run_async(_collect())
        except Exception as exc:
            logger.error("get_agent_list error: %s", exc, exc_info=True)
            agents = []

        for agent in agents:
            yield core_agent_pb2.AgentListResponse(
                role=agent["role"],
                description=agent["goal"],
            )

    def ExecutePlan(self, request, context):
        """
        Unary RPC triggered by the Go backend when the user confirms the plan.

        Loads the saved PlanSpec for *session_id*, builds an execution
        workflow in a new execution session, and returns the new session_id.
        """
        planning_session_id = request.session_id

        if not planning_session_id:
            return core_agent_pb2.ExecutePlanResponse(
                session_id="",
                result="session_id is required",
                status="error",
            )

        try:
            workflow, exec_session_id = _run_async(
                self.logic.build_execution_workflow(planning_session_id)
            )
        except Exception as exc:
            logger.error("ExecutePlan error: %s", exc, exc_info=True)
            return core_agent_pb2.ExecutePlanResponse(
                session_id=planning_session_id,
                result=f"Failed to build execution workflow: {exc}",
                status="error",
            )

        return core_agent_pb2.ExecutePlanResponse(
            session_id=exec_session_id,
            result="Execution workflow created successfully.",
            status="ok",
        )

    def StopRun(self, request, context):
        try:
            result = _run_async(
                self.logic.stop_run(
                    request.execution_session_id,
                    request.run_id,
                )
            )
        except Exception as exc:
            logger.error("StopRun error: %s", exc, exc_info=True)
            return core_agent_pb2.StopRunResponse(
                execution_session_id=request.execution_session_id,
                run_id=request.run_id,
                status="error",
                message=str(exc),
            )

        return core_agent_pb2.StopRunResponse(
            execution_session_id=result.get(
                "execution_session_id", request.execution_session_id
            ),
            run_id=result.get("run_id", request.run_id),
            status=result.get("status", "error"),
            message=result.get("message", ""),
        )

    def EvaluateRAG(self, request, context):
        """
        Unary RPC that evaluates RAG data quality for a set of documents.

        Uses OpenRouter embeddings for semantic similarity metrics and OpenRouter
        minimax as an LLM judge for faithfulness and test-case generation.

        The evaluator is dispatched to the persistent asyncio loop so all async
        resources (db pool, redis cache client, HTTP clients) stay on one loop
        across repeated evaluations.
        """
        documents = [
            {
                "file_key": doc.file_key,
                "content": doc.content,
                "file_name": doc.file_name,
            }
            for doc in request.documents
        ]

        metadata = _metadata_map(context)
        request_id = metadata.get("x-request-id", "")
        evaluation_id = metadata.get("x-evaluation-id", "")
        reference_id = metadata.get("x-reference-id", request.reference_id)

        logger.info(
            "EvaluateRAG request received: request_id=%s evaluation_id=%s reference_id=%s documents=%s",
            request_id,
            evaluation_id,
            reference_id,
            len(documents),
        )

        # Use the gRPC deadline as the wall-clock timeout so the Python thread
        # doesn't outlive the Go client's context.  Leave a 5-second buffer for
        # cleanup.  Fall back to the default if no deadline is set.
        grpc_time_remaining = context.time_remaining()
        eval_timeout = (grpc_time_remaining - 5.0) if grpc_time_remaining and grpc_time_remaining > 10 else _DEFAULT_ASYNC_TIMEOUT

        try:
            evaluator = RAGEvaluator(self.logic.repositories.embeddings)

            async def _evaluate() -> dict:
                try:
                    return await evaluator.evaluate_documents_async(
                        documents,
                        session_id=request.reference_id,
                        session_name=getattr(request, "session_name", ""),
                        session_description=getattr(request, "session_description", ""),
                        agent_roles=list(getattr(request, "agent_roles", [])),
                    )
                finally:
                    await evaluator.aclose()

            result = _run_async(_evaluate(), timeout=eval_timeout)
        except Exception as exc:
            logger.error(
                "EvaluateRAG error: request_id=%s evaluation_id=%s reference_id=%s error=%s",
                request_id,
                evaluation_id,
                reference_id,
                exc,
                exc_info=True,
            )
            return core_agent_pb2.EvaluateRAGResponse(
                reference_id=request.reference_id,
                overall_score=0.0,
                metrics=[],
                status="failed",
                error_message=str(exc),
                test_cases_count=0,
            )

        metric_protos = [
            core_agent_pb2.RAGMetricResult(
                metric_name=m["metric_name"],
                score=m["score"],
                passed=m["passed"],
                reason=m["reason"],
            )
            for m in result.get("metrics", [])
        ]

        logger.info(
            "EvaluateRAG completed: request_id=%s evaluation_id=%s reference_id=%s status=%s metrics=%s",
            request_id,
            evaluation_id,
            reference_id,
            result.get("status", "failed"),
            len(result.get("metrics", [])),
        )

        return core_agent_pb2.EvaluateRAGResponse(
            reference_id=request.reference_id,
            overall_score=result.get("overall_score", 0.0),
            metrics=metric_protos,
            status=result.get("status", "failed"),
            error_message=result.get("error_message", ""),
            test_cases_count=result.get("test_cases_count", 0),
        )
