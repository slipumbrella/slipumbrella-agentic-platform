"use client";

import { useAppSelector } from "@/lib/hooks";
import { Users, Folder, Activity, Database } from "lucide-react";
import { Card } from "@/components/ui/card";

export function AggregatedMetrics() {
    const { executionSessions, teams } = useAppSelector((state) => state.agent);

    const sessionsWithAgents = executionSessions.filter(s => (s.plans?.[0]?.agents?.length ?? 0) > 0);
    const totalAgents = sessionsWithAgents.reduce((sum, s) => sum + (s.plans?.[0]?.agents?.length ?? 0), 0);
    const activeTeams = teams.length;
    const totalSessions = sessionsWithAgents.length;
    
    // Calculate total data sources across all sessions
    // Note: In a real app, this might come from a more robust aggregated state
    const totalDataSources = teams.reduce((sum, team) => sum + (team.sessions?.length ?? 0), 0);

    const metrics = [
        {
            label: "Total Agents",
            value: totalAgents,
            icon: Users,
            color: "text-purple-600",
            bg: "bg-purple-100/50",
        },
        {
            label: "Active Teams",
            value: activeTeams,
            icon: Folder,
            color: "text-blue-600",
            bg: "bg-blue-100/50",
        },
        {
            label: "Total Sessions",
            value: totalSessions,
            icon: Activity,
            color: "text-emerald-600",
            bg: "bg-emerald-100/50",
        },
        {
            label: "Data Sources",
            value: totalDataSources,
            icon: Database,
            color: "text-amber-600",
            bg: "bg-amber-100/50",
        }
    ];

    return (
        <div key="aggregated-metrics" className="glass border-b border-white/20 animate-in fade-in duration-500">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
                    {metrics.map((metric, idx) => (
                        <Card 
                            key={idx} 
                            className="p-3 sm:p-4 lg:p-6 cursor-pointer group hover:scale-[1.02] transition-all border-white/20 bg-white/40 backdrop-blur-md shadow-sm hover:shadow-md animate-in fade-in slide-in-from-bottom-4 duration-700"
                            style={{ 
                                animationDelay: `${idx * 100}ms`, 
                                animationFillMode: 'both' 
                            }}
                        >
                            <div className="flex items-start justify-between">
                                <div className="min-w-0">
                                    <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">{metric.label}</p>
                                    <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold mt-1 sm:mt-2 text-gray-900">{metric.value}</h3>
                                </div>
                                <div className={`p-2 sm:p-3 rounded-xl ${metric.bg} ${metric.color} shrink-0`}>
                                    <metric.icon className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6" />
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
}
