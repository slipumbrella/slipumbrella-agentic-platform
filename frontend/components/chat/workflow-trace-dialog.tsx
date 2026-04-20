"use client";

import {
    Background,
    BackgroundVariant,
    Controls,
    type Edge,
    Handle,
    MarkerType,
    type Node,
    type NodeProps,
    Position,
    ReactFlow,
    useEdgesState,
    useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    Activity,
    ArrowRight,
    Brain,
    CheckCircle2,
    CircleDashed,
    Clock3,
    Expand,
    GitBranch,
    Loader2,
    MessagesSquare,
    Minimize2,
    MoveRight,
    PanelRight,
    PlayCircle,
    Sparkles,
    UserRoundCog,
    Wrench,
    XCircle,
} from "lucide-react";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { BorderBeam } from "@/components/ui/border-beam";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    filterWorkflowTraceNodes,
    getOrchestrationLabel,
    isTerminalWorkflowStatus,
    sortWorkflowTraceNodes,
    type ThinkingItem,
    type WorkflowTraceDetail,
    type WorkflowTraceNode,
} from "@/lib/features/chat/workflowTypes";
import { cn } from "@/lib/utils";

type FlowNodeData = {
  node: WorkflowTraceNode;
  index: number;
  orchestration: string;
  isSelected: boolean;
  onSelect: (key: string) => void;
  onOpenThinking: (key: string) => void;
  /** True for synthetic nodes (e.g. Collector) added only for visualisation. */
  isSynthetic?: boolean;
};

/** Synthetic node key for the Collector in concurrent layouts. */
export const CONCURRENT_COLLECTOR_KEY = '__collector__';

type StatusTone = {
  badge: string;
  panel: string;
  icon: React.ComponentType<{ className?: string }>;
};

type OrchestrationTone = {
  shell: string;
  glow: string;
  badge: string;
  canvas: string;
  beamFrom: string;
  beamTo: string;
  activeBorder: string;
  activeBg: string;
  activeText: string;
  activeDot: string;
  activeConnector: string;
  completedBorder: string;
  completedBg: string;
  completedText: string;
  completedDot: string;
  completedConnector: string;
  idleBorder: string;
  idleBg: string;
  idleText: string;
  idleDot: string;
  idleConnector: string;
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
};

const STATUS_TONES: Record<string, StatusTone> = {
  running: {
    badge: "border-amber-300/70 bg-amber-100/80 text-amber-800",
    panel: "border-amber-200/70 bg-amber-50/80",
    icon: PlayCircle,
  },
  completed: {
    badge: "border-emerald-300/70 bg-emerald-100/80 text-emerald-800",
    panel: "border-emerald-200/70 bg-emerald-50/80",
    icon: CheckCircle2,
  },
  failed: {
    badge: "border-rose-300/70 bg-rose-100/80 text-rose-800",
    panel: "border-rose-200/70 bg-rose-50/90",
    icon: XCircle,
  },
  canceled: {
    badge: "border-slate-300/70 bg-slate-100/85 text-slate-700",
    panel: "border-slate-200/70 bg-slate-50/85",
    icon: CircleDashed,
  },
};

