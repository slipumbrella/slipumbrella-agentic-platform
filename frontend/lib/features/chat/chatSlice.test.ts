import { describe, expect, it, vi } from "vitest";
import type {
    AgentEntry,
    ExecutionSession,
    PlanningSessionPlanResponse,
} from "./builderAPI";
import * as builderAPI from "./builderAPI";
import reducer, {
    appendSupervisorChunk,
    createBuilderSession,
    fetchBuilderSessions,
    fetchExecutionAgents,
    finalizeSupervisorMessage,
    openWorkflowTraceDialog,
    resolveBuilderSessionPlan,
    sendSupervisorMessage,
    setAvailableSpecialists,
    setLatestExecSessionId,
    setPlanOrchestration,
    stopSupervisorRun,
    switchBuilderSession,
    updateBuilderSessionTitle,
} from "./chatSlice";


describe("chatSlice sidebar reconciliation", () => {
  it("keeps a pending created session when a stale fetch returns without it", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      createBuilderSession.fulfilled(
        { session_id: "session-new", title: "New Agent Session" } as never,
        "req-1",
        { title: "New Agent Session" },
      ),
    );

    state = reducer(
      state,
      fetchBuilderSessions.fulfilled([], "req-2", undefined),
    );

    expect(state.chatHistory).toHaveLength(1);
    expect(state.chatHistory[0]).toMatchObject({
      id: "session-new",
      syncStatus: "pending_create",
    });
  });

  it("confirms a pending session without duplicating it when the server catches up", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      createBuilderSession.fulfilled(
        { session_id: "session-new", title: "New Agent Session" } as never,
        "req-1",
        { title: "New Agent Session" },
      ),
    );

    state = reducer(
      state,
      fetchBuilderSessions.fulfilled(
        [
          {
            id: "session-new",
            title: "New Agent Session",
            description: "",
            time: "3/21/2026",
            syncStatus: "confirmed" as const,
          },
        ],
        "req-2",
        undefined,
      ),
    );

    expect(state.chatHistory).toHaveLength(1);
    expect(state.chatHistory[0]).toMatchObject({
      id: "session-new",
      syncStatus: "confirmed",
    });
  });

  it("preserves a local rename when a stale server fetch still has the old title", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      createBuilderSession.fulfilled(
        { session_id: "session-new", title: "New Agent Session" } as never,
        "req-1",
        { title: "New Agent Session" },
      ),
    );

    state = reducer(
      state,
      updateBuilderSessionTitle({
        sessionId: "session-new",
        title: "Operating Systems Mock Test",
      }),
    );

    state = reducer(
      state,
      fetchBuilderSessions.fulfilled(
        [
          {
            id: "session-new",
            title: "New Agent Session",
            description: "",
            time: "3/21/2026",
            syncStatus: "confirmed" as const,
          },
        ],
        "req-2",
        undefined,
      ),
    );

    expect(state.chatHistory[0]).toMatchObject({
      id: "session-new",
      title: "Operating Systems Mock Test",
      syncStatus: "confirmed",
    });
  });

  it("falls back to the planning-session plan when no execution plan exists yet", () => {
    const planningSessionPlan = {
      orchestration: "sequential",
      agents: [
        {
          id: "researcher",
          role: "Researcher",
          goal: "Finds and verifies information",
          tools: ["search"],
        },
      ],
    } satisfies PlanningSessionPlanResponse;

    const restored = resolveBuilderSessionPlan(
      null,
      planningSessionPlan,
    );

    expect(restored.orchestration).toBe("sequential");
    expect(restored.agents).toHaveLength(1);
    expect(restored.agents[0]).toMatchObject({
      id: "researcher",
      role: "Researcher",
    });
  });

  it("prefers the planning-session plan when both planning and execution plans exist", () => {
    const latestExecutionSession = {
      session_id: "exec-1",
      planning_session_id: "planning-1",
      created_at: "2026-04-05T12:00:00Z",
      plans: [
        {
          id: 1,
          orchestration: "group_chat",
          agents: [
            {
              id: "exec-writer",
              role: "Execution Writer",
              goal: "Writes execution output",
              tools: ["write"],
            },
          ],
        },
      ],
    } satisfies ExecutionSession;

    const planningSessionPlan = {
      orchestration: "sequential",
      agents: [
        {
          id: "planner-researcher",
          role: "Planner Researcher",
          goal: "Researches the plan",
          tools: ["search"],
        },
      ],
    } satisfies PlanningSessionPlanResponse;

    const restored = resolveBuilderSessionPlan(
      latestExecutionSession,
      planningSessionPlan,
    );

    expect(restored.orchestration).toBe("sequential");
    expect(restored.agents).toHaveLength(1);
    expect(restored.agents[0]).toMatchObject({
      id: "planner-researcher",
      role: "Planner Researcher",
    });
  });

  it("keeps Builder specialists unchanged when execution agents are fetched", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      setAvailableSpecialists([
        {
          id: "planning-researcher",
          role: "Planning Researcher",
          goal: "Builds the planning team",
          tools: ["search"],
        },
      ]),
    );

    state = reducer(state, setPlanOrchestration("sequential"));

    const executionAgentsPayload = {
      orchestration: "group_chat",
      agents: [
        {
          id: "exec-writer",
          role: "Execution Writer",
          goal: "Works inside live execution",
          tools: ["write"],
        },
      ],
      google_sa_email: "service@example.com",
    } satisfies {
      agents: AgentEntry[];
      orchestration: string;
      google_sa_email?: string;
    };

    state = reducer(
      state,
      fetchExecutionAgents.fulfilled(
        executionAgentsPayload,
        "req-exec",
        { sessionId: "planning-1" },
      ),
    );

    expect(state.builder.availableSpecialists).toEqual([
      {
        id: "planning-researcher",
        label: "Planning Researcher",
        desc: "Builds the planning team",
        tools: ["search"],
      },
    ]);
    expect(state.builder.orchestrationType).toBe("sequential");
  });

  it("clears Builder orchestration when the planning plan is empty but keeps the latest exec session id", async () => {
    const latestExecutionSession = {
      session_id: "exec-1",
      planning_session_id: "planning-1",
      created_at: "2026-04-05T12:00:00Z",
      plans: [],
    } satisfies ExecutionSession;

    const planningSessionPlan = {
      orchestration: "sequential",
      agents: [],
    } satisfies PlanningSessionPlanResponse;

    const latestSessionSpy = vi
      .spyOn(builderAPI, "fetchLatestSessionByPlanningId")
      .mockResolvedValue(latestExecutionSession);
    const planningPlanSpy = vi
      .spyOn(builderAPI, "fetchPlanningSessionPlan")
      .mockResolvedValue(planningSessionPlan);

    const dispatched: unknown[] = [];
    const dispatch = vi.fn((action) => {
      dispatched.push(action);
      return action;
    });

    await switchBuilderSession({ sessionId: "planning-1" })(dispatch, vi.fn(), undefined);

    expect(dispatched).toContainEqual(setLatestExecSessionId("exec-1"));
    expect(dispatched).toContainEqual(setPlanOrchestration(""));
    expect(dispatched).not.toContainEqual(setPlanOrchestration("sequential"));

    latestSessionSpy.mockRestore();
    planningPlanSpy.mockRestore();
  });
});

