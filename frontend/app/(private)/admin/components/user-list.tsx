"use client";

import { useEffect, useState, useMemo } from "react";
import { getAllUsers, deleteUser, forcePasswordReset } from "@/lib/features/admin/adminAPI";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { 
    Trash2, 
    RotateCcw, 
    Search, 
    ShieldCheck, 
    User as UserIcon, 
    Mail, 
    Shield, 
    MoreHorizontal,
    AlertCircle,
    Loader2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
    Card, 
    CardContent, 
    CardHeader, 
    CardTitle, 
    CardDescription 
} from "@/components/ui/card";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface Team {
    id?: string;
    ID?: string;
    name?: string;
    Name?: string;
}

interface User {
    id?: string;
    ID?: string;
    username?: string;
    Username?: string;
    email?: string;
    Email?: string;
    role?: string;
    Role?: string;
    teams?: Team[];
    Teams?: Team[];
}

export function UserList() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [roleFilter, setRoleFilter] = useState<string | null>(null);

    const [confirmation, setConfirmation] = useState<{
        isOpen: boolean;
        type: "delete" | "reset" | null;
        userId: string | null;
        username: string | null;
    }>({
        isOpen: false,
        type: null,
        userId: null,
        username: null,
    });

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const data = await getAllUsers();
            setUsers(data);
            setError(null);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "Failed to fetch users";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const filteredUsers = useMemo(() => {
        return users.filter((user) => {
            const username = user.username || user.Username || "";
            const email = user.email || user.Email || "";
            const role = user.role || user.Role || "";
            
            const matchesSearch = username.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                email.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesRole = roleFilter ? role === roleFilter : true;
            
            return matchesSearch && matchesRole;
        });
    }, [users, searchTerm, roleFilter]);

    const handleConfirm = async () => {
        if (!confirmation.userId || !confirmation.type) return;

        try {
            if (confirmation.type === "delete") {
                await deleteUser(confirmation.userId);
                toast.success("User deleted successfully");
            } else if (confirmation.type === "reset") {
                await forcePasswordReset(confirmation.userId);
                toast.success("User forced to reset password on next login");
            }
            fetchUsers();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : `Failed to ${confirmation.type} user`;
            toast.error(errorMessage);
        } finally {
            setConfirmation({ isOpen: false, type: null, userId: null, username: null });
        }
    };

    const getRoleBadge = (role: string) => {
        const normalizedRole = role.toLowerCase();
        if (normalizedRole === "admin") {
            return (
                <Badge variant="outline" className="bg-purple-50 text-purple-600 border-purple-200 flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-xs">
                    <ShieldCheck className="h-3 w-3" />
                    Administrator
                </Badge>
            );
        }
        return (
            <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-xs">
                <UserIcon className="h-3 w-3" />
                Standard User
            </Badge>
        );
    };

    if (loading && users.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                <p className="text-gray-500 font-medium">Fetching user directory...</p>
            </div>
        );
    }

    return (
        <Card className="glass-card overflow-hidden border-white/20 shadow-xl">
            <CardHeader className="border-b border-white/10 bg-white/5 pb-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-purple-600 to-blue-600">
                            User Management
                        </CardTitle>
                        <CardDescription className="text-gray-500">
                            Overview of all registered platform participants
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <Input 
                                placeholder="Search users or email..." 
                                className="pl-9 w-64 bg-white/50 border-white/30 focus:border-purple-400"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                    <Button 
                        variant={roleFilter === null ? "secondary" : "ghost"} 
                        size="sm" 
                        onClick={() => setRoleFilter(null)}
                        className="rounded-full text-xs h-7"
                    >
                        All Roles
                    </Button>
                    {["admin", "user"].map((role) => (
                        <Button
                            key={role}
                            variant={roleFilter === role ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setRoleFilter(role)}
                            className="rounded-full text-xs h-7 capitalize"
                        >
                            {role}s
                        </Button>
                    ))}
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-white/10">
                                <th className="px-6 py-4">Participant</th>
                                <th className="px-6 py-4">Auth Details</th>
                                <th className="px-6 py-4">Permission Level</th>
                                <th className="px-6 py-4 text-right">Administrative Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredUsers.map((user) => {
                                const id = user.id || user.ID || "";
                                const username = user.username || user.Username || "Unknown";
                                const email = user.email || user.Email || "No Email";
                                const role = user.role || user.Role || "user";

                                return (
                                    <tr 
                                        key={id} 
                                        className="hover:bg-white/5 transition-all duration-200 group"
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-full bg-linear-to-br from-purple-100 to-blue-100 flex items-center justify-center text-purple-600 font-bold border border-purple-200 shadow-sm transition-transform">
                                                    {username.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-gray-900 group-hover:text-purple-700 transition-colors">
                                                        {username}
                                                    </span>
                                                    <div className="flex items-center gap-1 text-[10px] text-gray-400">
                                                        <Shield className="h-3 w-3" />
                                                        ID: {id.slice(0, 8)}...
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 text-sm text-gray-600">
                                                <Mail className="h-4 w-4 text-gray-400" />
                                                {email}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {getRoleBadge(role)}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="relative flex justify-end items-center h-8">
                                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 absolute right-0 translate-x-1 group-hover:translate-x-0 pointer-events-none group-hover:pointer-events-auto">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 px-3 text-xs border-purple-200 bg-white/50 hover:bg-purple-50 text-purple-700 font-bold rounded-lg flex items-center gap-1.5 shadow-sm"
                                                        onClick={() => setConfirmation({
                                                            isOpen: true,
                                                            type: "reset",
                                                            userId: id,
                                                            username: username
                                                        })}
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5" />
                                                        Reset PWD
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 px-3 text-xs border-red-200 bg-white/50 hover:bg-red-50 text-red-600 font-bold rounded-lg flex items-center gap-1.5 shadow-sm"
                                                        onClick={() => setConfirmation({
                                                            isOpen: true,
                                                            type: "delete",
                                                            userId: id,
                                                            username: username
                                                        })}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                        Delete
                                                    </Button>
                                                </div>
                                                <div className="group-hover:opacity-0 transition-opacity duration-300">
                                                    <MoreHorizontal className="h-5 w-5 text-gray-400 opacity-50" />
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {filteredUsers.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center gap-3 opacity-40">
                                            <AlertCircle className="h-10 w-10 text-gray-400" />
                                            <span className="text-gray-500 font-medium">No participants found matching your criteria</span>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </CardContent>

            <AlertDialog open={confirmation.isOpen} onOpenChange={(open) => !open && setConfirmation(prev => ({ ...prev, isOpen: false }))}>
                <AlertDialogContent className="glass-strong border-gray-200/60 shadow-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-xl font-bold">
                            {confirmation.type === "delete" ? "Irreversible Deletion" : "Security Override: Reset Password"}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-500">
                            {confirmation.type === "delete"
                                ? `Are you absolutely sure you want to delete "${confirmation.username}"? Their data will be permanently removed from the system cluster.`
                                : `This will invalidate current credentials for "${confirmation.username}". They must set a new security key upon their next authentication attempt.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-4">
                        <AlertDialogCancel className="rounded-xl border-gray-200 hover:bg-gray-50">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirm}
                            className={cn(
                                "rounded-xl shadow-md",
                                confirmation.type === "delete" 
                                    ? "bg-red-600 hover:bg-red-700 text-white" 
                                    : "bg-purple-600 hover:bg-purple-700 text-white"
                            )}
                        >
                            {confirmation.type === "delete" ? "Terminate Identity" : "Confirm Override"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
