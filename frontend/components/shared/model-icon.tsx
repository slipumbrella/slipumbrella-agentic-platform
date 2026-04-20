"use client";

import React from "react";
import Image from "next/image";
import { Bot, Zap, Brain, Sparkles, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModelIconProps {
  src?: string | null;
  name?: string;
  size?: number;
  className?: string;
  isReasoning?: boolean;
}

export function ModelIcon({
  src,
  name = "Model",
  size = 24,
  className,
  isReasoning = false,
}: ModelIconProps) {
  const [error, setError] = React.useState(false);

  // Fallback icon based on model type or name
  const getFallbackIcon = (): LucideIcon => {
    if (isReasoning) return Brain;
    const lowerName = name.toLowerCase();
    if (lowerName.includes("flash") || lowerName.includes("fast")) return Zap;
    if (lowerName.includes("pro") || lowerName.includes("large")) return Sparkles;
    return Bot;
  };

  const FallbackIcon = getFallbackIcon();

  if (!src || error) {
    return (
      <div
        className={cn(
          "model-icon-container flex items-center justify-center rounded-md bg-muted text-muted-foreground transition-all duration-300",
          className
        )}
        style={{ width: size, height: size }}
      >
        <FallbackIcon size={size * 0.6} strokeWidth={2} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "model-icon-container relative flex items-center justify-center overflow-hidden rounded-md transition-all duration-300 hover:scale-105 active:scale-95",
        className
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt={name}
        className="h-full w-full object-contain"
        onError={() => setError(true)}
      />
    </div>
  );
}
