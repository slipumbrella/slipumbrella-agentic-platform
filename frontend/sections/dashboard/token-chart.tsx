"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchTokenData } from "@/lib/features/dashboard/dashboardSlice";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { formatDate } from "@/lib/utils";
import React from "react";
import { cn } from "@/lib/utils";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

export function TokenChart({ className }: { className?: string }) {
    const dispatch = useAppDispatch();
    const { tokenUsageData } = useAppSelector((state) => state.dashboard);
    const [isMounted, setIsMounted] = React.useState(false);

    React.useEffect(() => {
        dispatch(fetchTokenData(7));
    }, [dispatch]);

    React.useEffect(() => {
        setIsMounted(true);
    }, []);

    return (
        <Card className={cn("lg:col-span-2 bg-white/40 backdrop-blur-3xl border border-white/40 shadow-[0_8px_32px_rgba(100,60,180,0.06)] flex flex-col h-full", className)}>
            <CardHeader className="shrink-0 flex flex-col gap-1 pb-2">
                <CardTitle className="text-xl font-black text-gray-900 tracking-tight">Token Consumption</CardTitle>
                <CardDescription className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Global usage logs (7 DAYS)</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 pt-0">
                <div className="relative h-full min-h-[320px] w-full min-w-0 overflow-hidden rounded-2xl border border-white/30 bg-white/30">
                    {!isMounted ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-3">
                                <div className="h-10 w-48 rounded-full bg-white/70 animate-pulse" />
                                <div className="h-40 w-full max-w-3xl rounded-3xl bg-gradient-to-b from-purple-100/60 via-white/40 to-cyan-100/60 animate-pulse" />
                            </div>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={320}>
                            <AreaChart data={tokenUsageData ?? []} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => formatDate(value)} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.30)', boxShadow: '0 8px 32px rgba(100,60,180,0.12)' }}
                                    labelFormatter={(label) => formatDate(label)}
                                    formatter={(value: number | undefined, name: string | undefined) => {
                                        const v = (value ?? 0).toLocaleString();
                                        const label = name === 'input_tokens' ? 'Input Tokens' : name === 'output_tokens' ? 'Output Tokens' : (name ?? '');
                                        return [v, label] as [string, string];
                                    }}
                                />
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <Area type="monotone" dataKey="input_tokens" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorInput)" strokeWidth={2} />
                                <Area type="monotone" dataKey="output_tokens" stroke="#06b6d4" fillOpacity={1} fill="url(#colorOutput)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
