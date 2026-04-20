import { createAction, createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
    fetchAttachments,
    fetchEvaluationThunk,
    resetAgentState,
    setSpecialistSelection,
} from "../agent/agentSlice";
import {
    AgentEntry,
    Artifact,
    createSession as createSessionAPI,
    executePlan as executePlanAPI,
    type ExecutionSession,
    fetchLatestSessionByPlanningId,
    fetchPlanningSessionPlan as fetchPlanningSessionPlanAPI,
    fetchSessionAgents as fetchSessionAgentsAPI,
    fetchSessionMessages as fetchSessionMessagesAPI,
    fetchTeamArtifacts as fetchTeamArtifactsAPI,
    fetchWorkflowTraceDetail as fetchWorkflowTraceDetailAPI,
    fetchWorkflowTraceSummaries as fetchWorkflowTraceSummariesAPI,
    listPlanningSessions,
    type PlanningSessionPlanResponse,
} from "./builderAPI";
import {
    isTerminalWorkflowStatus,
    sortAgentsByExecutionOrder,
    sortWorkflowTraceNodes,
    type WorkflowTraceDetail,
    type WorkflowTraceEventData,
    type WorkflowTraceNode,
    type WorkflowTraceStatus,
} from "./workflowTypes";
import { createClientWithFallback, type WebSocketClient, WSEventData } from "./ws";

type SupervisorRunStatus =
  | "idle"
  | "active"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed";

const TERMINAL_SUPERVISOR_RUN_STATUSES = new Set<SupervisorRunStatus>([
  "stopped",
  "completed",
  "failed",
]);

let activeSupervisorClient: WebSocketClient | null = null;

export const closeActiveSupervisorConnection = () => {
  if (activeSupervisorClient) {
    activeSupervisorClient.close();
    activeSupervisorClient = null;
  }
};

const getWsBaseUrl = () => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/api";
  return apiUrl.replace(/^http/, "ws");
};

interface Message {
  id: string;
  role: "user" | "assistant" | "presentation_prompt";
  content: string;
  timestamp: number;
  thinkContent?: string;  // tool call summary — persisted in DB Meta, shown as ThinkingBlock
  agentId?: string;
  agentRole?: string;
  // Only present when role === "presentation_prompt"
  question?: string;
  promptId?: string;
  originalMessage?: string;
}

type WorkflowTraceRecord = WorkflowTraceDetail;

interface Specialist {
  id: string;
  label: string;
  desc: string;
  tools: string[];
}

interface ChatContextState {
  messages: Message[];
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;
}

interface BuilderState extends ChatContextState {
  availableSpecialists: Specialist[];
  streamingContent: string;
  isStreaming: boolean;
  orchestrationType: string;
  isSwitchingSession: boolean;
  isTutorialActive: boolean;
  tutorialStep: number;
  builderThinkContent: string;
  isBuilderThinking: boolean;
  artifacts: Artifact[];
  latestExecSessionId: string | null;
  isAutoExecuting: boolean;
}

interface SupervisorState extends ChatContextState {
  execSessionId: string | null;
  activeRunId: string | null;
  activeRequestId: string | null;
  runStatus: SupervisorRunStatus;
  isWorkflowRunning: boolean;
  workflowTerminalStatus: WorkflowTraceStatus | null;
  isStopping: boolean;
  pendingStopRequest: boolean;
  executionAgents: AgentEntry[];
  orchestrationType: string;
  streamingContent: string;
  isStreaming: boolean;
  thinkingContent: string;
  isThinking: boolean;
  selectedAgentId: string | null;
  streamingAgentId: string;
  artifacts: Artifact[];
  workflowTraces: WorkflowTraceRecord[];
  activeWorkflowTraceId: string | null;
  isWorkflowDialogOpen: boolean;
  isWorkflowTraceLoading: boolean;
  googleSaEmail: string | null;
}

interface ChatState {
  builder: BuilderState;
  supervisor: SupervisorState;
  chatHistory: ChatHistoryItem[];
}

type ChatHistorySyncStatus = "confirmed" | "pending_create";

interface ChatHistoryItem {
  id: string;
  title: string;
  description: string;
  time: string;
  syncStatus: ChatHistorySyncStatus;
}

const mergeChatHistory = (
  existing: ChatHistoryItem[],
  fetched: ChatHistoryItem[],
  activeSessionId: string | null,
): ChatHistoryItem[] => {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const confirmedItems = fetched.map((item) => {
    const local = existingById.get(item.id);
    return {
      ...item,
      title: local?.title || item.title,
      description: local?.description || item.description,
      syncStatus: "confirmed" as const,
    };
  });

  const confirmedIds = new Set(confirmedItems.map((item) => item.id));
  const pendingItems = existing.filter(
    (item) => item.syncStatus === "pending_create" && !confirmedIds.has(item.id),
  );
  const activePending = pendingItems.filter((item) => item.id === activeSessionId);
  const remainingPending = pendingItems.filter((item) => item.id !== activeSessionId);

  return [...activePending, ...remainingPending, ...confirmedItems];
};

export const resolveBuilderSessionPlan = (
  latestExecutionSession: ExecutionSession | null,
  planningSessionPlan: PlanningSessionPlanResponse,
) => {
  return {
    agents: planningSessionPlan.agents ?? [],
    orchestration: planningSessionPlan.orchestration ?? "",
  };
};

const createWorkflowTraceRecord = (
  patch: Partial<WorkflowTraceDetail> & Pick<WorkflowTraceDetail, "trace_id">,
): WorkflowTraceRecord => ({
  trace_id: patch.trace_id,
  execution_session_id: patch.execution_session_id ?? "",
  orchestration: patch.orchestration ?? "",
  status: patch.status ?? "running",
  summary: patch.summary ?? "",
  run_id: patch.run_id,
  started_at: patch.started_at,
  completed_at: patch.completed_at,
  stopped_at: patch.stopped_at,
  nodes: sortWorkflowTraceNodes(patch.nodes ?? []),
});

const normalizeWorkflowText = (value?: string): string =>
  (value ?? "").trim().replace(/\s+/g, " ");

const shouldKeepExistingWorkflowResponse = (
  currentResponse?: string,
  incomingResponse?: string,
): boolean => {
  const current = normalizeWorkflowText(currentResponse);
  const incoming = normalizeWorkflowText(incomingResponse);

  if (!current || !incoming || current === incoming) {
    return false;
  }

  return incoming.includes(current) && incoming.length > current.length + 24;
};

const pruneWorkflowThinkingItems = (
  thinking: WorkflowTraceNode["thinking"],
  response?: string,
): WorkflowTraceNode["thinking"] => {
  if (!thinking) {
    return thinking;
  }

  const normalizedResponse = normalizeWorkflowText(response);
  if (!normalizedResponse) {
    return thinking;
  }

  return thinking.filter((item) => {
    if (item.role !== "assistant" || item.content_type !== "text") {
      return true;
    }

    return normalizeWorkflowText(item.text) !== normalizedResponse;
  });
};

