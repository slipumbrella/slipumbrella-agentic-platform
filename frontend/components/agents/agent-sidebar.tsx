'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    createTeamThunk,
    deleteTeamThunk,
    fetchTeams,
    setActiveSessionId,
    setSelectedTeam,
} from "@/lib/features/agent/agentSlice";
import { useAppDispatch, useAppSelector } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Bot, LayoutGrid, PlusCircle, Trash, Users } from 'lucide-react';
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function AgentSidebar() {
    const dispatch = useAppDispatch();
    const { selectedTeamId, teams, executionSessions } = useAppSelector((state) => state.agent);
    const [teamName, setTeamName] = useState("");
    const [teamDesc, setTeamDesc] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => {
        dispatch(fetchTeams());
    }, [dispatch]);

    const handleCreateTeam = async () => {
        if (!teamName.trim()) return;
        try {
            await dispatch(createTeamThunk({ name: teamName.trim(), description: teamDesc.trim() || undefined })).unwrap();
            setTeamName("");
            setTeamDesc("");
            setDialogOpen(false);
            toast.success("Team created");
        } catch {
            toast.error("Failed to create team");
        }
    };

    const handleDeleteTeam = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await dispatch(deleteTeamThunk(id)).unwrap();
            toast.success("Team deleted");
        } catch {
            toast.error("Failed to delete team");
        }
    };

    const handleSelectAllSessions = () => {
        dispatch(setSelectedTeam(null));
        dispatch(setActiveSessionId(null));
    };

    const handleSelectTeam = (teamId: string) => {
        const team = teams.find((item) => item.id === teamId);
        const nextSessionId = team?.sessions?.[0]?.session_id ?? null;

        dispatch(setSelectedTeam(teamId));
        dispatch(setActiveSessionId(nextSessionId));
    };

    const activeSessionsCount = executionSessions.filter(s => (s.plans?.[0]?.agents?.length ?? 0) > 0).length;

    const sidebarContent = (
        <div className="flex h-full flex-col">
            <div className="mb-8 px-2">
                <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest leading-none text-purple-700">Workspace</p>
                <div className="flex items-center justify-between">
                    <span className="text-xl font-black tracking-tight text-gray-900">Teams</span>
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gray-100/50 text-gray-400">
                        <Users size={12} />
                    </div>
                </div>
            </div>

            <div className="scrollbar-hide -mx-1 flex-1 space-y-6 overflow-y-auto px-1" style={{ scrollbarWidth: 'none' }}>
                <div className="space-y-1.5">
                    <button
                        type="button"
                        className={cn(
                            "group relative flex h-11 w-full items-center gap-3 overflow-hidden rounded-2xl px-3 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
                            selectedTeamId === null
                                ? "border border-purple-100 bg-white text-purple-700 shadow-sm"
                                : "text-gray-500 hover:bg-white/50 hover:text-gray-900",
                        )}
                        onClick={handleSelectAllSessions}
                    >
                        {selectedTeamId === null ? (
                            <div className="absolute bottom-1/4 left-0 top-1/4 w-1 rounded-full bg-purple-600" />
                        ) : null}
                        <div
                            className={cn(
                                "rounded-xl p-2 transition-all duration-300",
                                selectedTeamId === null
                                    ? "scale-110 bg-purple-600 text-white shadow-md shadow-purple-500/20"
                                        : "bg-gray-100/50 text-gray-400 group-hover:bg-purple-50 group-hover:text-purple-600",
                            )}
                        >
                            <LayoutGrid size={15} />
                        </div>
                        <span className="flex-1 text-[13px] font-bold tracking-tight">All Sessions</span>
                        <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-black tracking-tight",
                            selectedTeamId === null
                                ? "bg-purple-100 text-purple-700"
                                : "bg-gray-100 text-gray-400 group-hover:bg-purple-100 group-hover:text-purple-500",
                        )}>
                            {activeSessionsCount}
                        </span>
                    </button>

                    <div className="mx-2 my-4 h-px bg-gray-100/50" />

                    {teams.map((team) => {
                        const isActive = selectedTeamId === team.id;

                        return (
                            <div
                                key={team.id}
                                className={cn(
                                    "group relative flex items-center gap-2 overflow-hidden rounded-2xl px-3 transition-all duration-200",
                                    isActive
                                        ? "border border-purple-100 bg-white text-purple-700 shadow-sm"
                                        : "text-gray-500 hover:bg-white/50 hover:text-gray-900",
                                )}
                            >
                                {isActive ? (
                                    <div className="absolute bottom-1/4 left-0 top-1/4 w-1 rounded-full bg-purple-600" />
                                ) : null}
                                <button
                                    type="button"
                                    className="flex h-11 min-w-0 flex-1 items-center gap-2 py-2 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500 rounded-xl"
                                    onClick={() => handleSelectTeam(team.id)}
                                >
                                    <div
                                        className={cn(
                                            "rounded-xl p-2 transition-all duration-300",
                                            isActive
                                                ? "scale-110 border border-purple-100 bg-white text-purple-600 shadow-sm"
                                                : "bg-gray-100/30 text-gray-400 group-hover:bg-purple-50 group-hover:text-purple-500",
                                        )}
                                    >
                                        <Bot size={15} />
                                    </div>

                                    <span className="flex-1 truncate text-[13px] font-bold tracking-tight">{team.name}</span>
                                </button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-11 w-11 rounded-xl text-gray-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 active:scale-90 group-hover:opacity-100"
                                    onClick={(e) => handleDeleteTeam(team.id, e)}
                                    aria-label={`Delete ${team.name}`}
                                >
                                    <Trash size={14} />
                                </Button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="pt-6">
                <Button
                    className="h-11 w-full gap-2.5 rounded-2xl bg-purple-700 text-xs font-black text-white shadow-sm transition-colors hover:bg-purple-800 active:scale-95"
                    onClick={() => setDialogOpen(true)}
                >
                    <PlusCircle size={18} /> New Agent Team
                </Button>
            </div>
        </div>
    );

    return (
        <>
            <div className="relative hidden h-full w-72 flex-col overflow-hidden border-r border-gray-200/50 bg-white p-6 shadow-sm lg:flex">
                {sidebarContent}
            </div>

            <div className="shrink-0 border-b border-gray-200/50 bg-white px-4 py-3 lg:hidden">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-purple-600">Workspace</p>
                        <p className="truncate text-sm font-bold text-gray-800">Switch teams directly</p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-11 shrink-0 rounded-full border-gray-200 bg-white px-4 text-xs font-black uppercase tracking-wide text-gray-700 shadow-none"
                        onClick={() => setDialogOpen(true)}
                    >
                        <PlusCircle className="h-4 w-4" />
                        New Team
                    </Button>
                </div>

                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    <Button
                        variant={selectedTeamId === null ? "default" : "outline"}
                        size="sm"
                        className={cn(
                            "h-11 shrink-0 rounded-full px-4 text-sm font-semibold shadow-none",
                            selectedTeamId === null
                                ? "bg-purple-600 text-white hover:bg-purple-700"
                                : "border-gray-200 bg-white text-gray-700 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700",
                        )}
                        onClick={handleSelectAllSessions}
                    >
                        All Sessions
                    </Button>

                    {teams.map((team) => {
                        const isActive = selectedTeamId === team.id;
                        return (
                            <Button
                                key={team.id}
                                variant={isActive ? "default" : "outline"}
                                size="sm"
                                className={cn(
                                    "h-11 shrink-0 rounded-full px-4 text-sm font-semibold shadow-none",
                                    isActive
                                        ? "bg-purple-600 text-white hover:bg-purple-700"
                                        : "border-gray-200 bg-white text-gray-700 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700",
                                )}
                                onClick={() => handleSelectTeam(team.id)}
                            >
                                {team.name}
                            </Button>
                        );
                    })}
                </div>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="rounded-[32px] border border-gray-200 bg-white p-8 shadow-xl sm:max-w-md">
                    <DialogHeader className="mb-6">
                        <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest leading-none text-purple-600">Administration</p>
                        <DialogTitle className="text-2xl font-black tracking-tight text-gray-900">Create New Team</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <p className="ml-1 text-[10px] font-bold text-gray-400">TEAM NAME</p>
                            <Input
                                placeholder="e.g., Marketing Analysts"
                                value={teamName}
                                onChange={(e) => setTeamName(e.target.value)}
                                className="h-12 rounded-xl border-gray-100 bg-gray-50/50 px-4 text-sm font-medium transition-all focus:bg-white"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <p className="ml-1 text-[10px] font-bold text-gray-400">DESCRIPTION (OPTIONAL)</p>
                            <Input
                                placeholder="Enter a brief purpose..."
                                value={teamDesc}
                                onChange={(e) => setTeamDesc(e.target.value)}
                                className="h-12 rounded-xl border-gray-100 bg-gray-50/50 px-4 text-sm font-medium transition-all focus:bg-white"
                            />
                        </div>
                    </div>
                    <DialogFooter className="mt-8 gap-3 sm:justify-between">
                        <DialogClose asChild>
                            <Button variant="ghost" className="h-12 rounded-xl px-6 font-bold text-gray-400 hover:bg-gray-100 hover:text-gray-600">Cancel</Button>
                        </DialogClose>
                        <Button className="h-12 rounded-xl bg-purple-600 px-8 text-xs font-black text-white shadow-lg shadow-purple-500/20 hover:bg-purple-700" onClick={handleCreateTeam}>
                            Create Team
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
