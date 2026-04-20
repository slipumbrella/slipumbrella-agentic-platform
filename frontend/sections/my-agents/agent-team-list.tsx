'use client';

import { AgentCard } from "@/components/agents/agent-card";
import { AggregatedMetrics } from "@/components/agents/aggregated-metrics";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExecutionAgent, ExecutionSession, Team } from "@/lib/features/agent/agentSlice";
import { assignSessionThunk, fetchAgentConfig, fetchExecutionSessions, fetchTeams, setActiveSessionId, updateTeamThunk } from "@/lib/features/agent/agentSlice";
import { getTeamIdForSession } from "@/lib/features/agent/teamSessionUtils";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Check, Copy, FolderPlus, MessageSquare, Network, PencilLine, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Orchestration topology card — same visual footprint as an AgentCard.
// 120×120 SVG canvas, violet dashed border to distinguish from agent cards.
// ---------------------------------------------------------------------------
const TOPOLOGY_THEME = {
    nodeFill: "#f5f3ff",
    nodeStroke: "#8b5cf6",
    hubFill: "#7c3aed",
    linkStroke: "#e9d5ff",
    labelFill: "#8b5cf6",
};
const TOPOLOGY_CARD_STYLE = {
    "--topology-node-fill": TOPOLOGY_THEME.nodeFill,
    "--topology-node-stroke": TOPOLOGY_THEME.nodeStroke,
    "--topology-hub-fill": TOPOLOGY_THEME.hubFill,
    "--topology-link-stroke": TOPOLOGY_THEME.linkStroke,
    "--topology-label-fill": TOPOLOGY_THEME.labelFill,
} as React.CSSProperties;
const CW = 120, CH = 120; // SVG canvas
const ccx = CW / 2, ccy = CH / 2;