const mergeWorkflowNodeRecord = (
  target: WorkflowTraceNode,
  patch: Partial<WorkflowTraceNode>,
): void => {
  if (patch.agent_id !== undefined) {
    target.agent_id = patch.agent_id;
  }
  if (patch.agent_role !== undefined) {
    target.agent_role = patch.agent_role;
  }
  if (patch.is_leader !== undefined) {
    target.is_leader = patch.is_leader;
  }
  if (patch.order !== undefined) {
    target.order = patch.order;
  }
  if (patch.status !== undefined) {
    target.status = patch.status;
  }
  if (patch.preview !== undefined) {
    target.preview = patch.preview;
  }
  if (patch.error !== undefined) {
    target.error = patch.error;
  }
  if (patch.started_at !== undefined) {
    target.started_at = patch.started_at;
  }
  if (patch.completed_at !== undefined) {
    target.completed_at = patch.completed_at;
  }
  if (patch.from_agent_id !== undefined) {
    target.from_agent_id = patch.from_agent_id;
  }
  if (patch.response !== undefined && !shouldKeepExistingWorkflowResponse(target.response, patch.response)) {
    target.response = patch.response;
  }
  if (patch.thinking !== undefined) {
    target.thinking = pruneWorkflowThinkingItems(patch.thinking, target.response);
  }
};

const mergeWorkflowTraceRecord = (
  target: WorkflowTraceRecord,
  patch: Partial<WorkflowTraceDetail>,
): void => {
  if (patch.execution_session_id !== undefined) {
    target.execution_session_id = patch.execution_session_id;
  }
  if (patch.orchestration !== undefined) {
    target.orchestration = patch.orchestration;
  }
  if (patch.status !== undefined) {
    target.status = patch.status;
  }
  if (patch.summary !== undefined) {
    target.summary = patch.summary;
  }
  if (patch.run_id !== undefined) {
    target.run_id = patch.run_id;
  }
  if (patch.started_at !== undefined) {
    target.started_at = patch.started_at;
  }
  if (patch.completed_at !== undefined) {
    target.completed_at = patch.completed_at;
  }
  if (patch.stopped_at !== undefined) {
    target.stopped_at = patch.stopped_at;
  }
  if (patch.nodes !== undefined) {
    patch.nodes.forEach((nodePatch) => {
      const normalizedAgentId = nodePatch.agent_id?.trim();
      if (!normalizedAgentId) {
        return;
      }

      const existingNode = target.nodes.find((node) => node.agent_id === normalizedAgentId);
      if (existingNode) {
        mergeWorkflowNodeRecord(existingNode, nodePatch);
        return;
      }

      target.nodes.push({
        ...nodePatch,
        agent_id: normalizedAgentId,
        thinking: pruneWorkflowThinkingItems(nodePatch.thinking, nodePatch.response),
        status: nodePatch.status ?? "running",
      });
    });
    target.nodes = sortWorkflowTraceNodes(target.nodes);
  }
};

const TERMINAL_WORKFLOW_EVENT_TYPES = new Set([
  "workflow_completed",
  "workflow_failed",
  "workflow_stopped",
]);

const upsertWorkflowTraceRecord = (
  traces: WorkflowTraceRecord[],
  patch: Partial<WorkflowTraceDetail> & Pick<WorkflowTraceDetail, "trace_id">,
): WorkflowTraceRecord => {
  const existing = traces.find((trace) => trace.trace_id === patch.trace_id);
  if (existing) {
    mergeWorkflowTraceRecord(existing, patch);
    return existing;
  }

  const created = createWorkflowTraceRecord(patch);
  traces.unshift(created);
  return created;
};

const mergeWorkflowNodeFromEvent = (
  trace: WorkflowTraceRecord,
  event: WorkflowTraceEventData,
): void => {
  const normalizedAgentId = event.agent_id?.trim();
  if (!normalizedAgentId) {
    return;
  }

  const node = trace.nodes.find((candidate) => candidate.agent_id === normalizedAgentId);

  if (node) {
    mergeWorkflowNodeRecord(node, {
      agent_id: normalizedAgentId,
      agent_role: event.agent_role,
      is_leader: event.is_leader,
      order: event.order,
      status: event.status,
      preview: event.preview,
      response: event.response,
      error: event.error,
      started_at: event.started_at,
      completed_at: event.completed_at,
      from_agent_id: event.from_agent_id,
      thinking: event.thinking,
    });
  } else {
    trace.nodes.push({
      agent_id: normalizedAgentId,
      agent_role: event.agent_role,
      is_leader: event.is_leader,
      order: event.order,
      status: event.status,
      preview: event.preview,
      response: event.response,
      error: event.error,
      started_at: event.started_at,
      completed_at: event.completed_at,
      from_agent_id: event.from_agent_id,
      thinking: pruneWorkflowThinkingItems(event.thinking, event.response),
    });
  }

  trace.nodes = sortWorkflowTraceNodes(trace.nodes);
};

const isTerminalSupervisorRunStatus = (
  status?: SupervisorRunStatus | null,
): boolean => TERMINAL_SUPERVISOR_RUN_STATUSES.has(status ?? "idle");

const normalizeSupervisorRunStatus = (
  status?: string | null,
): SupervisorRunStatus => {
  switch (status) {
    case "active":
    case "running":
    case "started":
      return "active";
    case "stopping":
      return "stopping";
    case "stopped":
      return "stopped";
    case "completed":
      return "completed";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "active";
  }
};

const reconcileSupervisorRun = (
  supervisor: SupervisorState,
  incomingRunId?: string | null,
  nextStatus?: SupervisorRunStatus,
): boolean => {
  const normalizedRunId = incomingRunId?.trim();
  const effectiveNextStatus =
    supervisor.pendingStopRequest && nextStatus === "active" ? "stopping" : nextStatus;

  if (!normalizedRunId) {
    // Guard: never re-activate a run that already reached a terminal state.
    if (effectiveNextStatus && !isTerminalSupervisorRunStatus(supervisor.runStatus)) {
      supervisor.runStatus = effectiveNextStatus;
      supervisor.isStopping = effectiveNextStatus === "stopping";
    }
    return true;
  }

  if (
    supervisor.activeRunId &&
    supervisor.activeRunId !== normalizedRunId &&
    !isTerminalSupervisorRunStatus(supervisor.runStatus)
  ) {
    return false;
  }

  if (
    supervisor.activeRunId === normalizedRunId &&
    isTerminalSupervisorRunStatus(supervisor.runStatus) &&
    (!nextStatus || !isTerminalSupervisorRunStatus(nextStatus))
  ) {
    return false;
  }

  if (
    supervisor.activeRunId === normalizedRunId &&
    supervisor.runStatus === "stopping" &&
    nextStatus === "active"
  ) {
    return true;
  }

  if (supervisor.activeRunId !== normalizedRunId) {
    supervisor.activeRunId = normalizedRunId;
    supervisor.isStopping = supervisor.pendingStopRequest;
  }

  if (effectiveNextStatus) {
    supervisor.runStatus = effectiveNextStatus;
    supervisor.isStopping = effectiveNextStatus === "stopping";
  } else if (supervisor.runStatus === "idle") {
    supervisor.runStatus = "active";
  }

  return true;
};

