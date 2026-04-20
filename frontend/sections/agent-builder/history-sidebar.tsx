"use client";

import { Button } from "@/components/ui/button";
import {
    fetchBuilderSessions,
    resetBuilderSession,
    switchBuilderSession,
} from "@/lib/features/chat/chatSlice";
import { resetAgentState } from "@/lib/features/agent/agentSlice";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
    Check,
    History,
    MessageSquare,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    Search,
} from "lucide-react";
import React, { useEffect, useState } from "react";

const RECENT_SESSION_BADGE_MS = 90_000;

export function HistorySidebar({
    className,
    defaultCollapsed = true,
    variant = "sidebar",
    rightAction,
}: {
    className?: string;
    defaultCollapsed?: boolean;
    variant?: "sidebar" | "bar";
    rightAction?: React.ReactNode;
}) {
    const dispatch = useAppDispatch();
    const { chatHistory } = useAppSelector((state) => state.chat);
    const sessionId = useAppSelector((state) => state.chat.builder.sessionId);
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
    const [searchQuery, setSearchQuery] = useState("");
    const [recentSessionMarker, setRecentSessionMarker] = useState<{
        id: string;
        expiresAt: number;
    } | null>(null);
    const [isBarVisible, setIsBarVisible] = useState(true);
    const lastTouchYRef = React.useRef<number | null>(null);

    useEffect(() => {
        dispatch(fetchBuilderSessions());
    }, [dispatch]);

    useEffect(() => {
        if (!sessionId) {
            return;
        }

        const activeSession = chatHistory.find((item) => item.id === sessionId);
        if (activeSession?.syncStatus !== "pending_create") {
            return;
        }

        const timer = window.setTimeout(() => {
            setRecentSessionMarker((current) => {
                if (current?.id === sessionId) {
                    return current;
                }

                return {
                    id: sessionId,
                    expiresAt: Date.now() + RECENT_SESSION_BADGE_MS,
                };
            });
        }, 0);

        return () => window.clearTimeout(timer);
    }, [chatHistory, sessionId]);

    useEffect(() => {
        if (!recentSessionMarker) {
            return;
        }

        const remainingMs = recentSessionMarker.expiresAt - Date.now();
        const nextDelay = sessionId !== recentSessionMarker.id
            ? 0
            : Math.max(remainingMs, 0);

        const timer = window.setTimeout(() => {
            setRecentSessionMarker((current) =>
                current?.id === recentSessionMarker.id ? null : current,
            );
        }, nextDelay);

        return () => window.clearTimeout(timer);
    }, [recentSessionMarker, sessionId]);

    const handleNewChat = (): void => {
        dispatch(resetBuilderSession());
        dispatch(resetAgentState());
    };

    const handleSelectSession = (nextSessionId: string): void => {
        if (nextSessionId === sessionId) {
            return;
        }

        dispatch(switchBuilderSession({ sessionId: nextSessionId }));
    };

    const toggleCollapse = (): void => {
        setIsCollapsed((prev) => !prev);
    };

    const normalizedSearch = searchQuery.trim().toLowerCase();
    const filteredHistory = chatHistory.filter((item) =>
        item.title?.toLowerCase().includes(normalizedSearch),
    );
    const shouldShowSearch = chatHistory.length > 6;

    const isSessionNew = (historyId: string): boolean =>
        recentSessionMarker?.id === historyId && sessionId === historyId;

    useEffect(() => {
        if (variant !== "bar") {
            return;
        }

        const onWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaY) < 6) {
                return;
            }

            setIsBarVisible(event.deltaY < 0);
        };

        const onTouchStart = (event: TouchEvent) => {
            lastTouchYRef.current = event.touches[0]?.clientY ?? null;
        };

        const onTouchMove = (event: TouchEvent) => {
            const nextY = event.touches[0]?.clientY;
            const previousY = lastTouchYRef.current;

            if (typeof nextY !== "number" || typeof previousY !== "number") {
                lastTouchYRef.current = nextY ?? null;
                return;
            }

            const deltaY = nextY - previousY;
            if (Math.abs(deltaY) >= 6) {
                setIsBarVisible(deltaY > 0);
            }

            lastTouchYRef.current = nextY;
        };

        window.addEventListener("wheel", onWheel, { passive: true });
        window.addEventListener("touchstart", onTouchStart, { passive: true });
        window.addEventListener("touchmove", onTouchMove, { passive: true });

        return () => {
            window.removeEventListener("wheel", onWheel);
            window.removeEventListener("touchstart", onTouchStart);
            window.removeEventListener("touchmove", onTouchMove);
        };
    }, [variant]);

    if (variant === "bar") {
        return (
            <div
                data-mobile-bar-visible={isBarVisible ? "true" : "false"}
                className={cn(
                    "lg:hidden w-full max-w-full min-w-0 shrink-0 overflow-hidden border-b border-gray-200/70 bg-white/90 backdrop-blur-xl transition-[max-height,opacity] duration-200 z-40",
                    isBarVisible ? "max-h-20 opacity-100" : "max-h-0 opacity-0 border-b-transparent",
                    className,
                )}
            >
                <div className="flex h-16 w-max min-w-full items-center gap-2 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleNewChat}
                        className="h-10 shrink-0 rounded-full border border-purple-200 bg-purple-50 px-4 text-sm font-semibold text-purple-700 hover:bg-purple-100"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        New session
                    </Button>

                    <div className="h-6 w-px shrink-0 bg-gray-200" />

                    {chatHistory.length === 0 ? (
                        <div className="shrink-0 rounded-full border border-dashed border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-500">
                            No saved sessions yet
                        </div>
                    ) : (
                        chatHistory.map((history) => {
                            const isActive = sessionId === history.id;
                            const isNew = isSessionNew(history.id);

                            return (
                                <Button
                                    key={history.id}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleSelectSession(history.id)}
                                    aria-current={isActive ? "page" : undefined}
                                    className={cn(
                                        "h-11 shrink-0 rounded-full border px-4 text-left transition-colors",
                                        isActive
                                            ? "border-purple-300 bg-purple-50 text-gray-950"
                                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50",
                                    )}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium">
                                                {history.title}
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                                <span>{history.time}</span>
                                                {isNew ? (
                                                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700 ring-1 ring-purple-200">
                                                        New
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                </Button>
                            );
                        })
                    )}

                    {rightAction ? (
                        <div className="ml-2 flex shrink-0 items-center border-l border-gray-200 pl-3 pr-4">
                            {rightAction}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={false}
            animate={{ width: isCollapsed ? 80 : 296 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className={cn(
                "hidden xl:flex h-full shrink-0 flex-col overflow-hidden border-r border-gray-200/80 bg-white/85 backdrop-blur-xl",
                className,
            )}
        >
            <div className="flex h-16 items-center gap-3 border-b border-gray-200/70 px-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleCollapse}
                    className="h-10 w-10 shrink-0 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    aria-label={isCollapsed ? "Open session history" : "Collapse session history"}
                >
                    {isCollapsed ? (
                        <PanelLeftOpen className="h-5 w-5" />
                    ) : (
                        <PanelLeftClose className="h-5 w-5" />
                    )}
                </Button>

                <AnimatePresence initial={false}>
                    {!isCollapsed ? (
                        <motion.div
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                            className="flex min-w-0 flex-1 items-center justify-between gap-3"
                        >
                            <p className="text-sm font-semibold text-gray-900">
                                Sessions
                            </p>
                            <Button
                                onClick={handleNewChat}
                                className="h-10 rounded-xl bg-purple-600 px-3 text-sm font-semibold text-white hover:bg-purple-700"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                New
                            </Button>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
                <AnimatePresence mode="wait" initial={false}>
                    {!isCollapsed ? (
                        <motion.div
                            key="expanded"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex min-h-0 flex-1 flex-col"
                        >
                            {shouldShowSearch ? (
                                <div className="border-b border-gray-100 px-4 py-3">
                                    <label className="relative block">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                        <span className="sr-only">Search sessions</span>
                                        <input
                                            value={searchQuery}
                                            onChange={(event) => setSearchQuery(event.target.value)}
                                            placeholder="Search sessions"
                                            className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm text-gray-700 placeholder:text-gray-400 focus:border-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-200"
                                        />
                                    </label>
                                </div>
                            ) : null}

                            <div className="flex items-center gap-2 px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                                <History className="h-3.5 w-3.5" />
                                Session history
                            </div>

                            <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-6 custom-scrollbar">
                                {filteredHistory.length === 0 ? (
                                    <div className="px-4 py-12 text-center">
                                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
                                            <MessageSquare className="h-5 w-5" />
                                        </div>
                                        <p className="text-sm font-medium text-gray-700">
                                            {normalizedSearch
                                                ? "No sessions match that search."
                                                : "No saved sessions yet."}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-500">
                                            Start a new conversation and it will appear here.
                                        </p>
                                    </div>
                                ) : (
                                    filteredHistory.map((history) => {
                                        const isActive = sessionId === history.id;
                                        const isNew = isSessionNew(history.id);

                                        return (
                                            <button
                                                key={history.id}
                                                type="button"
                                                onClick={() => handleSelectSession(history.id)}
                                                aria-current={isActive ? "page" : undefined}
                                                className={cn(
                                                    "w-full rounded-2xl border px-4 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-purple-200",
                                                    isActive
                                                        ? "border-purple-300 bg-purple-50/70 shadow-sm"
                                                        : "border-transparent bg-white hover:border-gray-200 hover:bg-gray-50",
                                                )}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p
                                                                className={cn(
                                                                    "truncate text-sm font-semibold",
                                                                    isActive ? "text-gray-950" : "text-gray-700",
                                                                )}
                                                            >
                                                                {history.title}
                                                            </p>
                                                            {isNew ? (
                                                                <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700 ring-1 ring-purple-200">
                                                                    New
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <p className="mt-1 text-xs text-gray-400">
                                                            {history.time}
                                                        </p>
                                                    </div>
                                                    {isActive ? (
                                                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
                                                    ) : null}
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="collapsed"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex flex-1 flex-col items-center gap-3 overflow-y-auto py-4"
                        >
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleNewChat}
                                className="h-10 w-10 flex-none rounded-xl bg-purple-600 text-white hover:bg-purple-700"
                                title="New session"
                                aria-label="Start a new session"
                            >
                                <Plus className="h-5 w-5" />
                            </Button>

                            <div className="my-1 h-px w-8 bg-gray-200" />

                            {chatHistory.slice(0, 10).map((history) => {
                                const isActive = sessionId === history.id;
                                const isNew = isSessionNew(history.id);

                                return (
                                    <button
                                        key={history.id}
                                        type="button"
                                        onClick={() => handleSelectSession(history.id)}
                                        title={history.title}
                                        aria-current={isActive ? "page" : undefined}
                                        className={cn(
                                            "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors focus:outline-none focus:ring-2 focus:ring-purple-200",
                                            isActive
                                                ? "border-purple-300 bg-purple-50 text-purple-700"
                                                : "border-transparent bg-white text-gray-500 hover:border-gray-200 hover:bg-gray-50",
                                        )}
                                    >
                                        <MessageSquare className="h-4 w-4" />
                                        {isNew ? (
                                            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-purple-600 ring-2 ring-white" />
                                        ) : null}
                                    </button>
                                );
                            })}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}
