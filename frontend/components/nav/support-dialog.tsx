"use client";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createIssue } from "@/lib/features/issue/issueSlice";
import { useAppDispatch } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { AlertTriangle, Bug, Lightbulb, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

type IssueType = "bug" | "feature" | "general";

interface SupportFormState {
    readonly issueType: IssueType;
    readonly subject: string;
    readonly description: string;
}

const ISSUE_TYPES: ReadonlyArray<{ readonly value: IssueType; readonly label: string; readonly icon: React.ElementType; readonly color: string }> = [
    { value: "bug", label: "Bug Report", icon: Bug, color: "text-red-600 bg-red-50 border-red-200 hover:bg-red-100" },
    { value: "feature", label: "Feature Request", icon: Lightbulb, color: "text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100" },
    { value: "general", label: "General Issue", icon: AlertTriangle, color: "text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100" },
];

const INITIAL_FORM: SupportFormState = {
    issueType: "general",
    subject: "",
    description: "",
};

export function SupportDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [form, setForm] = useState<SupportFormState>(INITIAL_FORM);

    const isFormValid = form.subject.trim().length > 0 && form.description.trim().length > 0;

    const dispatch = useAppDispatch();

    const getErrorMessage = (error: unknown): string => {
        if (error instanceof Error && error.message) {
            return error.message;
        }

        if (
            typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
        ) {
            return error.message;
        }

        return "Failed to submit issue. Please try again.";
    };

    const handleSubmit = async (): Promise<void> => {
        if (!isFormValid) return;

        setIsSubmitting(true);
        try {
            await dispatch(createIssue({
                type: form.issueType,
                subject: form.subject,
                description: form.description
            })).unwrap();

            toast.success("Issue submitted successfully! We'll get back to you soon.");
            setForm(INITIAL_FORM);
            setIsOpen(false);
        } catch (error: unknown) {
            toast.error(getErrorMessage(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <button className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground w-full">
                    <MessageCircleQuestion className="h-4 w-4" />
                    Support
                </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px] glass-strong border border-gray-200/60">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <div className="h-8 w-8 rounded-lg bg-linear-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-md">
                            <MessageCircleQuestion className="h-4 w-4 text-white" />
                        </div>
                        Report an Issue
                    </DialogTitle>
                    <DialogDescription>
                        Describe the issue you&apos;re experiencing and we&apos;ll look into it.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mt-2">
                    {/* Issue Type Selector */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Issue Type</label>
                        <div className="grid grid-cols-3 gap-2">
                            {ISSUE_TYPES.map(({ value, label, icon: Icon, color }) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setForm((prev) => ({ ...prev, issueType: value }))}
                                    className={cn(
                                        "flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all duration-200 cursor-pointer",
                                        form.issueType === value
                                            ? `${color} ring-2 ring-offset-1 ring-current shadow-sm`
                                            : "bg-white/40 border-gray-200/60 text-gray-500 hover:bg-white/60"
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Subject */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Subject</label>
                        <Input
                            placeholder="Brief summary of the issue..."
                            value={form.subject}
                            onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                            className="bg-white/40 border-gray-200/60 focus:border-purple-400"
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Description</label>
                        <Textarea
                            placeholder="Describe the issue in detail. Include steps to reproduce if applicable..."
                            value={form.description}
                            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                            className="min-h-[120px] bg-white/40 border-gray-200/60 focus:border-purple-400 resize-none"
                        />
                    </div>

                    {/* Submit */}
                    <Button
                        onClick={handleSubmit}
                        disabled={!isFormValid || isSubmitting}
                        className="w-full bg-linear-to-r from-purple-600 to-blue-600 hover:opacity-90 text-white shadow-md rounded-xl disabled:opacity-50 cursor-pointer"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Submitting...
                            </>
                        ) : (
                            <>
                                <Send className="h-4 w-4 mr-2" />
                                Submit Issue
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