const initialContextState: ChatContextState = {
  messages: [],
  sessionId: null,
  isLoading: false,
  error: null,
};

const initialState: ChatState = {
  builder: {
    ...initialContextState,
    availableSpecialists: [],
    streamingContent: "",
    isStreaming: false,
    orchestrationType: "",
    isSwitchingSession: false,
    isTutorialActive: false,
    tutorialStep: 0,
    builderThinkContent: "",
    isBuilderThinking: false,
    artifacts: [],
    latestExecSessionId: null,
    isAutoExecuting: false,
  },
  supervisor: {
    ...initialContextState,
    execSessionId: null,
    activeRunId: null,
    activeRequestId: null,
    runStatus: "idle",
    isWorkflowRunning: false,
    workflowTerminalStatus: null,
    isStopping: false,
    pendingStopRequest: false,
    executionAgents: [],
    orchestrationType: "",
    streamingContent: "",
    isStreaming: false,
    thinkingContent: "",
    isThinking: false,
    selectedAgentId: null,
    streamingAgentId: "",
    artifacts: [],
    workflowTraces: [],
    activeWorkflowTraceId: null,
    isWorkflowDialogOpen: false,
    isWorkflowTraceLoading: false,
    googleSaEmail: null,
  },
  chatHistory: [],
};

// Standalone actions (defined before slice to avoid circular dependency with the thunk)
export const appendBuilderChunk = createAction<string>("chat/builder/appendChunk");
export const finalizeBuilderMessage = createAction("chat/builder/finalizeMessage");
export const appendBuilderThinkChunk = createAction<string>("chat/builder/appendThinkChunk");
export const finalizeBuilderThink = createAction("chat/builder/finalizeThink");
export const appendSupervisorChunk = createAction<{ chunk: string; agentId: string; runId?: string }>("chat/supervisor/appendChunk");
export const appendSupervisorThinkChunk = createAction<{ chunk: string; runId?: string }>("chat/supervisor/appendThinkChunk");
export const finalizeSupervisorThink = createAction("chat/supervisor/finalizeThink");
export const finalizeSupervisorMessage = createAction("chat/supervisor/finalizeMessage");
export const setPlanOrchestration = createAction<string>("chat/builder/setPlanOrchestration");

const normalizeAvailableSpecialists = (
  agents: Pick<AgentEntry, "id" | "role" | "goal" | "tools">[],
) =>
  agents.map((agent) => ({
    id: agent.id,
    role: agent.role,
    goal: agent.goal,
    tools: agent.tools ?? [],
  }));

export const setAvailableSpecialists = createAction<
  { id: string; role: string; goal: string; tools: string[] }[]
>("chat/builder/setAvailableSpecialists");
export const setLaunchConfirmed = createAction("chat/builder/setLaunchConfirmed");
export const clearLaunchConfirmed = createAction("chat/builder/clearLaunchConfirmed");

// --- Builder Thunks ---
export const createBuilderSession = createAsyncThunk(
  "chat/builder/createSession",
  async ({ title }: { title: string }) => {
    return await createSessionAPI(title);
  },
);

export const sendBuilderMessage = createAsyncThunk(
  "chat/builder/sendMessage",
  async (
    { message, sessionId }: { message: string; sessionId: string },
    { dispatch, getState },
  ) => {
    await new Promise<void>((resolve, reject) => {
      const wsUrl = `${getWsBaseUrl()}/ws/builder`;
      const client = createClientWithFallback(wsUrl, (event: WSEventData) => {
        switch (event.type) {
          case "builder_think":
            dispatch(appendBuilderThinkChunk(event.chunk ?? ""));
            break;
          case "chunk":
            if (event.chunk) dispatch(appendBuilderChunk(event.chunk));
            break;
          case "plan_created":
            if (event.plan_created) {
              dispatch(
                setAvailableSpecialists(
                  normalizeAvailableSpecialists(event.plan_created.agents),
                ),
              );
              dispatch(setPlanOrchestration(event.plan_created.orchestration));
            }
            dispatch(chatSlice.actions.setLatestExecSessionId(null));
            dispatch(finalizeBuilderThink());
            break;
          case "done":
            dispatch(finalizeBuilderThink());
            dispatch(finalizeBuilderMessage());
            client.close();
            resolve();
            break;
          case "session_renamed":
            if (event.title && sessionId) {
              dispatch(chatSlice.actions.updateBuilderSessionTitle({ sessionId, title: event.title }));
            }
            break;
          case "error":
            client.close();
            reject(new Error(event.error ?? "WebSocket error"));
            break;
        }
      });

      client.connect();

      const checkConnection = setInterval(() => {
        if (client.isConnected) {
          clearInterval(checkConnection);
          client.send({ type: "chat", session_id: sessionId, message });
        }
      }, 50);

      // 10-minute timeout — long enough for extended LLM thinking periods.
      // If partial content was already streamed, commit it before rejecting
      // so it isn't lost from the UI.
      setTimeout(() => {
        clearInterval(checkConnection);
        const currentState = (getState() as { chat: ChatState }).chat;
        if (currentState.builder.streamingContent) {
          dispatch(finalizeBuilderMessage());
        }
        client.close();
        reject(new Error("Connection timeout"));
      }, 600000);
    });
  },
  {
    condition: (_, { getState }) => {
      const state = (getState() as { chat: ChatState }).chat;
      return !state.builder.isLoading && !state.builder.isStreaming;
    },
  },
);

// --- Supervisor / Execution Thunks ---

/** Calls POST /builder/execute and stores the returned exec_session_id. */
export const executeBuilderPlan = createAsyncThunk(
  "chat/supervisor/executePlan",
  async (
    { planningSessionId, teamId }: { planningSessionId: string; teamId?: string },
    { dispatch },
  ) => {
    const result = await executePlanAPI(planningSessionId, teamId);
    // Pass planningSessionId — backend resolves agents via the latest execution session (Option A fallback).
    dispatch(fetchExecutionAgents({ sessionId: planningSessionId }));
    return result;
  },
);

