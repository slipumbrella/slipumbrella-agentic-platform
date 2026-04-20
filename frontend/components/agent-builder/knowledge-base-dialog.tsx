"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogClose
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
    clearAttachmentSelection,
    deleteAttachmentThunk,
    deleteAttachmentsBatchThunk,
    embedAttachments,
    fetchAttachments,
    selectAllAttachments,
    toggleAttachmentSelection,
    uploadFileThunk,
    uploadUrlThunk
} from "@/lib/features/agent/agentSlice";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
    CheckCircle,
    Clock3,
    Eye,
    FileText,
    Files,
    Globe,
    Link as LinkIcon,
    Loader2,
    Trash2,
    Upload,
    X
} from "lucide-react";
import { cn } from "@/lib/utils";
import React, { useState } from "react";
import { toast } from "sonner";

interface KnowledgeBaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setViewerOpen: (open: boolean) => void;
  setViewerAttachment: (attachment: { id: string; name: string } | null) => void;
  providedSessionId?: string;
  title?: string;
}

type AbortableRequest = {
  abort: () => void;
  unwrap: () => Promise<unknown>;
};

const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

const isAbortError = (error: unknown) =>
  error instanceof Error
    ? error.name === "AbortError" || error.message === "Aborted"
    : false;

const formatFileSize = (fileSize: number) => {
  if (fileSize >= 1024 * 1024) {
    return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (fileSize >= 1024) {
    return `${Math.round(fileSize / 1024)} KB`;
  }

  return `${fileSize} B`;
};

export function KnowledgeBaseDialog({
  open,
  onOpenChange,
  setViewerOpen,
  setViewerAttachment,
  providedSessionId,
  title = "Files for this agent",
}: KnowledgeBaseDialogProps) {
  const dispatch = useAppDispatch();
  const { attachments } = useAppSelector((state) => state.agent);
  const { sessionId: builderSessionId } = useAppSelector((state) => state.chat.builder);
  
  const sessionId = providedSessionId || builderSessionId;
  
  // Poll for attachment status if any is currently syncing in background
  React.useEffect(() => {
    if (!open || !sessionId || attachments.syncingIds.length === 0) return;

    const interval = setInterval(() => {
      dispatch(fetchAttachments(sessionId));
    }, 3000);

    return () => clearInterval(interval);
  }, [open, sessionId, attachments.syncingIds.length, dispatch]);

  const [urlInput, setUrlInput] = useState("");
  const [crawlBFS, setCrawlBFS] = useState(false);
  const [maxPages, setMaxPages] = useState(20);
  const [activeUploadLabel, setActiveUploadLabel] = useState<string | null>(null);
  const [uploadQueueCurrent, setUploadQueueCurrent] = useState(0);
  const [uploadQueueTotal, setUploadQueueTotal] = useState(0);
  const fileUploadRequestRef = React.useRef<AbortableRequest | null>(null);
  const urlUploadRequestRef = React.useRef<AbortableRequest | null>(null);
  const uploadCancelledRef = React.useRef(false);

  // True while any file in the queue is uploading (across the gap between sequential uploads)
  const isQueueActive = uploadQueueTotal > 0 || attachments.isUploading;

  const selectedIds = attachments.selectedIds;
  const unembeddedItems = attachments.items.filter((a) => !a.is_embedded);
  const readyCount = attachments.items.length - unembeddedItems.length;
  const waitingCount = unembeddedItems.length;
  const filesToPrepareCount = selectedIds.length > 0 ? selectedIds.length : waitingCount;
  const allUnembeddedSelected =
    unembeddedItems.length > 0 &&
    unembeddedItems.every((a) => selectedIds.includes(a.id));
  const someSelected = selectedIds.length > 0;
  const allItemsEmbedded = attachments.items.length > 0 && unembeddedItems.length === 0;
  const filesSummary =
    attachments.items.length === 0
      ? "No files yet"
      : waitingCount === 0
        ? `${readyCount} ready to use`
        : `${readyCount} ready, ${waitingCount} waiting`;
  const helperText = sessionId
    ? "Upload files or import website pages so this agent can answer with more context."
    : "Start the conversation first, then you can upload files or import website pages.";

  const handleUrlSubmit = () => {
    if (!urlInput.trim() || !sessionId) return;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlInput);
    } catch {
      toast.error("Enter a valid website address.");
      return;
    }

    const request = dispatch(
      uploadUrlThunk({
        url: parsedUrl.toString(),
        referenceId: sessionId,
        crawlBFS,
        maxPages: crawlBFS ? maxPages : undefined,
      })
    ) as AbortableRequest;
    urlUploadRequestRef.current = request;

    request
      .unwrap()
      .then((res) => {
        const attachmentCount =
          typeof res === "object" &&
          res !== null &&
          "attachments" in res &&
          Array.isArray(res.attachments)
            ? res.attachments.length
            : 1;
        setUrlInput("");
        toast.success(
          crawlBFS
            ? `Imported ${attachmentCount} pages from the website`
            : "Website page added"
        );
      })
      .catch((err) => {
        if (isAbortError(err)) {
          return;
        }
        toast.error(err?.message || "Could not import that website.");
      })
      .finally(() => {
        if (urlUploadRequestRef.current === request) {
          urlUploadRequestRef.current = null;
        }
      });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !sessionId) return;

    const files = Array.from(e.target.files);
    e.target.value = "";

    const oversized = files.filter((f) => f.size > MAX_UPLOAD_SIZE_BYTES);
    if (oversized.length > 0) {
      toast.error(
        oversized.length === 1
          ? `${oversized[0].name} exceeds the ${formatFileSize(MAX_UPLOAD_SIZE_BYTES)} limit.`
          : `${oversized.length} files exceed the ${formatFileSize(MAX_UPLOAD_SIZE_BYTES)} limit.`,
      );
      return;
    }

    uploadCancelledRef.current = false;
    setUploadQueueTotal(files.length);
    const knownAttachmentIds = new Set(attachments.items.map((item) => item.id));

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
      if (uploadCancelledRef.current) break;

      const file = files[i];
      setUploadQueueCurrent(i + 1);
      setActiveUploadLabel(file.name);

      const request = dispatch(uploadFileThunk({ file, referenceId: sessionId })) as AbortableRequest;
      fileUploadRequestRef.current = request;

      try {
        await request.unwrap();
        successCount += 1;
      } catch (err: unknown) {
        let uploadPersisted = false;
        try {
          const latest = await dispatch(fetchAttachments(sessionId)).unwrap();
          const latestAttachments = (latest as { attachments?: Array<{ id: string; original_file_name: string }> })?.attachments || [];
          uploadPersisted = latestAttachments.some(
            (item) =>
              item.original_file_name === file.name &&
              !knownAttachmentIds.has(item.id),
          );

          if (uploadPersisted) {
            latestAttachments.forEach((item) => knownAttachmentIds.add(item.id));
            successCount += 1;
            continue;
          }
        } catch {
          // Best-effort reconciliation only; if refresh fails, show original error.
        }

        if (isAbortError(err)) break;
        const msg =
          err instanceof Error
            ? err.message
            : (err as { message?: string })?.message || `Could not upload ${file.name}.`;
        toast.error(msg);
      } finally {
        // Keep the list synced after each upload attempt.
        void dispatch(fetchAttachments(sessionId));
      }
    }

    fileUploadRequestRef.current = null;
    setActiveUploadLabel(null);
    setUploadQueueTotal(0);
    setUploadQueueCurrent(0);

    if (!uploadCancelledRef.current && successCount > 0) {
      toast.success(successCount === 1 ? "File uploaded" : `${successCount} files uploaded`);
    }
  };

  const handleCancelFileUpload = () => {
    uploadCancelledRef.current = true;
    fileUploadRequestRef.current?.abort();
    fileUploadRequestRef.current = null;
    setActiveUploadLabel(null);
    setUploadQueueTotal(0);
    setUploadQueueCurrent(0);
    toast.message("Upload cancelled.");
    if (sessionId) {
      void dispatch(fetchAttachments(sessionId));
    }
  };

  const handleCancelUrlImport = () => {
    urlUploadRequestRef.current?.abort();
    urlUploadRequestRef.current = null;
    toast.message("Website import cancelled.");
    if (sessionId) {
      void dispatch(fetchAttachments(sessionId));
    }
  };

  const handleSelectAll = () => {
    if (allUnembeddedSelected) {
      dispatch(clearAttachmentSelection());
    } else {
      dispatch(selectAllAttachments());
    }
  };

  const handleEmbed = () => {
    if (!sessionId) return;
    const ids = selectedIds.length > 0 ? selectedIds : undefined;
    dispatch(embedAttachments({ referenceId: sessionId, attachmentIds: ids }))
      .unwrap()
      .then((data) => {
        toast.success(data.message || "Your files are being prepared in the background.");
      })
      .catch((err) => toast.error(err?.message || "Could not prepare the files."));
  };

  const handleDelete = (id: string) => {
    dispatch(deleteAttachmentThunk(id));
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    dispatch(deleteAttachmentsBatchThunk(selectedIds))
      .unwrap()
      .then(() => {
        toast.success(`Removed ${selectedIds.length} file${selectedIds.length === 1 ? "" : "s"}.`);
      })
      .catch((err) => toast.error(err?.message || "Could not remove the selected files."));
  };

  const isUrl = (item: { original_file_name: string; meta?: Record<string, unknown> }) =>
    typeof item.meta?.source_url === "string" || item.original_file_name.startsWith("http");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "sm:max-w-2xl max-h-[90vh] h-full w-full flex flex-col p-0 overflow-hidden bg-white border border-gray-200 shadow-[0_24px_48px_-20px_rgba(15,23,42,0.28)] rounded-2xl sm:rounded-[2rem] [&>button:last-child]:hidden"
      )}>
        <DialogHeader className="p-5 sm:p-8 pb-0 sm:pb-0 flex-none relative">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-purple-50 border border-purple-200/80 flex items-center justify-center text-purple-700">
                <Files className="h-5 w-5" />
              </div>
              {title}
            </DialogTitle>
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
          <DialogDescription className="text-sm text-gray-500 mt-2 max-w-xl leading-relaxed">
            {helperText}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <ScrollArea className="flex-none max-h-[600px] sm:max-h-none border-b border-gray-100 sm:border-0">
             <div className="px-5 sm:px-8 pt-4 sm:pt-5 pb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8 items-start">
                <div id="kb-upload-section" className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-[14px] font-bold text-gray-900 flex items-center gap-2">
                      <Upload className="h-4 w-4 text-purple-500" />
                      Upload a file
                    </h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Add documents, notes, or reference files your agent should use.
                    </p>
                  </div>
                  <div className="relative group/drop">
                    {/* File picker — hidden while queue is active so the cancel button is reachable */}
                    {!isQueueActive && (
                      <input
                        type="file"
                        multiple
                        aria-label="Upload files"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                        onChange={handleFileUpload}
                        disabled={!sessionId}
                      />
                    )}
                    <div className={cn(
                      "group border-2 border-dashed rounded-2xl py-8 px-5 flex flex-col items-center justify-center text-center transition-all duration-300 min-h-[178px]",
                      isQueueActive
                        ? "border-purple-300 bg-purple-50/40"
                        : "border-purple-100 bg-purple-50/20 group-hover/drop:bg-purple-50/50 group-hover/drop:border-purple-200 shadow-sm"
                    )}>
                      <div className="h-10 w-10 rounded-2xl bg-white shadow-sm border border-purple-50 flex items-center justify-center text-purple-500 mb-3">
                        {isQueueActive ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Upload className="h-5 w-5 group-hover/drop:scale-105 transition-transform duration-300" />
                        )}
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {isQueueActive
                          ? uploadQueueTotal > 1
                            ? `Uploading file ${uploadQueueCurrent} of ${uploadQueueTotal}…`
                            : `Uploading ${activeUploadLabel ?? "your file"}…`
                          : "Choose files or drag them here"}
                      </span>
                      <span className="mt-1 text-xs text-gray-500 max-w-xs leading-relaxed">
                        {isQueueActive
                          ? uploadQueueTotal > 1
                            ? `${activeUploadLabel ?? "Processing"} — you can cancel at any time.`
                            : "You can cancel at any time."
                          : sessionId
                            ? `PDF, DOCX, TXT, and similar files up to ${formatFileSize(MAX_UPLOAD_SIZE_BYTES)} — select multiple at once.`
                            : "Start the conversation first to unlock uploads."}
                      </span>
                      {isQueueActive && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-3 gap-1.5 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 z-30 relative"
                          onClick={handleCancelFileUpload}
                        >
                          <X className="h-3.5 w-3.5" /> Cancel upload
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div id="kb-url-section" className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-[14px] font-bold text-gray-900 flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" />
                      Import from a website
                    </h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Paste one page, or include linked pages when you want more from the same site.
                    </p>
                  </div>
                  <div className="flex flex-col bg-white p-5 rounded-2xl border border-gray-100 shadow-sm min-h-[178px] space-y-4">
                    <div className="flex flex-col gap-2.5">
                      <Input
                        placeholder="https://docs.example.com"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        className="bg-gray-50/50 h-9 text-xs w-full shadow-inner border-gray-100/50 focus:bg-white transition-all font-medium"
                        disabled={!sessionId || attachments.isCrawling}
                      />
                      <div className="flex gap-2">
                        <Button
                          className="flex-1 h-9 px-4 font-bold text-sm"
                          onClick={handleUrlSubmit}
                          disabled={attachments.isCrawling || !urlInput.trim() || !sessionId}
                        >
                          {attachments.isCrawling ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Importing...
                            </>
                          ) : (
                            "Import website"
                          )}
                        </Button>
                        {attachments.isCrawling && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 px-4 font-bold text-sm"
                            onClick={handleCancelUrlImport}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-gray-50 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <LinkIcon className="h-4 w-4 text-purple-500 shrink-0" />
                          <div className="min-w-0">
                             <p className="text-xs font-bold text-gray-900 leading-tight">Include linked pages</p>
                             <p className="text-[10px] text-gray-500 leading-tight mt-0.5">
                               Crawl more pages from the same site.
                             </p>
                          </div>
                        </div>
                        <Switch
                          checked={crawlBFS}
                          onCheckedChange={setCrawlBFS}
                          disabled={!sessionId || attachments.isCrawling}
                          className="shrink-0 scale-75"
                        />
                      </div>
                      
                      {crawlBFS && (
                        <div className="flex items-center gap-2 pl-6 animate-in fade-in slide-in-from-top-1 duration-300">
                          <span className="text-[11px] font-medium text-gray-500">Page limit</span>
                            <Input
                              type="number"
                              value={maxPages}
                              onChange={(e) => setMaxPages(Math.max(1, parseInt(e.target.value) || 1))}
                              className="h-7 w-12 text-xs px-1 text-center bg-gray-50 border-primary/20 focus:border-primary shadow-none rounded-md"
                              min={1}
                              max={20}
                              disabled={!sessionId || attachments.isCrawling}
                            />
                          <span className="text-[11px] text-gray-400">pages</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          <div
            id="kb-sources-panel"
            className="flex-1 flex flex-col min-h-0 border-t border-gray-100/60 overflow-hidden"
          >
            <div className="px-4 sm:px-8 pt-4 sm:pt-5 pb-3 flex-none">
              <div className="flex items-center justify-between gap-3 px-1 mb-2">
                <h4 id="kb-sources-header" className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                  <Files className="h-4.5 w-4.5 text-green-600" />
                  Files in this agent
                  <span className="text-[12px] font-medium text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full ml-1">
                    {filesSummary}
                  </span>
                </h4>

                {unembeddedItems.length > 0 && (
                  <div className="flex items-center gap-2 sm:gap-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`text-xs h-8 ${
                        allUnembeddedSelected ? "text-primary" : "text-gray-500"
                      }`}
                      onClick={handleSelectAll}
                    >
                      {allUnembeddedSelected ? "Clear selection" : "Select waiting"}
                    </Button>
                    {someSelected && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="text-xs h-8 px-3"
                        onClick={handleBatchDelete}
                        disabled={attachments.isDeletingIds.length > 0}
                      >
                        {attachments.isDeletingIds.length > 0 ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Remove
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1 w-full min-w-0">
              <div className="flex flex-col gap-4 px-4 sm:px-8 pt-4 pb-10 w-full overflow-hidden">
                {attachments.isLoading && attachments.items.length === 0 ? (
                  [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)
                ) : attachments.items.length === 0 ? (
                  <div className="py-16 bg-gray-50/70 rounded-3xl border border-dashed border-gray-200 flex flex-col items-center text-center px-6">
                    <Files className="h-12 w-12 mb-3 stroke-[1.5px] text-gray-300" />
                    <p className="text-sm font-semibold text-gray-700">No files added yet</p>
                    <p className="text-xs text-gray-500 mt-2 max-w-sm leading-relaxed">
                      Upload a file or import a website to give this agent more context.
                    </p>
                  </div>
                ) : (
                  attachments.items.map((item) => {
                    const itemIsUrl = isUrl(item);
                    const isSyncing = item.embedding_status === "syncing" || attachments.syncingIds?.includes(item.id) || false;
                    const isDeleting = attachments.isDeletingIds?.includes(item.id) || false;
                    const isProcessing = isSyncing || (attachments.isLoading && item.is_embedded);
                    const itemSizeLabel = item.file_size > 0
                      ? formatFileSize(item.file_size)
                      : itemIsUrl
                        ? "Website"
                        : "File";
                    const statusLabel = isDeleting
                      ? "Removing"
                      : item.is_embedded
                        ? "Ready in agent"
                        : isSyncing
                          ? "Preparing for agent"
                          : "Needs preparation";
                    const statusClassName = isDeleting
                      ? "text-red-600 bg-red-50 border-red-100"
                      : item.is_embedded
                        ? "text-green-700 bg-green-50 border-green-100"
                        : isSyncing
                          ? "text-primary bg-primary/10 border-primary/10"
                          : "text-amber-700 bg-amber-50 border-amber-100";

                    return (
                      <div
                        key={item.id}
                        className={`group relative flex items-center justify-between gap-4 p-4 rounded-2xl border transition-all duration-300 min-w-0 overflow-hidden ${
                          item.is_embedded
                            ? "bg-green-50/40 border-green-200 shadow-sm"
                            : "bg-white border-gray-200 hover:border-purple-200 hover:shadow-md"
                        }`}
                      >
                        <div className="flex items-center gap-4 min-w-0 flex-1 relative z-10">
                          {!item.is_embedded && (
                            <div className="w-4 h-4 flex items-center justify-center shrink-0">
                              {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                              ) : isProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              ) : (
                                <Checkbox
                                  checked={selectedIds.includes(item.id)}
                                  onCheckedChange={() => dispatch(toggleAttachmentSelection(item.id))}
                                  className="border-gray-300 data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-colors disabled:opacity-50"
                                />
                              )}
                            </div>
                          )}
                          {item.is_embedded && isDeleting && (
                            <div className="w-4 h-4 flex items-center justify-center shrink-0">
                                <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                            </div>
                          )}

                          <div className={`h-12 w-12 shrink-0 rounded-2xl flex items-center justify-center border ${
                            item.is_embedded 
                              ? "bg-white border-green-100 text-green-700"
                              : "bg-purple-50 border-purple-100 text-purple-600"
                          }`}>
                            {itemIsUrl ? <Globe className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold text-gray-900 line-clamp-1 break-all">
                              {item.original_file_name}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <span className="text-[10px] text-gray-500 font-semibold bg-gray-50 px-2 py-1 rounded-full border border-gray-100">
                                {itemIsUrl ? "Website" : "File"}
                              </span>
                              <span className="text-[10px] text-gray-500 font-semibold bg-gray-50 px-2 py-1 rounded-full border border-gray-100">
                                {itemSizeLabel}
                              </span>
                              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border inline-flex items-center gap-1.5 ${statusClassName}`}>
                                {isDeleting ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : item.is_embedded ? (
                                  <CheckCircle className="h-3 w-3" />
                                ) : isSyncing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Clock3 className="h-3 w-3" />
                                )}
                                {statusLabel}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 ml-auto sm:ml-6 border-l border-gray-100/80 pl-3 sm:pl-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-all duration-300 relative z-10 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-gray-400 hover:text-primary hover:bg-primary/10 transition-all rounded-xl shadow-none"
                            onClick={() => {
                              setViewerAttachment({ id: item.id, name: item.original_file_name });
                              setViewerOpen(true);
                            }}
                          >
                            <Eye className="h-4.5 w-4.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all rounded-xl shadow-none"
                            onClick={() => handleDelete(item.id)}
                          >
                            <Trash2 className="h-4.5 w-4.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between gap-3 flex-none">
          <div className="text-xs text-gray-500 font-medium max-w-[280px] leading-relaxed">
            Files are encrypted and processed securely before the agent uses them.
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            {attachments.items.length > 0 && (
              <Button
                onClick={handleEmbed}
                disabled={attachments.isEmbedding || !sessionId || allItemsEmbedded}
                className="min-w-[140px]"
              >
                {attachments.isEmbedding ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Preparing files
                  </>
                ) : allItemsEmbedded ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" /> All files ready
                  </>
                ) : (
                  <>
                    <Files className="h-4 w-4 mr-2" /> Prepare {filesToPrepareCount} file{filesToPrepareCount === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