const ORCHESTRATION_TONES: Record<string, OrchestrationTone> = {
  sequential: {
    shell: "from-sky-50 via-white to-cyan-50",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_38%)]",
    badge: "bg-sky-100/85 text-sky-800 border-sky-200/70",
    canvas: "from-sky-50/96 via-white to-cyan-50/80",
    beamFrom: "#38bdf8",
    beamTo: "#22d3ee",
    activeBorder: "border-sky-300/90",
    activeBg: "bg-sky-100/95",
    activeText: "text-sky-800",
    activeDot: "bg-sky-500",
    activeConnector: "bg-sky-400",
    completedBorder: "border-sky-200/90",
    completedBg: "bg-sky-50/90",
    completedText: "text-sky-700",
    completedDot: "bg-sky-300",
    completedConnector: "bg-sky-200",
    idleBorder: "border-slate-200/90",
    idleBg: "bg-white/82",
    idleText: "text-slate-500",
    idleDot: "bg-slate-300",
    idleConnector: "bg-slate-200",
    icon: MoveRight,
    eyebrow: "Ordered execution",
    title: "Sequential route map",
  },
  concurrent: {
    shell: "from-indigo-50 via-white to-blue-50",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.16),transparent_38%)]",
    badge: "bg-indigo-100/85 text-indigo-800 border-indigo-200/70",
    canvas: "from-indigo-50/96 via-white to-blue-50/84",
    beamFrom: "#6366f1",
    beamTo: "#60a5fa",
    activeBorder: "border-indigo-300/90",
    activeBg: "bg-indigo-100/95",
    activeText: "text-indigo-800",
    activeDot: "bg-indigo-500",
    activeConnector: "bg-indigo-400",
    completedBorder: "border-indigo-200/90",
    completedBg: "bg-indigo-50/90",
    completedText: "text-indigo-700",
    completedDot: "bg-indigo-300",
    completedConnector: "bg-indigo-200",
    idleBorder: "border-slate-200/90",
    idleBg: "bg-white/82",
    idleText: "text-slate-500",
    idleDot: "bg-slate-300",
    idleConnector: "bg-slate-200",
    icon: GitBranch,
    eyebrow: "Parallel execution",
    title: "Concurrent branch map",
  },
  group_chat: {
    shell: "from-fuchsia-50 via-white to-pink-50",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(217,70,239,0.15),transparent_38%)]",
    badge: "bg-fuchsia-100/85 text-fuchsia-800 border-fuchsia-200/70",
    canvas: "from-fuchsia-50/96 via-white to-pink-50/84",
    beamFrom: "#d946ef",
    beamTo: "#f472b6",
    activeBorder: "border-fuchsia-300/90",
    activeBg: "bg-fuchsia-100/95",
    activeText: "text-fuchsia-800",
    activeDot: "bg-fuchsia-500",
    activeConnector: "bg-fuchsia-400",
    completedBorder: "border-fuchsia-200/90",
    completedBg: "bg-fuchsia-50/90",
    completedText: "text-fuchsia-700",
    completedDot: "bg-fuchsia-300",
    completedConnector: "bg-fuchsia-200",
    idleBorder: "border-slate-200/90",
    idleBg: "bg-white/82",
    idleText: "text-slate-500",
    idleDot: "bg-slate-300",
    idleConnector: "bg-slate-200",
    icon: MessagesSquare,
    eyebrow: "Shared discussion",
    title: "Group conversation board",
  },
  handoff: {
    shell: "from-violet-50 via-white to-indigo-50",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.15),transparent_38%)]",
    badge: "bg-violet-100/85 text-violet-800 border-violet-200/70",
    canvas: "from-violet-50/96 via-white to-indigo-50/84",
    beamFrom: "#8b5cf6",
    beamTo: "#3b82f6",
    activeBorder: "border-violet-300/90",
    activeBg: "bg-violet-100/95",
    activeText: "text-violet-800",
    activeDot: "bg-violet-500",
    activeConnector: "bg-violet-400",
    completedBorder: "border-violet-200/90",
    completedBg: "bg-violet-50/92",
    completedText: "text-violet-700",
    completedDot: "bg-violet-300",
    completedConnector: "bg-violet-200",
    idleBorder: "border-slate-200/90",
    idleBg: "bg-white/82",
    idleText: "text-slate-500",
    idleDot: "bg-slate-300",
    idleConnector: "bg-slate-200",
    icon: ArrowRight,
    eyebrow: "Control transfer",
    title: "Handoff chain",
  },
  magentic: {
    shell: "from-amber-50 via-white to-orange-50",
    glow: "bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_38%)]",
    badge: "bg-amber-100/85 text-amber-800 border-amber-200/70",
    canvas: "from-amber-50/96 via-white to-orange-50/84",
    beamFrom: "#f59e0b",
    beamTo: "#fb923c",
    activeBorder: "border-amber-300/90",
    activeBg: "bg-amber-100/95",
    activeText: "text-amber-800",
    activeDot: "bg-amber-500",
    activeConnector: "bg-amber-400",
    completedBorder: "border-amber-200/90",
    completedBg: "bg-amber-50/92",
    completedText: "text-amber-700",
    completedDot: "bg-amber-300",
    completedConnector: "bg-amber-200",
    idleBorder: "border-slate-200/90",
    idleBg: "bg-white/82",
    idleText: "text-slate-500",
    idleDot: "bg-slate-300",
    idleConnector: "bg-slate-200",
    icon: UserRoundCog,
    eyebrow: "Manager-led orchestration",
    title: "Magentic coordination board",
  },
};

function getStatusTone(status: string): StatusTone {
  return STATUS_TONES[status] ?? STATUS_TONES.canceled;
}

function getOrchestrationTone(orchestration: string): OrchestrationTone {
  return ORCHESTRATION_TONES[orchestration] ?? ORCHESTRATION_TONES.concurrent;
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatSummaryText(value?: string): string {
  const normalized = normalizeMarkdownText(value || "");
  if (!normalized) {
    return "";
  }

  if (normalized.includes("\n")) {
    return normalized;
  }

  if (!normalized.includes(";")) {
    return normalized;
  }

  const parts = normalized
    .split(/;\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return normalized;
  }

  const first = parts[0];
  const match = first.match(/^(.*?\.)\s+(.+?:\s+.+)$/);
  if (match) {
    return [match[1], match[2], ...parts.slice(1)].join("\n");
  }

  return parts.join("\n");
}

function normalizeMarkdownText(value: string): string {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

function getNodeKey(node: WorkflowTraceNode, index: number): string {
  return node.agent_id || `${node.agent_role || "node"}-${node.order ?? index}`;
}

function isBoundaryNode(node: WorkflowTraceNode): boolean {
  return node.agent_id === 'input-conversation' || node.agent_id === 'end';
}

function getNodeMeta(node: WorkflowTraceNode): string {
  if (node.agent_id === 'input-conversation') {
    return 'Workflow entry point';
  }
  if (node.agent_id === 'end') {
    return node.status === 'completed' ? 'Workflow final output' : 'Waiting for final output';
  }
  if (node.status === "failed" && node.error) {
    return "Failed during execution";
  }
  if (node.status === "running") {
    return "Active node";
  }
  if (node.status === "completed") {
    return "Completed successfully";
  }

  return "Waiting for output";
}

function getNodeTitle(node: WorkflowTraceNode, index: number): string {
  return node.agent_role || `Node ${node.order ?? index + 1}`;
}

function StatusBadge({ status }: { status: string }) {
  const tone = getStatusTone(status);
  const Icon = tone.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
        tone.badge,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

export function ThinkingIndicator({
  status,
  thinking,
  nodeKey,
  onOpenThinking,
  className,
}: {
  status: string;
  thinking?: ThinkingItem[];
  nodeKey: string;
  onOpenThinking: (key: string) => void;
  className?: string;
}) {
  const isRunning = status === "running";
  const hasThinking = (thinking?.length ?? 0) > 0;
  const isComplete = status === "completed" && hasThinking;

  if (!isRunning && !isComplete) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (isComplete) onOpenThinking(nodeKey);
      }}
      disabled={isRunning}
      aria-label={isRunning ? "Agent is thinking…" : "View agent thinking chain"}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 shadow-md transition-all",
        isRunning &&
          "cursor-default animate-spin border-yellow-400 bg-yellow-200",
        isComplete &&
          "cursor-pointer border-emerald-400 bg-emerald-400 hover:bg-emerald-500 hover:border-emerald-500",
        className,
      )}
    >
      {isComplete && <Brain className="h-3 w-3 text-white" />}
    </button>
  );
}

