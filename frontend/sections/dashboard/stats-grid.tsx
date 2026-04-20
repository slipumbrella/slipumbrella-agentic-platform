"use client";

import React from "react";
import { Zap, Users, CreditCard, Activity, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAppSelector } from "@/lib/hooks";

export function StatsGrid() {
    const { stats } = useAppSelector((state) => state.dashboard);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Token usage — purple gradient hero card */}
            <Card className="border-0 relative overflow-hidden bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-[0_8px_32px_rgba(139,92,246,0.25)] hover:shadow-[0_12px_40px_rgba(139,92,246,0.40)] hover:-translate-y-0.5 transition-all duration-300 cursor-default rounded-[32px]">
                <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
                <CardContent className="p-8">
                    <div className="flex items-center justify-between mb-6">
                        <div className="p-3 bg-white/20 rounded-2xl backdrop-blur-md">
                            <Zap className="h-6 w-6 text-white" />
                        </div>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black text-white/70 uppercase tracking-widest">Total Token Usage</p>
                        <h3 className="text-4xl font-black tracking-tight leading-none">{stats.totalTokens.toLocaleString()}</h3>
                    </div>
                </CardContent>
            </Card>

            {/* Active agents */}
            <Card className="border-0 relative overflow-hidden bg-white/40 backdrop-blur-3xl border border-white/40 shadow-[0_4px_24px_rgba(100,60,180,0.06)] hover:shadow-[0_8px_32px_rgba(100,60,180,0.12)] hover:-translate-y-0.5 transition-all duration-300 cursor-default rounded-[32px] group">
                <CardContent className="p-8">
                    <div className="flex items-center justify-between mb-6">
                        <div className="p-3 bg-violet-100 rounded-2xl text-violet-600 group-hover:scale-110 transition-transform">
                            <Users className="h-6 w-6" />
                        </div>
                        <span className="text-[10px] font-black text-emerald-600 bg-emerald-100/50 px-3 py-1.5 rounded-full flex items-center gap-1 border border-emerald-100 uppercase tracking-widest">
                            <ArrowUpRight className="h-3 w-3" /> Online
                        </span>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Active Agents</p>
                        <h3 className="text-4xl font-black text-gray-950 tracking-tight leading-none">
                            {stats.activeAgents}
                        </h3>
                    </div>
                </CardContent>
            </Card>

            {/* Estimated cost */}
            <Card className="border-0 relative overflow-hidden bg-white/40 backdrop-blur-3xl border border-white/40 shadow-[0_4px_24px_rgba(100,60,180,0.06)] hover:shadow-[0_8px_32px_rgba(100,60,180,0.12)] hover:-translate-y-0.5 transition-all duration-300 cursor-default rounded-[32px] group">
                <CardContent className="p-8">
                    <div className="flex items-center justify-between mb-6">
                        <div className="p-3 bg-emerald-100 rounded-2xl text-emerald-600 group-hover:scale-110 transition-transform">
                            <CreditCard className="h-6 w-6" />
                        </div>
                        <span className="text-[10px] font-black text-gray-500 bg-gray-100/50 px-3 py-1.5 rounded-full border border-gray-100 uppercase tracking-widest">
                            Estimated
                        </span>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Estimated Cost</p>
                        <h3 className="text-4xl font-black text-gray-950 tracking-tight leading-none">{stats.estimatedCost}</h3>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