describe("chatSlice presentation prompt", () => {
  it("inserts a presentation_prompt message when workflow_presentation_prompt sideband is received", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      {
        type: "chat/receivePresentationPrompt",
        payload: {
          promptId: "prompt-abc",
          question: "Would you like to see this as a workflow?",
          originalMessage: "Help me write a report",
        },
      } as never,
    );

    const msgs = state.supervisor.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("presentation_prompt");
    expect((msgs[0] as { promptId?: string }).promptId).toBe("prompt-abc");
    expect((msgs[0] as { originalMessage?: string }).originalMessage).toBe("Help me write a report");
    expect(state.supervisor.isLoading).toBe(false);
  });
});

describe("chatSlice supervisor run state", () => {
  it("adopts the current run id from streamed supervisor chunks", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Partial answer",
        agentId: "agent-1",
        runId: "run-1",
      }),
    );

    expect(state.supervisor.activeRunId).toBe("run-1");
    expect(state.supervisor.runStatus).toBe("active");
    expect(state.supervisor.streamingContent).toBe("Partial answer");
  });

  it("ignores stale supervisor chunks from a different in-flight run", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Current run output",
        agentId: "agent-1",
        runId: "run-current",
      }),
    );

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "stale",
        agentId: "agent-2",
        runId: "run-stale",
      }),
    );

    expect(state.supervisor.activeRunId).toBe("run-current");
    expect(state.supervisor.streamingContent).toBe("Current run output");
    expect(state.supervisor.streamingAgentId).toBe("agent-1");
  });

  it("marks stop as in-flight on ack and terminal on workflow_stopped", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Partial answer",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    state = reducer(
      state,
      stopSupervisorRun.pending("req-1", undefined),
    );

    expect(state.supervisor.runStatus).toBe("stopping");
    expect(state.supervisor.isStopping).toBe(true);

    state = reducer(
      state,
      {
        type: "chat/receiveStopResult",
        payload: {
          runId: "run-stop",
          status: "accepted",
          message: "Stop requested.",
        },
      },
    );

    expect(state.supervisor.runStatus).toBe("stopping");
    expect(state.supervisor.isStopping).toBe(true);

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_stopped",
          data: {
            trace_id: "trace-1",
            execution_session_id: "exec-1",
            run_id: "run-stop",
            orchestration: "sequential",
            status: "stopped",
            summary: "Workflow stopped.",
            stopped_at: "2026-04-06T10:00:00Z",
          },
        },
      },
    );

    expect(state.supervisor.runStatus).toBe("stopped");
    expect(state.supervisor.isStopping).toBe(false);
    expect(state.supervisor.workflowTraces[0]).toMatchObject({
      trace_id: "trace-1",
      run_id: "run-stop",
      status: "stopped",
      stopped_at: "2026-04-06T10:00:00Z",
    });
  });

  it("does not auto-open the workflow dialog when a run starts", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_started",
          data: {
            trace_id: "trace-start",
            execution_session_id: "exec-1",
            run_id: "run-1",
            orchestration: "sequential",
            status: "running",
            summary: "Workflow started.",
            started_at: "2026-04-06T10:00:00Z",
          },
        },
      },
    );

    expect(state.supervisor.activeWorkflowTraceId).toBe("trace-start");
    expect(state.supervisor.isWorkflowDialogOpen).toBe(false);
  });

  it("keeps the workflow dialog open and adopts terminal node state immediately", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_started",
          data: {
            trace_id: "trace-live",
            execution_session_id: "exec-1",
            run_id: "run-1",
            orchestration: "sequential",
            status: "running",
            summary: "Workflow started.",
            started_at: "2026-04-06T10:00:00Z",
          },
        },
      },
    );

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_node_updated",
          data: {
            trace_id: "trace-live",
            execution_session_id: "exec-1",
            run_id: "run-1",
            orchestration: "sequential",
            status: "running",
            summary: "Workflow started.",
            agent_id: "agent-1",
            agent_role: "LeaderAgent",
            order: 1,
            started_at: "2026-04-06T10:00:01Z",
            completed_at: "",
            response: "Partial",
          },
        },
      },
    );

    state = reducer(state, openWorkflowTraceDialog("trace-live"));

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_completed",
          data: {
            trace_id: "trace-live",
            execution_session_id: "exec-1",
            run_id: "run-1",
            orchestration: "sequential",
            status: "completed",
            summary: "Workflow completed.",
            completed_at: "2026-04-06T10:00:10Z",
            nodes: [
              {
                agent_id: "agent-1",
                agent_role: "LeaderAgent",
                order: 1,
                status: "completed",
                response: "Final response",
                started_at: "2026-04-06T10:00:01Z",
                completed_at: "2026-04-06T10:00:09Z",
              },
              {
                agent_id: "end",
                agent_role: "Final response",
                order: 2,
                status: "completed",
                response: "Final response",
                completed_at: "2026-04-06T10:00:10Z",
              },
            ],
          },
        },
      },
    );

    expect(state.supervisor.isWorkflowDialogOpen).toBe(true);
    expect(state.supervisor.workflowTraces[0].status).toBe("completed");
    expect(state.supervisor.workflowTraces[0].nodes).toEqual([
      expect.objectContaining({
        agent_id: "agent-1",
        status: "completed",
        response: "Final response",
      }),
      expect.objectContaining({
        agent_id: "end",
        status: "completed",
        response: "Final response",
      }),
    ]);
  });

  it("marks the supervisor run completed when the response finalizes normally", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Final answer",
        agentId: "agent-1",
        runId: "run-complete",
      }),
    );

    state = reducer(state, finalizeSupervisorMessage());

    expect(state.supervisor.runStatus).toBe("completed");
    expect(state.supervisor.activeRunId).toBeNull();
    expect(state.supervisor.isStreaming).toBe(false);
    expect(state.supervisor.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Final answer",
    });
  });

  it("clears a stale active direct-mode run when the supervisor request settles", () => {
    const initialState = reducer(undefined, { type: "@@INIT" });

    const staleActiveState = {
      ...initialState,
      supervisor: {
        ...initialState.supervisor,
        activeRequestId: "req-direct",
        activeRunId: "run-direct",
        runStatus: "active" as const,
        isLoading: false,
        isStreaming: false,
        isWorkflowRunning: false,
        isStopping: false,
        streamingContent: "",
      },
    };

    const nextState = reducer(
      staleActiveState,
      sendSupervisorMessage.fulfilled({ requestId: "req-direct", sessionId: "exec-1" }, "req-direct", {
        message: "Help me",
        sessionId: "exec-1",
      }),
    );

    expect(nextState.supervisor.runStatus).toBe("completed");
    expect(nextState.supervisor.activeRunId).toBeNull();
    expect(nextState.supervisor.pendingStopRequest).toBe(false);
  });

  it("force-clears workflow lifecycle when done fires even if workflow_completed has not arrived", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Leader answer",
        agentId: "agent-1",
        runId: "run-workflow",
      }),
    );

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_started",
          data: {
            trace_id: "trace-workflow",
            execution_session_id: "exec-1",
            run_id: "run-workflow",
            orchestration: "sequential",
            status: "running",
            summary: "Workflow in progress",
          },
        },
      },
    );

    state = reducer(state, finalizeSupervisorMessage());

    expect(state.supervisor.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Leader answer",
    });
    // "done" means the WS stream is fully over — workflow state must be cleared
    // regardless of whether workflow_completed was received, so the stop button hides.
    expect(state.supervisor.isWorkflowRunning).toBe(false);
    expect(state.supervisor.runStatus).toBe("completed");
    expect(state.supervisor.activeRunId).toBeNull();
  });

  it("keeps the cleaner node response when a terminal snapshot carries a transcript-style duplicate", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_node_updated",
          data: {
            trace_id: "trace-dup",
            execution_session_id: "exec-1",
            run_id: "run-dup",
            orchestration: "sequential",
            status: "running",
            summary: "Workflow running",
            agent_id: "end",
            agent_role: "Final response",
            order: 2,
            response: "Clean final answer.",
            thinking: [
              {
                role: "tool",
                content_type: "function_call",
                tool_name: "summarize",
                arguments: "{}",
              },
            ],
          },
        },
      },
    );

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_completed",
          data: {
            trace_id: "trace-dup",
            execution_session_id: "exec-1",
            run_id: "run-dup",
            orchestration: "sequential",
            status: "completed",
            summary: "Workflow completed",
            completed_at: "2026-04-06T10:00:10Z",
            nodes: [
              {
                agent_id: "end",
                agent_role: "Final response",
                order: 2,
                status: "completed",
                response: "Clean final answer.\n\nClean final answer.\n\nAdditional transcript wrapper.",
                thinking: [
                  {
                    role: "assistant",
                    content_type: "text",
                    text: "Clean final answer.",
                  },
                  {
                    role: "tool",
                    content_type: "function_call",
                    tool_name: "summarize",
                    arguments: "{}",
                  },
                ],
              },
            ],
          },
        },
      },
    );

    expect(state.supervisor.workflowTraces[0]?.nodes[0]).toMatchObject({
      agent_id: "end",
      response: "Clean final answer.",
    });
    expect(state.supervisor.workflowTraces[0]?.nodes[0]?.thinking).toEqual([
      expect.objectContaining({
        role: "tool",
        content_type: "function_call",
      }),
    ]);
  });

  it("keeps stopping state sticky when late same-run chunks arrive after accepted stop", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Partial answer",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    state = reducer(state, stopSupervisorRun.pending("req-1", undefined));

    state = reducer(
      state,
      {
        type: "chat/receiveStopResult",
        payload: {
          runId: "run-stop",
          status: "accepted",
          message: "Stop requested.",
        },
      },
    );

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "late chunk",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    expect(state.supervisor.runStatus).toBe("stopping");
    expect(state.supervisor.isStopping).toBe(true);
  });

  it("lets done finalize preserved streamed text after a stopped run", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Preserved text",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_stopped",
          data: {
            trace_id: "trace-1",
            execution_session_id: "exec-1",
            run_id: "run-stop",
            orchestration: "sequential",
            status: "stopped",
            summary: "Workflow stopped.",
          },
        },
      },
    );

    state = reducer(state, finalizeSupervisorMessage());

    expect(state.supervisor.messages).toHaveLength(1);
    expect(state.supervisor.messages[0]).toMatchObject({
      role: "assistant",
      content: "Preserved text",
    });
    expect(state.supervisor.runStatus).toBe("stopped");
  });

  it("ignores late same-run chunks after workflow_stopped", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Partial answer",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_stopped",
          data: {
            trace_id: "trace-1",
            execution_session_id: "exec-1",
            run_id: "run-stop",
            orchestration: "sequential",
            status: "stopped",
            summary: "Workflow stopped.",
          },
        },
      },
    );

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "late chunk",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    expect(state.supervisor.runStatus).toBe("stopped");
    expect(state.supervisor.isStopping).toBe(false);
    expect(state.supervisor.streamingContent).toBe("");
    expect(state.supervisor.messages[0]?.content).toBe("Partial answer");
  });

  it("restores follow-up input state when workflow_stopped arrives", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(state, sendSupervisorMessage.pending("req-1", {
      message: "Help me",
      sessionId: "exec-1",
    }));

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Partial answer",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_stopped",
          data: {
            trace_id: "trace-1",
            execution_session_id: "exec-1",
            run_id: "run-stop",
            orchestration: "sequential",
            status: "stopped",
            summary: "Workflow stopped.",
          },
        },
      },
    );

    expect(state.supervisor.isLoading).toBe(false);
    expect(state.supervisor.isStreaming).toBe(false);
    expect(state.supervisor.runStatus).toBe("stopped");
    expect(state.supervisor.messages).toHaveLength(1);
    expect(state.supervisor.messages[0]?.content).toBe("Partial answer");
  });

  it("does not stay in stopping when stop_result is not accepted", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Partial answer",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    state = reducer(state, stopSupervisorRun.pending("req-1", undefined));

    state = reducer(
      state,
      {
        type: "chat/receiveStopResult",
        payload: {
          runId: "run-stop",
          status: "not_found",
          message: "The targeted run is no longer active.",
        },
      },
    );

    expect(state.supervisor.isStopping).toBe(false);
    expect(state.supervisor.runStatus).toBe("active");
    expect(state.supervisor.error).toBe("The targeted run is no longer active.");
  });

  it("adopts a fresh run after a stopped run in the same session", () => {
    let state = reducer(undefined, { type: "@@INIT" });

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "First run output",
        agentId: "agent-1",
        runId: "run-stop",
      }),
    );

    state = reducer(
      state,
      {
        type: "chat/receiveWorkflowEvent",
        payload: {
          eventType: "workflow_stopped",
          data: {
            trace_id: "trace-1",
            execution_session_id: "exec-1",
            run_id: "run-stop",
            orchestration: "sequential",
            status: "stopped",
            summary: "Workflow stopped.",
          },
        },
      },
    );

    state = reducer(
      state,
      appendSupervisorChunk({
        chunk: "Second run output",
        agentId: "agent-2",
        runId: "run-next",
      }),
    );

    expect(state.supervisor.activeRunId).toBe("run-next");
    expect(state.supervisor.runStatus).toBe("active");
    expect(state.supervisor.streamingContent).toBe("Second run output");
  });
});