function ThinkingPanel({
  node,
  onClose,
}: {
  node: WorkflowTraceNode;
  onClose: () => void;
}) {
  const items = node.thinking ?? [];

  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-slate-950/35 p-4 backdrop-blur-sm sm:p-6">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-white/80 bg-white/96 shadow-[0_30px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Thinking chain
            </p>
            <h3 className="mt-1 truncate text-xl font-semibold text-slate-950">
              {node.agent_role ?? "Agent"}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Full intermediate message chain produced by this agent.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6 [scrollbar-width:thin]">
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">No thinking chain recorded for this node.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item, i) => (
                <ThinkingItemRow key={i} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThinkingItemRow({ item }: { item: ThinkingItem }) {
  const [argsOpen, setArgsOpen] = React.useState(false);
  const normalizedText = normalizeMarkdownText(item.text ?? "");

  if (item.content_type === "function_call") {
    return (
      <div className="rounded-2xl border border-indigo-200/70 bg-indigo-50/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="text-[12px] font-semibold text-indigo-700 uppercase tracking-wide">
            Tool call
          </span>
          <span className="text-sm font-medium text-indigo-900">{item.tool_name}</span>
        </div>
        {item.arguments && item.arguments !== "{}" && (
          <button
            type="button"
            onClick={() => setArgsOpen((v) => !v)}
            className="mt-2 text-xs text-indigo-500 hover:text-indigo-700"
          >
            {argsOpen ? "Hide arguments" : "Show arguments"}
          </button>
        )}
        {argsOpen && item.arguments && (
          <pre className="mt-2 overflow-x-auto rounded-xl bg-indigo-100/70 px-3 py-2 text-[11px] text-indigo-800">
            {(() => { try { return JSON.stringify(JSON.parse(item.arguments), null, 2); } catch { return item.arguments; } })()}
          </pre>
        )}
      </div>
    );
  }

  if (item.content_type === "function_result") {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide">
            Tool result
          </span>
          <span className="text-xs text-slate-500">{item.tool_name}</span>
        </div>
        {normalizedText && (
          <div className="prose prose-sm prose-slate mt-2 max-w-none leading-relaxed prose-p:my-0 prose-headings:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:border prose-pre:border-slate-200/70 prose-pre:bg-white/70 prose-pre:px-3 prose-pre:py-2 prose-code:rounded prose-code:bg-white prose-code:px-1.5 prose-code:py-0.5 prose-code:text-slate-800">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{normalizedText}</ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  // Default: text message
  const isAssistant = item.role === "assistant";
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3",
        isAssistant
          ? "border-slate-200/70 bg-white/90 text-slate-800"
          : "border-slate-100/70 bg-slate-50/50 text-slate-500",
      )}
    >
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {item.role}
      </p>
      {normalizedText && (
        <div className="prose prose-sm prose-slate max-w-none leading-relaxed prose-p:my-0 prose-headings:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:border prose-pre:border-slate-200/70 prose-pre:bg-slate-50/90 prose-pre:px-3 prose-pre:py-2 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-slate-800">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{normalizedText}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function OverviewStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] backdrop-blur-sm">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ResponseBubble({
  content,
  variant = "default",
  className,
}: {
  content: string;
  variant?: "default" | "error";
  className?: string;
}) {
  const normalized = normalizeMarkdownText(content);

  if (!normalized) {
    return null;
  }

  const shellClassName =
    variant === "error"
      ? "border-rose-200/80 bg-rose-50/80 text-rose-800"
      : "border-slate-200/70 bg-white/88 text-slate-800";

  return (
    <div
      className={cn(
        "rounded-[26px] border px-4 py-4 shadow-sm sm:px-5",
        shellClassName,
        className,
      )}
    >
      <div className="prose prose-sm prose-slate max-w-none wrap-break-word leading-relaxed prose-p:my-0 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0 prose-pre:overflow-x-auto prose-pre:rounded-2xl prose-pre:border prose-pre:border-slate-200/70 prose-pre:bg-slate-50/90 prose-pre:px-4 prose-pre:py-3 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-slate-800">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{normalized}</ReactMarkdown>
      </div>
    </div>
  );
}

// ─── ReactFlow graph implementation ───────────────────────────────────────────

function AgentNode({ data }: NodeProps) {
  const { node, index, orchestration, isSelected, onSelect, onOpenThinking, isSynthetic } = data as unknown as FlowNodeData;
  const tone = getOrchestrationTone(orchestration);
  const nodeKey = getNodeKey(node, index);
  const isRunning = node.status === 'running';
  const isCompleted = node.status === 'completed';
  const isFailed = node.status === 'failed';
  const isLeader = node.is_leader === true;
  const isBoundary = isBoundaryNode(node);
  const boundaryBadge = node.agent_id === 'input-conversation' ? 'Input' : 'Output';

  return (
    <div className="relative">
      {!isBoundary && !isSynthetic ? (
        <ThinkingIndicator
          status={node.status}
          thinking={node.thinking}
          nodeKey={nodeKey}
          onOpenThinking={onOpenThinking}
          className="absolute -top-3 -right-3 z-10"
        />
      ) : null}
      <div
        onClick={() => onSelect(nodeKey)}
        className={cn(
          'w-40 rounded-2xl border-2 px-4 py-3 transition-all duration-200 shadow-sm',
          isSynthetic ? 'cursor-pointer border-dashed' : 'cursor-pointer',
          isSelected ? 'ring-2 ring-offset-2' : 'hover:shadow-md',
          isBoundary ? 'border-slate-300 bg-linear-to-br from-slate-100 to-white ring-slate-300/70' : '',
          !isBoundary && isRunning ? `${tone.activeBorder} ${tone.activeBg} ${!isSynthetic ? 'ring-blue-400 animate-pulse' : ''}` : '',
          !isBoundary && isCompleted ? `${tone.completedBorder} ${tone.completedBg}` : '',
          !isBoundary && isFailed ? 'border-rose-300 bg-rose-50' : '',
          !isBoundary && !isRunning && !isCompleted && !isFailed ? `${tone.idleBorder} ${tone.idleBg}` : '',
        )}
      >
        <Handle type="target" position={Position.Top} className="bg-slate-400!" />
        <div className="flex items-center justify-between gap-1.5 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {isBoundary ? 'Stage' : isSynthetic ? '' : `Step ${index + 1}`}
          </span>
          {isBoundary ? (
            <span className="rounded-full border border-slate-300/80 bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-700">
              {boundaryBadge}
            </span>
          ) : null}
          {isLeader && !isBoundary && !isSynthetic ? (
            <span className="rounded-full border border-indigo-200/80 bg-indigo-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
              Leader
            </span>
          ) : null}
        </div>
        <p className="text-sm font-semibold text-slate-900 truncate">{getNodeTitle(node, index)}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500 truncate">{getNodeMeta(node)}</p>
          {isRunning && <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />}
          {isCompleted && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
          {isFailed && <span className="h-2 w-2 rounded-full bg-rose-500" />}
          {!isRunning && !isCompleted && !isFailed && <span className="h-2 w-2 rounded-full bg-slate-300" />}
        </div>
        {!isSynthetic ? <Handle type="source" position={Position.Bottom} className="bg-slate-400!" /> : <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />}
      </div>
    </div>
  );
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 90;
const H_GAP = 60;
const V_GAP = 92;

function buildSequentialLayout(
  nodes: WorkflowTraceNode[],
  selectedNodeKey: string | null,
  onSelect: (k: string) => void,
  orchestration: string,
  onOpenThinking: (k: string) => void,
): { rfNodes: Node[]; rfEdges: Edge[] } {
  const rfNodes: Node[] = nodes.map((node, i) => ({
    id: getNodeKey(node, i),
    type: 'agentNode',
    position: { x: 0, y: i * (NODE_HEIGHT + V_GAP) },
    data: { node, index: i, orchestration, isSelected: selectedNodeKey === getNodeKey(node, i), onSelect, onOpenThinking } as Record<string, unknown>,
  }));
  const rfEdges: Edge[] = nodes.slice(1).map((node, i) => ({
    id: `e${i}-${i + 1}`,
    source: getNodeKey(nodes[i], i),
    target: getNodeKey(node, i + 1),
    animated: nodes[i].status === 'running',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#94a3b8' },
  }));
  return { rfNodes, rfEdges };
}

function buildConcurrentLayout(
  nodes: WorkflowTraceNode[],
  selectedNodeKey: string | null,
  onSelect: (k: string) => void,
  orchestration: string,
  onOpenThinking: (k: string) => void,
): { rfNodes: Node[]; rfEdges: Edge[] } {
  if (nodes.length === 0) return { rfNodes: [], rfEdges: [] };

  // Filter out framework-internal infrastructure nodes (dispatcher / aggregator)
  // that the ConcurrentBuilder adds automatically — they are not real business agents.
  const FRAMEWORK_INTERNAL_IDS = new Set(['dispatcher', 'aggregator']);
  const visibleNodes = nodes.filter((n) => !FRAMEWORK_INTERNAL_IDS.has(n.agent_id ?? ''));

  // Separate the distributor (leader) from worker agents.
  const leader = visibleNodes.find((n) => n.is_leader) ?? visibleNodes[0];
  const workers = visibleNodes.filter((n) => n !== leader);
  const leaderKey = getNodeKey(leader, 0);

  // Derive aggregated status for the synthetic Collector node.
  const collectorStatus: string =
    workers.length === 0
      ? leader.status
      : workers.every((w) => w.status === 'completed')
        ? 'completed'
        : workers.some((w) => w.status === 'running')
          ? 'running'
          : workers.some((w) => w.status === 'failed')
            ? 'failed'
            : 'idle';

  const collectorNode: WorkflowTraceNode = {
    agent_id: CONCURRENT_COLLECTOR_KEY,
    agent_role: 'Collector',
    status: collectorStatus,
    order: 9999,
  };

  const workerCount = Math.max(workers.length, 1);
  const totalWidth = workerCount * (NODE_WIDTH + H_GAP) - H_GAP;
  const centerX = totalWidth / 2 - NODE_WIDTH / 2;

  const rfNodes: Node[] = [
    {
      id: leaderKey,
      type: 'agentNode',
      position: { x: centerX, y: 0 },
      data: { node: leader, index: 0, orchestration, isSelected: selectedNodeKey === leaderKey, onSelect, onOpenThinking } as Record<string, unknown>,
    },
    ...workers.map((node, i) => ({
      id: getNodeKey(node, i + 1),
      type: 'agentNode',
      position: { x: i * (NODE_WIDTH + H_GAP), y: NODE_HEIGHT + V_GAP },
      data: { node, index: i + 1, orchestration, isSelected: selectedNodeKey === getNodeKey(node, i + 1), onSelect, onOpenThinking } as Record<string, unknown>,
    })),
    {
      id: CONCURRENT_COLLECTOR_KEY,
      type: 'agentNode',
      position: { x: centerX, y: 2 * (NODE_HEIGHT + V_GAP) },
      data: {
        node: collectorNode,
        index: workers.length + 1,
        orchestration,
        isSelected: selectedNodeKey === CONCURRENT_COLLECTOR_KEY,
        onSelect,
        onOpenThinking: () => {},
        isSynthetic: true,
      } as Record<string, unknown>,
    },
  ];

  // Fan-out: distributor → each worker.
  const fanOutEdges: Edge[] = workers.map((node, i) => ({
    id: `e-leader-${i + 1}`,
    source: leaderKey,
    target: getNodeKey(node, i + 1),
    animated: leader.status === 'running',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#6366f1', strokeWidth: 1.5 },
  }));

  // Fan-in: each worker → collector.
  const fanInEdges: Edge[] = workers.map((node, i) => ({
    id: `e-${i + 1}-collector`,
    source: getNodeKey(node, i + 1),
    target: CONCURRENT_COLLECTOR_KEY,
    animated: node.status === 'running',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: node.status === 'completed' ? '#818cf8' : '#94a3b8',
      strokeWidth: 1.5,
    },
  }));

  // Fallback edge when there are no workers.
  const noWorkerEdge: Edge[] = workers.length === 0 ? [{
    id: 'e-leader-collector',
    source: leaderKey,
    target: CONCURRENT_COLLECTOR_KEY,
    animated: leader.status === 'running',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#6366f1', strokeWidth: 1.5 },
  }] : [];

  return { rfNodes, rfEdges: [...fanOutEdges, ...fanInEdges, ...noWorkerEdge] };
}

function buildHandoffLayout(
  nodes: WorkflowTraceNode[],
  selectedNodeKey: string | null,
  onSelect: (k: string) => void,
  orchestration: string,
  onOpenThinking: (k: string) => void,
): { rfNodes: Node[]; rfEdges: Edge[] } {
  const rfNodes: Node[] = nodes.map((node, i) => ({
    id: getNodeKey(node, i),
    type: 'agentNode',
    position: { x: i % 2 === 0 ? 0 : NODE_WIDTH + H_GAP, y: i * (NODE_HEIGHT + V_GAP) },
    data: { node, index: i, orchestration, isSelected: selectedNodeKey === getNodeKey(node, i), onSelect, onOpenThinking } as Record<string, unknown>,
  }));
  const rfEdges: Edge[] = nodes.slice(1).map((node, i) => {
    const sourceNode = node.from_agent_id
      ? nodes.find((n) => n.agent_id === node.from_agent_id)
      : nodes[i];
    const sourceIdx = sourceNode ? nodes.indexOf(sourceNode) : i;
    const sourceKey = sourceNode ? getNodeKey(sourceNode, sourceIdx) : getNodeKey(nodes[i], i);
    const isActive = node.status === 'running';
    return {
      id: `e${sourceKey}-${getNodeKey(node, i + 1)}`,
      source: sourceKey,
      target: getNodeKey(node, i + 1),
      animated: isActive,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: isActive ? '#8b5cf6' : '#94a3b8', strokeWidth: isActive ? 2 : 1 },
    };
  });
  return { rfNodes, rfEdges };
}

function buildGroupChatLayout(
  nodes: WorkflowTraceNode[],
  selectedNodeKey: string | null,
  onSelect: (k: string) => void,
  orchestration: string,
  onOpenThinking: (k: string) => void,
): { rfNodes: Node[]; rfEdges: Edge[] } {
  const n = nodes.length;
  if (n === 0) return { rfNodes: [], rfEdges: [] };
  const radius = Math.max(120, n * 60);
  const rfNodes: Node[] = nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return {
      id: getNodeKey(node, i),
      type: 'agentNode',
      position: {
        x: radius + radius * Math.cos(angle) - NODE_WIDTH / 2,
        y: radius + radius * Math.sin(angle) - NODE_HEIGHT / 2,
      },
      data: { node, index: i, orchestration, isSelected: selectedNodeKey === getNodeKey(node, i), onSelect, onOpenThinking } as Record<string, unknown>,
    };
  });
  const rfEdges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      rfEdges.push({
        id: `e${i}-${j}`,
        source: getNodeKey(nodes[i], i),
        target: getNodeKey(nodes[j], j),
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#e879f9', opacity: 0.5 },
      });
    }
  }
  return { rfNodes, rfEdges };
}

