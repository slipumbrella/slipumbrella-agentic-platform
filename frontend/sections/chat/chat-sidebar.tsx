"use client";

import { DataQualityGauge } from "@/components/agent-builder/data-quality-gauge";
import { KnowledgeBaseDialog } from "@/components/agent-builder/knowledge-base-dialog";
import { MarkdownViewerDialog } from "@/components/agent-builder/markdown-viewer-dialog";
import { ArtifactPreviewSheet } from "@/components/chat/artifact-preview-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
    deleteLineConfig,
    embedAttachments,
    fetchAttachments,
    fetchEvaluationThunk,
    saveLineConfig,
} from "@/lib/features/agent/agentSlice";
import type { Artifact } from "@/lib/features/chat/builderAPI";
import { downloadArtifact } from "@/lib/features/chat/builderAPI";
import { getOrchestrationLabel, sortAgentsByExecutionOrder } from "@/lib/features/chat/workflowTypes";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import {
    Bot,
    Box,
    BrainCircuit,
    Check,
    ChevronDown,
    Clock,
    Copy,
    Download,
    ExternalLink,
    Eye,
    FileSpreadsheet,
    FileText,
    Loader2,
    MessageSquare,
    Paperclip,
    Presentation,
    Sparkles,
    Unlink,
    Users,
    Wifi,
    WifiOff,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";

// ─── Section label ────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 px-0.5">
      {children}
    </p>
  );
}

// ─── File type icon and color ─────────────────────────────────────────────────
function getFileTypeInfo(fileType: string) {
  switch (fileType) {
    case "gdoc":
      return {
        icon: FileText,
        bgClass: "bg-blue-500/15",
        textClass: "text-blue-500",
        label: "Docs",
        gradient: "from-blue-500/10 to-blue-500/5",
      };
    case "gsheet":
      return {
        icon: FileSpreadsheet,
        bgClass: "bg-emerald-500/15",
        textClass: "text-emerald-500",
        label: "Sheets",
        gradient: "from-emerald-500/10 to-emerald-500/5",
      };
    case "gslide":
      return {
        icon: Presentation,
        bgClass: "bg-amber-500/15",
        textClass: "text-amber-500",
        label: "Slides",
        gradient: "from-amber-500/10 to-amber-500/5",
      };
    default:
      return {
        icon: FileText,
        bgClass: "bg-primary/15",
        textClass: "text-primary",
        label: fileType.toUpperCase(),
        gradient: "from-primary/10 to-primary/5",
      };
  }
}

