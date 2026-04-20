"use client";

import React, { useState } from "react";
import { Upload, Link as LinkIcon, FileText, Globe, Plus, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import { DataQualityGauge } from "@/components/agent-builder/data-quality-gauge";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { uploadFileThunk, uploadUrlThunk } from "@/lib/features/agent/agentSlice";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function DataSourcesPanel() {
    const dispatch = useAppDispatch();
    const { attachments } = useAppSelector((state) => state.agent);
    const { sessionId } = useAppSelector((state) => state.chat.builder);

    const totalItems = attachments.items.length;
    const embeddedCount = attachments.items.filter(a => a.is_embedded).length;
    const baseScore = totalItems > 0 ? 40 : 0;
    const itemBonus = Math.min(totalItems * 10, 30);
    const embedBonus = Math.min(embeddedCount * 10, 30);
    const dataQualityScore = Math.min(baseScore + itemBonus + embedBonus, 100);

    const [urlInput, setUrlInput] = useState("");
    const [isQueueRunning, setIsQueueRunning] = useState(false);

    const isUrl = (name: string) => name.startsWith("http");

    const handleUrlSubmit = () => {
        if (!urlInput.trim() || !sessionId) return;

        try {
            new URL(urlInput);
        } catch {
            toast.error("Please enter a valid URL (e.g., https://example.com)");
            return;
        }

        toast.promise(
            dispatch(uploadUrlThunk({ url: urlInput, referenceId: sessionId })).unwrap(),
            {
                loading: "Scraping URL...",
                success: "Website scraped successfully",
                error: (err) => err?.message || "Failed to scrape URL",
            },
        );
        setUrlInput("");
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length || !sessionId) return;

        const files = Array.from(e.target.files);
        e.target.value = "";
        setIsQueueRunning(true);

        let successCount = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const label = files.length > 1 ? `${file.name} (${i + 1}/${files.length})` : file.name;
            const toastId = toast.loading(`Uploading ${label}...`);
            try {
                await dispatch(uploadFileThunk({ file, referenceId: sessionId })).unwrap();
                successCount++;
                toast.dismiss(toastId);
            } catch (err: unknown) {
                const msg =
                    err instanceof Error
                        ? err.message
                        : (err as { message?: string })?.message || "Failed to upload file";
                toast.error(msg, { id: toastId });
            }
        }

        setIsQueueRunning(false);
        if (successCount > 0) {
            toast.success(successCount === 1 ? "File uploaded successfully" : `${successCount} files uploaded`);
        }
    };

    const files = attachments.items.filter(a => !isUrl(a.original_file_name));
    const urls = attachments.items.filter(a => isUrl(a.original_file_name));

    return (
        <div className="w-96 bg-card border-l border-border h-full flex flex-col overflow-hidden">
            <div className="p-6 border-b">
                <h2 className="font-semibold text-lg text-foreground mb-1">Data Sources</h2>
                <p className="text-xs text-muted-foreground">Manage knowledge base for your agents</p>
            </div>

            <ScrollArea className="flex-1 p-6">
                <div className="space-y-8">
                    {/* Data Quality Section using Gauge */}
                    <div className="flex flex-col items-center">
                        <div style={{ width: 160, height: 160 }}>
                            <DataQualityGauge score={dataQualityScore} className="border-none shadow-none p-0 w-full h-full" />
                        </div>
                    </div>

                    {/* Upload Section */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                            <Upload className="h-4 w-4 text-purple-500" /> Upload Knowledge
                        </h3>

                        <div className="relative group">
                            {!isQueueRunning && !attachments.isUploading && (
                                <input
                                    type="file"
                                    multiple
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                    onChange={handleFileUpload}
                                    disabled={!sessionId}
                                />
                            )}
                            <div className={cn(
                                "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors",
                                isQueueRunning || attachments.isUploading ? "bg-gray-50 border-gray-200" : "bg-purple-50 border-purple-200 group-hover:border-purple-300"
                            )}>
                                {isQueueRunning || attachments.isUploading ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <Loader2 className="h-8 w-8 text-purple-500 animate-spin" />
                                        <span className="text-xs text-gray-500">Uploading...</span>
                                    </div>
                                ) : (
                                    <>
                                        <FileText className="h-8 w-8 text-purple-400 mb-2" />
                                        <span className="text-sm font-medium text-purple-700">Click to Upload</span>
                                        <span className="text-xs text-gray-500 mt-1">PDF, DOCX, TXT — select multiple</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Website Section */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                            <Globe className="h-4 w-4 text-blue-500" /> Add Website
                        </h3>
                        <div className="flex gap-2">
                            <Input
                                placeholder="https://example.com"
                                value={urlInput}
                                onChange={(e) => setUrlInput(e.target.value)}
                                className="h-9 text-sm"
                                disabled={!sessionId}
                            />
                            <Button size="sm" onClick={handleUrlSubmit} disabled={!sessionId || attachments.isUploading} className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 w-9 p-0 shrink-0">
                                {attachments.isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>

                    {/* Lists Section */}
                    <div className="space-y-6 pt-4 border-t">
                        {/* Files List */}
                        <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Uploaded Files</h4>
                            {files.length === 0 ? (
                                <p className="text-sm text-gray-400 italic">No files uploaded yet.</p>
                            ) : (
                                <div className="space-y-2">
                                    {files.map(file => (
                                        <div key={file.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted border border-border">
                                            <div className="h-8 w-8 rounded bg-white flex items-center justify-center border shrink-0">
                                                <FileText className="h-4 w-4 text-gray-500" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-gray-700 truncate" title={file.original_file_name}>{file.original_file_name}</p>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-gray-400">{(file.file_size / 1024).toFixed(0)} KB</span>
                                                    {file.is_embedded && (
                                                        <span className="text-[10px] text-green-600 flex items-center gap-0.5">
                                                            <CheckCircle2 className="h-2.5 w-2.5" /> Embedded
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Websites List */}
                        <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Websites</h4>
                            {urls.length === 0 ? (
                                <p className="text-sm text-gray-400 italic">No websites added yet.</p>
                            ) : (
                                <div className="space-y-2">
                                    {urls.map(item => (
                                        <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted border border-border">
                                            <div className="h-8 w-8 rounded bg-white flex items-center justify-center border shrink-0">
                                                <LinkIcon className="h-4 w-4 text-blue-400" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-gray-700 truncate" title={item.original_file_name}>{item.original_file_name.replace(/^https?:\/\//, '')}</p>
                                                <div className="flex items-center gap-1">
                                                    {item.is_embedded ? (
                                                        <span className="text-[10px] text-green-600 flex items-center gap-0.5">
                                                            <CheckCircle2 className="h-2.5 w-2.5" /> Embedded
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] uppercase font-bold tracking-wider text-yellow-500">Scraped</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}