function buildMagenticLayout(
  nodes: WorkflowTraceNode[],
  selectedNodeKey: string | null,
  onSelect: (k: string) => void,
  orchestration: string,
  onOpenThinking: (k: string) => void,
): { rfNodes: Node[]; rfEdges: Edge[] } {
  if (nodes.length === 0) return { rfNodes: [], rfEdges: [] };
  const [manager, ...workers] = nodes;
  const managerKey = getNodeKey(manager, 0);
  const n = workers.length;
  const radius = Math.max(140, n * 70);
  // Manager at center of the radial layout
  const centerX = radius;
  const centerY = radius;
  const rfNodes: Node[] = [
    {
      id: managerKey,
      type: 'agentNode',
      position: { x: centerX - NODE_WIDTH / 2, y: centerY - NODE_HEIGHT / 2 },
      data: { node: manager, index: 0, orchestration, isSelected: selectedNodeKey === managerKey, onSelect, onOpenThinking } as Record<string, unknown>,
    },
    ...workers.map((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
      return {
        id: getNodeKey(node, i + 1),
        type: 'agentNode',
        position: {
          x: centerX + radius * Math.cos(angle) - NODE_WIDTH / 2,
          y: centerY + radius * Math.sin(angle) - NODE_HEIGHT / 2,
        },
        data: { node, index: i + 1, orchestration, isSelected: selectedNodeKey === getNodeKey(node, i + 1), onSelect, onOpenThinking } as Record<string, unknown>,
      };
    }),
  ];
  const rfEdges: Edge[] = workers.map((node, i) => ({
    id: `e0-${i + 1}`,
    source: managerKey,
    target: getNodeKey(node, i + 1),
    animated: manager.status === 'running',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#f59e0b' },
  }));
  return { rfNodes, rfEdges };
}

