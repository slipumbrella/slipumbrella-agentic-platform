"use client";

import {
    formatModelTag,
    getFirstSentence,
    getPrimaryModelTag,
    type BuilderModelOption,
} from "@/components/agent-builder/config-utils";
import { DataQualityGauge } from "@/components/agent-builder/data-quality-gauge";
import { MarkdownViewerDialog } from "@/components/agent-builder/markdown-viewer-dialog";
import { SpecialistConfigDialog } from "@/components/agent-builder/specialist-config-dialog";
import { Button } from "@/components/ui/button";
import { type CarouselApi } from "@/components/ui/carousel";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    fetchAttachments,
    fetchEvaluationThunk,
} from "@/lib/features/agent/agentSlice";
import {
    fetchActiveBuilderModels,
    fetchModelAssignments,
    saveModelAssignmentsDraft,
    type ModelAssignmentsState,
} from "@/lib/features/chat/builderAPI";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { Bot, Info, Loader2, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { KnowledgeBaseDialog } from "@/components/agent-builder/knowledge-base-dialog";

export function ConfigSidebar({ className }: { className?: string }) {
  const dispatch = useAppDispatch();
  const { attachments, evaluation } = useAppSelector(
    (state) => state.agent,
  );
  const {
    sessionId,
    messages,
    availableSpecialists,
    isSwitchingSession,
    orchestrationType,
    isTutorialActive,
    tutorialStep,
  } = useAppSelector(
    (state) => state.chat.builder,
  );
  const hasStarted = messages.length > 0 || isSwitchingSession || !!sessionId;
  const shouldShowSidebar = hasStarted || (isTutorialActive && tutorialStep >= 1);

  const orchestrationMap: Record<string, { label: string; desc: string }> = {
    sequential: {
      label: "Sequential",
      desc: "Each specialist performs their task in a specific order, passing results to the next step.",
    },
    concurrent: {
      label: "Concurrent",
      desc: "Multiple specialists work on different aspects of your request simultaneously to save time.",
    },
    group_chat: {
      label: "Group Chat",
      desc: "Specialists collaborate in a shared workspace to collectively solve complex problems.",
    },
    handoff: {
      label: "Handoff",
      desc: "The task is transferred between specialized experts as it moves through different stages.",
    },
    magentic: {
      label: "Dynamic",
      desc: "The system intelligently determines the best specialist for each part of the task in real-time.",
    },
  };

  const currentOrchestration = orchestrationMap[orchestrationType] || null;

  const [viewerOpen, setViewerOpen] = useState(false);
  const [kbDialogOpen, setKbDialogOpen] = useState(false);
  const [builderModels, setBuilderModels] = useState<BuilderModelOption[]>([]);
  const [modelAssignments, setModelAssignments] = useState<ModelAssignmentsState | null>(null);
  const [isLoadingModelAssignments, setIsLoadingModelAssignments] = useState(false);
  const [isSavingModelAssignments, setIsSavingModelAssignments] = useState(false);
  const [modelAssignmentError, setModelAssignmentError] = useState<string | null>(null);
  const [isCarouselOpen, setIsCarouselOpen] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [viewerAttachment, setViewerAttachment] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [carouselApi] = useState<CarouselApi>();
  const modelSaveRequestRef = useRef(0);
  const specialistIdsKey = availableSpecialists.map((item) => item.id).join("|");

  // Fetch attachments when session is ready
  useEffect(() => {
    if (sessionId) {
      dispatch(fetchAttachments(sessionId));
    }
  }, [sessionId, dispatch]);

  // Keep attachment embedding status fresh while background embedding is in progress.
  useEffect(() => {
    if (!sessionId || attachments.syncingIds.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      dispatch(fetchAttachments(sessionId));
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionId, attachments.syncingIds.length, dispatch]);

  const isKnowledgeTutorialStep =
    isTutorialActive && tutorialStep >= 2 && tutorialStep <= 4;
  const isKnowledgeDialogOpen = kbDialogOpen || isKnowledgeTutorialStep;

  useEffect(() => {
    if (!sessionId || availableSpecialists.length === 0) {
      setBuilderModels([]);
      setModelAssignments(null);
      setIsLoadingModelAssignments(false);
      setModelAssignmentError(null);
      return;
    }

    let ignore = false;
    setIsLoadingModelAssignments(true);
    setModelAssignmentError(null);

    void Promise.all([
      fetchActiveBuilderModels(),
      fetchModelAssignments(sessionId),
    ])
      .then(([models, assignments]) => {
        if (ignore) {
          return;
        }
        setBuilderModels(models);
        setModelAssignments(assignments);
      })
      .catch((error: unknown) => {
        if (ignore) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load builder model choices";
        setModelAssignmentError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!ignore) {
          setIsLoadingModelAssignments(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [sessionId, specialistIdsKey, availableSpecialists.length]);

  // Fetch evaluation when embeddings exist
  useEffect(() => {
    if (!sessionId || attachments.items.length === 0) {
      return;
    }

    const hasEmbeddings = attachments.items.some(a => a.is_embedded);
    const hasEvaluationData = evaluation.data?.reference_id === sessionId;
    if (hasEmbeddings && !evaluation.isEvaluating && !hasEvaluationData) {
      dispatch(fetchEvaluationThunk({ referenceId: sessionId }));
    }
  }, [sessionId, attachments.items, dispatch, evaluation.isEvaluating, evaluation.data]);

  // Poll evaluation while backend is running; this is a fallback when SSE event delivery is interrupted.
  useEffect(() => {
    if (!sessionId || !evaluation.isEvaluating) {
      return;
    }

    const interval = setInterval(() => {
      dispatch(fetchEvaluationThunk({ referenceId: sessionId }));
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionId, evaluation.isEvaluating, dispatch]);

  // SSE is optional; polling above is the reliable source of truth for status transitions.
  // Stream endpoint can return 404 while embeddings are still being prepared, which is expected.

  useEffect(() => {
    if (!carouselApi) return;
    const onSelect = () => {
      setCarouselIndex(carouselApi.selectedScrollSnap());
    };
    carouselApi.on("select", onSelect);
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi]);

  useEffect(() => {
    if (isCarouselOpen && carouselApi) {
      carouselApi.scrollTo(carouselIndex, true);
    }
  }, [carouselApi, carouselIndex, isCarouselOpen]);

  const dataQualityScore =
    evaluation.data?.status === "completed"
      ? Math.round(evaluation.data.overall_score)
      : 0;

  const evaluationMetrics = evaluation.data?.status === "completed"
    ? evaluation.data.metrics
    : undefined;
  const testCasesCount = evaluation.data?.test_cases_count;

  const hasPendingEmbeddings = attachments.items.length > 0 &&
    attachments.items.some(a => !a.is_embedded);

  const embeddedCount = attachments.items.filter(a => a.is_embedded).length;
  const totalCount = attachments.items.length;
  const pendingCount = Math.max(totalCount - embeddedCount, 0);
  const isSyncing = attachments.isLoading || attachments.isUploading || attachments.isEmbedding;
  const filesSummary = (() => {
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
      return "Add documents, PDFs, or websites";
    }
    if (pendingCount === 0) {
      return `${embeddedCount} file${embeddedCount !== 1 ? "s" : ""} ready`;
    }

    return `${embeddedCount} ready · ${pendingCount} still processing`;
  })();
  const filesStatusTone = attachments.isEmbedding || attachments.isUploading || attachments.isCrawling
    ? "text-primary"
    : pendingCount === 0 && totalCount > 0
      ? "text-green-600"
      : "text-amber-700";

  const getModelOption = (modelId?: string | null) =>
    builderModels.find((item) => item.id === modelId);
  const activeModelIds = new Set(
    builderModels.filter((item) => item.is_active).map((item) => item.id),
  );
  const isActiveModelId = (modelId?: string | null) =>
    !!modelId && activeModelIds.has(modelId);

  const updateModelAssignments = async (
    nextBaseline: Record<string, string>,
    nextOverrides: Record<string, string>,
  ) => {
    if (!sessionId || !modelAssignments) {
      return;
    }

    const previousState = modelAssignments;
    const optimisticState: ModelAssignmentsState = {
      ...previousState,
      baseline: nextBaseline,
      overrides: nextOverrides,
      final: {
        ...nextBaseline,
        ...nextOverrides,
      },
      confirmed: false,
      reviewed_at: null,
      confirmed_at: null,
    };

    const requestId = modelSaveRequestRef.current + 1;
    modelSaveRequestRef.current = requestId;

    setModelAssignments(optimisticState);
    setIsSavingModelAssignments(true);
    setModelAssignmentError(null);

    try {
      const savedState = await saveModelAssignmentsDraft(sessionId, {
        baseline: nextBaseline,
        overrides: nextOverrides,
      });
      if (modelSaveRequestRef.current === requestId) {
        setModelAssignments(savedState);
      }
    } catch (error: unknown) {
      if (modelSaveRequestRef.current === requestId) {
        setModelAssignments(previousState);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to save model assignments";
        setModelAssignmentError(message);
        toast.error(message);
      }
    } finally {
      if (modelSaveRequestRef.current === requestId) {
        setIsSavingModelAssignments(false);
      }
    }
  };

  const handleAgentModelChange = async (agentId: string, modelId: string) => {
    if (!modelAssignments) {
      return;
    }
    if (!isActiveModelId(modelId)) {
      toast.error("Choose an active model for this specialist.");
      return;
    }

    const nextOverrides = { ...modelAssignments.overrides };
    if (modelAssignments.baseline[agentId] === modelId) {
      delete nextOverrides[agentId];
    } else {
      nextOverrides[agentId] = modelId;
    }

    await updateModelAssignments(modelAssignments.baseline, nextOverrides);
  };

  const handleApplyModelToAll = async (modelId: string) => {
    if (!modelAssignments) {
      return;
    }
    if (!isActiveModelId(modelId)) {
      toast.error("Pick an active model before applying it to all specialists.");
      return;
    }

    const nextOverrides: Record<string, string> = {};
    for (const specialist of availableSpecialists) {
      if (modelAssignments.baseline[specialist.id] !== modelId) {
        nextOverrides[specialist.id] = modelId;
      }
    }

    await updateModelAssignments(modelAssignments.baseline, nextOverrides);
  };

  const handleResetAgentModel = async (agentId: string) => {
    if (!modelAssignments?.overrides[agentId]) {
      return;
    }

    const nextOverrides = { ...modelAssignments.overrides };
    delete nextOverrides[agentId];

    await updateModelAssignments(modelAssignments.baseline, nextOverrides);
  };

  const handleResetAllModels = async () => {
    if (!modelAssignments || Object.keys(modelAssignments.overrides).length === 0) {
      return;
    }

    await updateModelAssignments(modelAssignments.baseline, {});
  };

  const handleConfigOpenChange = (open: boolean) => {
    if (!open) {
      setIsCarouselOpen(false);
    }
  };

  return (
    <div
      className={[
        "w-full md:w-[19rem] xl:w-80 glass-sidebar border-l border-gray-200/60 flex flex-col shrink-0 h-full overflow-y-auto md:overflow-hidden",
        shouldShowSidebar ? "animate-in fade-in slide-in-from-right-5 duration-700 fill-mode-forwards" : "hidden",
        className,
      ].filter(Boolean).join(" ")}
    >
      <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-3 md:gap-5 md:py-5 xl:px-5">
        <section id="quality-gauge" className="shrink-0 space-y-1 md:space-y-2">
          <div className="space-y-1 px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
              Readiness
            </p>
            <p className="text-[11px] leading-relaxed text-gray-600 md:text-[12px]">
              Check if the team is ready.
            </p>
          </div>
          <DataQualityGauge
            score={dataQualityScore}
            isEvaluating={evaluation.isEvaluating}
            metrics={evaluationMetrics}
            testCasesCount={testCasesCount}
            hasUploads={totalCount > 0}
            isLoading={isSwitchingSession || attachments.isLoading}
            isEmbedding={attachments.isEmbedding}
          />
        </section>

        <section
          id="agent-specialists-section"
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div className="space-y-3 px-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                  Team
                </p>
                <div className="space-y-1">
                  <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">
                    Agent Specialists
                  </h3>
                  <p className="max-w-[18rem] text-[12px] leading-relaxed text-gray-600">
                    Review the team before launch.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 self-start sm:max-w-[184px] sm:justify-end">
                <span className="inline-flex min-h-9 items-center rounded-full border border-purple-100 bg-purple-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-purple-700">
                  {availableSpecialists.length} Experts
                </span>
                {availableSpecialists.length > 0 && !isSwitchingSession && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 rounded-full border-gray-200 bg-white px-4 text-[11px] font-semibold text-gray-700 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700"
                    onClick={() => { setCarouselIndex(0); setIsCarouselOpen(true); }}
                    disabled={isLoadingModelAssignments || isSwitchingSession}
                  >
                    Configure
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {currentOrchestration && (
                <HoverCard openDelay={200}>
                  <HoverCardTrigger asChild>
                    <div className="inline-flex w-fit cursor-help items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[10px] font-medium text-gray-600 transition-colors hover:border-purple-200 hover:bg-purple-50/70 hover:text-purple-600">
                      <span>{currentOrchestration.label} Mode</span>
                      <Info className="h-3 w-3 text-gray-300 group-hover/orch:text-purple-500" />
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="right"
                    align="start"
                    className="w-64 border-purple-100 p-3.5 shadow-xl"
                  >
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-700">
                        {currentOrchestration.label} orchestration
                      </p>
                      <p className="text-[12px] leading-relaxed text-gray-600">
                        {currentOrchestration.desc}
                      </p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}
              {modelAssignments && Object.keys(modelAssignments.overrides).length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px] text-purple-700 hover:bg-purple-50 disabled:text-gray-300"
                  onClick={() => void handleResetAllModels()}
                  disabled={isSavingModelAssignments}
                >
                  Undo model changes
                </Button>
              )}
            </div>
          </div>

          {modelAssignmentError && (
            <div className="mx-1 rounded-2xl border border-rose-100 bg-rose-50/80 px-3 py-2.5 text-[11px] text-rose-600 shadow-sm">
              {modelAssignmentError}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar scrollbar-stable">
            <div className="flex flex-col gap-2.5 px-1 pb-4">
              {isSwitchingSession ? (
                <>
                  <Skeleton className="h-[42px] w-full rounded-2xl border border-white/40" />
                  <Skeleton className="h-[42px] w-full rounded-2xl border border-white/40" />
                  <Skeleton className="h-[42px] w-full rounded-2xl border border-white/40" />
                </>
              ) : availableSpecialists.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-[28px] border border-dashed border-gray-200 bg-gray-50/80 px-5 py-10 text-center">
                  <Bot className="mb-3 h-10 w-10 stroke-[1.5px] text-gray-400" />
                  <p className="text-[13px] font-medium text-gray-600">
                    Start the conversation to generate your specialist team.
                  </p>
                  <p className="mt-1 max-w-[16rem] text-[11px] leading-relaxed text-gray-500">
                    The builder will suggest roles here once it understands the job.
                  </p>
                </div>
              ) : (
                availableSpecialists.map(
                  (item: { id: string; label: string; desc: string; tools?: string[] }, idx: number) => {
                    const currentModelId =
                      modelAssignments?.final[item.id] ??
                      modelAssignments?.baseline[item.id] ??
                      "";
                    const currentModel = getModelOption(currentModelId);
                    const isChanged = !!modelAssignments?.overrides[item.id];
                    const tag = currentModel ? formatModelTag(getPrimaryModelTag(currentModel.tags)) : null;

                    return (
                      <div
                        key={item.id}
                        className="group relative cursor-pointer select-none overflow-hidden rounded-[24px] border border-gray-200 bg-white transition-all duration-200 hover:border-purple-200 hover:bg-purple-50/40 hover:shadow-sm"
                        onClick={() => { setCarouselIndex(idx); setIsCarouselOpen(true); }}
                      >
                        <div className="relative flex items-start gap-3 p-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-purple-100 bg-purple-50 text-purple-700 transition-colors duration-200 group-hover:border-purple-200 group-hover:bg-white">
                            <Bot className="h-4.5 w-4.5" />
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <p className="text-[13px] font-semibold leading-tight text-gray-900">
                                  {item.label}
                                </p>
                                <p className="text-[11px] leading-snug text-gray-500 line-clamp-2">
                                  {getFirstSentence(item.desc, 88)}
                                </p>
                              </div>
                              {isChanged && (
                                <span className="mt-0.5 inline-flex shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-purple-700">
                                  Edited
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">
                              {currentModel ? (
                                <>
                                  <span className="text-[10px] font-medium text-gray-600">
                                    {currentModel.name}
                                  </span>
                                  {tag && (
                                    <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-purple-700">
                                      {tag}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-[10px] italic text-gray-400">
                                  Waiting for Builder
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  },
                )
              )}
            </div>
          </div>
        </section>

        <section id="config-sidebar-knowledge" className="shrink-0 space-y-3 border-t border-gray-200/70 pt-4">
          <div className="space-y-1 px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
              Files & Links
            </p>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-[14px] font-semibold text-gray-900">Context Sources</h3>
                <p className={`max-w-[15rem] text-[11px] leading-relaxed ${totalCount === 0 ? "text-gray-500" : filesStatusTone}`}>
                  {filesSummary}
                </p>
              </div>
              {!isSyncing && totalCount > 0 && (
                <span className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full bg-purple-50 px-2 text-[10px] font-semibold text-purple-700">
                  {totalCount}
                </span>
              )}
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-11 w-full justify-start gap-2 rounded-2xl border-purple-200 bg-purple-50/55 px-4 text-[12px] font-semibold text-purple-800 hover:bg-purple-100/70"
            onClick={() => setKbDialogOpen(true)}
          >
            <Paperclip className="h-4 w-4" />
            Open files manager
            {isSyncing && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-primary" />}
          </Button>
        </section>
      </div>

      <SpecialistConfigDialog
        isOpen={isCarouselOpen}
        onOpenChange={handleConfigOpenChange}
        availableSpecialists={availableSpecialists}
        modelAssignments={modelAssignments}
        builderModels={builderModels}
        isLoading={isLoadingModelAssignments}
        isSaving={isSavingModelAssignments}
        error={modelAssignmentError}
        onModelChange={handleAgentModelChange}
        onResetModel={handleResetAgentModel}
        onApplyToAll={handleApplyModelToAll}
        initialIndex={carouselIndex}
        carouselIndex={carouselIndex}
        onCarouselIndexChange={setCarouselIndex}
      />

      <KnowledgeBaseDialog
        open={isKnowledgeDialogOpen}
        onOpenChange={(open) => {
          if (!isKnowledgeTutorialStep) {
            setKbDialogOpen(open);
          }
        }}
        setViewerOpen={setViewerOpen}
        setViewerAttachment={setViewerAttachment}
      />

      <MarkdownViewerDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        attachmentId={viewerAttachment?.id ?? null}
        fileName={viewerAttachment?.name ?? ""}
      />
    </div>
  );
}
