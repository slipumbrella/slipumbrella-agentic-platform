'use client';

import { Button } from "@/components/ui/button";
import type { ExecutionAgent } from "@/lib/features/agent/agentSlice";
import { Bot, MessageSquare } from "lucide-react";

interface AgentCardProps {
    agent: ExecutionAgent;
    onChat?: () => void;
    chatLabel?: string;
}

export function AgentCard({ agent, onChat, chatLabel = "Chat with Agent" }: AgentCardProps) {
    return (
        <div className="bg-white/60 backdrop-blur-xl rounded-2xl p-4 sm:p-6 border border-gray-200/60 shadow-[0_8px_32px_rgba(100,60,180,0.08)] hover:shadow-[0_12px_40px_rgba(139,92,246,0.15)] transition-all duration-300 flex flex-col h-full">
            <div className="flex justify-between items-start mb-3 sm:mb-4">
                <div className="flex gap-2.5 sm:gap-3 min-w-0">
                    <div className="h-9 w-9 sm:h-10 sm:w-10 bg-linear-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-[0_4px_12px_rgba(139,92,246,0.25)] shrink-0">
                        <Bot className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-bold text-gray-900 text-sm sm:text-base leading-none mb-1 truncate" title={agent.role}>{agent.role}</h3>
                        <span className="text-purple-500/80 text-[9px] font-black uppercase tracking-widest">Specialist</span>
                    </div>
                </div>
            </div>

            <p className="text-gray-500 text-xs sm:text-sm mb-4 line-clamp-3 flex-1 min-h-10 leading-relaxed">
                {agent.goal}
            </p>

            <div className="mt-auto space-y-4">
                {agent.tools && agent.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {agent.tools.slice(0, 4).map((tool, i) => (
                            <span key={i} className="bg-gray-100/50 text-gray-500 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-gray-200/30 whitespace-nowrap">
                                {tool}
                            </span>
                        ))}
                        {agent.tools.length > 4 && (
                            <span className="text-[9px] font-bold text-purple-400 ml-1">+{agent.tools.length - 4} more</span>
                        )}
                    </div>
                )}

                {onChat ? (
                    <Button
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white h-10 rounded-xl text-xs font-bold shadow-md shadow-purple-500/20 active:scale-95 transition-all"
                        onClick={onChat}
                    >
                        <MessageSquare size={14} className="mr-2" /> {chatLabel}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}
