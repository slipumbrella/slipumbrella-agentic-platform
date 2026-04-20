"use client";

import React from "react";

import { BuilderTutorial } from "@/components/agent-builder/builder-tutorial";
import { LightRays } from "@/components/ui/light-rays";
import { setTutorialActive, setTutorialStep } from "@/lib/features/chat/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { ChatInterface } from "@/sections/agent-builder/chat-interface";
import { ConfigSidebar } from "@/sections/agent-builder/config-sidebar";
import { HistorySidebar } from "@/sections/agent-builder/history-sidebar";
import { motion } from "framer-motion";
import { MessageSquare, Settings2 } from "lucide-react";

export default function AgentBuilderPage() {
    const [activeTab, setActiveTab] = React.useState<'chat' | 'data'>('chat');
    const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
    const dispatch = useAppDispatch();
    const { messages, sessionId, isSwitchingSession, isTutorialActive, tutorialStep } = useAppSelector((state) => state.chat.builder);
    const chatTabId = "builder-chat-tab";
    const dataTabId = "builder-data-tab";
    const chatPanelId = "builder-chat-panel";
    const dataPanelId = "builder-data-panel";

    const hasStarted = messages.length > 0 || isSwitchingSession || !!sessionId;
    const showTutorialSidebar = isTutorialActive && tutorialStep >= 1;
    const useSplitLayout = hasStarted || showTutorialSidebar;
    const mainLayoutMode = useSplitLayout ? "split" : "full";
    const sidebarState = useSplitLayout ? "visible" : "hidden";

    React.useEffect(() => {
        if (isTutorialActive) {
            if (tutorialStep === 0) {
                setActiveTab('chat');
            } else {
                setActiveTab('data');
            }
        } else if (messages.length === 0) {
            setActiveTab('chat');
        }
    }, [isTutorialActive, tutorialStep, messages.length]);

    React.useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return;
        }

        const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        const syncMotionPreference = () => setPrefersReducedMotion(mediaQuery.matches);

        syncMotionPreference();
        mediaQuery.addEventListener("change", syncMotionPreference);

        return () => {
            mediaQuery.removeEventListener("change", syncMotionPreference);
        };
    }, []);

    return (
        <div className="relative flex min-h-[calc(100svh-3.5rem)] h-[calc(100dvh-3.5rem)] w-full min-w-0 flex-col overflow-hidden bg-background">
            {/* Background enhancement with LightRays */}
            {!prefersReducedMotion ? (
                <LightRays
                    color="rgba(139, 92, 246, 0.15)"
                    count={12}
                    speed={15}
                    className="opacity-80"
                />
            ) : null}

            {/* Mobile: Responsive Session History Bar */}
            <HistorySidebar 
                variant="bar" 
                className="lg:hidden" 
            />

            {/* Mobile: Tab Switcher (Segmented Control) */}
            <div className="md:hidden border-b border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-md shrink-0">
                <div
                    className="relative flex overflow-hidden rounded-xl border border-border bg-muted/70 p-0.5"
                    role="tablist"
                    aria-label="Builder panel switcher"
                >
                    {/* Active Sliding Background */}
                    <motion.div
                        className="pointer-events-none absolute inset-y-0.5 rounded-lg border border-border bg-card shadow-sm"
                        initial={false}
                        animate={{
                            x: activeTab === 'chat' ? 0 : '100%',
                            width: 'calc(50% - 2px)'
                        }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />

                    <button
                        id={chatTabId}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'chat'}
                        aria-controls={chatPanelId}
                        onClick={() => setActiveTab('chat')}
                        className={cn(
                            "relative z-10 flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
                            activeTab === 'chat' ? "text-primary" : "text-muted-foreground"
                        )}
                    >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Chat
                    </button>
                    <button
                        id={dataTabId}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'data'}
                        aria-controls={dataPanelId}
                        onClick={() => setActiveTab('data')}
                        className={cn(
                            "relative z-10 flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
                            activeTab === 'data' ? "text-primary" : "text-muted-foreground"
                        )}
                    >
                        <Settings2 className="h-3.5 w-3.5" />
                        Data
                    </button>
                </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 md:flex-row">
                <HistorySidebar />

                <div
                    id={chatPanelId}
                    role="tabpanel"
                    aria-labelledby={chatTabId}
                    data-builder-layout={mainLayoutMode}
                    className={cn(
                        "min-h-0 min-w-0 flex-1",
                        activeTab === 'chat'
                            ? "flex"
                            : useSplitLayout
                                ? "hidden md:flex"
                                : "hidden",
                    )}
                >
                    <ChatInterface layoutMode={mainLayoutMode} />
                </div>

                <div
                    id={dataPanelId}
                    role="tabpanel"
                    aria-labelledby={dataTabId}
                    data-builder-sidebar={sidebarState}
                    className={cn(
                        "min-h-0 shrink-0",
                        activeTab === 'data'
                            ? useSplitLayout
                                ? "flex flex-1 md:w-[19rem] md:flex-none xl:w-80"
                                : "flex flex-1 md:hidden"
                            : useSplitLayout
                                ? "hidden md:flex md:w-[19rem] md:flex-none xl:w-80"
                                : "hidden",
                    )}
                >
                    <ConfigSidebar
                        className={cn(
                            activeTab === 'data'
                                ? "flex !w-full md:!w-[19rem] md:!flex-none xl:!w-80"
                            : useSplitLayout
                                ? "md:!flex md:!w-[19rem] md:!flex-none xl:!w-80"
                                : undefined,
                        )}
                    />
                </div>
            </div>

            <BuilderTutorial 
                open={isTutorialActive} 
                onOpenChange={(open) => dispatch(setTutorialActive(open))} 
                onStepChange={(step) => dispatch(setTutorialStep(step))}
            />
        </div>
    );
}
