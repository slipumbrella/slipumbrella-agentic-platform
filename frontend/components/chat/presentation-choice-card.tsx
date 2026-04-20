"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessagesSquare, Network } from "lucide-react";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PresentationChoiceCardProps {
  question: string;
  promptId: string;
  originalMessage: string;
  sessionId: string;
  onChoose: (choice: "workflow" | "chat") => void;
}

export function PresentationChoiceCard({
  question,
  onChoose,
}: PresentationChoiceCardProps) {
  const [chosen, setChosen] = React.useState<"workflow" | "chat" | null>(null);

  const handleChoose = (choice: "workflow" | "chat") => {
    if (chosen) return;
    setChosen(choice);
    onChoose(choice);
  };

  return (
    <div className="flex flex-col max-w-[80%] min-w-0 gap-2">
      <div className="flex p-4 rounded-2xl min-w-0 bg-white/50 backdrop-blur-md border border-white/25 text-gray-800 rounded-tl-none shadow-sm">
        <div className="text-sm leading-relaxed prose prose-sm prose-gray max-w-none prose-p:my-1">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{question}</ReactMarkdown>
        </div>
      </div>
      <div className="flex gap-2 ml-1">
        <Button
          size="sm"
          className={cn(
            "rounded-full gap-1.5",
            chosen === "workflow"
              ? "bg-indigo-700 text-white"
              : "bg-indigo-600 hover:bg-indigo-700 text-white",
          )}
          disabled={chosen !== null}
          onClick={() => handleChoose("workflow")}
        >
          <Network className="h-3.5 w-3.5" />
          Show as Workflow
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={cn(
            "rounded-full gap-1.5 border-slate-300 text-slate-600",
            chosen === null ? "hover:bg-slate-50" : "border-slate-400 text-slate-700",
          )}
          disabled={chosen !== null}
          onClick={() => handleChoose("chat")}
        >
          <MessagesSquare className="h-3.5 w-3.5" />
          Keep in Chat
        </Button>
      </div>
    </div>
  );
}
