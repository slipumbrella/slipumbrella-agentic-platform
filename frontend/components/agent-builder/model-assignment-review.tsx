"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  BuilderModelOption,
  ModelAssignmentsState,
} from "@/lib/features/chat/builderAPI";

type SpecialistReviewItem = {
  id: string;
  label: string;
  desc: string;
  tools?: string[];
};

type ModelAssignmentReviewProps = {
  specialists: SpecialistReviewItem[];
  models: BuilderModelOption[];
  assignments: ModelAssignmentsState | null;
  isLoading?: boolean;
  error?: string | null;
};

type InvalidAssignment = {
  specialistId: string;
  modelId: string;
};

export function getInvalidSpecialistAssignments(
  specialists: SpecialistReviewItem[],
  models: BuilderModelOption[],
  assignments: ModelAssignmentsState | null,
): InvalidAssignment[] {
  if (!assignments) {
    return specialists.map((specialist) => ({
      specialistId: specialist.id,
      modelId: "",
    }));
  }

  const activeModelIds = new Set(
    models.filter((model) => model.is_active).map((model) => model.id),
  );

  return specialists.flatMap((specialist) => {
    const finalModelId =
      assignments.final[specialist.id] ??
      assignments.overrides[specialist.id] ??
      assignments.baseline[specialist.id] ??
      "";

    if (!finalModelId || !activeModelIds.has(finalModelId)) {
      return [{ specialistId: specialist.id, modelId: finalModelId }];
    }

    return [];
  });
}

export function ModelAssignmentReview({
  specialists,
  models,
  assignments,
  isLoading = false,
  error = null,
}: ModelAssignmentReviewProps) {
  const getModel = (modelId?: string | null) =>
    models.find((item) => item.id === modelId);

  const overrideCount = Object.keys(assignments?.overrides ?? {}).length;
  const invalidAssignments = getInvalidSpecialistAssignments(
    specialists,
    models,
    assignments,
  );

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-purple-100/70 bg-white/70 p-4 shadow-sm">
        <p className="text-sm font-medium text-gray-500">Loading specialist models...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-rose-100 bg-rose-50/80 p-4 shadow-sm">
        <p className="text-sm font-medium text-rose-600">{error}</p>
      </div>
    );
  }

  if (!assignments || specialists.length === 0) {
    return (
      <div className="rounded-3xl border border-purple-100/70 bg-white/70 p-4 shadow-sm">
        <p className="text-sm font-medium text-gray-700">
          Builder still needs to finish assigning specialist models before you create the team.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border border-purple-100/70 bg-linear-to-br from-purple-50/90 to-white px-4 py-3.5 shadow-sm shrink-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-500">
          Final model review
        </p>
        <p className="mt-1 text-sm text-gray-600 leading-relaxed">
          Builder&apos;s defaults stay in place unless you changed them. Review the final setup before team creation.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-purple-200 bg-white/80 text-purple-700"
          >
            {specialists.length} specialist{specialists.length === 1 ? "" : "s"}
          </Badge>
          <Badge
            variant="outline"
            className="border-purple-200 bg-white/80 text-purple-700"
          >
            {overrideCount} custom choice{overrideCount === 1 ? "" : "s"}
          </Badge>
        </div>
        {invalidAssignments.length > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-amber-700">
              Choose an active model for every specialist before continuing.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-2 custom-scrollbar">
        {specialists.map((specialist) => {
          const baselineModelId = assignments.baseline[specialist.id] ?? "";
          const finalModelId = assignments.final[specialist.id] ?? baselineModelId;
          const finalModel = getModel(finalModelId);
          const isChanged = Boolean(assignments.overrides[specialist.id]);
          const isInvalid = invalidAssignments.some(
            (item) => item.specialistId === specialist.id,
          );

          return (
            <div
              key={specialist.id}
              className={`rounded-3xl px-4 py-3.5 shadow-sm ${
                isInvalid
                  ? "border border-amber-200 bg-amber-50/70"
                  : "border border-purple-100/70 bg-white/80"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">{specialist.label}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500 line-clamp-1 italic">
                    {specialist.desc}
                  </p>
                  {specialist.tools && specialist.tools.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {specialist.tools.map((tool) => (
                        <Badge key={tool} variant="ghost" className="h-4.5 px-1.5 py-0 text-[10px] bg-indigo-50/80 text-indigo-600 border-indigo-100/40 font-bold uppercase tracking-wider">
                          {tool.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Badge
                  variant={isInvalid ? "outline" : isChanged ? "default" : "outline"}
                  className={cn("shrink-0", isInvalid
                    ? "border-amber-300 bg-white text-amber-700"
                    : isChanged
                      ? "border-purple-600 bg-purple-600 text-white"
                      : "border-purple-200 bg-purple-50 text-purple-700")}
                >
                  {isInvalid ? "Needs update" : isChanged ? "You changed" : "Builder picked"}
                </Badge>
              </div>

              <div className={`mt-3 rounded-2xl px-3 py-2.5 ${
                isInvalid
                  ? "border border-amber-200 bg-white/80"
                  : "border border-purple-100/70 bg-purple-50/50"
              }`}>
                <p className="text-[11px] font-semibold text-gray-900">
                  {finalModel?.name ?? (finalModelId || "No model assigned")}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500 line-clamp-2">
                  {finalModel?.selection_hint ??
                    (finalModelId
                      ? "This saved model is not in the active model list right now."
                      : "Builder has not assigned a model yet.")}
                  {finalModel?.advanced_info && (
                    <span className="block mt-1 pt-1 border-t border-purple-100/30 text-[10px] text-purple-400 font-bold opacity-80 italic">
                      {finalModel.advanced_info}
                    </span>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