function OrchestrationSidePanel({ orchestration, agentCount }: { orchestration?: string; agentCount: number }) {
    if (!orchestration || agentCount < 1) return null;

    const n = Math.min(agentCount, 4);

    const labels: Record<string, string> = {
        sequential: "Pipeline",   concurrent: "Parallel",
        group_chat: "Mesh",       magentic:   "Hub & Spoke",
        handoff:    "Relay",
    };
    const descriptions: Record<string, string> = {
        sequential: "Tasks flow step-by-step",
        concurrent: "Tasks run in parallel",
        group_chat: "Agents share context",
        magentic:   "Central coordinator",
        handoff:    "Direct transfer of state",
    };

    let inner: React.ReactNode = null;

    // Sequential — vertical chain top → bottom ───────────────────────────────
    if (orchestration === "sequential") {
        const ty = 14, by = CH - 14;
        const gap = n > 1 ? (by - ty) / (n - 1) : 0;
        const pts = Array.from({ length: n }, (_, i) => ({ x: ccx, y: +(ty + i * gap).toFixed(1) }));
        inner = (
            <>
                {pts.slice(0, -1).map((p, i) => (
                    <line key={i} x1={ccx} y1={p.y} x2={ccx} y2={pts[i + 1].y}
                        stroke="var(--topology-link-stroke)" strokeWidth="2" strokeLinecap="round" />
                ))}
                {pts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="9"
                        fill={i === 0 ? "var(--topology-hub-fill)" : "var(--topology-node-fill)"} stroke={i === 0 ? "white" : "var(--topology-node-stroke)"} strokeWidth="2" />
                ))}
            </>
        );
    }

    // Concurrent — source at top, fan out to workers below ──────────────────
    if (orchestration === "concurrent") {
        const srcY = 15, dstY = CH - 15;
        const cols = Math.min(n, 3);
        const spread = CW - 30;
        const xs = Array.from({ length: cols }, (_, i) =>
            cols === 1 ? ccx : +(15 + i * spread / (cols - 1)).toFixed(1)
        );
        inner = (
            <>
                <circle cx={ccx} cy={srcY} r="10" fill="var(--topology-hub-fill)" stroke="white" strokeWidth="2" />
                {xs.map((x, index) => (
                    <g key={index}>
                        <line x1={ccx} y1={srcY} x2={x} y2={dstY}
                            stroke="var(--topology-link-stroke)" strokeWidth="2" strokeLinecap="round" />
                        <circle cx={x} cy={dstY} r="9" fill="var(--topology-node-fill)" stroke="var(--topology-node-stroke)" strokeWidth="2" />
                    </g>
                ))}
            </>
        );
    }

    // Group Chat — full mesh, dot per edge ───────────────────────────────────
    if (orchestration === "group_chat") {
        const mn  = Math.min(n, 4);
        const r   = CH / 2 - 16;
        const pts = Array.from({ length: mn }, (_, i) => {
            const a = (i / mn) * 2 * Math.PI - Math.PI / 2;
            return { x: +(ccx + r * Math.cos(a)).toFixed(1), y: +(ccy + r * Math.sin(a)).toFixed(1) };
        });
        const edges: Array<{ ax: number; ay: number; bx: number; by: number; idx: number }> = [];
        pts.forEach((a, i) => pts.slice(i + 1).forEach(b => {
            edges.push({ ax: +a.x, ay: +a.y, bx: +b.x, by: +b.y, idx: edges.length });
        }));
        inner = (
            <>
                {edges.map(e => (
                    <line key={e.idx} x1={e.ax} y1={e.ay} x2={e.bx} y2={e.by}
                        stroke="var(--topology-link-stroke)" strokeWidth="1.5" strokeLinecap="round" />
                ))}
                {pts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="9" fill="var(--topology-node-fill)" stroke="var(--topology-node-stroke)" strokeWidth="2" />
                ))}
            </>
        );
    }

    // Magentic — hub at centre, spokes radiate outward ───────────────────────
    if (orchestration === "magentic") {
        const workers = Math.min(Math.max(n - 1, 1), 3);
        const wr = CH / 2 - 14;
        const wPts = Array.from({ length: workers }, (_, i) => {
            const a = (i / workers) * 2 * Math.PI - Math.PI / 2;
            return { x: +(ccx + wr * Math.cos(a)).toFixed(1), y: +(ccy + wr * Math.sin(a)).toFixed(1) };
        });
        inner = (
            <>
                {wPts.map((p, i) => (
                    <line key={i} x1={ccx} y1={ccy} x2={p.x} y2={p.y}
                        stroke="var(--topology-link-stroke)" strokeWidth="2" strokeLinecap="round" />
                ))}
                {wPts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="9" fill="var(--topology-node-fill)" stroke="var(--topology-node-stroke)" strokeWidth="2" />
                ))}
                <circle cx={ccx} cy={ccy} r="14" fill="var(--topology-hub-fill)" stroke="white" strokeWidth="2.5" />
                <text x={ccx} y={ccy} textAnchor="middle" dominantBaseline="central"
                    fill="white" fontSize="9" fontWeight="800" letterSpacing="-0.5">M</text>
            </>
        );
    }

    // Handoff — nodes passing work in an arc ─────────────────────────────────
    if (orchestration === "handoff") {
        const lx = 20, rx = CW - 20, cy = ccy + 10;
        const pts = [{ x: lx, y: cy }, { x: rx, y: cy }];
        inner = (
            <>
                <path d={`M ${lx},${cy} A ${(rx - lx) / 2},${(rx - lx) / 4} 0 0,1 ${rx},${cy}`}
                    fill="none" stroke="var(--topology-link-stroke)" strokeWidth="2.5" strokeDasharray="5 5" strokeLinecap="round" />
                {pts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="10" 
                        fill={i === 0 ? "var(--topology-hub-fill)" : "var(--topology-node-fill)"} stroke={i === 0 ? "white" : "var(--topology-node-stroke)"} strokeWidth="2" />
                ))}
                <text x={ccx} y={cy - 20} textAnchor="middle" fill="var(--topology-label-fill)" className="text-[8px] font-bold uppercase tracking-widest">Relay</text>
            </>
        );
    }
    
    if (!inner) return null;

    return (
        <div className="flex flex-col lg:flex-row items-stretch gap-4 lg:gap-5 w-full">
            {/* Orchestration card — same footprint as AgentCard but visually distinct */}
            <div style={TOPOLOGY_CARD_STYLE} className="w-full shrink-0 flex flex-col rounded-2xl border border-purple-100 bg-purple-50/30 p-4 sm:p-5 lg:min-h-70 lg:w-50 lg:rounded-xl">
                {/* Header */}
                <div className="flex items-center gap-2.5 mb-3 sm:mb-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                        <Network size={15} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[9px] font-bold text-purple-500 uppercase tracking-widest leading-none mb-0.5">Topology</p>
                        <p className="text-sm font-semibold text-purple-900 leading-none truncate">{labels[orchestration] ?? orchestration}</p>
                    </div>
                </div>

                {/* SVG animation — grows to fill card */}
                <div className="flex-1 flex items-center justify-center py-1">
                    <svg viewBox={`0 0 ${CW} ${CH}`} className="aspect-square w-full max-w-[100px] lg:max-w-[120px]" style={{ overflow: "visible" }}>
                        {inner}
                    </svg>
                </div>

                {/* Description */}
                <p className="mt-2 text-center text-[10px] leading-snug text-purple-600/80 sm:mt-3">
                    {descriptions[orchestration] ?? ""}
                </p>
            </div>

            {/* Vertical separator — hidden on mobile */}
            <div className="hidden min-h-70 w-px shrink-0 bg-purple-100 lg:block" />
        </div>
    );
}

