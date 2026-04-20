import api from "@/lib/axios"; // Import shared instance
import { AxiosError } from "axios";
import type {
    OrchestrationType,
    WorkflowTraceDetail,
    WorkflowTraceSummary,
} from "./workflowTypes";

export interface AgentItem {
  role: string;
  description: string;
}

export interface ChatResponse {
  message: string;
  agents: AgentItem[];
}

export interface AgentEntry {
  id: string;
  role: string;
  goal: string;
  tools?: string[];
  context?: Record<string, unknown>;
  order?: number;
  is_leader?: boolean;
}

export interface PlanningSessionPlanResponse {
  agents: AgentEntry[];
  orchestration: string;
}

export interface ExecutionPlan {
  id: number;
  agents: AgentEntry[];
  orchestration?: OrchestrationType;
}

export interface ExecutionSession {
  session_id: string;
  title?: string;
  type?: string;
  planning_session_id: string | null;
  team_id?: string;
  created_at: string;
  plans?: ExecutionPlan[];
  agents?: AgentEntry[];
}

interface ErrorResponse {
  error?: string;
}

export interface BuilderModelOption {
  uuid: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
  selection_hint?: string | null;
  advanced_info?: string | null;
  context_length: number;
  input_price: number;
  output_price: number;
  is_reasoning: boolean;
  is_active: boolean;
  icon?: string | null;
}

export interface ModelAssignmentsState {
  baseline: Record<string, string>;
  overrides: Record<string, string>;
  final: Record<string, string>;
  confirmed: boolean;
  reviewed_at?: string | null;
  confirmed_at?: string | null;
}

export interface SaveModelAssignmentsPayload {
  baseline: Record<string, string>;
  overrides: Record<string, string>;
}

type RawBuilderModelOption = Omit<BuilderModelOption, "tags" | "icon"> & {
  tags?: string[] | null;
  tag?: string | null;
  icon?: string | null;
};

let activeBuilderModelsCache: BuilderModelOption[] | null = null;
let activeBuilderModelsInFlight: Promise<BuilderModelOption[]> | null = null;

const normalizeTags = (value?: string[] | string | null) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  return rawValues.reduce<string[]>((tags, rawValue) => {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) {
      return tags;
    }

    if (tags.some((tag) => tag.toLowerCase() === trimmedValue.toLowerCase())) {
      return tags;
    }

    tags.push(trimmedValue);
    return tags;
  }, []);
};

const normalizeBuilderModelOption = (
  model: RawBuilderModelOption,
): BuilderModelOption => ({
  ...model,
  tags: normalizeTags(model.tags ?? model.tag),
  icon: model.icon ?? null,
});

export const sendMessage = async (message: string, sessionId: string) => {
  try {
    const response = await api.post<ChatResponse>("/builder/chat", {
      session_id: sessionId,
      message,
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to send message",
    );
  }
};

export const createSession = async (title: string) => {
  try {
    const response = await api.post("/builder/sessions", { title });
    return response.data;
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to create session",
    );
  }
};

export const executePlan = async (planningSessionId: string, teamId?: string): Promise<{ exec_session_id: string }> => {
  try {
    const response = await api.post<{ exec_session_id: string }>("/builder/execute", {
      session_id: planningSessionId,
      team_id: teamId ?? "",
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to execute plan",
    );
  }
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/api";

/**
 * Sends a message to the builder chat endpoint and streams the response via SSE.
 * @param message      - user text
 * @param sessionId    - planning session UUID
 * @param onChunk      - called for each streamed token chunk
 * @param onDone       - called once when the stream finishes normally
 * @param onError      - called with an error string if something goes wrong
 */
export const sendMessageStream = async (
  message: string,
  sessionId: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/builder/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
      credentials: "include",
    });
  } catch (err) {
    onError(err instanceof Error ? err.message : "Network error");
    return;
  }

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({})) as Record<string, string>;
    onError(data.error ?? "Failed to send message");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed.done) { onDone(); return; }
          if (typeof parsed.chunk === "string") onChunk(parsed.chunk);
          if (typeof parsed.error === "string") { onError(parsed.error); return; }
        } catch {
          // malformed SSE data — ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onDone();
};

export const fetchSessionAgents = async (sessionId: string): Promise<{ agents: AgentEntry[]; orchestration: string; google_sa_email?: string }> => {
  try {
    const response = await api.get<{ agents: AgentEntry[]; orchestration: OrchestrationType; google_sa_email?: string }>("/builder/agents", {
      params: { session_id: sessionId },
    });
    return {
      agents: response.data.agents ?? [],
      orchestration: response.data.orchestration ?? "",
      google_sa_email: response.data.google_sa_email,
    };
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to fetch agents",
    );
  }
};

export const listExecutionSessions = async (): Promise<ExecutionSession[]> => {
  try {
    const response = await api.get<{ sessions: ExecutionSession[] }>("/builder/sessions");
    return response.data.sessions ?? [];
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to list sessions",
    );
  }
};

export interface SessionMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  meta?: Record<string, unknown> | string | null;
}

export interface Artifact {
  id: string;
  team_id: string;
  file_id: string;
  file_type: string;
  title: string;
  url: string;
  content?: string | null;
  source_session_id?: string | null;
  source_planning_session_id?: string | null;
  resolution_source?: string | null;
  created_by_agent_id?: string | null;
  created_by_agent_role?: string | null;
  created_by_tool_name?: string | null;
  created_at: string;
}

export const fetchSessionMessages = async (sessionId: string): Promise<SessionMessage[]> => {
  try {
    const response = await api.get<{ messages: SessionMessage[] }>(`/builder/sessions/${sessionId}/messages`);
    return response.data.messages ?? [];
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to fetch session messages",
    );
  }
};