function buildFlowLayout(
  orchestration: string,
  nodes: WorkflowTraceNode[],
  selectedNodeKey: string | null,
  onSelect: (k: string) => void,
  onOpenThinking: (k: string) => void,
): { rfNodes: Node[]; rfEdges: Edge[] } {
  if (orchestration === 'sequential') return buildSequentialLayout(nodes, selectedNodeKey, onSelect, orchestration, onOpenThinking);
  if (orchestration === 'concurrent') return buildConcurrentLayout(nodes, selectedNodeKey, onSelect, orchestration, onOpenThinking);
  if (orchestration === 'handoff') return buildHandoffLayout(nodes, selectedNodeKey, onSelect, orchestration, onOpenThinking);
  if (orchestration === 'group_chat') return buildGroupChatLayout(nodes, selectedNodeKey, onSelect, orchestration, onOpenThinking);
  if (orchestration === 'magentic') return buildMagenticLayout(nodes, selectedNodeKey, onSelect, orchestration, onOpenThinking);
  return buildSequentialLayout(nodes, selectedNodeKey, onSelect, orchestration, onOpenThinking);
}

const nodeTypes = { agentNode: AgentNode };

function WorkflowGraph({
  orchestration,
  nodes,
  selectedNodeKey,
  onSelectNode,
  onOpenThinking,
}: {
  orchestration: string;
  nodes: WorkflowTraceNode[];
  selectedNodeKey: string | null;
  onSelectNode: (nodeKey: string) => void;
  onOpenThinking: (nodeKey: string) => void;
}) {
  const tone = getOrchestrationTone(orchestration);

  const { rfNodes, rfEdges } = React.useMemo(
    () => buildFlowLayout(orchestration, nodes, selectedNodeKey, onSelectNode, onOpenThinking),
    [orchestration, nodes, selectedNodeKey, onSelectNode, onOpenThinking],
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(rfNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(rfEdges);

  // Sync external data updates (status, selection) into ReactFlow state without resetting viewport
  React.useEffect(() => {
    setFlowNodes(rfNodes);
    setFlowEdges(rfEdges);
  }, [rfNodes, rfEdges, setFlowNodes, setFlowEdges]);

  return (
    <div
      className={cn(
        'relative rounded-[28px] border border-dashed border-white/75 bg-white/58 overflow-hidden shadow-inner shadow-white/30',
      )}
      style={{ height: '380px' }}
    >
      <ReactFlow
        // key resets viewport (fitView) only when orchestration type or node count changes
        key={`${orchestration}-${nodes.length}`}
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgba(148,163,184,0.3)" />
        <Controls className="bottom-3! left-3! top-auto!" showInteractive={false} />
      </ReactFlow>
      <div className="pointer-events-none absolute right-3 top-3 z-10">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] backdrop-blur-sm',
            tone.badge,
          )}
        >
          {getOrchestrationLabel(orchestration)}
        </span>
      </div>
    </div>
  );
}