/** Sends a message to the supervisor (execution session) using WebSocket streaming. */
export const sendSupervisorMessage = createAsyncThunk(
  "chat/supervisor/sendMessage",
  async (
    {
      message,
      sessionId,
      targetAgentId,
      presentationMode,
    }: {
      message: string;
      sessionId: string;
      targetAgentId?: string;
      presentationMode?: string;
    },
    { dispatch, getState, requestId },
  ) => {
    await new Promise<void>((resolve, reject) => {
      const wsUrl = `${getWsBaseUrl()}/ws/execution`;
      closeActiveSupervisorConnection();

      const maybeSendQueuedStop = () => {
        const supervisorState = (getState() as { chat: ChatState }).chat.supervisor;
        if (
          !supervisorState.pendingStopRequest ||
          !supervisorState.execSessionId ||
          !supervisorState.activeRunId ||
          activeSupervisorClient !== client ||
          !client.isConnected
        ) {
          return;
        }

        client.send({
          type: "stop",
          execution_session_id: supervisorState.execSessionId,
          run_id: supervisorState.activeRunId,
        });
        dispatch(chatSlice.actions.clearPendingStopRequest());
      };

      let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };

      const client = createClientWithFallback(wsUrl, (event: WSEventData) => {
        if (activeSupervisorClient !== client) {
          return;
        }

        switch (event.type) {
          case "builder_think":
            dispatch(
              appendSupervisorThinkChunk({
                chunk: event.chunk ?? "",
                runId: event.run_id,
              }),
            );
            maybeSendQueuedStop();
            break;
          case "chunk":
            dispatch(
              appendSupervisorChunk({
                chunk: event.chunk ?? "",
                agentId: event.agent_id ?? "",
                runId: event.run_id,
              }),
            );
            maybeSendQueuedStop();
            break;
          case "workflow_started":
          case "workflow_node_updated":
          case "workflow_completed":
          case "workflow_failed":
          case "workflow_stopped":
            if (event.data) {
              dispatch(chatSlice.actions.receiveWorkflowEvent({ eventType: event.type, data: event.data }));
              maybeSendQueuedStop();
            }
            break;
          case "stop_result": {
            if (event.stop_result) {
              dispatch(
                chatSlice.actions.receiveStopResult({
                  runId: event.stop_result.run_id || event.run_id,
                  status: event.stop_result.status,
                  message: event.stop_result.message,
                }),
              );
            }
            break;
          }
          case "workflow_presentation_prompt": {
            if (event.presentation_prompt) {
              dispatch(
                chatSlice.actions.receiveSupervisorRunHint({
                  runId: event.run_id,
                }),
              );
              const pp = event.presentation_prompt;
              dispatch(chatSlice.actions.receivePresentationPrompt({
                promptId: pp.prompt_id,
                question: pp.question,
                originalMessage: pp.original_message,
              }));
              maybeSendQueuedStop();
            }
            break;
          }
          case "done":
            settle(() => {
              dispatch(finalizeSupervisorThink());
              dispatch(finalizeSupervisorMessage());
              const supervisorState = (getState() as { chat: ChatState }).chat.supervisor;
              // Fetch final trace detail. Note: isWorkflowRunning is already false by the
              // time "done" fires (set by the prior workflow_completed event), so we check
              // activeWorkflowTraceId directly instead.
              if (supervisorState.activeWorkflowTraceId) {
                dispatch(
                  fetchSupervisorWorkflowTraceDetail({
                    traceId: supervisorState.activeWorkflowTraceId,
                  }),
                );
              }
              // Reload chat history from the backend so the stored final response
              // becomes visible without requiring a manual page refresh.
              // Skip if a presentation prompt is pending — it is an in-memory message that
              // has not been persisted; reloading from the API would wipe it immediately.
              const hasPendingPrompt = supervisorState.messages.some(
                (m) => m.role === "presentation_prompt",
              );
              if (supervisorState.execSessionId && !hasPendingPrompt) {
                dispatch(loadSupervisorHistory({ sessionId: supervisorState.execSessionId }));
              }
              if (connectionTimeout) {
                clearTimeout(connectionTimeout);
                connectionTimeout = null;
              }
              if (activeSupervisorClient === client) {
                closeActiveSupervisorConnection();
              } else {
                client.close();
              }
              resolve();
            });
            break;
          case "error": {
            const supervisorState = (getState() as { chat: ChatState }).chat.supervisor;
            const isStopError =
              !!event.run_id &&
              supervisorState.isStopping &&
              supervisorState.activeRunId === event.run_id;

            if (isStopError) {
              dispatch(
                chatSlice.actions.receiveStopError({
                  runId: event.run_id,
                  error: event.error ?? "Failed to stop run",
                }),
              );
              break;
            }

            settle(() => {
              if (connectionTimeout) {
                clearTimeout(connectionTimeout);
                connectionTimeout = null;
              }
              if (activeSupervisorClient === client) {
                closeActiveSupervisorConnection();
              } else {
                client.close();
              }
              reject(new Error(event.error ?? "WebSocket error"));
            });
            break;
          }
        }
      });

      client.onClose = (wasIntentional) => {
        clearInterval(checkConnection);
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
        if (wasIntentional && activeSupervisorClient !== client) {
          settle(resolve);
        }
      };

      activeSupervisorClient = client;
      client.connect();

      const checkConnection = setInterval(() => {
        if (client.isConnected) {
          clearInterval(checkConnection);
          client.send({
            type: "chat",
            session_id: sessionId,
            message,
            ...(targetAgentId ? { target_agent_id: targetAgentId } : {}),
            ...(presentationMode ? { presentation_mode: presentationMode } : {}),
          });
        }
      }, 50);

      connectionTimeout = setTimeout(() => {
        settle(() => {
          clearInterval(checkConnection);
          if (activeSupervisorClient === client) {
            closeActiveSupervisorConnection();
          } else {
            client.close();
          }
          reject(new Error("WebSocket connection timeout"));
        });
      }, 120000);
    });

    const supervisorState = (getState() as { chat: ChatState }).chat.supervisor;
    return { requestId, sessionId: supervisorState.execSessionId };
  },
);

export const stopSupervisorRun = createAsyncThunk(
  "chat/supervisor/stopRun",
  async (_, { dispatch, getState }) => {
    const supervisorState = (getState() as { chat: ChatState }).chat.supervisor;

    if (!supervisorState.execSessionId) {
      throw new Error("No active run to stop");
    }

    if (!supervisorState.activeRunId) {
      if (!activeSupervisorClient) {
        throw new Error("Execution connection is unavailable");
      }
      dispatch(chatSlice.actions.queuePendingStopRequest());
      return { queued: true };
    }

    if (!activeSupervisorClient?.isConnected) {
      throw new Error("Execution connection is unavailable");
    }

    activeSupervisorClient.send({
      type: "stop",
      execution_session_id: supervisorState.execSessionId,
      run_id: supervisorState.activeRunId,
    });

    return { runId: supervisorState.activeRunId };
  },
  {
    condition: (_, { getState }) => {
      const supervisorState = (getState() as { chat: ChatState }).chat.supervisor;
      return (
        !!supervisorState.execSessionId &&
        supervisorState.runStatus === "active" &&
        !supervisorState.isStopping
      );
    },
  },
);

