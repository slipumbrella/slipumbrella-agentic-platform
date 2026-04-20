"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { getAttachmentContent } from "@/lib/features/agent/uploadAPI";
import { Code, Eye, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface MarkdownViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attachmentId: string | null;
  fileName: string;
}

export function MarkdownViewerDialog({
  open,
  onOpenChange,
  attachmentId,
  fileName,
}: MarkdownViewerDialogProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [viewRaw, setViewRaw] = useState(false);

  // Consider it markdown if it or its original filename ends in .md
  // or if it's a PDF/Image which we know the backend OCRs into markdown
  const isOcrFile = fileName.toLowerCase().endsWith(".pdf") || 
                    /\.(jpg|jpeg|png|webp|gif)$/i.test(fileName);
  const isMarkdown = fileName.toLowerCase().endsWith(".md") || isOcrFile;

  useEffect(() => {
    if (!open || !attachmentId) return;

    let mounted = true;
    const loadContent = async () => {
      setLoading(true);
      setContent("");
      setViewRaw(false);

      try {
        const data = await getAttachmentContent(attachmentId);
        if (mounted) {
          setContent(data);
        }
      } catch {
        if (mounted) {
          setContent("Failed to load content.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadContent();

    return () => {
      mounted = false;
    };
  }, [open, attachmentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-screen lg:max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white/95 backdrop-blur-xl border border-white/20 shadow-2xl">
        <DialogHeader className="p-6 pb-4 border-b border-gray-100 flex flex-row items-center justify-between space-y-0 pr-12">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold">
              {isMarkdown ? <Code className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-xl font-bold text-gray-900 truncate pr-4">
                {fileName}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Preview of the document content extracted from {fileName}.
              </DialogDescription>
              <p className="text-xs text-gray-500 font-medium tracking-tight">
                {isOcrFile ? "OCR-EXTRACTED KNOWLEDGE" : "DOCUMENT PREVIEW"}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 bg-white/50 scrollbar-none">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-32 space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
              <p className="text-sm font-medium text-gray-400 animate-pulse">Reading document...</p>
            </div>
          ) : (
            <div className="p-8 max-w-3xl mx-auto">
              {!viewRaw ? (
                <div className="prose prose-sm prose-gray max-w-none prose-p:leading-relaxed prose-pre:bg-gray-50/80 prose-pre:border prose-pre:border-gray-100 prose-pre:text-gray-800 prose-headings:text-gray-900 prose-a:text-primary font-sans antialiased text-gray-800">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw, rehypeSanitize]}
                    components={{
                      code: ({ inline, ...props }: { inline?: boolean } & React.ComponentPropsWithoutRef<"code">) => (
                        <code 
                          className={inline 
                            ? "bg-gray-100/80 text-gray-900 px-1.5 py-0.5 rounded-md font-bold before:content-none after:content-none" 
                            : "text-inherit bg-transparent p-0 border-none"
                          } 
                          {...props} 
                        />
                      ),
                      table: (props) => (
                        <div className="my-6 w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                          <table className="min-w-full border-collapse text-sm text-gray-800" {...props} />
                        </div>
                      ),
                      th: (props) => (
                        <th
                          className="border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-700"
                          {...props}
                        />
                      ),
                      td: (props) => (
                        <td className="border border-gray-200 px-3 py-2 align-top text-sm text-gray-800" {...props} />
                      ),
                      tr: (props) => <tr className="even:bg-gray-50/40" {...props} />,
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-6 font-mono text-[13px] leading-relaxed text-gray-700 whitespace-pre-wrap break-all shadow-inner">
                  {content}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50/30 flex items-center justify-between px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewRaw(!viewRaw)}
            className={`h-9 px-4 gap-2 font-bold transition-all duration-300 ${
              viewRaw 
                ? 'bg-primary/10 text-primary hover:bg-primary/20' 
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {viewRaw ? (
              <>
                <Eye className="h-4 w-4" />
                <span>Show Rendered</span>
              </>
            ) : (
              <>
                <Code className="h-4 w-4" />
                <span>View Raw Content</span>
              </>
            )}
          </Button>

          <Button variant="ghost" onClick={() => onOpenChange(false)} className="px-8 font-bold text-gray-500 hover:text-gray-900 border border-transparent hover:border-gray-200">
            Close Preview
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
