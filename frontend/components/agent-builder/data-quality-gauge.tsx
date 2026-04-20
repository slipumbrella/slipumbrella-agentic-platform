"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import { CheckCircle2, Database, Loader2, XCircle } from "lucide-react";
import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";
import remarkGfm from "remark-gfm";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { NumberTicker } from "@/components/ui/number-ticker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface MetricResult {
    metric_name: string;
    score: number;
    passed: boolean;
    reason: string;
}

interface DataQualityGaugeProps {
    score: number;
    label?: string;
    className?: string;
    isEvaluating?: boolean;
    metrics?: MetricResult[];
    testCasesCount?: number;
    hasUploads?: boolean;
    isLoading?: boolean;
    systemPrompt?: string;
    isEmbedding?: boolean;
    compact?: boolean;
}

type DataQualityTone = "empty" | "healthy" | "warning" | "critical";

const DATA_QUALITY_TONES: Record<
    DataQualityTone,
    {
        chartColor: string;
        statusClassName: string;
        detailBadgeClassName: string;
        valueClassName: string;
        summaryLabel: string;
        detailLabel: string;
    }
> = {
    empty: {
        chartColor: "#E2E8F0",
        statusClassName: "border-slate-200 bg-slate-50 text-slate-400",
        detailBadgeClassName: "border-slate-200 bg-slate-50 text-slate-500",
        valueClassName: "text-slate-500",
        summaryLabel: "Waiting for Upload",
        detailLabel: "Awaiting Knowledge",
    },
    healthy: {
        chartColor: "#10B981",
        statusClassName: "border-emerald-100 bg-emerald-50 text-emerald-700",
        detailBadgeClassName: "border-emerald-100 bg-emerald-50 text-emerald-700",
        valueClassName: "text-emerald-600",
        summaryLabel: "Excellent Quality",
        detailLabel: "Optimal",
    },
    warning: {
        chartColor: "#F59E0B",
        statusClassName: "border-amber-100 bg-amber-50 text-amber-700",
        detailBadgeClassName: "border-amber-100 bg-amber-50 text-amber-700",
        valueClassName: "text-amber-600",
        summaryLabel: "Needs Improvement",
        detailLabel: "Refinement Needed",
    },
    critical: {
        chartColor: "#EF4444",
        statusClassName: "border-rose-100 bg-rose-50 text-rose-700",
        detailBadgeClassName: "border-rose-100 bg-rose-50 text-rose-700",
        valueClassName: "text-rose-600",
        summaryLabel: "Poor Quality",
        detailLabel: "Critical Failure",
    },
};

export function getDataQualityTone(score: number, isEmpty: boolean): DataQualityTone {
    if (isEmpty) return "empty";
    if (score >= 80) return "healthy";
    if (score >= 50) return "warning";
    return "critical";
}

export function getDataQualityColor(score: number, isEmpty: boolean) {
    return DATA_QUALITY_TONES[getDataQualityTone(score, isEmpty)].chartColor;
}

function getMetricTone(score: number): DataQualityTone {
    if (score >= 0.7) return "healthy";
    if (score >= 0.5) return "warning";
    return "critical";
}

