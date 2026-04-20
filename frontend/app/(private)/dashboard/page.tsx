"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { StatsGrid } from "@/sections/dashboard/stats-grid";
import { TokenChart } from "@/sections/dashboard/token-chart";
import { ActivityLog } from "@/sections/dashboard/activity-log";

export default function DashboardPage() {
    return (
        <div className="p-4 sm:p-6 h-full lg:h-[calc(100vh-56px)] bg-[#f0f4ff] mesh-rays overflow-y-auto lg:overflow-hidden flex flex-col gap-6 relative">
            {/* Animated Rays/Orbs */}
            <div className="absolute top-[-10%] left-[20%] w-[300px] sm:w-[600px] h-[400px] bg-purple-200/20 rounded-full blur-[120px] pointer-events-none animate-pulse" />
            <div className="absolute bottom-[-10%] right-[10%] w-[300px] sm:w-[500px] h-[500px] bg-blue-200/10 rounded-full blur-[100px] pointer-events-none" />

            <div className="flex flex-col relative z-10">
                <p className="text-[10px] font-black text-purple-600 uppercase tracking-[0.2em] leading-none mb-2">Operational Analytics</p>
                <h1 className="text-3xl sm:text-4xl font-black bg-clip-text text-transparent bg-linear-to-r from-gray-950 to-gray-500 tracking-tighter leading-none">
                    Mission Control
                </h1>
            </div>

            {/* Stats Grid - Fixed height part */}
            <div className="shrink-0 relative z-10">
                <StatsGrid />
            </div>

            {/* Chart Section - Fills remaining space on desktop, min-height on mobile */}
            <div className="flex-1 min-h-[400px] lg:min-h-0 relative z-10 mb-6 lg:mb-0">
                <TokenChart className="h-full" />
            </div>
        </div>
    );
}
