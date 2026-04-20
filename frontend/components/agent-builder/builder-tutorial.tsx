"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  MessageSquare,
  Upload,
  Activity,
  Users,
  ChevronRight,
  ChevronLeft,
  X,
  Target,
  Database,
  FileText,
  Network,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface Step {
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  highlightId?: string | string[];
}

type TutorialRegion = "curtain" | "sidebar" | "dialog" | "dialog-left";

const steps: Step[] = [
  {
    title: "1. Describe the job",
    description: "Start with the outcome you want. The builder uses your first message to shape the team and the next setup steps.",
    icon: MessageSquare,
    color: "text-purple-600",
    highlightId: ["curtain-suggestions", "builder-curtain", "chat-area"],
  },
  {
    title: "2. Open the knowledge area",
    description: "Use the sidebar to review your team and open the knowledge area where you add the material your agents should rely on.",
    icon: Upload,
    color: "text-purple-600",
    highlightId: "config-sidebar-knowledge",
  },
  {
    title: "3. Upload documents",
    description: "Add PDFs, guides, and other reference files so the team can answer with your own business context.",
    icon: FileText,
    color: "text-purple-600",
    highlightId: "kb-upload-section",
  },
  {
    title: "4. Add links",
    description: "Connect useful webpages when your team should learn from site content as well as uploaded files.",
    icon: Network,
    color: "text-primary",
    highlightId: "kb-url-section",
  },
  {
    title: "5. Review your sources",
    description: "Check what has been added, preview content when needed, and confirm your sources are ready before launch.",
    icon: Database,
    color: "text-green-600",
    highlightId: "kb-sources-panel",
  },
  {
    title: "6. Check quality",
    description: "Use the quality gauge as a quick signal that your knowledge base is strong enough for the team you want to create.",
    icon: Activity,
    color: "text-emerald-600",
    highlightId: "quality-gauge",
  },
  {
    title: "7. Create the team",
    description: "Agents from the saved plan appear in Agent Specialists. When you press Create Team, the system creates the team from that plan and moves you into the normal working flow.",
    icon: Users,
    color: "text-amber-600",
    highlightId: ["agent-specialists-section", "create-team-btn"],
  },
];

const getTargetRegion = (highlightId?: string): TutorialRegion => {
  if (
    highlightId === "config-sidebar-knowledge" ||
    highlightId === "quality-gauge" ||
    highlightId === "agent-specialists-section"
  ) {
    return "sidebar";
  }

  if (highlightId === "kb-sources-panel") {
    return "dialog-left";
  }

  if (highlightId === "create-team-btn") {
    return "dialog";
  }

  return "curtain";
};

interface BuilderTutorialProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStepChange?: (step: number) => void;
}

