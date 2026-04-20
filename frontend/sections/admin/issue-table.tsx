"use client";

import React, { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { getIssues, resolveIssue, reopenIssue } from "@/lib/features/issue/issueSlice";
import { toast } from "sonner";
import { 
    CheckCircle2, 
    Circle, 
    AlertCircle, 
    Bug, 
    Lightbulb, 
    Clock, 
    User, 
    Search,
    Filter,
    ArrowUpDown,
    Check,
    RotateCcw
} from "lucide-react";
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle 
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(new Date(dateString));
};

export function IssueTable() {
    const dispatch = useAppDispatch();
    const { issues, status, error } = useAppSelector((state) => state.issue);
    const [searchTerm, setSearchTerm] = useState("");
    const [typeFilter, setTypeFilter] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string | null>(null);

    useEffect(() => {
        dispatch(getIssues());
    }, [dispatch]);

    const filteredIssues = issues.filter((issue) => {
        const matchesSearch = issue.subject.toLowerCase().includes(searchTerm.toLowerCase()) || 
                             issue.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             issue.user?.username.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = typeFilter ? issue.type === typeFilter : true;
        const matchesStatus = statusFilter ? issue.status === statusFilter : true;
        return matchesSearch && matchesType && matchesStatus;
    });

    const getTypeIcon = (type: string) => {
        switch (type) {
            case "bug": return <Bug className="h-4 w-4" />;
            case "feature": return <Lightbulb className="h-4 w-4" />;
            default: return <AlertCircle className="h-4 w-4" />;
        }
    };

    const getTypeColor = (type: string) => {
        switch (type) {
            case "bug": return "bg-red-500/10 text-red-600 border-red-200/50";
            case "feature": return "bg-amber-500/10 text-amber-600 border-amber-200/50";
            default: return "bg-blue-500/10 text-blue-600 border-blue-200/50";
        }
    };

    if (status === "loading" && issues.length === 0) {
        return (
            <div className="flex items-center justify-center p-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    return (
        <Card className="glass-card overflow-hidden border-white/20 shadow-xl">
            <CardHeader className="border-b border-white/10 bg-white/5 pb-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-purple-600 to-blue-600">
                            Support Tickets
                        </CardTitle>
                        <CardDescription className="text-gray-500">
                            Manage and resolve issues submitted by users
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <Input 
                                placeholder="Search issues..." 
                                className="pl-9 w-64 bg-white/50 border-white/30 focus:border-purple-400"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
                
                <div className="flex flex-wrap gap-2 mt-4">
                    <Button 
                        variant={typeFilter === null ? "secondary" : "ghost"} 
                        size="sm" 
                        onClick={() => setTypeFilter(null)}
                        className="rounded-full text-xs h-7"
                    >
                        All Types
                    </Button>
                    {["bug", "feature", "general"].map((type) => (
                        <Button
                            key={type}
                            variant={typeFilter === type ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setTypeFilter(type)}
                            className="rounded-full text-xs h-7 capitalize"
                        >
                            {type}
                        </Button>
                    ))}
                    <div className="w-px h-7 bg-white/20 mx-1" />
                    <Button 
                        variant={statusFilter === null ? "secondary" : "ghost"} 
                        size="sm" 
                        onClick={() => setStatusFilter(null)}
                        className="rounded-full text-xs h-7"
                    >
                        All Status
                    </Button>
                    {["active", "resolved"].map((status) => (
                        <Button
                            key={status}
                            variant={statusFilter === status ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setStatusFilter(status)}
                            className="rounded-full text-xs h-7 capitalize"
                        >
                            {status}
                        </Button>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-white/10">
                                <th className="px-6 py-4">Issue</th>
                                <th className="px-6 py-4">Submitted By</th>
                                <th className="px-6 py-4">Type</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredIssues.map((issue) => (
                                <tr 
                                    key={issue.id} 
                                    className="hover:bg-white/5 transition-colors group"
                                >
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                            <span className="font-semibold text-gray-900 group-hover:text-purple-700 transition-colors">
                                                {issue.subject}
                                            </span>
                                            <span className="text-sm text-gray-500 line-clamp-1 max-w-md">
                                                {issue.description}
                                            </span>
                                            <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-1">
                                                <Clock className="h-3 w-3" />
                                                {formatDate(issue.created_at)}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="h-8 w-8 rounded-full bg-linear-to-br from-purple-100 to-blue-100 flex items-center justify-center text-purple-600 font-bold border border-purple-200 shadow-sm">
                                                {issue.user?.username.charAt(0).toUpperCase() || "?"}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-gray-700">{issue.user?.username || "Unknown"}</span>
                                                <span className="text-[10px] text-gray-400 capitalize">{issue.user?.role || "user"}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant="outline" className={cn("flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] capitalize font-medium", getTypeColor(issue.type))}>
                                            {getTypeIcon(issue.type)}
                                            {issue.type}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                        {issue.status === "active" ? (
                                            <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 flex items-center gap-1 w-fit">
                                                <Circle className="h-2 w-2 fill-current" />
                                                Active
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200 flex items-center gap-1 w-fit">
                                                <CheckCircle2 className="h-2 w-2" />
                                                Resolved
                                            </Badge>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        {issue.status === "active" ? (
                                            <Button 
                                                size="sm" 
                                                variant="outline"
                                                onClick={() => {
                                                    dispatch(resolveIssue(issue.id))
                                                        .unwrap()
                                                        .then(() => toast.success("Issue resolved"))
                                                        .catch((err) => toast.error(err.message || "Failed to resolve issue"));
                                                }}
                                                className="h-8 px-2 text-xs border-green-200 hover:bg-green-50 hover:text-green-600 transition-all font-medium rounded-lg"
                                            >
                                                <Check className="h-3.5 w-3.5 mr-1" />
                                                Resolve
                                            </Button>
                                        ) : (
                                            <Button 
                                                size="sm" 
                                                variant="outline"
                                                onClick={() => {
                                                    dispatch(reopenIssue(issue.id))
                                                        .unwrap()
                                                        .then(() => toast.success("Issue reopened"))
                                                        .catch((err) => toast.error(err.message || "Failed to reopen issue"));
                                                }}
                                                className="h-8 px-2 text-xs border-gray-200 hover:bg-gray-50 hover:text-gray-600 transition-all font-medium rounded-lg"
                                            >
                                                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                                Reopen
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {filteredIssues.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center gap-3 opacity-40">
                                            <AlertCircle className="h-10 w-10 text-gray-400" />
                                            <span className="text-gray-500 font-medium">No issues found matching your filters</span>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
}