/** Removes the choice card and resends the original message with the chosen presentation mode. */
export const resolvePresentationPrompt = createAsyncThunk(
  "chat/supervisor/resolvePresentationPrompt",
  async (
    {
      promptId,
      choice,
      originalMessage,
      sessionId,
    }: {
      promptId: string;
      choice: "workflow" | "chat";
      originalMessage: string;
      sessionId: string;
    },
    { dispatch },
  ) => {
    dispatch(chatSlice.actions.removePresentationPrompt(promptId));
    dispatch(
      sendSupervisorMessage({
        message: originalMessage,
        sessionId,
        presentationMode: choice,
      }),
    );
  },
);

/** Fetches the agents for the current execution session. */
export const fetchExecutionAgents = createAsyncThunk(
  "chat/supervisor/fetchAgents",
  async ({ sessionId }: { sessionId: string }) => {
    return await fetchSessionAgentsAPI(sessionId);
  },
);

/** Fetches artifacts for the current team. */
export const fetchExecutionArtifacts = createAsyncThunk(
  "chat/supervisor/fetchArtifacts",
  async ({ teamId }: { teamId: string }) => {
    return await fetchTeamArtifactsAPI(teamId);
  },
);

export const fetchSupervisorWorkflowTraces = createAsyncThunk(
  "chat/supervisor/fetchWorkflowTraces",
  async ({ sessionId }: { sessionId: string }) => {
    return await fetchWorkflowTraceSummariesAPI(sessionId);
  },
);

export const fetchSupervisorWorkflowTraceDetail = createAsyncThunk(
  "chat/supervisor/fetchWorkflowTraceDetail",
  async ({ traceId }: { traceId: string }) => {
    return await fetchWorkflowTraceDetailAPI(traceId);
  },
);

export const fetchBuilderArtifacts = createAsyncThunk(
  "chat/builder/fetchArtifacts",
  async ({ teamId }: { teamId: string }) => {
    return await fetchTeamArtifactsAPI(teamId);
  },
);

/** Loads persisted chat messages for a builder session (chat history). */
export const loadBuilderHistory = createAsyncThunk(
  "chat/builder/loadHistory",
  async ({ sessionId }: { sessionId: string }) => {
    const raw = await fetchSessionMessagesAPI(sessionId);
    return raw.map((m) => {
      // Parse think_content from the meta JSON stored by the backend
      let thinkContent: string | undefined;
      if (m.meta) {
        try {
          const parsed = typeof m.meta === "string" ? JSON.parse(m.meta) : m.meta;
          if (parsed?.think_content) thinkContent = String(parsed.think_content);
        } catch {
          // ignore malformed meta
        }
      }
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: new Date(m.created_at).getTime(),
        thinkContent,
      };
    });
  },
);

/** Loads persisted chat messages for a supervisor/execution session. */
export const loadSupervisorHistory = createAsyncThunk(
  "chat/supervisor/loadHistory",
  async ({ sessionId }: { sessionId: string }) => {
    const raw = await fetchSessionMessagesAPI(sessionId);
    return raw.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
    }));
  },
);

/** Fetches the list of planning sessions for the sidebar chat history. */
export const fetchBuilderSessions = createAsyncThunk(
  "chat/builder/fetchSessions",
  async () => {
    const sessions = await listPlanningSessions();
    return sessions.map((s) => ({
      id: s.session_id,
      title: s.title || "Untitled session",
      description: "",
      time: new Date(s.created_at).toLocaleDateString(),
      syncStatus: "confirmed" as const,
    }));
  }
);

/** Centralized action for switching sessions on agent-builder page */
export const switchBuilderSession = createAsyncThunk(
  "chat/builder/switchSession",
  async ({ sessionId }: { sessionId: string }, { dispatch }) => {
    // 1. Update session ID and clear old chat messages
    dispatch(selectBuilderSession(sessionId));

    // 2. Clear agent state (specialists, attachments, evaluation)
    dispatch(resetAgentState());

    // 3. Fetch all data in parallel
    const results = await Promise.all([
      dispatch(loadBuilderHistory({ sessionId })),
      fetchLatestSessionByPlanningId(sessionId),
      fetchPlanningSessionPlanAPI(sessionId),
      dispatch(fetchAttachments(sessionId)),
      dispatch(fetchEvaluationThunk({ referenceId: sessionId })),
    ]);

    const latestExecutionSession = results[1];
    const planningSessionPlan = results[2];
    const planToRestore = resolveBuilderSessionPlan(
      latestExecutionSession,
      planningSessionPlan,
    );
    const orderedAgents = sortAgentsByExecutionOrder(planToRestore.agents ?? []);
    const latestExecSessionId = latestExecutionSession?.session_id ?? null;
    const orchestrationType = orderedAgents.length > 0 ? planToRestore.orchestration ?? "" : "";

    dispatch(setAvailableSpecialists(normalizeAvailableSpecialists(orderedAgents)));
    dispatch(setPlanOrchestration(orchestrationType));
    dispatch(setSpecialistSelection(orderedAgents.map((agent) => agent.id).filter(Boolean)));
    dispatch(setLatestExecSessionId(latestExecSessionId));
  }
);