export const fetchTeamArtifacts = async (teamId: string): Promise<Artifact[]> => {
  try {
    const response = await api.get<{ artifacts: Artifact[] }>(`/builder/teams/${teamId}/artifacts`);
    return response.data.artifacts ?? [];
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to fetch team artifacts",
    );
  }
};

export interface PlanningSession {
  session_id: string;
  title: string;
  created_at: string;
}

export const listPlanningSessions = async (): Promise<PlanningSession[]> => {
  const response = await api.get<{ sessions: PlanningSession[] }>("/builder/planning-sessions");
  return response.data.sessions ?? [];
};

export const fetchWorkflowTraceSummaries = async (
  sessionId: string,
): Promise<WorkflowTraceSummary[]> => {
  try {
    const response = await api.get<{ traces: WorkflowTraceSummary[] }>(
      `/builder/sessions/${sessionId}/workflow-traces`,
    );
    return response.data.traces ?? [];
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to fetch workflow traces",
    );
  }
};

export const fetchWorkflowTraceDetail = async (
  traceId: string,
): Promise<WorkflowTraceDetail> => {
  try {
    const response = await api.get<{ trace: WorkflowTraceDetail }>(
      `/builder/workflow-traces/${traceId}`,
    );
    return response.data.trace;
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to fetch workflow trace",
    );
  }
};

export const fetchBuilderConfig = async (): Promise<{ google_sa_email: string }> => {
  const response = await api.get<{ google_sa_email: string }>("/builder/config");
  return response.data;
};

export const fetchActiveBuilderModels = async (
  options: { forceRefresh?: boolean } = {},
): Promise<BuilderModelOption[]> => {
  const { forceRefresh = false } = options;

  if (!forceRefresh && activeBuilderModelsCache) {
    return activeBuilderModelsCache;
  }

  if (activeBuilderModelsInFlight) {
    return activeBuilderModelsInFlight;
  }

  activeBuilderModelsInFlight = (async () => {
    try {
      const response = await api.get<{ models: RawBuilderModelOption[] }>("/builder-models");
      const models = (response.data.models ?? []).map(normalizeBuilderModelOption);
      activeBuilderModelsCache = models;
      return models;
    } catch (error: unknown) {
      const axiosError = error as AxiosError<ErrorResponse>;
      throw new Error(
        axiosError.response?.data?.error || "Failed to fetch builder models",
      );
    } finally {
      activeBuilderModelsInFlight = null;
    }
  })();

  return activeBuilderModelsInFlight;
};

export const fetchPlanningSessionPlan = async (
  sessionId: string,
): Promise<PlanningSessionPlanResponse> => {
  try {
    const response = await api.get<PlanningSessionPlanResponse>(
      `/builder/planning-sessions/${sessionId}/plan`,
    );
    return {
      agents: response.data.agents ?? [],
      orchestration: response.data.orchestration ?? "",
    };
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    // 404 means no plan created yet — return empty rather than rejecting Promise.all
    if (axiosError.response?.status === 404) {
      return { agents: [], orchestration: "" };
    }
    throw new Error(
      axiosError.response?.data?.error || "Failed to fetch planning session plan",
    );
  }
};

export const fetchModelAssignments = async (
  sessionId: string,
): Promise<ModelAssignmentsState> => {
  try {
    const response = await api.get<ModelAssignmentsState>(
      `/builder/sessions/${sessionId}/model-assignments`,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to fetch model assignments",
    );
  }
};

export const saveModelAssignmentsDraft = async (
  sessionId: string,
  payload: SaveModelAssignmentsPayload,
): Promise<ModelAssignmentsState> => {
  try {
    const response = await api.put<ModelAssignmentsState>(
      `/builder/sessions/${sessionId}/model-assignments`,
      payload,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to save model assignments",
    );
  }
};

export const confirmModelAssignments = async (
  sessionId: string,
): Promise<ModelAssignmentsState> => {
  try {
    const response = await api.post<ModelAssignmentsState>(
      `/builder/sessions/${sessionId}/model-assignments/confirm`,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    throw new Error(
      axiosError.response?.data?.error || "Failed to confirm model assignments",
    );
  }
};

/**
 * Fetches the latest execution session for a given planning session ID.
 * Returns null if no session exists yet (404 / empty array from backend).
 */
export const fetchLatestSessionByPlanningId = async (
  planningSessionId: string,
): Promise<ExecutionSession | null> => {
  try {
    const response = await api.get<{ sessions: ExecutionSession[] }>(
      `/builder/sessions?planning_session_id=${encodeURIComponent(planningSessionId)}`,
    );
    return response.data.sessions?.[0] ?? null;
  } catch (error: unknown) {
    const axiosError = error as AxiosError<ErrorResponse>;
    // 404 means no draft session yet — not an error condition
    if (axiosError.response?.status === 404) return null;
    throw new Error(
      axiosError.response?.data?.error ?? "Failed to fetch session",
    );
  }
};

/** Mirrors the backend's sanitizeFilename: replaces non-alphanumeric/hyphen/underscore chars with hyphens. */
const sanitizeArtifactFilename = (name: string): string =>
  name.replace(/[^a-zA-Z0-9\-_]/g, "-") || "artifact";

/**
 * Triggers a browser download of a local_doc artifact as a .md file.
 * Uses the axios instance (carries auth cookies) to fetch as a blob,
 * then creates a temporary anchor to trigger the browser save dialog.
 */
export const downloadArtifact = async (id: string, title: string): Promise<void> => {
  const response = await api.get<Blob>(`/builder/artifacts/${id}/download`, {
    responseType: "blob",
  });
  // axios preserves the server Content-Type in the blob; no need to re-wrap
  const url = URL.createObjectURL(response.data);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeArtifactFilename(title)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(url);
  }
};