export function WorkflowResultCard({
  trace,
  onOpen,
}: {
  trace: WorkflowTraceDetail;
  onOpen: () => void;
}) {
  const tone = getOrchestrationTone(trace.orchestration);
  const Icon = tone.icon;
  const orderedNodes = filterWorkflowTraceNodes(sortWorkflowTraceNodes(trace.nodes ?? []), trace.orchestration);
  const summaryText = formatSummaryText(trace.summary || "Workflow completed without a summary.");

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative w-full cursor-pointer overflow-hidden rounded-[28px] border border-white/80 bg-linear-to-br p-5 text-left shadow-[0_20px_48px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_52px_rgba(79,70,229,0.14)]",
        tone.shell,
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 opacity-80", tone.glow)} />
      <div className="relative flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] border border-white/80 bg-white/85 text-slate-800 shadow-sm backdrop-blur-sm">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-950">Workflow Result</p>
            <Badge variant="secondary" className={cn("rounded-full border", tone.badge)}>
              {getOrchestrationLabel(trace.orchestration)}
            </Badge>
            <StatusBadge status={trace.status} />
          </div>
          <p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-slate-600">
            {summaryText}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {orderedNodes.length} node{orderedNodes.length === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {formatDateTime(trace.completed_at || trace.started_at)}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
              <PanelRight className="h-3.5 w-3.5" />
              Open workflow board
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

export function WorkflowTraceDialog({
  trace,
  open,
  isLoading,
  onOpenChange,
}: {
  trace: WorkflowTraceDetail | null;
  open: boolean;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const orderedNodes = React.useMemo(
    () => filterWorkflowTraceNodes(sortWorkflowTraceNodes(trace?.nodes ?? []), trace?.orchestration),
    [trace?.nodes, trace?.orchestration],
  );
  const [selectedNodeKey, setSelectedNodeKey] = React.useState<string | null>(null);
  const [isExpandedResponseOpen, setIsExpandedResponseOpen] = React.useState(false);
  const [isThinkingPanelOpen, setIsThinkingPanelOpen] = React.useState(false);

  React.useEffect(() => {
    if (orderedNodes.length === 0) {
      setSelectedNodeKey(null);
      return;
    }

    setSelectedNodeKey((current) => {
      if (current && orderedNodes.some((node, index) => getNodeKey(node, index) === current)) {
        return current;
      }

      return getNodeKey(orderedNodes[0], 0);
    });
  }, [orderedNodes, trace?.trace_id]);

  React.useEffect(() => {
    if (!open) {
      setIsExpandedResponseOpen(false);
      setIsThinkingPanelOpen(false);
    }
  }, [open]);

  const handleOpenThinking = React.useCallback(
    (nodeKey: string) => {
      setSelectedNodeKey(nodeKey);
      setIsThinkingPanelOpen(true);
    },
    [],
  );

  const selectedNode: WorkflowTraceNode | null = React.useMemo(() => {
    // Special case: Collector is a synthetic node — resolve it to a summary node.
    if (selectedNodeKey === CONCURRENT_COLLECTOR_KEY) {
      return {
        agent_id: CONCURRENT_COLLECTOR_KEY,
        agent_role: 'Collector',
        status: trace?.status ?? 'idle',
        response: trace?.summary ?? '',
        order: 9999,
      };
    }
    return (
      orderedNodes.find((node, index) => getNodeKey(node, index) === selectedNodeKey) ??
      orderedNodes[0] ??
      null
    );
  }, [selectedNodeKey, orderedNodes, trace?.summary, trace?.status]);

  const selectedNodeIndex = selectedNode
    ? orderedNodes.findIndex((node, index) => getNodeKey(node, index) === getNodeKey(selectedNode, orderedNodes.indexOf(selectedNode)))
    : -1;
  const selectedNodeStep = selectedNodeIndex >= 0 ? selectedNodeIndex + 1 : null;
  const selectedResponse = (selectedNode?.response || "").trim();
  const tone = getOrchestrationTone(trace?.orchestration || "concurrent");
  const Icon = tone.icon;
  const descriptionText = formatSummaryText(
    trace?.summary || "Inspect orchestration progress, routing order, and per-agent outputs in one place.",
  );
  const showLoadingState = isLoading && !trace;
  const scrollAreaClassName =
    "min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.75)_transparent] [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300/85 [&::-webkit-scrollbar-thumb]:bg-clip-padding hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/90";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[96vh] w-[min(96vw,92rem)] max-w-[min(96vw,92rem)] border-none bg-transparent p-0 shadow-none sm:max-w-[min(96vw,92rem)] [&>button:last-child]:right-6 [&>button:last-child]:top-6 [&>button:last-child]:rounded-full [&>button:last-child]:border [&>button:last-child]:border-white/70 [&>button:last-child]:bg-white/88 [&>button:last-child]:p-2 [&>button:last-child]:text-slate-600 [&>button:last-child]:shadow-sm [&>button:last-child]:backdrop-blur-sm [&>button:last-child]:hover:bg-white [&>button:last-child]:data-[state=open]:bg-white/90">
        <div className="relative h-full overflow-hidden rounded-[34px] p-px">
          <div className="pointer-events-none absolute inset-px rounded-[33px] bg-white/78" />
          <div className={cn("relative flex h-full min-h-0 flex-col overflow-hidden rounded-[33px] border border-white/70 bg-linear-to-br shadow-[0_30px_90px_rgba(15,23,42,0.16)]", tone.shell)}>
            <BorderBeam duration={6} size={380} colorFrom={tone.beamFrom} colorTo={tone.beamTo} />
            <BorderBeam
              duration={6}
              delay={3}
              size={420}
              borderWidth={2}
              reverse
              colorFrom={tone.beamTo}
              colorTo={tone.beamFrom}
            />
            <div className={cn("pointer-events-none absolute inset-0", tone.glow)} />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.82),transparent_32%)]" />

            {isThinkingPanelOpen && selectedNode ? (
              <ThinkingPanel
                node={selectedNode}
                onClose={() => setIsThinkingPanelOpen(false)}
              />
            ) : null}

            {isExpandedResponseOpen && selectedNode ? (
              <div className="absolute inset-0 z-30 overflow-hidden bg-slate-950/35 p-4 backdrop-blur-sm sm:p-6">
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-white/80 bg-white/96 shadow-[0_30px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Full response
                      </p>
                      <h3 className="mt-1 truncate text-xl font-semibold text-slate-950">
                        {selectedNode.agent_role || "Selected node"}
                      </h3>
                      <p className="mt-2 text-sm text-slate-500">
                        Markdown view for the full output from this node only.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsExpandedResponseOpen(false)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                    >
                      <Minimize2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className={cn("min-h-0 flex-1 px-5 py-5 sm:px-6 sm:py-6", scrollAreaClassName)}>
                    <ResponseBubble
                      content={selectedResponse || selectedNode?.error || "No response available for this node yet."}
                      className="min-h-full"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <DialogHeader className="relative shrink-0 border-b border-white/70 px-6 py-6 pr-18 text-left backdrop-blur-sm">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[22px] border border-white/80 bg-white/88 text-slate-900 shadow-sm">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                          {trace ? tone.eyebrow : "Workflow trace"}
                        </p>
                        <DialogTitle className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                          Workflow Board
                        </DialogTitle>
                      </div>
                    </div>
                    <DialogDescription className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-slate-600">
                      {descriptionText}
                    </DialogDescription>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {trace ? (
                      <>
                        <Badge variant="secondary" className={cn("rounded-full border", tone.badge)}>
                          {getOrchestrationLabel(trace.orchestration)}
                        </Badge>
                        <StatusBadge status={trace.status} />
                      </>
                    ) : null}
                  </div>
                </div>
            </DialogHeader>

            <div className="relative grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,400px)]">
                <div className={cn("min-w-0 px-6 py-6", scrollAreaClassName)}>
                  {showLoadingState ? (
                    <div className="flex min-h-96 items-center justify-center rounded-[28px] border border-dashed border-slate-200/80 bg-white/75">
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                        Loading workflow trace...
                      </div>
                    </div>
                  ) : trace ? (
                    <div className="space-y-6">
                      <div className="grid gap-3 md:grid-cols-3">
                        <OverviewStat label="Trace ID" value={trace.trace_id} icon={Activity} />
                        <OverviewStat label="Started" value={formatDateTime(trace.started_at)} icon={Clock3} />
                        <OverviewStat label="Completed" value={formatDateTime(trace.completed_at)} icon={Sparkles} />
                      </div>

                      <WorkflowGraph
                        orchestration={trace.orchestration}
                        nodes={orderedNodes}
                        selectedNodeKey={selectedNodeKey}
                        onSelectNode={setSelectedNodeKey}
                        onOpenThinking={handleOpenThinking}
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-96 items-center justify-center rounded-[28px] border border-dashed border-slate-200/80 bg-white/75 text-sm text-slate-500">
                      No workflow trace selected.
                    </div>
                  )}
                </div>

                <div className="min-h-0 border-t border-white/70 bg-white/78 backdrop-blur-md xl:border-l xl:border-t-0">
                  <div className={cn("h-full px-5 py-6", scrollAreaClassName)}>
                    {selectedNode ? (
                      <div className="space-y-5">
                        <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_14px_36px_rgba(15,23,42,0.06)]">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Node detail</p>
                              <h3 className="mt-2 text-xl font-semibold text-slate-950">
                                {selectedNode.agent_role || "Selected node"}
                              </h3>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {selectedNodeStep ? (
                                  <span className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                                    {isBoundaryNode(selectedNode) ? 'System stage' : `Step ${selectedNodeStep}`}
                                  </span>
                                ) : null}
                                {isBoundaryNode(selectedNode) ? (
                                  <span className="rounded-full border border-slate-300/80 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
                                    {selectedNode.agent_id === 'input-conversation' ? 'Workflow input' : 'Workflow output'}
                                  </span>
                                ) : null}
                                {selectedNode.is_leader ? (
                                  <span className="rounded-full border border-indigo-200/80 bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
                                    Leader
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <StatusBadge status={selectedNode.status} />
                          </div>

                          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                            <div className={cn("rounded-2xl border px-4 py-3", getStatusTone(selectedNode.status).panel)}>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Started</p>
                              <p className="mt-2 text-sm font-medium text-slate-800">
                                {formatDateTime(selectedNode.started_at)}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Completed</p>
                              <p className="mt-2 text-sm font-medium text-slate-800">
                                {formatDateTime(selectedNode.completed_at)}
                              </p>
                            </div>
                          </div>
                        </div>

                        {selectedResponse ? (
                          <section className="rounded-[24px] border border-white/80 bg-white/85 p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Full response</p>
                                <p className="mt-2 text-sm text-slate-500">
                                  {isBoundaryNode(selectedNode)
                                    ? 'Boundary-stage response captured for this workflow.'
                                    : 'Single response surface for this selected agent.'}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setIsExpandedResponseOpen(true)}
                                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                                aria-label="Open full response"
                              >
                                <Expand className="h-4 w-4" />
                              </button>
                            </div>

                            <ResponseBubble content={selectedResponse} className="mt-4" />
                          </section>
                        ) : null}

                        {selectedNode.error ? (
                          <section className="rounded-[24px] border border-rose-200/80 bg-rose-50/85 p-5 shadow-[0_10px_28px_rgba(190,24,93,0.08)]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-500">Error detail</p>
                            <ResponseBubble content={selectedNode.error} variant="error" className="mt-3" />
                          </section>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex min-h-80 items-center justify-center rounded-[28px] border border-dashed border-slate-200/80 bg-white/70 px-6 text-center text-sm text-slate-500">
                        Select a node in the workflow board to inspect its output and timing.
                      </div>
                    )}
                  </div>
                </div>
              </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function shouldRenderWorkflowResultCard(trace: WorkflowTraceDetail): boolean {
  return isTerminalWorkflowStatus(trace.status);
}
