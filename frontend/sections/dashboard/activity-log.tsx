"use client";

import React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAppSelector } from "@/lib/hooks";
import { formatRelativeTime } from "@/lib/utils";

export function ActivityLog() {
    const { activityLog } = useAppSelector((state) => state.dashboard);

    return (
        <Card className="bg-white/60 backdrop-blur-xl border border-gray-200/60 shadow-[0_8px_32px_rgba(100,60,180,0.08)] flex flex-col">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Recent Activity</CardTitle>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </div>
                <CardDescription>Latest actions performed by your swarm</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0">
                <ScrollArea className="h-[300px] px-6">
                    <div className="space-y-6 pb-6">
                        {activityLog.map((log) => (
                            <div key={log.id} className="flex gap-4 items-start group">
                                <div className={`mt-1 h-2 w-2 rounded-full ring-4 ring-opacity-20 flex-shrink-0 ${log.status === 'success' ? 'bg-green-500 ring-green-500' : 'bg-red-500 ring-red-500'
                                    }`} />
                                <div className="flex-1 space-y-1">
                                    <p className="text-sm font-medium text-gray-900">{log.action}</p>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-purple-600 font-medium">{log.agent}</span>
                                        <span className="text-xs text-gray-400">•</span>
                                        <span className="text-xs text-gray-400">{formatRelativeTime(log.time)}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
