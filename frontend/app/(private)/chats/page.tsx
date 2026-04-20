"use client";

import { ChatInterface } from "@/sections/chat/chat-interface";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { setActiveSessionId, setSelectedTeam } from "@/lib/features/agent/agentSlice";
import { getTeamIdForSession } from "@/lib/features/agent/teamSessionUtils";
import {
    clearSupervisorChat,
    closeActiveSupervisorConnection,
    fetchExecutionAgents,
    fetchExecutionArtifacts,
    loadSupervisorHistory,
    setExecSessionId,
    setSelectedAgent,
} from "@/lib/features/chat/chatSlice";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { ChatList } from "@/sections/chat/chat-list";
import { ChatSidebar } from "@/sections/chat/chat-sidebar";
import { Menu } from "lucide-react";

/** Reads exec_session_id from URL query params and seeds Redux on navigation. */
function ExecSessionSeeder() {
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const currentExecSessionId = useAppSelector((s) => s.chat.supervisor.execSessionId);
  const { executionSessions, teams } = useAppSelector((s) => s.agent);
    const lastSeenUrlSelectionRef = useRef<string | null>(null);
    const lastAppliedUrlSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    const id = searchParams.get("exec_session_id");
        const agentId = searchParams.get("agent_id");
        const requestedTeamId = searchParams.get("team_id");

        if (!id) {
            lastSeenUrlSelectionRef.current = null;
            lastAppliedUrlSelectionRef.current = null;
            return;
        }

        const urlSelectionKey = `${id}:${agentId ?? ""}:${requestedTeamId ?? ""}`;
        const urlChanged = lastSeenUrlSelectionRef.current !== urlSelectionKey;
        lastSeenUrlSelectionRef.current = urlSelectionKey;

        if (!urlChanged && currentExecSessionId && currentExecSessionId !== id) {
            return;
        }

        const matchedSession = executionSessions.find((session) => session.session_id === id);
        const resolvedTeamId = matchedSession
            ? getTeamIdForSession(matchedSession, teams)
            : requestedTeamId || null;
        const appliedSelectionKey = `${id}:${resolvedTeamId ?? ""}:${agentId ?? ""}`;

        if (!urlChanged && currentExecSessionId === id && lastAppliedUrlSelectionRef.current === appliedSelectionKey) {
            return;
        }

        dispatch(setSelectedTeam(resolvedTeamId));
        dispatch(setActiveSessionId(id));
        dispatch(setSelectedAgent(agentId));
        if (resolvedTeamId) {
            dispatch(fetchExecutionArtifacts({ teamId: resolvedTeamId }));
        }
        lastAppliedUrlSelectionRef.current = appliedSelectionKey;

        if (id !== currentExecSessionId) {
            closeActiveSupervisorConnection();
            dispatch(clearSupervisorChat());
            dispatch(setExecSessionId(id));
            dispatch(loadSupervisorHistory({ sessionId: id }));
            dispatch(fetchExecutionAgents({ sessionId: id }));
    }
  }, [searchParams, dispatch, currentExecSessionId, executionSessions, teams]);

    useEffect(() => () => {
        closeActiveSupervisorConnection();
        dispatch(clearSupervisorChat());
        dispatch(setExecSessionId(null));
    }, [dispatch]);

  return null;
}

export default function ChatPage() {
    return (
        <div className="flex h-[calc(100vh-3.5rem)] mesh-app relative">
            <Suspense fallback={null}>
                <ExecSessionSeeder />
            </Suspense>

            <div className="lg:hidden absolute top-4 left-4 z-50">
                <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="bg-white/50 backdrop-blur-sm">
                            <Menu className="h-5 w-5" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="p-0 w-80">
                        <ChatList className="w-full h-full" forceVisible />
                    </SheetContent>
                </Sheet>
            </div>

            <div className="xl:hidden absolute top-4 right-4 z-50">
                <Sheet>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon" className="bg-white/50 backdrop-blur-sm">
                            <Menu className="h-5 w-5 transform rotate-180" />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="p-0 w-80">
                        <ChatSidebar className="w-full h-full" forceVisible />
                    </SheetContent>
                </Sheet>
            </div>



            {/* Left: Chat List (Desktop) */}
            <ChatList />

            {/* Center: Chat */}
            <ChatInterface />

            {/* Right: Team Info (Desktop) */}
            <ChatSidebar />


        </div>
    );
}
