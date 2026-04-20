"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import React from "react";

interface ThinkingBlockProps {
  content: string;
  isLive: boolean;
  accent: "purple" | "indigo";
  liveLabel?: string;
  idleLabel?: string;
  className?: string;
}

const accentStyles = {
  purple: {
    shell: "glass border-purple-200/40",
    dots: "bg-purple-400",
    label: "text-purple-500",
    icon: "text-purple-400",
    divider: "border-purple-100/60",
    content: "text-gray-500",
  },
  indigo: {
    shell: "bg-white/50 backdrop-blur-md border border-indigo-200/60",
    dots: "bg-indigo-400",
    label: "text-indigo-500",
    icon: "text-indigo-400",
    divider: "border-indigo-100/80",
    content: "text-gray-500",
  },
} as const;

export const ThinkingBlock = React.memo(function ThinkingBlock({
  content,
  isLive,
  accent,
  liveLabel = "Thinking...",
  idleLabel = "Thought process",
  className,
}: ThinkingBlockProps) {
  const [open, setOpen] = React.useState(true);
  const styles = accentStyles[accent];

  React.useEffect(() => {
    if (!isLive && content) {
      const timeout = setTimeout(() => setOpen(false), 800);
      return () => clearTimeout(timeout);
    }
  }, [isLive, content]);

  if (!content && !isLive) {
    return null;
  }

  return (
    <div className={cn("flex gap-4 animate-in fade-in duration-300", className)}>
      <div className="h-10 w-10 shrink-0" />
      <div className={cn("rounded-2xl rounded-tl-none shadow-sm max-w-[80%] overflow-hidden", styles.shell)}>
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 px-4 py-2.5 w-full text-left"
        >
          {isLive ? (
            <span className="flex gap-0.5">
              <span className={cn("h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:0ms]", styles.dots)} />
              <span className={cn("h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:150ms]", styles.dots)} />
              <span className={cn("h-1.5 w-1.5 rounded-full animate-bounce [animation-delay:300ms]", styles.dots)} />
            </span>
          ) : null}
          <span className={cn("text-xs font-semibold uppercase tracking-wide", styles.label)}>
            {isLive ? liveLabel : idleLabel}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 ml-auto transition-transform",
              styles.icon,
              open && "rotate-180",
            )}
          />
        </button>
        {open ? (
          <div className={cn("px-4 pb-3 text-xs leading-relaxed whitespace-pre-wrap border-t max-h-48 overflow-y-auto", styles.divider, styles.content)}>
            {content}
          </div>
        ) : null}
      </div>
    </div>
  );
});