function getArtifactOriginLabel(artifact: Artifact): string | null {
  const parts: string[] = [];

  if (artifact.created_by_agent_role && artifact.created_by_tool_name) {
    parts.push(`${artifact.created_by_agent_role} via ${artifact.created_by_tool_name}`);
  } else if (artifact.created_by_agent_role) {
    parts.push(artifact.created_by_agent_role);
  } else if (artifact.created_by_tool_name) {
    parts.push(artifact.created_by_tool_name);
  }

  if (artifact.source_session_id) {
    parts.push(`Session ${artifact.source_session_id.substring(0, 8)}`);
  } else if (artifact.source_planning_session_id) {
    parts.push(`Planning ${artifact.source_planning_session_id.substring(0, 8)}`);
  }

  if (artifact.resolution_source === "lineage_assignment") {
    parts.push("Recovered from lineage");
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ChatSidebar({ className, forceVisible = false }: { className?: string; forceVisible?: boolean }) {
  const dispatch = useAppDispatch();
  const { executionAgents } = useAppSelector((state) => state.agent);
  const { execSessionId, executionAgents: chatExecutionAgents, artifacts: execArtifacts, orchestrationType: supervisorOrchestration, googleSaEmail } =
    useAppSelector((state) => state.chat.supervisor);
  const { orchestrationType } = useAppSelector((state) => state.chat.builder);
  const { attachments, selectedTeamId, lineConfig, activeSessionId, evaluation } = useAppSelector((state) => state.agent);

  const activeAgents = sortAgentsByExecutionOrder(
    chatExecutionAgents.length > 0 ? chatExecutionAgents : executionAgents,
  );
  const activeOrchestration = supervisorOrchestration || orchestrationType;
  const knowledgeSessionId = execSessionId ?? activeSessionId;
  const allArtifacts = selectedTeamId ? [...execArtifacts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  ) : [];
  const embeddedCount = attachments.items.filter((attachment) => attachment.is_embedded).length;
  const totalCount = attachments.items.length;
  const pendingCount = Math.max(totalCount - embeddedCount, 0);
  const hasPendingEmbeddings = pendingCount > 0;
  const dataQualityScore = evaluation.data?.status === "completed"
    ? Math.round(evaluation.data.overall_score)
    : 0;
  const evaluationMetrics = evaluation.data?.status === "completed"
    ? evaluation.data.metrics
    : undefined;
  const knowledgeSummary = (() => {
    if (attachments.isUploading) {
      return "Uploading…";
    }
    if (attachments.isCrawling) {
      return "Reading website…";
    }
    if (attachments.isEmbedding) {
      return pendingCount > 0
        ? `Getting ${pendingCount} file${pendingCount !== 1 ? "s" : ""} ready…`
        : "Getting files ready…";
    }
    if (totalCount === 0) {
      return knowledgeSessionId
        ? "Add documents, PDFs, or websites"
        : "Select a session to add knowledge";
    }
    if (pendingCount === 0) {
      return `${embeddedCount} file${embeddedCount !== 1 ? "s" : ""} ready`;
    }

    return `${embeddedCount} ready · ${pendingCount} still processing`;
  })();
  const knowledgeTone = attachments.isEmbedding || attachments.isUploading || attachments.isCrawling
    ? "text-primary"
    : pendingCount === 0 && totalCount > 0
      ? "text-emerald-600"
      : "text-amber-700";

  const managerLabel = (agent: { is_leader?: boolean }, orchestration: string, index: number): string | null => {
    if (agent.is_leader) return "Leader";
    if (index !== 0) return null;
    if (orchestration === "magentic") return "Manager";
    if (orchestration === "handoff") return "Entry";
    return null;
  };

  // LINE state
  const [lineOpen, setLineOpen] = React.useState(false);
  const [lineToken, setLineToken] = React.useState("");
  const [lineSecret, setLineSecret] = React.useState("");
  const [webhookCopied, setWebhookCopied] = React.useState(false);
  const [previewArtifact, setPreviewArtifact] = React.useState<Artifact | null>(null);
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = React.useState(false);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [viewerAttachment, setViewerAttachment] = React.useState<{ id: string; name: string } | null>(null);

  const webhookUrl = selectedTeamId
    ? `${process.env.NEXT_PUBLIC_LINE_WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL}/webhooks/line?team_id=${selectedTeamId}`
    : "";

  React.useEffect(() => {
    if (!knowledgeSessionId) {
      return;
    }

    dispatch(fetchAttachments(knowledgeSessionId));
  }, [dispatch, knowledgeSessionId]);

  React.useEffect(() => {
    if (!knowledgeSessionId || attachments.syncingIds.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      dispatch(fetchAttachments(knowledgeSessionId));
    }, 3000);

    return () => clearInterval(interval);
  }, [dispatch, knowledgeSessionId, attachments.syncingIds.length]);

  React.useEffect(() => {
    if (!knowledgeSessionId || attachments.items.length === 0) {
      return;
    }

    const hasEmbeddings = attachments.items.some((attachment) => attachment.is_embedded);
    const hasCurrentEvaluationData = evaluation.data?.reference_id === knowledgeSessionId;
    if (hasEmbeddings && !evaluation.isEvaluating && !hasCurrentEvaluationData) {
      dispatch(fetchEvaluationThunk({ referenceId: knowledgeSessionId }));
    }
  }, [dispatch, knowledgeSessionId, attachments.items, evaluation.data, evaluation.isEvaluating]);

  React.useEffect(() => {
    if (!knowledgeSessionId || !evaluation.isEvaluating) {
      return;
    }

    const interval = setInterval(() => {
      dispatch(fetchEvaluationThunk({ referenceId: knowledgeSessionId }));
    }, 3000);

    return () => clearInterval(interval);
  }, [dispatch, knowledgeSessionId, evaluation.isEvaluating]);

  // Handlers
  const handleSaveLine = async () => {
    if (!selectedTeamId || !lineToken || !lineSecret) return;
    try {
      await dispatch(saveLineConfig({ teamId: selectedTeamId, accessToken: lineToken, channelSecret: lineSecret })).unwrap();
      setLineToken("");
      setLineSecret("");
      toast.success("LINE config saved");
    } catch {
      toast.error("Failed to save LINE config");
    }
  };

  const handleDeleteLine = async () => {
    if (!selectedTeamId) return;
    try {
      await dispatch(deleteLineConfig(selectedTeamId)).unwrap();
      toast.success("LINE config removed");
    } catch {
      toast.error("Failed to remove LINE config");
    }
  };

  const handleCopyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  };

  const handleEmbedKnowledge = async () => {
    if (!knowledgeSessionId || !hasPendingEmbeddings) {
      return;
    }

    const selectedIds = attachments.selectedIds.length > 0 ? attachments.selectedIds : undefined;
    try {
      const result = await dispatch(
        embedAttachments({
          referenceId: knowledgeSessionId,
          attachmentIds: selectedIds,
        }),
      ).unwrap();
      toast.success(result.message || "Your files are being prepared.");
      void dispatch(fetchEvaluationThunk({ referenceId: knowledgeSessionId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare the files.";
      toast.error(message);
    }
  };

  return (
    <>
    <aside className={cn("w-80 glass-sidebar border-l border-border/60 overflow-hidden shrink-0", forceVisible ? "flex flex-col" : "hidden xl:flex xl:flex-col", className)}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">Agent Team</p>
              <p className="text-[11px] text-muted-foreground truncate max-w-35 leading-tight mt-0.5">
                {execSessionId ? `Session ${execSessionId.substring(0, 8)}…` : "No session active"}
              </p>
            </div>
          </div>
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border",
            execSessionId
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-200/60 dark:border-emerald-500/30 dark:text-emerald-400"
              : "bg-muted text-muted-foreground border-border/60",
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              execSessionId ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40",
            )} />
            {execSessionId ? "Active" : "Idle"}
          </div>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

        {/* ── Knowledge ───────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-3.5 w-3.5 text-primary" />
            <SectionLabel>Files & Links</SectionLabel>
          </div>

          <div className="rounded-2xl border border-border/40 bg-muted/20 p-3">
            <div className="flex items-center gap-3">
              <DataQualityGauge
                score={dataQualityScore}
                metrics={evaluationMetrics}
                isEvaluating={evaluation.isEvaluating}
                hasUploads={totalCount > 0}
                isLoading={attachments.isLoading}
                isEmbedding={attachments.isEmbedding}
                compact
                className="shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-semibold text-foreground">Knowledge readiness</p>
                <p className={cn("text-[11px] leading-relaxed", totalCount === 0 ? "text-muted-foreground" : knowledgeTone)}>
                  {knowledgeSummary}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-10 justify-center gap-2 rounded-2xl border-purple-200 bg-purple-50/55 px-4 text-[11px] font-semibold text-purple-800 hover:bg-purple-100/70"
                onClick={() => setKnowledgeDialogOpen(true)}
                disabled={!knowledgeSessionId}
              >
                <Paperclip className="h-3.5 w-3.5" />
                Upload
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-10 justify-center gap-2 rounded-2xl border-border/60 bg-background px-4 text-[11px] font-semibold"
                onClick={handleEmbedKnowledge}
                disabled={!knowledgeSessionId || !hasPendingEmbeddings || attachments.isEmbedding}
              >
                {attachments.isEmbedding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <BrainCircuit className="h-3.5 w-3.5" />
                )}
                Embed
              </Button>
            </div>
          </div>
        </section>

        {/* ── Active Agents ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-primary" />
              <SectionLabel>Active Agents</SectionLabel>
            </div>
            <div className="flex items-center gap-1.5">
              {activeOrchestration && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 font-medium">
                  {getOrchestrationLabel(activeOrchestration)}
                </Badge>
              )}
              <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                {activeAgents.length}
              </span>
            </div>
          </div>

          {activeAgents.length === 0 ? (
            <div className="flex items-center gap-2.5 py-3 px-3 rounded-xl bg-muted/40 border border-border/40">
              <Bot className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              <p className="text-xs text-muted-foreground">No agents loaded yet</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {activeAgents.map((agent, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 p-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 border border-border/30 hover:border-primary/20 transition-all duration-200 cursor-default"
                >
                  <div className="relative shrink-0 mt-0.5">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-background bg-emerald-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-semibold text-foreground truncate">{agent.role}</p>
                      {managerLabel(agent, activeOrchestration, idx) && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-medium shrink-0">
                          {managerLabel(agent, activeOrchestration, idx)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Google Workspace ────────────────────────────────────────────────── */}
        <GoogleWorkspaceSection agents={activeAgents} saEmail={googleSaEmail} />

        <Separator className="opacity-50" />

        {/* ── Artifacts ──────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <SectionLabel>Artifacts</SectionLabel>
            </div>
            {allArtifacts.length > 0 && (
              <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                {allArtifacts.length}
              </span>
            )}
          </div>

          {allArtifacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 rounded-xl border border-dashed border-border/40 bg-muted/20">
              <Box className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-[11px] text-muted-foreground text-center">
                {selectedTeamId
                  ? "Team-wide artifacts will appear here"
                  : "Select a team-backed chat to view artifacts"}
              </p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1 -mr-1">
              {allArtifacts.map((artifact) => {
                const fileTypeInfo = getFileTypeInfo(artifact.file_type);
                const IconComponent = fileTypeInfo.icon;
                const originLabel = getArtifactOriginLabel(artifact);

                return (
                  <div
                    key={artifact.id}
                    className={cn(
                      "group relative flex items-center gap-3 p-3 rounded-xl border transition-all duration-200",
                      "bg-linear-to-br", fileTypeInfo.gradient,
                      "border-border/40 hover:border-primary/30 hover:shadow-sm"
                    )}
                  >
                    <div className={cn(
                      "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                      fileTypeInfo.bgClass,
                    )}>
                      <IconComponent className={cn("h-5 w-5", fileTypeInfo.textClass)} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-xs font-semibold text-foreground truncate leading-tight">
                        {artifact.title}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          "text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide",
                          fileTypeInfo.bgClass,
                          fileTypeInfo.textClass,
                        )}>
                          {fileTypeInfo.label}
                        </span>
                        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/70">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(artifact.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                          {" · "}
                          {new Date(artifact.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {originLabel ? (
                          <span className="text-[9px] text-muted-foreground/80">
                            {originLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {artifact.file_type === "local_doc" ? (
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          onClick={() => setPreviewArtifact(artifact)}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                            "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground",
                            "transition-all duration-200 cursor-pointer border-none"
                          )}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Preview
                        </button>
                        <button
                          onClick={() => {
                            downloadArtifact(artifact.id, artifact.title).catch(() => {
                              toast.error("Download failed");
                            });
                          }}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                            "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                            "transition-all duration-200 cursor-pointer border-none"
                          )}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </button>
                      </div>
                    ) : (
                      <a
                        href={artifact.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                          "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground",
                          "transition-all duration-200 shrink-0"
                        )}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── LINE Integration ───────────────────────────────────────────────── */}
        {selectedTeamId && (
          <>
            <Separator className="opacity-50" />

            <Collapsible open={lineOpen} onOpenChange={setLineOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex w-full items-center justify-between py-0.5 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-primary" />
                    <SectionLabel>LINE Integration</SectionLabel>
                  </div>
                  <div className="flex items-center gap-2">
                    {lineConfig.configured ? (
                      <Wifi className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <WifiOff className="h-3 w-3 text-muted-foreground/50" />
                    )}
                    <ChevronDown className={cn(
                      "h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200",
                      lineOpen && "rotate-180",
                    )} />
                  </div>
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="pt-3 space-y-3">
                {lineConfig.configured ? (
                  <div className="p-3 rounded-xl bg-emerald-500/8 border border-emerald-200/40 dark:border-emerald-500/20 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Connected</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10 px-2 cursor-pointer"
                        onClick={handleDeleteLine}
                      >
                        <Unlink className="h-3 w-3 mr-1" /> Disconnect
                      </Button>
                    </div>
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <p>Token: <span className="font-mono">{lineConfig.tokenPreview}</span></p>
                      <p>Secret: <span className="font-mono">{lineConfig.secretPreview}</span></p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-muted-foreground font-medium">Channel Access Token</Label>
                      <Input
                        placeholder="Enter token…"
                        value={lineToken}
                        onChange={(e) => setLineToken(e.target.value)}
                        className="h-8 text-xs bg-background/60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-muted-foreground font-medium">Channel Secret</Label>
                      <Input
                        placeholder="Enter secret…"
                        type="password"
                        value={lineSecret}
                        onChange={(e) => setLineSecret(e.target.value)}
                        className="h-8 text-xs bg-background/60"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                      onClick={handleSaveLine}
                      disabled={!lineToken || !lineSecret || lineConfig.status === "saving"}
                    >
                      {lineConfig.status === "saving" && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
                      Connect LINE Bot
                    </Button>
                  </div>
                )}

                {/* Webhook URL */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-muted-foreground font-medium">Webhook URL</Label>
                  <div className="flex gap-1.5">
                    <Input
                      readOnly
                      value={webhookUrl}
                      className="h-8 text-[10px] bg-background/40 text-muted-foreground font-mono"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 shrink-0 cursor-pointer"
                      onClick={handleCopyWebhook}
                      disabled={!webhookUrl}
                      aria-label="Copy webhook URL"
                    >
                      {webhookCopied
                        ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                        : <Copy className="h-3.5 w-3.5" />
                      }
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>
    </aside>
    <ArtifactPreviewSheet
      artifact={previewArtifact}
      open={previewArtifact !== null}
      onClose={() => setPreviewArtifact(null)}
      onDownload={() => {
        if (!previewArtifact) return;
        downloadArtifact(previewArtifact.id, previewArtifact.title).catch(() => {
          toast.error("Download failed");
        });
      }}
    />
    <KnowledgeBaseDialog
      open={knowledgeDialogOpen}
      onOpenChange={setKnowledgeDialogOpen}
      setViewerOpen={setViewerOpen}
      setViewerAttachment={setViewerAttachment}
      providedSessionId={knowledgeSessionId ?? undefined}
      title="Files for this session"
    />
    <MarkdownViewerDialog
      open={viewerOpen}
      onOpenChange={setViewerOpen}
      attachmentId={viewerAttachment?.id ?? null}
      fileName={viewerAttachment?.name ?? ""}
    />
    </>
  );
}

function GoogleWorkspaceSection({ agents, saEmail }: { agents: { tools?: string[] }[]; saEmail: string | null }) {
  const [saCopied, setSaCopied] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !saEmail) return null;

  const hasGW = agents.some(a => a.tools?.some((t: string) => t.startsWith('gdocs_') || t.startsWith('gsheets_') || t.startsWith('gslides_') || t.startsWith('gdrive_')));
  if (!hasGW) return null;

  const handleCopySA = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(saEmail);
    setSaCopied(true);
    setTimeout(() => setSaCopied(false), 2000);
  };

  return (
    <>
      <Separator className="opacity-50" />
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-amber-500 pt-1">
          <Sparkles className="h-3.5 w-3.5" />
          <SectionLabel>Google Workspace</SectionLabel>
        </div>
        
        <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-200/40 dark:border-amber-500/20 space-y-2.5">
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-amber-800 dark:text-amber-400">
              Team requires document access
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Invite this service account as an <b>Editor</b> to your documents:
            </p>
          </div>
          
          <div className="flex gap-1.5">
            <Input
              readOnly
              value={saEmail}
              className="h-8 text-[10px] bg-background/40 text-muted-foreground font-mono truncate"
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0 cursor-pointer"
              onClick={handleCopySA}
            >
              {saCopied
                ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                : <Copy className="h-3.5 w-3.5" />
              }
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