function getPrimaryChatAction(session: ExecutionSession): {
    label: string;
    agentId?: string;
} {
    const plan = session.plans?.[0];
    const agents = plan?.agents ?? [];
    const leader = agents.find((agent) => agent.is_leader === true);
    const userFacingAgents = agents.filter((agent) => agent.role !== "LineAgent");
    const candidateAgents = userFacingAgents.length > 0 ? userFacingAgents : agents;

    if (!plan || candidateAgents.length === 0) {
        return { label: "Chat with Agent" };
    }

    if (plan.orchestration === "group_chat") {
        return { label: "Start Group Chat" };
    }

    if (leader) {
        return { label: `Chat with ${leader.role}`, agentId: leader.id };
    }

    if (plan.orchestration === "handoff") {
        const firstAgent = candidateAgents[0];
        return firstAgent
            ? { label: `Chat with ${firstAgent.role}`, agentId: firstAgent.id }
            : { label: "Chat with Agent" };
    }

    const firstAgent = candidateAgents[0];
    return firstAgent
        ? { label: `Chat with ${firstAgent.role}`, agentId: firstAgent.id }
        : { label: "Chat with Agent" };
}

export function AgentTeamList() {
    const dispatch = useAppDispatch();
    const router = useRouter();
    const { executionSessions, selectedTeamId, activeSessionId, teams, googleSaEmail } = useAppSelector((state) => state.agent);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [teamNameDraft, setTeamNameDraft] = useState("");
    const [teamDescriptionDraft, setTeamDescriptionDraft] = useState("");

    useEffect(() => {
        dispatch(fetchExecutionSessions());
        dispatch(fetchTeams());
        dispatch(fetchAgentConfig());
    }, [dispatch]);

    const selectedTeam = selectedTeamId ? teams.find((team: Team) => team.id === selectedTeamId) ?? null : null;

    const handleChatWithSession = ({
        sessionId,
        agentId,
        teamId,
    }: {
        sessionId: string;
        agentId?: string;
        teamId?: string | null;
    }) => {
        const params = new URLSearchParams({
            exec_session_id: sessionId,
        });

        if (agentId) {
            params.set("agent_id", agentId);
        }
        if (teamId) {
            params.set("team_id", teamId);
        }

        router.push(`/chats?${params.toString()}`);
    };

    const handleAssign = async (teamId: string, sessionId: string) => {
        try {
            await dispatch(assignSessionThunk({ teamId, sessionId })).unwrap();
            dispatch(fetchTeams());
            dispatch(fetchExecutionSessions());
            toast.success("Session assigned to team");
        } catch {
            toast.error("Failed to assign session");
        }
    };

    const handleUpdateTeamDetails = async () => {
        if (!selectedTeam) return;

        const trimmedName = teamNameDraft.trim();
        const trimmedDescription = teamDescriptionDraft.trim();

        if (!trimmedName) {
            toast.error("Team name is required");
            return;
        }

        try {
            await dispatch(
                updateTeamThunk({
                    id: selectedTeam.id,
                    name: trimmedName,
                    description: trimmedDescription || undefined,
                }),
            ).unwrap();
            dispatch(fetchTeams());
            setIsEditDialogOpen(false);
            toast.success("Team details updated");
        } catch {
            toast.error("Failed to update team details");
        }
    };

    const openEditDialog = () => {
        if (!selectedTeam) return;

        setTeamNameDraft(selectedTeam.name ?? "");
        setTeamDescriptionDraft(selectedTeam.description ?? "");
        setIsEditDialogOpen(true);
    };

    // Filter sessions by selected team
    let visibleSessions: ExecutionSession[];
    if (selectedTeamId === null) {
        visibleSessions = executionSessions.filter(s => (s.plans?.[0]?.agents?.length ?? 0) > 0);
    } else {
        const teamSessionIds = new Set(selectedTeam?.sessions?.map((s) => s.session_id) ?? []);
        visibleSessions = executionSessions.filter((s) => 
            teamSessionIds.has(s.session_id) && (s.plans?.[0]?.agents?.length ?? 0) > 0
        );
    }

    return (
        <div className="flex-1 flex flex-col min-w-0">
            {selectedTeamId === null ? (
                <AggregatedMetrics />
            ) : null}

            <div className="max-w-7xl mx-auto w-full space-y-6 sm:space-y-8 lg:space-y-10 py-4 sm:py-6 lg:py-8 px-4 sm:px-6 lg:px-8">
                {selectedTeamId !== null && (
                    <div className="flex flex-col gap-4 pb-4 sm:pb-5 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-3">
                                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
                                    {selectedTeam?.name ?? "Team Agents"}
                                </h1>
                                {selectedTeam && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-11 rounded-full border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-none hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700"
                                        onClick={openEditDialog}
                                    >
                                        <PencilLine className="mr-2 h-4 w-4" />
                                        Edit details
                                    </Button>
                                )}
                            </div>
                            <p className="max-w-2xl text-sm leading-6 text-gray-500">
                                {selectedTeam?.description?.trim() || "No description yet."}
                            </p>
                        </div>
                    </div>
                )}

                {visibleSessions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200/60 bg-white py-12 text-center sm:py-20">
                        <p className="text-gray-500 text-sm sm:text-base px-4">
                            {selectedTeamId ? "No sessions assigned to this team yet." : "No agent teams found. Create a team in the Agent Builder."}
                        </p>
                    </div>
                ) : (
                    visibleSessions.map(session => {
                        const agents = session.plans?.[0]?.agents ?? [];
                        const orchestration = session.plans?.[0]?.orchestration;
                        const title = session.title || `Session ${session.session_id.substring(0, 8)}`;
                        const primaryChat = getPrimaryChatAction(session);

                        return (
                            <div
                                key={session.session_id}
                                className={cn(
                                    "space-y-3 sm:space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 p-3 sm:p-4 rounded-2xl transition-all",
                                    activeSessionId === session.session_id ? "bg-purple-500/5 ring-1 ring-purple-500/20" : ""
                                )}
                                onClick={() => dispatch(setActiveSessionId(session.session_id))}
                            >
                                    <div className="flex items-center gap-3 pb-2 border-b border-gray-200/60">
                                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0 flex-1">
                                            <h2 className={cn("text-base sm:text-lg font-semibold transition-colors truncate", activeSessionId === session.session_id ? "text-purple-700" : "text-gray-800")}>
                                                {title}
                                            </h2>
                                            <span className="bg-purple-500/15 text-purple-700 px-2.5 py-0.5 rounded-full text-xs font-medium">
                                                {agents.length} Agents
                                            </span>
                                            {activeSessionId === session.session_id && (
                                                <span className="rounded-md border border-purple-200/50 bg-purple-100/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-purple-600">
                                                    Active Focus
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex-1" />
                                        {teams.length > 0 && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-11 w-11 rounded-xl text-gray-400 hover:bg-purple-50 hover:text-purple-600" aria-label="Assign session to a team">
                                                        <FolderPlus size={14} />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent>
                                                    {teams.map((team: Team) => (
                                                        <DropdownMenuItem key={team.id} onClick={(e) => { e.stopPropagation(); handleAssign(team.id, session.session_id); }}>
                                                            {team.name}
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                    </div>

                                    <button
                                        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-purple-600 py-3.5 text-white shadow-md shadow-purple-500/20 transition-all active:scale-[0.99] cursor-pointer lg:hidden"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleChatWithSession({
                                                sessionId: session.session_id,
                                                agentId: primaryChat.agentId,
                                                teamId: getTeamIdForSession(session, teams),
                                            });
                                        }}
                                    >
                                        <MessageSquare size={16} className="shrink-0" />
                                        <span className="text-sm font-bold">{primaryChat.label}</span>
                                    </button>

                                    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 items-start">
                                    <div className="w-full lg:w-auto shrink-0">
                                        <OrchestrationSidePanel orchestration={orchestration} agentCount={agents.length} />
                                    </div>
                                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 min-w-0">
                                        {agents.map((agent, idx) => (
                                            <AgentCard
                                                key={agent.id || idx}
                                                agent={agent}
                                            />
                                        ))}
                                    </div>
                                </div>
                                <GoogleWorkspaceInvitation agents={agents} saEmail={googleSaEmail} />

                                {/* Full-width chat CTA — clearly guides users to start a conversation */}
                                <button
                                    className="hidden w-full items-center justify-center gap-3 rounded-2xl bg-purple-600 py-3.5 text-white shadow-md shadow-purple-500/20 transition-all hover:bg-purple-700 active:scale-[0.99] lg:flex"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleChatWithSession({
                                            sessionId: session.session_id,
                                            agentId: primaryChat.agentId,
                                            teamId: getTeamIdForSession(session, teams),
                                        });
                                    }}
                                >
                                    <MessageSquare size={16} className="shrink-0" />
                                    <span className="text-sm font-bold">{primaryChat.label}</span>
                                    <span className="hidden text-xs font-medium text-purple-200/70 sm:inline">— tap to open chat</span>
                                </button>
                            </div>
                        );
                    })
                )}
            </div>

            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent className="sm:max-w-lg rounded-[28px] border border-gray-200 bg-white p-7 shadow-xl">
                    <DialogHeader className="space-y-2">
                        <DialogTitle className="text-2xl font-bold tracking-tight text-gray-900">
                            Edit team details
                        </DialogTitle>
                        <DialogDescription className="text-sm leading-6 text-gray-500">
                            Update the team name and description so people know what this team handles.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        <div className="space-y-2">
                            <label htmlFor="team-name" className="text-sm font-semibold text-gray-700">
                                Team name
                            </label>
                            <Input
                                id="team-name"
                                value={teamNameDraft}
                                onChange={(event) => setTeamNameDraft(event.target.value)}
                                placeholder="Sales Ops"
                                className="h-12 rounded-2xl border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 shadow-none focus:border-purple-300 focus:bg-white"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="team-description" className="text-sm font-semibold text-gray-700">
                                Description
                            </label>
                            <Textarea
                                id="team-description"
                                value={teamDescriptionDraft}
                                onChange={(event) => setTeamDescriptionDraft(event.target.value)}
                                placeholder="Describe what this team helps with."
                                className="min-h-28 rounded-2xl border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-900 shadow-none focus:border-purple-300 focus:bg-white"
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-3 sm:justify-end">
                        <DialogClose asChild>
                            <Button
                                variant="outline"
                                className="h-11 rounded-full border-gray-200 px-5 text-sm font-semibold text-gray-700 shadow-none hover:bg-gray-50"
                            >
                                Cancel
                            </Button>
                        </DialogClose>
                        <Button
                            className="h-11 rounded-full bg-purple-700 px-5 text-sm font-semibold text-white hover:bg-purple-800"
                            onClick={handleUpdateTeamDetails}
                        >
                            Save changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function GoogleWorkspaceInvitation({ agents, saEmail }: { agents: ExecutionAgent[]; saEmail: string | null }) {
    const [saCopied, setSaCopied] = React.useState(false);
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || !saEmail) return null;

    const hasGW = agents.some(a => a.tools?.some((t: string) => t.startsWith('gdocs_') || t.startsWith('gsheets_') || t.startsWith('gslides_') || t.startsWith('gdrive_')));
    if (!hasGW) return null;

    const handleCopySA = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(saEmail);
        setSaCopied(true);
        setTimeout(() => setSaCopied(false), 2000);
    };

    return (
        <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-200/40 space-y-2.5 mt-4">
            <div className="flex items-center gap-2 text-amber-600">
                <Sparkles className="h-3.5 w-3.5" />
                <h4 className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest leading-none">Authorization Required</h4>
            </div>
            
            <p className="text-[10px] sm:text-[11px] text-gray-500 leading-relaxed font-medium">
                Invite this system email as an <b>Editor</b> to your Docs for agent access:
            </p>

            <div className="flex gap-2 w-full lg:max-w-md">
                <Input
                    readOnly
                    value={saEmail}
                    className="h-11 text-[10px] sm:text-[11px] bg-white text-gray-400 font-mono truncate border-amber-200/40 shadow-none rounded-xl"
                />
                <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0 cursor-pointer rounded-xl border-amber-200/40 bg-white"
                    aria-label="Copy Google Workspace service account email"
                    onClick={handleCopySA}
                >
                    {saCopied
                        ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                        : <Copy className="h-3.5 w-3.5 text-amber-600" />
                    }
                </Button>
            </div>
        </div>
    );
}
