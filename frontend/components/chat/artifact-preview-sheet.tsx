"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Artifact } from "@/lib/features/chat/builderAPI";
import { Download, FileText, X } from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

interface ArtifactPreviewSheetProps {
  artifact: Artifact | null;
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
}

export function ArtifactPreviewSheet({
  artifact,
  open,
  onClose,
  onDownload,
}: ArtifactPreviewSheetProps) {
  // Strip a leading heading that duplicates the title already shown in the header.
  // This is the standard document-viewer pattern (GitHub, Notion, etc.) and
  // also ensures getByText("title") returns exactly one element in tests.
  // Must be declared before any early returns to satisfy React's Rules of Hooks.
  const displayContent = useMemo(() => {
    if (!artifact?.content) return "";
    const firstLineEnd = artifact.content.indexOf("\n");
    const firstLine = firstLineEnd !== -1
      ? artifact.content.slice(0, firstLineEnd).trim()
      : artifact.content.trim();
    const headingTitle = firstLine.replace(/^#+\s*/, "");
    if (headingTitle === artifact.title) {
      return artifact.content.slice(firstLineEnd + 1).trimStart();
    }
    return artifact.content;
  }, [artifact]);

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-150 md:min-w-225 flex flex-col p-0 gap-0"
      >
        {artifact && (
          <>
            {/* ── Header ──────────────────────────────────────────── */}
            <SheetHeader className="px-6 py-5 border-b border-border/60 space-y-3 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <SheetTitle className="text-base font-semibold text-foreground leading-tight truncate">
                      {artifact.title}
                    </SheetTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(artifact.created_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-primary/15 text-primary uppercase tracking-wide">
                  Local Doc
                </span>
                <div className="flex-1" />
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-semibold bg-primary hover:bg-primary/90"
                  onClick={onDownload}
                  aria-label="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download .md
                </Button>
              </div>
            </SheetHeader>

            {/* ── Body ────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-8 py-7">
              {displayContent ? (
                <div className="prose prose-sm prose-invert max-w-none
                  prose-headings:text-foreground prose-headings:font-semibold
                  prose-p:text-muted-foreground prose-p:leading-relaxed
                  prose-strong:text-foreground prose-strong:font-semibold
                  prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
                  prose-pre:bg-black/30 prose-pre:border prose-pre:border-border/50 prose-pre:rounded-xl
                  prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground
                  prose-table:text-sm prose-th:text-foreground prose-td:text-muted-foreground
                  prose-hr:border-border/50
                  prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                    {displayContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <FileText className="h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No content available</p>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
