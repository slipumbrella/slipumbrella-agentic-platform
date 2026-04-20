export type OrchestrationType =
  | "sequential"
  | "concurrent"
  | "group_chat"
  | "handoff"
  | "magentic"
  | string;

export type WorkflowTraceStatus =
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "canceled"
  | string;

export interface ThinkingItem {
  role: string;           // "user" | "assistant" | "tool"
  content_type: string;   // "text" | "function_call" | "function_result"
  text?: string;
  tool_name?: string;
  arguments?: string;     // JSON-encoded string for function_call args
}

export interface WorkflowTraceNode {
  agent_id?: string;
  agent_role?: string;
  is_leader?: boolean;
  order?: number;
  status: WorkflowTraceStatus;
  preview?: string;
  response?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
  from_agent_id?: string;
  thinking?: ThinkingItem[];
}

export interface WorkflowTraceSummary {
  trace_id: string;
  execution_session_id: string;
  orchestration: OrchestrationType;
  status: WorkflowTraceStatus;
  summary: string;
  run_id?: string;
  started_at?: string;
  completed_at?: string;
  stopped_at?: string;
}

export interface WorkflowTraceDetail extends WorkflowTraceSummary {
  nodes: WorkflowTraceNode[];
}

export interface WorkflowTraceEventData {
  trace_id: string;
  execution_session_id: string;
  orchestration: OrchestrationType;
  status: WorkflowTraceStatus;
  summary: string;
  run_id?: string;
  agent_id?: string;
  agent_role?: string;
  is_leader?: boolean;
  order?: number;
  preview?: string;
  response?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
  stopped_at?: string;
  from_agent_id?: string;
  thinking?: ThinkingItem[];
  nodes?: WorkflowTraceNode[];
}

const DIRECT_TARGET_ORCHESTRATIONS = new Set(["sequential", "concurrent"]);
const TERMINAL_WORKFLOW_STATUSES = new Set(["completed", "failed", "stopped", "canceled"]);

export const supportsDirectTargeting = (
  orchestration?: OrchestrationType | null,
): boolean => DIRECT_TARGET_ORCHESTRATIONS.has(orchestration ?? "");

export const hasLeaderAgent = (
  agents: { is_leader?: boolean }[],
): boolean => agents.some((a) => a.is_leader === true);

export const isTerminalWorkflowStatus = (
  status?: WorkflowTraceStatus | null,
): boolean => TERMINAL_WORKFLOW_STATUSES.has(status ?? "");

export const getWorkflowTraceTimestamp = (trace: {
  completed_at?: string;
  started_at?: string;
  stopped_at?: string;
}): number => {
  if (trace.completed_at) {
    return new Date(trace.completed_at).getTime();
  }

  if (trace.stopped_at) {
    return new Date(trace.stopped_at).getTime();
  }

  if (trace.started_at) {
    return new Date(trace.started_at).getTime();
  }

  return Date.now();
};

export const getOrchestrationLabel = (
  orchestration?: OrchestrationType | null,
): string => {
  const labels: Record<string, string> = {
    sequential: "Sequential",
    concurrent: "Concurrent",
    group_chat: "Group Chat",
    handoff: "Handoff",
    magentic: "Magentic",
  };

  return labels[orchestration ?? ""] ?? (orchestration || "Workflow");
};

export const sortAgentsByExecutionOrder = <T extends { order?: number | null; role?: string }>(
  agents: T[],
): T[] => {
  return [...agents].sort((left, right) => {
    const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return (left.role ?? "").localeCompare(right.role ?? "");
  });
};

export const sortWorkflowTraceNodes = (
  nodes: WorkflowTraceNode[],
): WorkflowTraceNode[] => {
  return [...nodes].sort((left, right) => {
    const leftId = left.agent_id ?? "";
    const rightId = right.agent_id ?? "";

    if (leftId === "input-conversation" && rightId !== "input-conversation") {
      return -1;
    }

    if (rightId === "input-conversation" && leftId !== "input-conversation") {
      return 1;
    }

    if (leftId === "end" && rightId !== "end") {
      return 1;
    }

    if (rightId === "end" && leftId !== "end") {
      return -1;
    }

    if (left.is_leader !== right.is_leader) {
      return left.is_leader ? -1 : 1;
    }

    const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return (left.agent_role ?? "").localeCompare(right.agent_role ?? "");
  });
};

const HIDDEN_AGENT_IDENTITIES = new Set(["input-conversation", "end"]);

export const filterWorkflowTraceNodes = (
  nodes: WorkflowTraceNode[],
  orchestration?: string,
): WorkflowTraceNode[] => {
  // For sequential orchestration, boundary nodes (input / end) are meaningful
  // steps in the trace and should be visible in the graph and detail panel.
  if (orchestration === "sequential") return nodes;
  return nodes.filter(
    (node) =>
      !HIDDEN_AGENT_IDENTITIES.has(node.agent_id ?? "") &&
      !HIDDEN_AGENT_IDENTITIES.has(node.agent_role ?? ""),
  );
};