const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    // Builder Actions
    addBuilderMessage: (
      state,
      action: PayloadAction<Omit<Message, "timestamp">>,
    ) => {
      state.builder.messages.push({ ...action.payload, timestamp: Date.now() });
    },
    clearBuilderChat: (state) => {
      const { isTutorialActive, tutorialStep } = state.builder;
      state.builder = {
        ...initialState.builder,
        isTutorialActive,
        tutorialStep,
      };
    },
    resetBuilderSession: (state) => {
      const { isTutorialActive, tutorialStep } = state.builder;
      state.builder = {
        ...initialContextState,
        availableSpecialists: [],
        streamingContent: "",
        isStreaming: false,
        orchestrationType: "",
        isSwitchingSession: false,
        builderThinkContent: "",
        isBuilderThinking: false,
        artifacts: [],
        latestExecSessionId: null,
        isAutoExecuting: false,
        isTutorialActive,
        tutorialStep,
      };
    },

    // Supervisor Actions
    addSupervisorMessage: (
      state,
      action: PayloadAction<Omit<Message, "timestamp">>,
    ) => {
      state.supervisor.messages.push({
        ...action.payload,
        timestamp: Date.now(),
      });
    },
    clearSupervisorChat: (state) => {
      state.supervisor = initialState.supervisor;
    },
    setExecSessionId: (state, action: PayloadAction<string | null>) => {
      state.supervisor.execSessionId = action.payload;
    },
    setSelectedAgent: (state, action: PayloadAction<string | null>) => {
      state.supervisor.selectedAgentId = action.payload;
    },
    receiveSupervisorRunHint: (state, action: PayloadAction<{ runId?: string }>) => {
      reconcileSupervisorRun(state.supervisor, action.payload.runId, "active");
    },
    queuePendingStopRequest: (state) => {
      state.supervisor.pendingStopRequest = true;
    },
    clearPendingStopRequest: (state) => {
      state.supervisor.pendingStopRequest = false;
    },
    receiveStopResult: (
      state,
      action: PayloadAction<{ runId?: string; status: string; message?: string }>,
    ) => {
      const { runId, status, message } = action.payload;
      const normalizedStatus = status === "accepted" ? "stopping" : normalizeSupervisorRunStatus(status);
      if (!reconcileSupervisorRun(state.supervisor, runId, normalizedStatus)) {
        return;
      }

      if (status === "accepted") {
        state.supervisor.pendingStopRequest = false;
        state.supervisor.isStopping = true;
        return;
      }

      state.supervisor.pendingStopRequest = false;
      state.supervisor.isStopping = false;
      if (state.supervisor.runStatus === "stopping") {
        state.supervisor.runStatus = "active";
      }
      state.supervisor.error = message || "Failed to stop run";
    },
    receiveStopError: (
      state,
      action: PayloadAction<{ runId?: string; error: string }>,
    ) => {
      const { runId, error } = action.payload;
      if (!reconcileSupervisorRun(state.supervisor, runId, "active")) {
        return;
      }

      state.supervisor.pendingStopRequest = false;
      state.supervisor.isStopping = false;
      state.supervisor.error = error;
    },
    openWorkflowTraceDialog: (state, action: PayloadAction<string>) => {
      state.supervisor.activeWorkflowTraceId = action.payload;
      state.supervisor.isWorkflowDialogOpen = true;
    },
    closeWorkflowTraceDialog: (state) => {
      state.supervisor.isWorkflowDialogOpen = false;
    },
    setTutorialActive: (state, action: PayloadAction<boolean>) => {
      state.builder.isTutorialActive = action.payload;
    },
    setTutorialStep: (state, action: PayloadAction<number>) => {
      state.builder.tutorialStep = action.payload;
    },
    receiveWorkflowEvent: (
      state,
      action: PayloadAction<{ eventType: string; data: WorkflowTraceEventData }>,
    ) => {
      const { eventType, data } = action.payload;
      const nextRunStatus = normalizeSupervisorRunStatus(data.status);
      if (!reconcileSupervisorRun(state.supervisor, data.run_id, nextRunStatus)) {
        return;
      }

      const trace = upsertWorkflowTraceRecord(state.supervisor.workflowTraces, {
        trace_id: data.trace_id,
        execution_session_id: data.execution_session_id,
        orchestration: data.orchestration,
        status: data.status,
        summary: data.summary,
        run_id: data.run_id,
        started_at: data.started_at,
        completed_at: data.completed_at,
        stopped_at: data.stopped_at,
      });

      if (TERMINAL_WORKFLOW_EVENT_TYPES.has(eventType) && data.nodes !== undefined) {
        mergeWorkflowTraceRecord(trace, { nodes: data.nodes });
      }

      mergeWorkflowNodeFromEvent(trace, data);

      if (!state.supervisor.activeWorkflowTraceId || eventType === "workflow_started") {
        state.supervisor.activeWorkflowTraceId = trace.trace_id;
      }

      if (isTerminalWorkflowStatus(data.status)) {
        state.supervisor.isWorkflowRunning = false;
        state.supervisor.workflowTerminalStatus = data.status;
      } else {
        state.supervisor.isWorkflowRunning = true;
        state.supervisor.workflowTerminalStatus = null;
      }

      if (isTerminalWorkflowStatus(data.status)) {
        if (state.supervisor.streamingContent) {
          const streamingAgent = state.supervisor.executionAgents.find(
            (agent) => agent.id === state.supervisor.streamingAgentId,
          );
          state.supervisor.messages.push({
            id: Date.now().toString(),
            role: "assistant",
            content: state.supervisor.streamingContent,
            timestamp: Date.now(),
            agentId: state.supervisor.streamingAgentId || undefined,
            agentRole: streamingAgent?.role,
          });
          state.supervisor.streamingContent = "";
          state.supervisor.streamingAgentId = "";
        }

        state.supervisor.isStopping = false;
        state.supervisor.isLoading = false;
        state.supervisor.isStreaming = false;
        state.supervisor.isThinking = false;
        state.supervisor.thinkingContent = "";
        state.supervisor.pendingStopRequest = false;
      }
    },
    selectBuilderSession: (state, action: PayloadAction<string>) => {
      state.builder.sessionId = action.payload;
      state.builder.messages = [];
      state.builder.streamingContent = "";
      state.builder.isStreaming = false;
      state.builder.error = null;
      state.builder.isLoading = true; // triggers curtain exit before loadBuilderHistory resolves
      state.builder.availableSpecialists = [];
      state.builder.isTutorialActive = false;
      state.builder.tutorialStep = 0;
      state.builder.builderThinkContent = "";
      state.builder.isBuilderThinking = false;
      state.builder.artifacts = [];
      state.builder.latestExecSessionId = null;
      state.builder.isAutoExecuting = false;
    },
    updateBuilderSessionTitle: (
      state,
      action: PayloadAction<{ sessionId: string; title: string }>
    ) => {
      const item = state.chatHistory.find((h) => h.id === action.payload.sessionId);
      if (item) {
        item.title = action.payload.title;
      }
    },
    restoreBuilderThinkContent: (state, action: PayloadAction<string>) => {
      state.builder.builderThinkContent = action.payload;
    },
    setLatestExecSessionId: (state, action: PayloadAction<string | null>) => {
      state.builder.latestExecSessionId = action.payload;
    },
    receivePresentationPrompt: (
      state,
      action: PayloadAction<{ promptId: string; question: string; originalMessage: string }>
    ) => {
      const { promptId, question, originalMessage } = action.payload;
      state.supervisor.messages.push({
        id: promptId,
        role: "presentation_prompt",
        content: question,
        question,
        promptId,
        originalMessage,
        timestamp: Date.now(),
      });
      // Stop the loading indicator — the prompt card IS the response for this turn
      state.supervisor.isLoading = false;
      state.supervisor.isStreaming = false;
      state.supervisor.isWorkflowRunning = false;
      state.supervisor.workflowTerminalStatus = null;
    },
    removePresentationPrompt: (state, action: PayloadAction<string>) => {
      state.supervisor.messages = state.supervisor.messages.filter(
        (m) => !(m.role === "presentation_prompt" && m.promptId === action.payload)
      );
    },
  },
  extraReducers: (builder) => {
    builder
      // Streaming chunk actions
      .addCase(appendBuilderChunk, (state, action) => {
        state.builder.streamingContent += action.payload;
        state.builder.isStreaming = true;
      })
      .addCase(finalizeBuilderMessage, (state) => {
        if (state.builder.streamingContent) {
          state.builder.messages.push({
            id: Date.now().toString(),
            role: "assistant",
            content: state.builder.streamingContent,
            timestamp: Date.now(),
            // Snapshot the current think content alongside this message
            thinkContent: state.builder.builderThinkContent || undefined,
          });
        }
        state.builder.streamingContent = "";
        state.builder.isStreaming = false;
        // Clear global think content once it's been snapshotted into the message
        state.builder.builderThinkContent = "";
      })
      .addCase(appendBuilderThinkChunk, (state, action) => {
        state.builder.builderThinkContent += action.payload;
        state.builder.isBuilderThinking = true;
      })
      .addCase(finalizeBuilderThink, (state) => {
        state.builder.isBuilderThinking = false;
        // Keep builderThinkContent populated so accordion content stays visible
      })
      // Supervisor streaming chunk actions
      .addCase(appendSupervisorChunk, (state, action) => {
        const { chunk, agentId, runId } = action.payload;
        if (!reconcileSupervisorRun(state.supervisor, runId, "active")) {
          return;
        }

        // Flush the current buffer as a committed message when the responding agent changes
        if (agentId !== state.supervisor.streamingAgentId && state.supervisor.streamingContent) {
          const prevAgent = state.supervisor.executionAgents.find(
            (a) => a.id === state.supervisor.streamingAgentId,
          );
          state.supervisor.messages.push({
            id: Date.now().toString(),
            role: "assistant",
            content: state.supervisor.streamingContent,
            timestamp: Date.now(),
            agentId: state.supervisor.streamingAgentId || undefined,
            agentRole: prevAgent?.role,
          });
          state.supervisor.streamingContent = "";
        }
        state.supervisor.streamingContent += chunk;
        state.supervisor.streamingAgentId = agentId;
        state.supervisor.isStreaming = true;
      })
      .addCase(appendSupervisorThinkChunk, (state, action) => {
        if (!reconcileSupervisorRun(state.supervisor, action.payload.runId, "active")) {
          return;
        }

        state.supervisor.thinkingContent += action.payload.chunk;
        state.supervisor.isThinking = true;
      })
      .addCase(finalizeSupervisorThink, (state) => {
        state.supervisor.isThinking = false;
      })
      .addCase(finalizeSupervisorMessage, (state) => {
        if (state.supervisor.streamingContent) {
          const streamingAgent = state.supervisor.executionAgents.find(
            (agent) => agent.id === state.supervisor.streamingAgentId,
          );
          state.supervisor.messages.push({
            id: Date.now().toString(),
            role: "assistant",
            content: state.supervisor.streamingContent,
            timestamp: Date.now(),
            agentId: state.supervisor.streamingAgentId || undefined,
            agentRole: streamingAgent?.role,
          });
        }
        state.supervisor.streamingContent = "";
        state.supervisor.streamingAgentId = "";
        state.supervisor.isStreaming = false;
        state.supervisor.isLoading = false;
        // "done" means the WS stream is fully over — force-clear workflow running flag
        // regardless of whether workflow_completed was received, so the stop button hides.
        state.supervisor.isWorkflowRunning = false;
        if (
          !state.supervisor.isStopping &&
          !isTerminalSupervisorRunStatus(state.supervisor.runStatus)
        ) {
          state.supervisor.runStatus = "completed";
          state.supervisor.activeRunId = null;
          state.supervisor.pendingStopRequest = false;
        }
      })
      .addCase(setAvailableSpecialists, (state, action) => {
        state.builder.availableSpecialists = action.payload.map((a) => ({
          id: a.id,
          label: a.role,
          desc: a.goal,
          tools: a.tools,
        }));
      })
      .addCase(setPlanOrchestration, (state, action) => {
        state.builder.orchestrationType = action.payload;
      })

      // Builder Session
      .addCase(createBuilderSession.fulfilled, (state, action) => {
        state.builder.sessionId = action.payload.session_id;
        state.chatHistory = state.chatHistory.filter((item) => item.id !== action.payload.session_id);
        state.chatHistory.unshift({
          id: action.payload.session_id,
          title: action.payload.title || "New Chat Session",
          description: "",
          time: new Date().toLocaleDateString(),
          syncStatus: "pending_create",
        });
      })
      // Builder Message
      .addCase(sendBuilderMessage.pending, (state) => {
        state.builder.isLoading = true;
        state.builder.error = null;
        state.builder.builderThinkContent = "";
        state.builder.isBuilderThinking = false;
      })
      .addCase(sendBuilderMessage.fulfilled, (state) => {
        state.builder.isLoading = false;
        // Message already committed to state.builder.messages by finalizeBuilderMessage action
      })
      .addCase(sendBuilderMessage.rejected, (state, action) => {
        state.builder.isLoading = false;
        state.builder.isStreaming = false;
        state.builder.streamingContent = "";
        state.builder.isBuilderThinking = false;
        state.builder.error = action.error.message || "Failed to send message";
      })

      // Execute plan
      .addCase(executeBuilderPlan.pending, (state) => {
        state.supervisor.isLoading = true;
        state.supervisor.error = null;
        state.builder.isAutoExecuting = true;                        // NEW
      })
      .addCase(executeBuilderPlan.fulfilled, (state, action) => {
        state.supervisor.isLoading = false;
        state.supervisor.execSessionId = action.payload.exec_session_id;
        state.builder.isAutoExecuting = false;                       // NEW
        state.builder.latestExecSessionId = action.payload.exec_session_id; // NEW
      })
      .addCase(executeBuilderPlan.rejected, (state, action) => {
        state.supervisor.isLoading = false;
        state.supervisor.error = action.error.message || "Failed to execute plan";
        state.builder.isAutoExecuting = false;                       // NEW
      })

      // Supervisor message
      .addCase(sendSupervisorMessage.pending, (state, action) => {
        state.supervisor.isLoading = true;
        state.supervisor.error = null;
        state.supervisor.activeRunId = null;
        state.supervisor.activeRequestId = action.meta.requestId;
        state.supervisor.runStatus = "active";
        state.supervisor.isWorkflowRunning = false;
        state.supervisor.workflowTerminalStatus = null;
        state.supervisor.isStopping = false;
        state.supervisor.pendingStopRequest = false;
        state.supervisor.streamingContent = "";
        state.supervisor.thinkingContent = "";
        state.supervisor.isThinking = false;
        state.supervisor.streamingAgentId = "";
        state.supervisor.isStreaming = false;
      })
      .addCase(sendSupervisorMessage.fulfilled, (state, action) => {
        if (state.supervisor.activeRequestId !== action.meta.requestId) {
          return;
        }
        state.supervisor.isLoading = false;
        state.supervisor.activeRequestId = null;
        // WS stream is fully over — force-close any lingering run state.
        // Normal path: runStatus is already terminal (set by workflow_completed or
        // finalizeSupervisorMessage), so this is a no-op. It acts as a safety net
        // when an intermediate event (e.g. workflow_completed) was missed.
        if (!isTerminalSupervisorRunStatus(state.supervisor.runStatus)) {
          state.supervisor.runStatus = state.supervisor.isStopping ? "stopped" : "completed";
          state.supervisor.activeRunId = null;
          state.supervisor.pendingStopRequest = false;
          state.supervisor.isWorkflowRunning = false;
          state.supervisor.isStopping = false;
        }
        // Message already committed by finalizeSupervisorMessage
      })
      .addCase(sendSupervisorMessage.rejected, (state, action) => {
        if (state.supervisor.activeRequestId !== action.meta.requestId) {
          return;
        }
        state.supervisor.isLoading = false;
        state.supervisor.isStreaming = false;
        state.supervisor.isThinking = false;
        state.supervisor.isWorkflowRunning = false;
        state.supervisor.workflowTerminalStatus = null;
        state.supervisor.activeRunId = null;
        state.supervisor.streamingContent = "";
        state.supervisor.streamingAgentId = "";
        state.supervisor.activeRequestId = null;
        state.supervisor.runStatus = "idle";
        state.supervisor.isStopping = false;
        state.supervisor.pendingStopRequest = false;
        state.supervisor.error = action.error.message || "Failed to send message";
      })
      .addCase(stopSupervisorRun.pending, (state) => {
        state.supervisor.error = null;
        state.supervisor.isStopping = true;
        state.supervisor.runStatus = "stopping";
      })
      .addCase(stopSupervisorRun.fulfilled, () => {
        // Final stopped/completed state is driven by streamed workflow events.
      })
      .addCase(stopSupervisorRun.rejected, (state, action) => {
        state.supervisor.isStopping = false;
        if (state.supervisor.runStatus === "stopping") {
          state.supervisor.runStatus = "active";
        }
        state.supervisor.error = action.error.message || "Failed to stop run";
      })

      .addCase(fetchExecutionAgents.fulfilled, (state, action) => {
        const orderedAgents = sortAgentsByExecutionOrder(action.payload.agents);
        state.supervisor.executionAgents = orderedAgents;
        state.supervisor.orchestrationType = action.payload.orchestration || "";
        state.supervisor.googleSaEmail = action.payload.google_sa_email ?? null;
      })

      // Load builder chat history
      .addCase(loadBuilderHistory.pending, (state) => {
        state.builder.isLoading = true;
      })
      .addCase(loadBuilderHistory.fulfilled, (state, action) => {
        state.builder.isLoading = false;
        state.builder.messages = action.payload;
        // Don't hydrate global thinkContent here, as it's now rendered per-message
        state.builder.isBuilderThinking = false;
      })
      .addCase(loadBuilderHistory.rejected, (state, action) => {
        state.builder.isLoading = false;
        state.builder.error = action.error.message || "Failed to load chat history";
      })

      // Load supervisor chat history
      .addCase(loadSupervisorHistory.pending, (state) => {
        state.supervisor.isLoading = true;
      })
      .addCase(loadSupervisorHistory.fulfilled, (state, action) => {
        state.supervisor.isLoading = false;
        state.supervisor.messages = action.payload;
      })
      .addCase(loadSupervisorHistory.rejected, (state, action) => {
        state.supervisor.isLoading = false;
        state.supervisor.error = action.error.message || "Failed to load chat history";
      })

      // Fetch workflow traces
      .addCase(fetchSupervisorWorkflowTraces.fulfilled, (state, action) => {
        action.payload.forEach((traceSummary) => {
          upsertWorkflowTraceRecord(state.supervisor.workflowTraces, {
            ...traceSummary,
            nodes:
              state.supervisor.workflowTraces.find(
                (trace) => trace.trace_id === traceSummary.trace_id,
              )?.nodes ?? [],
          });
        });
      })
      .addCase(fetchSupervisorWorkflowTraceDetail.pending, (state) => {
        state.supervisor.isWorkflowTraceLoading = true;
      })
      .addCase(fetchSupervisorWorkflowTraceDetail.fulfilled, (state, action) => {
        state.supervisor.isWorkflowTraceLoading = false;
        const trace = upsertWorkflowTraceRecord(state.supervisor.workflowTraces, {
          ...action.payload,
          nodes: sortWorkflowTraceNodes(action.payload.nodes ?? []),
        });
        if (isTerminalWorkflowStatus(trace.status)) {
          state.supervisor.isWorkflowRunning = false;
          state.supervisor.workflowTerminalStatus = trace.status;
          state.supervisor.isLoading = false;
          state.supervisor.isStreaming = false;
          state.supervisor.isThinking = false;
          state.supervisor.isStopping = false;
          state.supervisor.pendingStopRequest = false;
          state.supervisor.thinkingContent = "";
        }
      })
      .addCase(fetchSupervisorWorkflowTraceDetail.rejected, (state) => {
        state.supervisor.isWorkflowTraceLoading = false;
      })

      // Fetch builder planning sessions (sidebar history)
      .addCase(fetchBuilderSessions.fulfilled, (state, action) => {
        state.chatHistory = mergeChatHistory(
          state.chatHistory,
          action.payload,
          state.builder.sessionId,
        );
      })
      // Switch Session
      .addCase(switchBuilderSession.pending, (state) => {
        state.builder.isSwitchingSession = true;
      })
      .addCase(switchBuilderSession.fulfilled, (state) => {
        state.builder.isSwitchingSession = false;
      })
      .addCase(switchBuilderSession.rejected, (state) => {
        state.builder.isSwitchingSession = false;
      })
      
      // Fetch Artifacts
      .addCase(fetchExecutionArtifacts.fulfilled, (state, action) => {
        state.supervisor.artifacts = action.payload;
      })
      .addCase(fetchBuilderArtifacts.fulfilled, (state, action) => {
        state.builder.artifacts = action.payload;
      });
  },
});

export const {
  addBuilderMessage,
  clearBuilderChat,
  resetBuilderSession,
  addSupervisorMessage,
  clearSupervisorChat,
  setExecSessionId,
  setSelectedAgent,
  receiveStopResult,
  receiveStopError,
  openWorkflowTraceDialog,
  closeWorkflowTraceDialog,
  selectBuilderSession,
  updateBuilderSessionTitle,
  restoreBuilderThinkContent,
  setLatestExecSessionId,
  setTutorialActive,
  setTutorialStep,
  receivePresentationPrompt,
  removePresentationPrompt,
} = chatSlice.actions;
// appendBuilderChunk, finalizeBuilderMessage, appendSupervisorChunk, finalizeSupervisorMessage
// are exported above (standalone createAction)
export default chatSlice.reducer;
