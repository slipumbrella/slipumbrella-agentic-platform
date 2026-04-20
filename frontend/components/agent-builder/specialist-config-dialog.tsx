"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Loader2,
  Bot,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ModelIcon } from "@/components/shared/model-icon";
import type { BuilderModelOption, ModelAssignmentsState } from "@/lib/features/chat/builderAPI";
import {
  formatModelTag,
  getPrimaryModelTag,
  normalizeModelTags,
} from "@/components/agent-builder/config-utils";

function formatModelPrice(value: number) {
  if (value === 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

const preferredTagOrder = ["steady", "swift", "deep"];

interface Specialist {
  id: string;
  label: string;
  desc: string;
  tools?: string[];
}

interface SpecialistConfigDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  availableSpecialists: Specialist[];
  modelAssignments: ModelAssignmentsState | null;
  builderModels: BuilderModelOption[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onModelChange: (specialistId: string, modelId: string) => Promise<void>;
  onResetModel: (specialistId: string) => Promise<void>;
  onApplyToAll: (modelId: string) => Promise<void>;
  initialIndex: number;
  carouselIndex: number;
  onCarouselIndexChange: (idx: number) => void;
}

function ModelTagBadges({
  tags,
  className,
  maxVisible,
}: {
  tags?: string[] | null;
  className?: string;
  maxVisible?: number;
}) {
  const normalizedTags = normalizeModelTags(tags);
  const visibleTags =
    typeof maxVisible === "number"
      ? normalizedTags.slice(0, Math.max(0, maxVisible))
      : normalizedTags;

  if (visibleTags.length === 0) {
    return null;
  }

  return (
    <div className={cn("model-tag-badges flex flex-wrap items-center gap-1.5", className)}>
      {visibleTags.map((tag) => (
        <Badge
          key={tag.toLowerCase()}
          variant="outline"
          className="border-purple-200 bg-purple-50 text-purple-700 text-[9px] font-bold"
        >
          {formatModelTag(tag)}
        </Badge>
      ))}
    </div>
  );
}

export function SpecialistConfigDialog({
  isOpen,
  onOpenChange,
  availableSpecialists,
  modelAssignments,
  builderModels,
  isLoading,
  isSaving,
  error,
  onModelChange,
  onResetModel,
  onApplyToAll,
  initialIndex,
  carouselIndex,
  onCarouselIndexChange,
}: SpecialistConfigDialogProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [direction, setDirection] = useState(0);
  const [activeHoverId, setActiveHoverId] = useState<string | null>(null);

  const getModelOption = (id: string) => builderModels.find((m) => m.id === id) || null;
  const isActiveModelId = (id: string) => builderModels.some((m) => m.id === id);

  const getOrderedModelOptions = (baselineId: string, currentId: string) => {
    const builderPick = getModelOption(baselineId);
    if (!builderPick) return null;

    const otherModels = builderModels.filter((m) => m.id !== baselineId);

    const groupedOptions = preferredTagOrder
      .map((tag) => ({
        tag,
        options: otherModels
          .filter((m) => {
            const primary = getPrimaryModelTag(m.tags).toLowerCase();
            return primary === tag;
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((group) => group.options.length > 0);

    const capturedIds = new Set([
      baselineId,
      ...groupedOptions.flatMap((g) => g.options.map((m) => m.id)),
    ]);

    const additionalOptions = otherModels
      .filter((m) => !capturedIds.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      builderPick,
      currentUnavailable: currentId && !isActiveModelId(currentId) ? getModelOption(currentId) : null,
      groupedOptions,
      additionalOptions,
    };
  };

  const handleNext = () => {
    if (carouselIndex < availableSpecialists.length - 1) {
      setDirection(1);
      onCarouselIndexChange(carouselIndex + 1);
      setIsAdvancedOpen(false);
    }
  };

  const handlePrev = () => {
    if (carouselIndex > 0) {
      setDirection(-1);
      onCarouselIndexChange(carouselIndex - 1);
      setIsAdvancedOpen(false);
    }
  };

  const currentSpecialist = availableSpecialists[carouselIndex];
  const configModelId = currentSpecialist ? (modelAssignments?.final[currentSpecialist.id] ?? modelAssignments?.baseline[currentSpecialist.id] ?? "") : "";
  const configModel = getModelOption(configModelId);
  const configBaselineModelId = currentSpecialist ? (modelAssignments?.baseline[currentSpecialist.id] ?? "") : "";
  const configOrderedModels = getOrderedModelOptions(configBaselineModelId, configModelId);
  const hasOverride = currentSpecialist ? Boolean(modelAssignments?.overrides[currentSpecialist.id]) : false;
  const isCurrentModelActive = !configModelId || isActiveModelId(configModelId);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent 
        className={cn(
          "fixed left-1/2! top-1/2! -translate-x-1/2! -translate-y-1/2!",
          "w-[540px] p-0 overflow-visible gap-0 border-none shadow-none bg-transparent focus:ring-0 z-200 [&>button:last-child]:hidden"
        )}
      >
        <div className="relative w-full rounded-[2.5rem] bg-[#fdfcff] border border-purple-200 shadow-[0_32px_64px_-16px_rgba(168,85,247,0.25)] flex flex-col overflow-visible h-[740px]">
          
          {/* Header */}
          <div className="bg-linear-to-br from-purple-50/90 via-white/40 to-indigo-50/60 px-8 py-7 border-b border-purple-100/40 relative shrink-0 rounded-t-[2.5rem] overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-[3px] bg-linear-to-r from-purple-400 via-indigo-500 to-blue-400 opacity-80" />
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-[18px] font-black text-gray-900 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-white border border-purple-200/80 shadow-[0_8px_20px_-4px_rgba(168,85,247,0.3)] flex items-center justify-center text-purple-600 shrink-0">
                    <Sparkles className="h-5 w-5 animate-pulse" />
                  </div>
                  <span className="bg-clip-text text-transparent bg-linear-to-r from-gray-900 via-gray-800 to-gray-600 uppercase tracking-tight">
                    Model Customization
                  </span>
                </DialogTitle>
                <DialogDescription className="text-[12px] mt-2 text-gray-400 flex items-center gap-2 ml-12 font-medium">
                  <span className="font-bold text-purple-600 bg-purple-100/50 px-2.5 py-1 rounded-full border border-purple-200/30">
                    {availableSpecialists.length} Experts
                  </span>
                  <span className="w-1 h-1 bg-gray-300 rounded-full" />
                  <span>Configure model strategy.</span>
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="rounded-2xl h-10 w-10 text-gray-400 hover:text-purple-600 hover:bg-purple-100/40 transition-all duration-300"
                >
                  <X className="h-5 w-5" />
                </Button>
              </DialogClose>
            </div>
          </div>

          {/* Body with Animated Swipe */}
          <div className="relative flex-1 overflow-visible">
            <AnimatePresence mode="wait" custom={direction}>
              {currentSpecialist && (
                <motion.div
                  key={currentSpecialist.id}
                  custom={direction}
                  initial={{ opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -direction * 40 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="absolute inset-0 w-full h-full"
                >
                  <ScrollArea className="h-full">
                    <div className="px-8 py-6 h-full">
                      <div className="space-y-6">
                        {/* Compact Specialist Card */}
                        <div className="rounded-[2.2rem] border border-purple-100/60 bg-linear-to-br from-white via-white/80 to-purple-50/20 p-7 flex items-center gap-5 shadow-xs group/inner">
                          <div className="w-14 h-14 shrink-0 rounded-2xl bg-linear-to-br from-white to-purple-50/50 border border-purple-100 shadow-xs flex items-center justify-center text-purple-600">
                            <Bot className="h-7 w-7" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3.5 mb-1 flex-wrap">
                              <p className="text-[16px] font-black text-slate-900 tracking-tight">{currentSpecialist.label}</p>
                              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-100/50 border border-purple-200/40">
                                <span className="text-[9px] font-black text-purple-700 uppercase tracking-widest">#{carouselIndex + 1}</span>
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] font-bold uppercase tracking-wide",
                                  !isCurrentModelActive
                                    ? "border-amber-300 bg-amber-50 text-amber-700"
                                    : hasOverride
                                      ? "border-purple-600 bg-purple-600 text-white"
                                      : "border-purple-200 bg-purple-50 text-purple-700",
                                )}
                              >
                                {!isCurrentModelActive ? "Needs update" : hasOverride ? "You changed" : "Builder picked"}
                              </Badge>
                            </div>
                            <p className="text-[12px] text-slate-500 leading-relaxed font-bold line-clamp-1 truncate max-w-[280px]">
                              {currentSpecialist.desc}
                            </p>
                            {currentSpecialist.tools && currentSpecialist.tools.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {currentSpecialist.tools.map((tool) => (
                                  <Badge
                                    key={tool}
                                    variant="outline"
                                    className="border-indigo-100 bg-indigo-50/90 text-indigo-700 text-[9px] font-bold uppercase tracking-wide"
                                  >
                                    {tool.replace(/_/g, " ")}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between px-1">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Assign Model</label>
                            {isSaving && <Loader2 className="h-4 w-4 animate-spin text-purple-500" />}
                          </div>
                          
                          <div className="grid gap-4">
                                <Select
                                  value={configModelId}
                                  onValueChange={(value) => { 
                                    setActiveHoverId(null);
                                    void onModelChange(currentSpecialist.id, value); 
                                  }}
                                  onOpenChange={(open) => {
                                    if (!open) setActiveHoverId(null);
                                  }}
                                  disabled={isLoading || isSaving}
                                >
                                  <SelectTrigger
                                    aria-label={`Model for ${currentSpecialist.label}`}
                                    className="h-16 w-full rounded-[1.5rem] border-purple-200/50 bg-white shadow-xs px-6 text-center hover:bg-white hover:border-purple-400 transition-all focus:ring-4 focus:ring-purple-200/30 flex items-center justify-center group/trigger"
                                  >
                                    <div className="pointer-events-none min-w-0 flex w-full items-center justify-center gap-3">
                                      {configModel && (
                                        <ModelIcon
                                          src={configModel.icon}
                                          name={configModel.name}
                                          size={24}
                                          isReasoning={configModel.is_reasoning}
                                          className="shadow-sm shrink-0"
                                        />
                                      )}
                                      <div className="min-w-0 flex items-center gap-2">
                                        <div className="truncate text-[14px] font-black text-slate-800 tracking-tight leading-tight [&_.model-icon-container]:hidden [&_.model-tag-badges]:hidden">
                                          <SelectValue placeholder="Waiting for Builder" />
                                        </div>
                                        {configModel && (
                                          <Badge
                                            variant="outline"
                                            className="shrink-0 border-purple-200 bg-purple-50 text-purple-700 text-[9px] font-bold"
                                          >
                                            {formatModelTag(getPrimaryModelTag(configModel.tags))}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </SelectTrigger>
                                  <SelectContent 
                                    position="popper"
                                    sideOffset={8}
                                    align="center" 
                                    className="w-[min(28rem,var(--radix-select-trigger-width))] max-h-[400px] rounded-2xl border border-purple-100 shadow-2xl z-400 backdrop-blur-3xl overflow-y-auto custom-scrollbar"
                                  >
                                    {configOrderedModels?.builderPick && (
                                  <>
                                    <SelectGroup>
                                      <SelectLabel className="text-[10px] uppercase tracking-widest text-purple-400 font-black px-4 py-3">Builder Selection</SelectLabel>
                                      <HoverCard 
                                        openDelay={0} 
                                        closeDelay={0}
                                        open={activeHoverId === configOrderedModels.builderPick.id}
                                        onOpenChange={(open) => setActiveHoverId(open ? configOrderedModels.builderPick.id : null)}
                                      >
                                        <HoverCardTrigger asChild>
                                          <SelectItem value={configOrderedModels.builderPick.id} className="rounded-xl px-4 py-2.5 focus:bg-purple-50 group/item">
                                            <div className="flex flex-col gap-0.5">
                                              <div className="flex items-center gap-2.5">
                                                <span className="font-bold text-[13px] text-slate-700 group-hover/item:text-purple-700 transition-colors inline-flex items-center gap-2">
                                                  <ModelIcon
                                                    src={configOrderedModels.builderPick.icon}
                                                    name={configOrderedModels.builderPick.name}
                                                    size={20}
                                                    isReasoning={configOrderedModels.builderPick.is_reasoning}
                                                  />
                                                  {configOrderedModels.builderPick.name}
                                                </span>
                                              </div>
                                              <ModelTagBadges tags={configOrderedModels.builderPick.tags} />
                                            </div>
                                          </SelectItem>
                                        </HoverCardTrigger>
                                          <HoverCardContent 
                                            side="right" 
                                            align="start" 
                                            sideOffset={16}
                                            className="w-[min(26rem,calc(100vw-2rem))] p-5 rounded-2xl border-purple-100 shadow-2xl backdrop-blur-xl bg-white/90 z-600 animate-in zoom-in-95 slide-in-from-left-2 duration-150 pointer-events-none"
                                          >
                                            <div className="flex flex-col gap-3.5">
                                              <div className="flex items-center justify-between pb-1.5 border-b border-purple-100/50">
                                                <div className="flex items-center gap-2">
                                                  <div className="p-0 overflow-hidden rounded-lg bg-purple-50 shadow-xs ring-1 ring-purple-100">
                                                    <ModelIcon
                                                      src={configOrderedModels.builderPick.icon}
                                                      name={configOrderedModels.builderPick.name}
                                                      size={24}
                                                      isReasoning={configOrderedModels.builderPick.is_reasoning}
                                                    />
                                                  </div>
                                                  <span className="font-black text-[15px] text-slate-800 tracking-tight">{configOrderedModels.builderPick.name}</span>
                                                </div>
                                                <Badge variant="outline" className="border-purple-100 bg-purple-50 text-purple-600 text-[8px] font-black uppercase tracking-widest">
                                                  Builder Pick
                                                </Badge>
                                              </div>

                                              <div className="space-y-4 pt-1">
                                                {configOrderedModels.builderPick.selection_hint && (
                                                  <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                      <div className="w-1.5 h-4 bg-purple-400 rounded-full" />
                                                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Model Strength</span>
                                                    </div>
                                                    <p className="text-[14px] text-slate-700 font-bold leading-relaxed">
                                                      {configOrderedModels.builderPick.selection_hint}
                                                    </p>
                                                  </div>
                                                )}
                                                {configOrderedModels.builderPick.advanced_info && (
                                                  <div className="space-y-2 pt-2 border-t border-purple-50/60">
                                                    <div className="flex items-center gap-2">
                                                      <div className="w-1.5 h-4 bg-slate-300 rounded-full" />
                                                      <span className="text-[10px] font-black uppercase text-purple-400 tracking-widest">Deep Context</span>
                                                    </div>
                                                    <p className="text-[13px] text-purple-600/90 font-medium italic leading-relaxed">
                                                      {configOrderedModels.builderPick.advanced_info}
                                                    </p>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </HoverCardContent>
                                      </HoverCard>
                                    </SelectGroup>
                                    <SelectSeparator className="my-1.5" />
                                  </>
                                )}
                                {configOrderedModels?.groupedOptions.map((group) => (
                                  <React.Fragment key={group.tag}>
                                    <SelectGroup>
                                      <SelectLabel className="text-[10px] uppercase tracking-widest text-gray-400 font-bold px-4 py-3">{group.tag}</SelectLabel>
                                      {group.options.map((model) => (
                                        <HoverCard 
                                          key={model.id} 
                                          openDelay={0} 
                                          closeDelay={0}
                                          open={activeHoverId === model.id}
                                          onOpenChange={(open) => setActiveHoverId(open ? model.id : null)}
                                        >
                                          <HoverCardTrigger asChild>
                                            <SelectItem value={model.id} className="rounded-xl px-4 py-2.5 focus:bg-purple-50 group/item">
                                              <div className="flex flex-col gap-0.5">
                                                <div className="flex items-center gap-2.5">
                                                  <span className="font-bold text-[13px] text-slate-700 group-hover/item:text-purple-700 transition-colors inline-flex items-center gap-2">
                                                    <ModelIcon
                                                      src={model.icon}
                                                      name={model.name}
                                                      size={20}
                                                      isReasoning={model.is_reasoning}
                                                    />
                                                    {model.name}
                                                  </span>
                                                </div>
                                                <ModelTagBadges tags={model.tags} />
                                              </div>
                                            </SelectItem>
                                          </HoverCardTrigger>
                                          <HoverCardContent 
                                            side="right" 
                                            align="start" 
                                            sideOffset={16}
                                            className="w-[min(26rem,calc(100vw-2rem))] p-5 rounded-2xl border-purple-100 shadow-2xl backdrop-blur-xl bg-white/90 z-600 animate-in zoom-in-95 slide-in-from-left-2 duration-75 pointer-events-none"
                                          >
                                            <div className="flex flex-col gap-3.5">
                                              <div className="flex items-center justify-between pb-1.5 border-b border-purple-100/50">
                                                <div className="flex items-center gap-2">
                                                  <div className="p-0 overflow-hidden rounded-lg bg-alpha-purple-100 shadow-xs ring-1 ring-purple-200/50">
                                                    <ModelIcon
                                                      src={model.icon}
                                                      name={model.name}
                                                      size={24}
                                                      isReasoning={model.is_reasoning}
                                                    />
                                                  </div>
                                                  <span className="font-black text-[15px] text-slate-800 tracking-tight">{model.name}</span>
                                                </div>
                                                <Badge variant="outline" className="border-slate-100 bg-slate-50 text-slate-500 text-[8px] font-black uppercase tracking-widest">
                                                  Model Info
                                                </Badge>
                                              </div>

                                              <div className="space-y-4 pt-1">
                                                {model.selection_hint && (
                                                  <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                      <div className="w-1.5 h-4 bg-purple-400 rounded-full" />
                                                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Strength</span>
                                                    </div>
                                                    <p className="text-[14px] text-slate-700 font-bold leading-relaxed">
                                                      {model.selection_hint}
                                                    </p>
                                                  </div>
                                                )}
                                                {model.advanced_info && (
                                                  <div className="space-y-2 pt-2 border-t border-purple-50/60">
                                                    <div className="flex items-center gap-2">
                                                      <div className="w-1.5 h-4 bg-slate-300 rounded-full" />
                                                      <span className="text-[10px] font-black uppercase text-purple-400 tracking-widest">Deep context</span>
                                                    </div>
                                                    <p className="text-[13px] text-purple-500/80 font-medium italic leading-relaxed">
                                                      {model.advanced_info}
                                                    </p>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </HoverCardContent>
                                        </HoverCard>
                                      ))}
                                    </SelectGroup>
                                  </React.Fragment>
                                ))}
                                {configOrderedModels?.additionalOptions && configOrderedModels.additionalOptions.length > 0 && (
                                  <>
                                    <SelectSeparator className="my-1.5" />
                                    <SelectGroup>
                                      <SelectLabel className="text-[10px] uppercase tracking-widest text-gray-400 font-bold px-4 py-3">More Models</SelectLabel>
                                      {configOrderedModels.additionalOptions.map((model) => (
                                        <HoverCard 
                                          key={model.id} 
                                          openDelay={0} 
                                          closeDelay={0}
                                          open={activeHoverId === model.id}
                                          onOpenChange={(open) => setActiveHoverId(open ? model.id : null)}
                                        >
                                          <HoverCardTrigger asChild>
                                            <SelectItem key={model.id} value={model.id} className="rounded-xl px-4 py-2.5 focus:bg-purple-50 group/item">
                                              <div className="flex flex-col gap-0.5">
                                                <div className="flex items-center gap-2.5">
                                                  <span className="font-bold text-[13px] text-slate-700 group-hover/item:text-purple-700 transition-colors inline-flex items-center gap-2">
                                                    <ModelIcon
                                                      src={model.icon}
                                                      name={model.name}
                                                      size={20}
                                                      isReasoning={model.is_reasoning}
                                                    />
                                                    {model.name}
                                                  </span>
                                                </div>
                                                <ModelTagBadges tags={model.tags} />
                                              </div>
                                            </SelectItem>
                                          </HoverCardTrigger>
                                          <HoverCardContent 
                                            side="right" 
                                            align="start" 
                                            sideOffset={16}
                                            className="w-[min(26rem,calc(100vw-2rem))] p-5 rounded-2xl border-purple-100 shadow-2xl backdrop-blur-xl bg-white/90 z-600 animate-in zoom-in-95 slide-in-from-left-2 duration-75 pointer-events-none"
                                          >
                                            <div className="flex flex-col gap-3.5">
                                              <div className="flex items-center justify-between pb-1.5 border-b border-purple-100/50">
                                                <div className="flex items-center gap-2">
                                                  <div className="p-0 overflow-hidden rounded-lg bg-alpha-purple-100 shadow-xs ring-1 ring-purple-200/50">
                                                    <ModelIcon
                                                      src={model.icon}
                                                      name={model.name}
                                                      size={24}
                                                      isReasoning={model.is_reasoning}
                                                    />
                                                  </div>
                                                  <span className="font-black text-[15px] text-slate-800 tracking-tight">{model.name}</span>
                                                </div>
                                                <Badge variant="outline" className="border-slate-100 bg-slate-50 text-slate-500 text-[8px] font-black uppercase tracking-widest">
                                                  Model Info
                                                </Badge>
                                              </div>

                                              <div className="space-y-4 pt-1">
                                                {model.selection_hint && (
                                                  <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                      <div className="w-1.5 h-4 bg-purple-400 rounded-full" />
                                                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Strength</span>
                                                    </div>
                                                    <p className="text-[14px] text-slate-700 font-bold leading-relaxed">
                                                      {model.selection_hint}
                                                    </p>
                                                  </div>
                                                )}
                                                {model.advanced_info && (
                                                  <div className="space-y-2 pt-2 border-t border-purple-50/60">
                                                    <div className="flex items-center gap-2">
                                                      <div className="w-1.5 h-4 bg-slate-300 rounded-full" />
                                                      <span className="text-[10px] font-black uppercase text-purple-400 tracking-widest">Deep context</span>
                                                    </div>
                                                    <p className="text-[13px] text-purple-500/80 font-medium italic leading-relaxed">
                                                      {model.advanced_info}
                                                    </p>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          </HoverCardContent>
                                        </HoverCard>
                                      ))}
                                    </SelectGroup>
                                  </>
                                )}
                                </SelectContent>
                              </Select>

                            <div className="flex flex-col gap-3">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-10 w-full justify-between rounded-xl px-5 text-[11px] font-black text-gray-500 hover:bg-purple-50 hover:text-purple-700 transition-all border border-transparent hover:border-purple-200 shadow-xs"
                                onClick={() => setIsAdvancedOpen((prev) => !prev)}
                                disabled={!configModel}
                              >
                                <div className="flex items-center gap-2.5">
                                  <Sparkles className="h-4 w-4 text-purple-500" />
                                  Advanced Intel Metrics
                                </div>
                                <Plus className={cn("h-4 w-4 transition-transform duration-500", isAdvancedOpen && "rotate-45")} />
                              </Button>

                              {isAdvancedOpen && configModel && (
                                <div className="grid grid-cols-1 gap-4 pt-1 animate-in fade-in slide-in-from-top-3 duration-500">
                                  <div className="grid grid-cols-3 gap-3">
                                    <div className="rounded-[1.2rem] border border-slate-100 bg-white p-4 space-y-1 shadow-xs text-center relative group/tip">
                                      <span className="text-[9px] font-black uppercase text-slate-400">Input Price</span>
                                      <p className="text-[11px] font-black text-slate-800">{formatModelPrice(configModel.input_price)}</p>
                                      <span className="text-[8px] font-bold text-slate-400 block">/ 1M tokens</span>
                                    </div>
                                    <div className="rounded-[1.2rem] border border-slate-100 bg-white p-4 space-y-1 shadow-xs text-center relative group/tip">
                                      <span className="text-[9px] font-black uppercase text-slate-400">Logic</span>
                                      <p className="text-[11px] font-black text-slate-800">{configModel.is_reasoning ? "Hard" : "Standard"}</p>
                                      <span className="text-[8px] font-bold text-slate-400 block truncate px-1">Reasoning Span</span>
                                    </div>
                                    <div className="rounded-[1.2rem] border border-slate-100 bg-white p-4 space-y-1 shadow-xs text-center relative group/tip">
                                      <span className="text-[9px] font-black uppercase text-slate-400">Context</span>
                                      <p className="text-[11px] font-black text-slate-800">{configModel.context_length >= 1000 ? `${Math.round(configModel.context_length/1000)}k` : configModel.context_length}</p>
                                      <span className="text-[8px] font-bold text-slate-400 block">Memory Capacity</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {!isCurrentModelActive && configModelId && (
                            <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50/80 px-4 py-3 text-[11px] font-medium text-amber-700">
                              This saved model is not in the current active list right now.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </ScrollArea>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Manual Navigation Arrows */}
            {availableSpecialists.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={carouselIndex === 0}
                  className="absolute -left-18 top-1/2 -translate-y-1/2 h-14 w-14 rounded-2xl bg-purple-700 hover:bg-purple-800 border-none shadow-[0_8px_32px_rgba(168,85,247,0.4)] text-white flex items-center justify-center transition-all hover:scale-110 disabled:opacity-0 z-60"
                >
                  <ChevronLeft className="h-8 w-8" />
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={carouselIndex === availableSpecialists.length - 1}
                  className="absolute -right-18 top-1/2 -translate-y-1/2 h-14 w-14 rounded-2xl bg-purple-700 hover:bg-purple-800 border-none shadow-[0_8px_32px_rgba(168,85,247,0.4)] text-white flex items-center justify-center transition-all hover:scale-110 disabled:opacity-0 z-60"
                >
                  <ChevronRight className="h-8 w-8" />
                </button>
              </>
            )}
          </div>

          {/* Footer Status & Batch Actions */}
          <div className="border-t border-purple-100/60 px-8 py-7 bg-white/60 backdrop-blur-md shrink-0 rounded-b-[2.5rem] overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rounded-2xl text-gray-400 hover:text-rose-500 hover:bg-rose-50 text-[10px] font-black h-9 px-5 transition-all uppercase tracking-widest"
                  onClick={() => { if (currentSpecialist) void onResetModel(currentSpecialist.id); }}
                  disabled={!currentSpecialist || !modelAssignments?.overrides[currentSpecialist.id] || isSaving}
                >
                  Reset
                </Button>
                <div className="w-px h-6 bg-slate-200/60" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-2xl border-purple-200 bg-white text-purple-700 hover:bg-purple-800 hover:text-white text-[10px] font-black h-9 px-6 shadow-xs transition-all uppercase tracking-widest group"
                  onClick={() => { if (currentSpecialist) void onApplyToAll(modelAssignments?.final[currentSpecialist.id] ?? ""); }}
                  disabled={!currentSpecialist || isSaving || !isCurrentModelActive}
                >
                  <Plus className="mr-2 h-3.5 w-3.5 group-hover:rotate-90 transition-transform duration-300" />
                  Apply to all Specialist
                </Button>
              </div>

              <div className="flex flex-col items-end gap-2 pr-2">
                <div className="flex gap-2">
                  {availableSpecialists.map((_, i) => (
                    <div key={i} className={cn("h-2 rounded-full transition-all duration-500 shadow-xs", i === carouselIndex ? "w-8 bg-linear-to-r from-purple-500 to-indigo-600" : "w-2 bg-slate-200")} />
                  ))}
                </div>
                <span className="text-[10px] font-black text-slate-400 tracking-tighter uppercase">{carouselIndex + 1} / {availableSpecialists.length} Experts</span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