function EvaluationAuditPanel({
    score,
    tone,
    color,
    metrics,
    systemPrompt,
}: {
    score: number;
    tone: DataQualityTone;
    color: string;
    metrics?: MetricResult[];
    systemPrompt?: string;
}) {
    const detailTone = DATA_QUALITY_TONES[tone];

    return (
        <ScrollArea className="max-h-[min(70vh,32rem)]">
            <div className="rounded-t-2xl border-b border-gray-200 bg-white p-4 pb-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                        <h4 className="text-[14px] font-extrabold tracking-tight text-gray-900">Evaluation Audit</h4>
                        <p className="text-[10px] font-medium text-gray-500">Quality breakdown for this knowledge base</p>
                    </div>
                    <span
                        className={cn(
                            "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                            detailTone.detailBadgeClassName,
                        )}
                    >
                        {detailTone.detailLabel}
                    </span>
                </div>

                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-tight text-gray-500">
                    <span>Signal Strength:</span>
                    <span className={cn("text-[14px] font-black", detailTone.valueClassName)} style={{ color }}>
                        {score}%
                    </span>
                </div>
            </div>

            <Accordion type="single" collapsible className="w-full">
                {Array.isArray(metrics) && metrics.map((metric, index) => {
                    const metricTone = DATA_QUALITY_TONES[getMetricTone(metric.score)];

                    return (
                        <AccordionItem key={index} value={`item-${index}`} className="border-b border-gray-100/80 px-2 last:border-b-0">
                            <AccordionTrigger className="mb-1 mt-1 rounded-xl px-2 py-3 transition-colors hover:bg-slate-50 hover:no-underline">
                                <div className="flex w-full items-center justify-between pr-3">
                                    <div className="flex items-center gap-2">
                                        {metric.passed ? (
                                            <div className="rounded-md border border-emerald-100 bg-emerald-50 p-0.5">
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                            </div>
                                        ) : (
                                            <div className="rounded-md border border-rose-100 bg-rose-50 p-0.5">
                                                <XCircle className="h-3.5 w-3.5 text-rose-500" />
                                            </div>
                                        )}
                                        <span className="text-[12.5px] font-bold tracking-tight text-gray-700">{metric.metric_name}</span>
                                    </div>
                                    <span className={cn("rounded-md border bg-white px-2 py-0.5 text-[12px] font-black shadow-xs", metricTone.valueClassName)}>
                                        {(metric.score * 100).toFixed(0)}%
                                    </span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="px-2 pb-3">
                                <div className="prose prose-sm mt-1 max-w-full rounded-xl border border-gray-100 bg-gray-50 p-4 text-[11.5px] leading-relaxed text-gray-600 shadow-inner prose-slate">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {metric.reason}
                                    </ReactMarkdown>
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}

                {systemPrompt ? (
                    <AccordionItem value="item-prompt" className="border-b-0 px-2 pb-2">
                        <AccordionTrigger className="rounded-xl px-2 py-3 transition-colors hover:bg-slate-50 hover:no-underline">
                            <div className="flex items-center gap-2">
                                <div className="rounded-md border border-slate-200 bg-slate-100 p-0.5">
                                    <Database className="h-3.5 w-3.5 text-slate-500" />
                                </div>
                                <span className="text-[12.5px] font-bold tracking-tight text-slate-600">System Guardrails</span>
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-2 pb-2">
                            <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50/50 p-3 font-mono text-[10px] leading-tight text-slate-500">
                                {systemPrompt}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                ) : null}
            </Accordion>
        </ScrollArea>
    );
}

export function DataQualityGauge({
    score,
    className,
    isEvaluating,
    metrics,
    hasUploads = false,
    isLoading,
    systemPrompt,
    isEmbedding,
    compact = false,
}: DataQualityGaugeProps) {
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const safeScore = isNaN(Number(score)) ? 0 : Number(score);
    const isEmpty = safeScore === 0 && (!metrics || metrics.length === 0);
    const isWaitingForEmbedding = hasUploads && isEmpty && !isEvaluating;
    const tone = getDataQualityTone(safeScore, isEmpty);
    const detailTone = DATA_QUALITY_TONES[tone];

    const color = getDataQualityColor(safeScore, isEmpty);
    const data = React.useMemo(
        () => [{ name: "score", value: safeScore, fill: color }],
        [safeScore, color],
    );
    const hasDetails = Boolean(metrics && metrics.length > 0);
    const chartSize = compact ? 56 : 128;
    const barSize = compact ? 8 : 10;

    if (isLoading) {
        return (
            <div className={cn("flex items-center justify-center", compact ? "p-0" : "flex-col p-4", className)}>
                <Skeleton className={cn("rounded-full", compact ? "h-11 w-11" : "h-32 w-32")} />
                {!compact ? <Skeleton className="h-4 w-24 rounded-full" /> : null}
            </div>
        );
    }

    const gaugeBody = (
        <div
            data-testid="data-quality-gauge-layout"
            className={cn(
                "relative",
                compact
                    ? "flex items-center justify-center"
                    : "flex flex-row items-center gap-2.5 sm:flex-col sm:gap-0",
            )}
        >
            <div className={cn("relative", compact ? "h-11 w-11" : "h-28 w-28 sm:h-28 sm:w-28 md:h-32 md:w-32")}>
                <div
                    data-testid="data-quality-gauge-chart"
                    className={cn(
                        "absolute inset-0 flex items-center justify-center",
                        compact ? "scale-100" : "scale-[0.82] sm:scale-[0.875] md:scale-100",
                    )}
                >
                    <RadialBarChart
                        width={chartSize}
                        height={chartSize}
                        cx="50%"
                        cy="50%"
                        innerRadius="80%"
                        outerRadius="100%"
                        barSize={barSize}
                        data={data}
                        startAngle={180}
                        endAngle={0}
                    >
                        <PolarAngleAxis
                            type="number"
                            domain={[0, 100]}
                            angleAxisId={0}
                            tick={false}
                        />
                        <RadialBar
                            background
                            dataKey="value"
                            cornerRadius={barSize / 2}
                            isAnimationActive={false}
                        />
                    </RadialBarChart>
                </div>

                <div className={cn("absolute inset-0 flex flex-col items-center justify-center", compact ? "" : "pt-2 sm:pt-4")}>
                    {isEvaluating ? (
                        compact ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary opacity-70" />
                        ) : (
                            <>
                                <Loader2 className="mb-0.5 h-5 w-5 animate-spin text-primary opacity-70 sm:mb-1 sm:h-7 sm:w-7" />
                                <span className="px-2 text-center text-[9px] font-bold uppercase tracking-wider text-primary animate-pulse sm:text-[10px]">
                                    Evaluating
                                </span>
                            </>
                        )
                    ) : isEmbedding ? (
                        compact ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary opacity-70" />
                        ) : (
                            <>
                                <Loader2 className="mb-0.5 h-5 w-5 animate-spin text-primary opacity-70 sm:mb-1 sm:h-7 sm:w-7" />
                                <span className="px-2 text-center text-[9px] font-bold uppercase tracking-wider text-primary animate-pulse sm:text-[10px]">
                                    Embedding...
                                </span>
                            </>
                        )
                    ) : isWaitingForEmbedding ? (
                        compact ? (
                            <Database className="h-3.5 w-3.5 text-amber-500" />
                        ) : (
                            <>
                                <Database className="mb-0.5 h-4 w-4 text-amber-400 sm:mb-1 sm:h-6 sm:w-6" />
                                <span className="px-2 text-center text-[8px] font-bold uppercase tracking-wider text-amber-600 sm:text-[9px]">
                                    Waiting for Embedding
                                </span>
                            </>
                        )
                    ) : isEmpty ? (
                        compact ? (
                            <span className="text-[10px] font-bold text-slate-300">--</span>
                        ) : (
                            <>
                                <span className="text-lg font-bold text-slate-300 sm:text-2xl">--</span>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 sm:text-[10px]">
                                    Await Data
                                </span>
                            </>
                        )
                    ) : compact ? (
                        <span className="text-[11px] font-bold tracking-tight" style={{ color }}>
                            {safeScore}%
                        </span>
                    ) : (
                        <span className="text-[1.2rem] font-bold tracking-tighter sm:text-3xl" style={{ color }}>
                            <NumberTicker value={safeScore} style={{ color }} />%
                        </span>
                    )}
                </div>
            </div>

            {!compact ? (
                <p
                    data-testid="data-quality-gauge-status"
                    className={cn(
                        "hidden max-w-[7.5rem] rounded-full border px-2 py-1 text-center text-[8px] font-black uppercase tracking-[0.18em] leading-tight shadow-sm transition-colors sm:block sm:max-w-none sm:text-[10px]",
                        isEvaluating || isEmbedding
                            ? "border-primary/20 bg-primary/5 text-primary animate-pulse"
                            : isWaitingForEmbedding
                                ? "border-amber-100 bg-amber-50 text-amber-600"
                                : detailTone.statusClassName,
                    )}
                >
                    {isEvaluating ? "Analyzing Quality..." : isEmbedding ? "Embedding Data..." : isWaitingForEmbedding ? "Waiting for Embedding" : detailTone.summaryLabel}
                </p>
            ) : null}
        </div>
    );

    const auditDetails = hasDetails ? (
        <EvaluationAuditPanel
            score={safeScore}
            tone={tone}
            color={color}
            metrics={metrics}
            systemPrompt={systemPrompt}
        />
    ) : null;

    return (
        <div
            id="quality-gauge"
            className={cn("flex flex-col items-center justify-center p-0", className)}
            aria-label={isEmpty ? "Data quality waiting for uploads" : `Data quality score ${safeScore}%`}
        >
            {compact ? (
                gaugeBody
            ) : (
                <div className="flex flex-col items-center">
                    <HoverCard openDelay={200} closeDelay={100}>
                        <HoverCardTrigger asChild>{gaugeBody}</HoverCardTrigger>

                        {hasDetails && !isEvaluating ? (
                            <HoverCardContent
                                className="z-50 w-[380px] overflow-hidden rounded-2xl border border-gray-200 bg-white p-0 shadow-lg animate-in zoom-in-95 duration-200"
                                align="start"
                                side="left"
                                sideOffset={10}
                            >
                                {auditDetails}
                            </HoverCardContent>
                        ) : null}
                    </HoverCard>

                    {hasDetails && !isEvaluating ? (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="mt-2 h-9 rounded-full px-3 text-[11px] font-semibold text-gray-500 shadow-none hover:bg-slate-100 hover:text-gray-900"
                                onClick={() => setDetailsOpen(true)}
                            >
                                View audit details
                            </Button>

                            <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
                                <DialogContent className="max-w-2xl rounded-[28px] border border-gray-200 bg-white p-0 shadow-xl">
                                    <DialogHeader className="sr-only">
                                        <DialogTitle>Evaluation Audit</DialogTitle>
                                        <DialogDescription>
                                            Detailed quality breakdown for the current knowledge base.
                                        </DialogDescription>
                                    </DialogHeader>
                                    {auditDetails}
                                </DialogContent>
                            </Dialog>
                        </>
                    ) : null}
                </div>
            )}
        </div>
    );
}
