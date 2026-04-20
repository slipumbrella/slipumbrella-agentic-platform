"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    fetchExecutionSessions,
    fetchTeams,
    setActiveSessionId,
    setSelectedTeam,
} from "@/lib/features/agent/agentSlice";
import {
    clearSupervisorChat,
    closeActiveSupervisorConnection,
    fetchExecutionAgents,
    fetchExecutionArtifacts,
    loadSupervisorHistory,
    setExecSessionId,
    setSelectedAgent,
} from "@/lib/features/chat/chatSlice";
import {
    getOrchestrationLabel,
    sortAgentsByExecutionOrder,
} from "@/lib/features/chat/workflowTypes";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import {
    Bot,
    PanelLeftClose,
    PanelLeftOpen,
    Search,
} from "lucide-react";
import { useEffect, useState } from "react";

interface SessionRowData {
  sessionId: string;
  title: string;
  orchestration: string;
  teamId: string | null;
}

export function ChatList({ className, forceVisible = false }: { className?: string; forceVisible?: boolean }) {
  const dispatch = useAppDispatch();
  const { executionSessions, teams } = useAppSelector((state) => state.agent);
  const { execSessionId } = useAppSelector((state) => state.chat.supervisor);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    dispatch(fetchTeams());
    dispatch(fetchExecutionSessions());
  }, [dispatch]);

  const handleSelectRow = ({
    sessionId,
    teamId,
  }: {
    sessionId: string;
    teamId: string | null;
  }) => {
    if (sessionId === execSessionId) {
      return;
    }

    const session = executionSessions.find((s) => s.session_id === sessionId);
    const agents = sortAgentsByExecutionOrder(session?.plans?.[0]?.agents ?? []);
    const leaderAgent = agents.find((a) => a.is_leader) ?? null;

    closeActiveSupervisorConnection();
    dispatch(clearSupervisorChat());
    dispatch(setExecSessionId(sessionId));
    dispatch(setSelectedAgent(leaderAgent?.id ?? null));
    dispatch(setSelectedTeam(teamId));
    dispatch(setActiveSessionId(sessionId));
    if (teamId) {
      dispatch(fetchExecutionArtifacts({ teamId }));
    }
    dispatch(loadSupervisorHistory({ sessionId }));
    dispatch(fetchExecutionAgents({ sessionId }));
  };

  const toggleCollapse = (): void => setIsCollapsed((prev) => !prev);

  const sessionTeamMap = new Map<string, string>(
    teams.flatMap((team) =>
      (team.sessions ?? []).map((session) => [session.session_id, team.id] as [string, string]),
    ),
  );

  const allSessionRows: SessionRowData[] = executionSessions.map((session) => ({
    sessionId: session.session_id,
    title: session.title || `Session ${session.session_id.substring(0, 8)}`,
    orchestration: session.plans?.[0]?.orchestration ?? "",
    teamId: sessionTeamMap.get(session.session_id) ?? null,
  }));

  const searchActive = search.trim().length > 0;
  const filteredSessions = searchActive
    ? allSessionRows.filter((session) => {
        const q = search.toLowerCase();
        return (
          session.title.toLowerCase().includes(q) ||
          session.orchestration.toLowerCase().includes(q) ||
          getOrchestrationLabel(session.orchestration).toLowerCase().includes(q)
        );
      })
    : [];

  // Build flat team rows: one row per team, using the most recent session's orchestration
  const teamRows = teams.map((team) => {
    const teamSessions = executionSessions.filter((session) =>
      (team.sessions ?? []).some((assigned) => assigned.session_id === session.session_id),
    );
    const latestSession = teamSessions[0] ?? null;
    const orchestration = latestSession?.plans?.[0]?.orchestration ?? "";
    const sessionId = latestSession?.session_id ?? null;
    const isActive = sessionId !== null && execSessionId === sessionId;
    return { team, sessionId, orchestration, isActive };
  });

  const assignedSessionIds = new Set(
    teams.flatMap((team) => (team.sessions ?? []).map((s) => s.session_id)),
  );
  const unassignedSessions = executionSessions.filter(
    (session) => !assignedSessionIds.has(session.session_id),
  );

  return (
    <div className={cn(
      "glass-sidebar border-r border-gray-200/60 flex-col shrink-0 transition-all duration-300 ease-in-out",
      forceVisible ? "flex" : "hidden lg:flex",
      isCollapsed ? "w-14" : "w-72",
      className,
    )}>
      {/* Header */}
      <div className={cn("p-2 border-b border-gray-200/60 flex items-center", isCollapsed ? "justify-center" : "gap-2")}>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-lg text-gray-500 hover:text-purple-600 hover:bg-purple-500/10 transition-colors cursor-pointer"
          onClick={toggleCollapse}
          aria-label={isCollapsed ? "Expand chat list" : "Collapse chat list"}
        >
          {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
        {!isCollapsed ? <h2 className="font-bold text-lg text-gray-800 flex-1">Chats</h2> : null}
      </div>

      {!isCollapsed ? (
        <>
          {/* Search */}
          <div className="p-3 border-b border-gray-200/60">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search sessions or workflows..."
                className="pl-9 bg-white/40 border-white/30"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {searchActive ? (
              filteredSessions.length === 0 ? (
                <p className="text-xs text-gray-400 italic text-center py-8">No sessions found.</p>
              ) : (
                filteredSessions.map((session) => (
                  <TeamRow
                    key={session.sessionId}
                    name={session.title}
                    orchestration={session.orchestration}
                    isActive={execSessionId === session.sessionId}
                    onClick={() =>
                      session.sessionId
                        ? handleSelectRow({ sessionId: session.sessionId, teamId: session.teamId })
                        : undefined
                    }
                  />
                ))
              )
            ) : (
              <>
                {teamRows.map(({ team, sessionId, orchestration, isActive }) => (
                  <TeamRow
                    key={team.id}
                    name={team.name}
                    orchestration={orchestration}
                    isActive={isActive}
                    onClick={() =>
                      sessionId
                        ? handleSelectRow({ sessionId, teamId: team.id })
                        : undefined
                    }
                    disabled={!sessionId}
                  />
                ))}

                {unassignedSessions.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2">Unassigned</p>
                    {unassignedSessions.map((session) => {
                      const orchestration = session.plans?.[0]?.orchestration ?? "";
                      const title = session.title || `Session ${session.session_id.substring(0, 8)}`;
                      return (
                        <TeamRow
                          key={session.session_id}
                          name={title}
                          orchestration={orchestration}
                          isActive={execSessionId === session.session_id}
                          onClick={() =>
                            handleSelectRow({ sessionId: session.session_id, teamId: null })
                          }
                        />
                      );
                    })}
                  </div>
                ) : null}

                {teams.length === 0 && unassignedSessions.length === 0 ? (
                  <p className="text-xs text-gray-400 italic text-center py-8">No sessions yet.</p>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TeamRow({
  name,
  orchestration,
  isActive,
  onClick,
  disabled = false,
}: {
  name: string;
  orchestration: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500 text-left",
        isActive
          ? "bg-purple-50 border-r-2 border-purple-600"
          : "hover:bg-white/40 border-r-2 border-transparent",
        disabled && "cursor-default opacity-50",
      )}
    >
      <div
        className={cn(
          "h-8 w-8 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200",
          isActive
            ? "bg-purple-600 text-white shadow-sm shadow-purple-500/30"
            : "bg-purple-100 text-purple-600",
        )}
      >
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-semibold truncate leading-tight",
            isActive ? "text-purple-800" : "text-gray-700",
          )}
        >
          {name}
        </p>
        {orchestration ? (
          <p className="text-[10px] font-medium text-gray-400 mt-0.5 truncate">
            {getOrchestrationLabel(orchestration)}
          </p>
        ) : null}
      </div>
    </button>
  );
}