export function BuilderTutorial({ open, onOpenChange, onStepChange }: BuilderTutorialProps) {
  const [currentStep, setCurrentStep] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ag_builder_tutorial_step");
      return saved ? parseInt(saved) : 0;
    }
    return 0;
  });

  const [targetRects, setTargetRects] = useState<DOMRect[]>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(380);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      const nextHeight = cardRef.current?.offsetHeight;
      if (nextHeight) {
        setCardHeight((prev) => (prev === nextHeight ? prev : nextHeight));
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, currentStep]);

  useEffect(() => {
    if (open) {
      localStorage.setItem("ag_builder_tutorial_step", currentStep.toString());
      onStepChange?.(currentStep);
    }
  }, [currentStep, open, onStepChange]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    localStorage.removeItem("ag_builder_tutorial_step");
  }, [onOpenChange]);

  const nextStep = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleClose();
    }
  }, [currentStep, handleClose]);

  const prevStep = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      else if (e.key === "ArrowRight" && currentStep < steps.length - 1) setCurrentStep(prev => prev + 1);
      else if (e.key === "ArrowLeft" && currentStep > 0) setCurrentStep(prev => prev - 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, currentStep, handleClose]);

  const updateRect = useCallback(() => {
    if (!open) return;
    const highlightId = steps[currentStep].highlightId;
    if (!highlightId) {
      setTargetRects([]);
      return;
    }

    const ids = Array.isArray(highlightId) ? highlightId : [highlightId];
    const newRects = ids
      .map(id => document.getElementById(id)?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => !!rect && (rect.width > 0 || rect.height > 0));

    if (newRects.length === 0) {
      setTargetRects([]);
      return;
    }

    setTargetRects(prev => {
      if (prev.length !== newRects.length) return newRects;
      for (let i = 0; i < prev.length; i++) {
        if (Math.abs(prev[i].left - newRects[i].left) > 2 || 
            Math.abs(prev[i].top - newRects[i].top) > 2 ||
            Math.abs(prev[i].width - newRects[i].width) > 2 ||
            Math.abs(prev[i].height - newRects[i].height) > 2) {
          return newRects;
        }
      }
      return prev;
    });
  }, [currentStep, open]);

  useEffect(() => {
    if (open) {
      const highlightId = steps[currentStep].highlightId;
      const primaryHighlightId = Array.isArray(highlightId) ? highlightId[0] : highlightId;
      if (primaryHighlightId) {
        const el = document.getElementById(primaryHighlightId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      const t0 = setTimeout(updateRect, 0);
      const t1 = setTimeout(updateRect, 100);
      const t2 = setTimeout(updateRect, 500);
      window.addEventListener("resize", updateRect);
      window.addEventListener("scroll", updateRect, true);
      return () => {
        clearTimeout(t0);
        clearTimeout(t1);
        clearTimeout(t2);
        window.removeEventListener("resize", updateRect);
        window.removeEventListener("scroll", updateRect, true);
      };
    } else {
      const frame = window.requestAnimationFrame(() => {
        setTargetRects([]);
        setCurrentStep(0);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [currentStep, open, updateRect]);

  const isMobile = viewport.width < 768;
  const guideWidth = isMobile ? Math.min(viewport.width - 24, 360) : viewport.width < 1024 ? 380 : 420;

  const pos = useMemo(() => {
    const defaultCenter = typeof window !== "undefined"
      ? {
          left: Math.max(12, window.innerWidth / 2 - guideWidth / 2),
          top: isMobile ? window.innerHeight - Math.max(cardHeight, 340) - 12 : window.innerHeight / 2 - 170,
        }
      : { left: 0, top: 0 };
    
    if (targetRects.length === 0 || typeof window === "undefined") return defaultCenter;

    const primaryHighlightId = Array.isArray(steps[currentStep].highlightId)
      ? steps[currentStep].highlightId[0]
      : steps[currentStep].highlightId;
    const region = getTargetRegion(primaryHighlightId);
    const minX = Math.min(...targetRects.map((rect) => rect.left));
    const minY = Math.min(...targetRects.map((rect) => rect.top));
    const maxX = Math.max(...targetRects.map((rect) => rect.right));
    const maxY = Math.max(...targetRects.map((rect) => rect.bottom));
    const targetRect = {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
      right: maxX,
      bottom: maxY,
    };
    const spacing =
      region === "sidebar" ? 16 : region === "dialog" || region === "dialog-left" ? 32 : 40;
    const guideHeight = Math.max(cardHeight, 340);
    const padding = isMobile ? 12 : 24;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    const targetCenterX = targetRect.left + targetRect.width / 2;

    const clampLeft = (value: number) => Math.max(padding, Math.min(value, winW - guideWidth - padding));
    const clampTop = (value: number) => Math.max(padding, Math.min(value, winH - guideHeight - padding));

    if (isMobile) {
      return {
        left: clampLeft((winW - guideWidth) / 2),
        top: clampTop(winH - guideHeight - 12),
      };
    }

    if (region === "sidebar" || region === "dialog-left") {
      const preferredLeft = targetRect.left - guideWidth - spacing;
      const left = preferredLeft >= padding ? preferredLeft : targetRect.right + spacing;
      const top = clampTop(targetRect.top + targetRect.height / 2 - guideHeight / 2);
      return {
        left: clampLeft(left),
        top,
      };
    }

    let left = targetCenterX - guideWidth / 2;
    let top = targetRect.bottom + spacing;

    if (region === "dialog") {
      const preferredTop = targetRect.top - guideHeight - spacing;
      const fallbackTop = targetRect.bottom + spacing;
      top = preferredTop >= padding ? preferredTop : fallbackTop;
    } else {
      if (top + guideHeight + padding > winH) {
        top = targetRect.top - guideHeight - spacing;
      }
      if (top < padding) {
        left = targetRect.right + spacing;
        top = targetRect.top + targetRect.height / 2 - guideHeight / 2;
      }
    }

    return {
      left: clampLeft(left),
      top: clampTop(top),
    };
  }, [cardHeight, currentStep, guideWidth, isMobile, targetRects]);

  if (typeof document === "undefined" || !open) return null;

  const CurrentIcon = steps[currentStep].icon;
  const isLastStep = currentStep === steps.length - 1;

  const cardMotion = shouldReduceMotion
    ? { animate: { opacity: 1, scale: 1, y: 0, top: Math.round(pos?.top ?? 0), left: Math.round(pos?.left ?? 0) }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, scale: 0.95, y: 20 },
        animate: { top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: 1, scale: 1, y: 0 },
        transition: { type: "spring" as const, stiffness: 165, damping: 28, mass: 1 },
      };
  const cardLayoutProps = shouldReduceMotion ? {} : { layout: "position" as const };

  return createPortal(
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 9999999 }} role="dialog" aria-modal="true">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 999998 }}>
        <defs>
          <mask id="tutorial-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRects.map((rect, i) => (
              <rect
                key={`hole-${i}`}
                x={rect.left - 6}
                y={rect.top - 6}
                width={rect.width + 12}
                height={rect.height + 12}
                rx={12}
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" mask="url(#tutorial-mask)" />
      </svg>

      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 999999 }}>
        {targetRects.map((rect, i) => (
          <motion.div
            key={`frame-${i}`}
            layoutId={targetRects.length === 1 ? "spotlight-frame" : undefined}
            initial={false}
            animate={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12,
            }}
            transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 150, damping: 26, mass: 1.05 }}
            className="absolute pointer-events-none"
            style={{ borderRadius: 12, border: "2px solid rgb(147, 51, 234)", boxShadow: "0 0 0 4px rgba(147, 51, 234, 0.12)" }}
          >
            <div className="absolute -top-3 -left-3 bg-purple-600 text-white p-1.5 rounded-full shadow-md">
              <Target className="w-4 h-4" aria-hidden="true" />
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        ref={cardRef}
        {...cardLayoutProps}
        {...cardMotion}
        style={{ zIndex: 10000001, width: guideWidth }}
        className={cn(
          "absolute pointer-events-auto overflow-hidden border border-purple-100 bg-linear-to-br from-purple-50/95 to-white/95 backdrop-blur-3xl shadow-2xl text-left",
          isMobile ? "rounded-[1.75rem] rounded-b-[1.1rem]" : "rounded-[2rem]",
        )}
      >
        <div className={cn("space-y-6 relative", isMobile ? "p-5 pb-4" : "p-8")}>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleClose(); }}
            className="absolute top-6 right-6 rounded-full w-8 h-8 text-gray-300 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close tutorial"
          >
            <X className="w-4 h-4" />
          </Button>

          <div className="flex items-end justify-between">
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold text-purple-600 uppercase tracking-[0.3em]">Guided Walkthrough</h3>
              <div className="flex gap-1.5">
                {steps.map((_, i) => (
                  <div key={i} className={cn("h-1.5 rounded-full transition-all duration-300", i === currentStep ? "w-8 bg-purple-600" : i < currentStep ? "w-4 bg-purple-200" : "w-4 bg-gray-100")} />
                ))}
              </div>
            </div>
            <span className={cn("font-black italic text-gray-100 select-none leading-none", isMobile ? "text-3xl" : "text-4xl")}>{currentStep + 1}</span>
          </div>

          <motion.div key={currentStep} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.1 }} className="space-y-4">
            <div className={cn("p-4 rounded-2xl bg-gray-50 w-fit border border-gray-100", steps[currentStep].color)}>
              <CurrentIcon className={cn(isMobile ? "w-7 h-7" : "w-9 h-9")} />
            </div>
            <div className="space-y-2">
              <h2 className={cn("font-black tracking-tight text-gray-900 leading-tight", isMobile ? "text-xl" : "text-2xl")}>{steps[currentStep].title}</h2>
              <p className={cn("text-gray-600 leading-relaxed font-medium", isMobile ? "text-[13px]" : "text-sm")}>{steps[currentStep].description}</p>
            </div>
          </motion.div>

          <div className="flex items-center justify-between pt-5 border-t border-gray-100">
            <Button variant="ghost" onClick={prevStep} disabled={currentStep === 0} className={cn("rounded-xl font-bold tracking-widest text-gray-400 hover:text-gray-800 disabled:opacity-0 transition-all uppercase cursor-pointer", isMobile ? "px-2 text-[10px]" : "text-[11px]")} aria-label="Previous step">
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <Button ref={nextButtonRef} onClick={nextStep} className={cn("bg-linear-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold shadow-md transition-all active:scale-95 cursor-pointer", isMobile ? "h-11 rounded-xl px-5 text-sm" : "h-12 rounded-2xl px-7")} aria-label={isLastStep ? "Start building" : `Next step: ${steps[currentStep + 1]?.title ?? ""}`}>
              {isLastStep ? "Start Building" : "Next Step"}
              {!isLastStep && <ChevronRight className="w-4 h-4 ml-2" />}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
