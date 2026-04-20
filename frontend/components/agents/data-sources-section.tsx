"use client";

import { DataQualityGauge, getDataQualityColor } from "@/components/agent-builder/data-quality-gauge";
import { KnowledgeBaseDialog } from "@/components/agent-builder/knowledge-base-dialog";
import { MarkdownViewerDialog } from "@/components/agent-builder/markdown-viewer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    fetchAttachments,
    fetchEvaluationThunk,
} from "@/lib/features/agent/agentSlice";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import {
    BrainCircuit,
    Database,
    FileText,
    Globe,
    Loader2,
    Plus,
    Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Evaluation Progress Tracker component
// ---------------------------------------------------------------------------
function EvaluationProgress({ status }: { status?: string }) {
    if (!status || status === "completed" || status === "failed") return null;

    const stages = [
        { key: "initializing", label: "Preparing" },
        { key: "embedding", label: "Indexing" },
        { key: "analyzing", label: "Evaluating" },
        { key: "finalizing", label: "Finalizing" }
    ];

    const currentIdx = Math.max(0, stages.findIndex(s => status.toLowerCase().includes(s.key.toLowerCase())));

    return (
        <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5">
            <Loader2 className="h-3 w-3 animate-spin text-primary/70" />
            <div className="flex gap-1">
                {stages.map((stage, i) => (
                    <div 
                        key={stage.key}
                        className={cn(
                            "h-1.5 w-5 rounded-full transition-colors duration-300",
                            i <= currentIdx ? "bg-primary/70" : "bg-gray-200"
                        )}
                    />
                ))}
            </div>
            <span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">{stages[currentIdx].label}</span>
        </div>
    );
}

export function DataSourcesSection() {
    const dispatch = useAppDispatch();
    const { attachments, evaluation, selectedTeamId, activeSessionId, teams, executionSessions } = useAppSelector((state) => state.agent);
    
    const selectedTeam = teams.find((t) => t.id === selectedTeamId);
    const activeSession = executionSessions.find(s => s.session_id === activeSessionId);
    const teamName = selectedTeam?.name ?? (activeSession?.title || "Project Context");
    
    // Scope knowledge base to a session id only (never a team id).
    // Prefer the explicitly selected active session, then fallback to the team's latest session.
    const teamSessionId = selectedTeam?.sessions?.[0]?.session_id ?? null;
    const sessionId = activeSessionId ?? teamSessionId;

    // Knowledge Base Dialog State
    const [kbDialogOpen, setKbDialogOpen] = useState(false);
    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerAttachment, setViewerAttachment] = useState<{ id: string; name: string } | null>(null);

    const isUrl = (name: string) => name.startsWith("http");

    // Unified fetch logic with polling for evaluation
    useEffect(() => {
        if (!sessionId) return;
        
        dispatch(fetchAttachments(sessionId));
        dispatch(fetchEvaluationThunk({ referenceId: sessionId }));

        let pollInterval: NodeJS.Timeout;
        if (evaluation.isEvaluating) {
            pollInterval = setInterval(() => {
                dispatch(fetchEvaluationThunk({ referenceId: sessionId }));
            }, 3000);
        }

        return () => {
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [sessionId, evaluation.isEvaluating, dispatch]);

    const items = attachments.items;
    const filteredItems = useMemo(() => items, [items]);

    const totalItems = items.length;
    const embeddedCount = items.filter(a => a.is_embedded).length;
    
    // Heuristic fallback
    const heuristicScore = useMemo(() => {
        if (totalItems === 0) return 0;
        const base = 40;
        const bonus = Math.min(totalItems * 10, 30) + Math.min(embeddedCount * 10, 30);
        return Math.min(base + bonus, 100);
    }, [totalItems, embeddedCount]);

    const evaluationData = evaluation.data;
    const dataQualityScore = (evaluationData?.status === "completed" && evaluationData.overall_score !== undefined)
        ? Math.round(evaluationData.overall_score)
        : (totalItems > 0 ? (evaluationData?.overall_score ?? heuristicScore) : 0);

    const gaugeGlowColor = getDataQualityColor(dataQualityScore, dataQualityScore === 0);

    // Only show Knowledge Core if a specific team is selected
    if (selectedTeamId === null) return null;

    if (selectedTeamId !== null && !selectedTeam) {
        return (
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-3 px-8 py-20">
                <Loader2 className="h-7 w-7 animate-spin text-primary/70" />
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500">Loading Team Knowledge</p>
            </div>
        );
    }

    return (
        <div 
            key={`${selectedTeamId}-${activeSessionId}`} 
            className="w-full shrink-0 border-b border-gray-200 bg-white"
        >
            {/* ── Mobile compact bar (hidden on lg+) ── */}
            <div className="lg:hidden flex items-center gap-3 px-4 py-3 min-w-0">
                <div className="h-11 w-11 shrink-0">
                    <DataQualityGauge
                        score={dataQualityScore}
                        isEvaluating={evaluation.isEvaluating}
                        metrics={evaluation.data?.metrics}
                        hasUploads={totalItems > 0}
                        isLoading={attachments.isLoading}
                        isEmbedding={attachments.isEmbedding}
                        compact
                        className="border-none shadow-none bg-transparent"
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-gray-900 truncate">{teamName}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                        {totalItems} sources · {embeddedCount} live
                    </p>
                </div>
                <Button
                    size="sm"
                    className="h-11 shrink-0 gap-1.5 rounded-xl bg-purple-700 text-[11px] font-black uppercase tracking-wide text-white shadow-none hover:bg-purple-800 disabled:opacity-50"
                    onClick={() => setKbDialogOpen(true)}
                    disabled={!sessionId}
                >
                    <Plus className="h-3.5 w-3.5" />
                    Knowledge
                </Button>
            </div>

            {/* ── Desktop full layout (hidden below lg) ── */}
            <div className="hidden lg:block max-w-7xl mx-auto px-10 py-10 relative z-10 w-full min-w-0">
                <div className="flex flex-row items-stretch gap-16">
                    {/* Left Stack: Health & Identity */}
                    <div className="flex items-center gap-10 shrink-0 pr-12 border-r border-gray-200">
                        <div className="relative group shrink-0">
                            <div className="absolute -inset-3 rounded-full opacity-10" style={{ backgroundColor: gaugeGlowColor }} />
                            <div className="w-32 h-32 shrink-0 relative z-10">
                                <DataQualityGauge
                                    score={dataQualityScore}
                                    isEvaluating={evaluation.isEvaluating}
                                    metrics={evaluation.data?.metrics}
                                    hasUploads={totalItems > 0}
                                    isLoading={attachments.isLoading}
                                    isEmbedding={attachments.isEmbedding}
                                    className="border-none shadow-none bg-transparent"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 min-w-0">
                            <div className="flex items-center gap-3">
                                <Badge variant="secondary" className="border border-purple-100 bg-purple-50 text-purple-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest shrink-0">
                                    <Sparkles className="h-3 w-3 mr-1.5" />
                                    {teamName.split(' ')[0]}
                                </Badge>
                                <EvaluationProgress status={evaluation.data?.status} />
                            </div>
                            <h2 className="text-3xl font-black text-gray-900 tracking-tight truncate max-w-[320px] leading-tight">
                                {teamName}
                            </h2>
                            <div className="flex items-center gap-6 mt-1 text-[11px] font-black text-gray-400 uppercase tracking-widest">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-gray-900 text-sm">{totalItems}</span>
                                    <span>Sources</span>
                                </div>
                                <div className="h-4 w-px bg-gray-200" />
                                <div className="flex items-baseline gap-2">
                                    <span className={cn("text-sm", embeddedCount === totalItems && totalItems > 0 ? "text-emerald-600" : "text-amber-500")}>
                                        {embeddedCount}
                                    </span>
                                    <span>Live</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Stack: Controls & Repository */}
                    <div className="flex-1 flex flex-col xl:flex-row gap-10 items-stretch min-w-0">
                        {/* Middle Action Column */}
                        <div className="flex flex-col justify-center gap-4 w-full xl:w-[220px] shrink-0">
                            <Button
                                variant="default"
                                className="h-14 w-full rounded-2xl border-none bg-purple-700 px-6 text-white shadow-none transition-colors hover:bg-purple-800 disabled:hover:bg-purple-700"
                                onClick={() => setKbDialogOpen(true)}
                                disabled={!sessionId}
                            >
                                <Plus className="h-5 w-5 text-white" />
                                <span className="font-black uppercase tracking-widest text-[11px] whitespace-nowrap">
                                    {sessionId ? "Manage Knowledge" : "Select a Session"}
                                </span>
                            </Button>
                        </div>

                        {/* Large Scrollable Document Area */}
                        <div className="flex-1 min-w-0 flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-6 scrollbar-none">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                                        <Database className="h-4 w-4" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[12px] font-black text-gray-800 uppercase tracking-widest leading-none">Knowledge Base</span>
                                        <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">Session Knowledge Scope</span>
                                    </div>
                                </div>
                            </div>

                            <ScrollArea className="h-[140px] w-full">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-4 pb-2">
                                    {totalItems === 0 ? (
                                        <button 
                                            type="button"
                                            disabled={!sessionId}
                                            className="col-span-full flex h-full w-full flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-slate-50 py-6 text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-50"
                                            onClick={() => setKbDialogOpen(true)}
                                        >
                                            <BrainCircuit className="h-8 w-8 mb-2 opacity-30" />
                                            {sessionId ? "Empty Repository" : "Select Session"}
                                        </button>
                                    ) : (
                                        filteredItems.map((item) => {
                                            const isLink = isUrl(item.original_file_name);
                                            return (
                                                <button 
                                                    type="button"
                                                    key={item.id} 
                                                    className="group/repo-item flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition-colors duration-200 hover:border-purple-200 hover:bg-purple-50/40"
                                                    onClick={() => setKbDialogOpen(true)}
                                                >
                                                    <div className={cn(
                                                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white",
                                                        isLink ? 'bg-blue-50 text-blue-500' : 'bg-purple-50 text-purple-600'
                                                    )}>
                                                        {isLink ? <Globe className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-[11px] font-bold text-gray-700 truncate group-hover:text-purple-600 transition-colors">
                                                            {isLink ? item.original_file_name.replace(/^https?:\/\//, '') : item.original_file_name}
                                                        </p>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <div className={cn(
                                                                "h-1.5 w-1.5 rounded-full shrink-0",
                                                                item.is_embedded ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.3)]" : "bg-amber-400"
                                                            )} />
                                                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-tighter">
                                                                {item.is_embedded ? 'Live' : 'Ready'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                </div>
            </div>

            <KnowledgeBaseDialog
                open={kbDialogOpen}
                onOpenChange={setKbDialogOpen}
                setViewerOpen={setViewerOpen}
                setViewerAttachment={setViewerAttachment}
                providedSessionId={sessionId || undefined}
                title="Files for this team"
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
