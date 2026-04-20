"use client";

import { useEffect, useSyncExternalStore, useState } from "react";
import { useAppSelector } from "@/lib/hooks";
import { selectUser } from "@/lib/features/auth/authSlice";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { UserList } from "./components/user-list";
import { RegisterUserDialog } from "./components/register-user-dialog";
import { ModelCatalog } from "./components/model-catalog";
import { IssueTable } from "@/sections/admin/issue-table";
import { Users, Bug, Database } from "lucide-react";

// Client-side only hook to detect hydration
const emptySubscribe = () => () => { };
function useIsMounted(): boolean {
    return useSyncExternalStore(
        emptySubscribe,
        () => true,
        () => false
    );
}

export default function AdminPage() {
    const user = useAppSelector(selectUser);
    const router = useRouter();
    const isMounted = useIsMounted();
    const [activeTab, setActiveTab] = useState<"users" | "issues" | "models">("users");

    useEffect(() => {
        if (isMounted && user && user.role !== "admin") {
            router.replace("/dashboard");
        }
    }, [user, router, isMounted]);

    if (!isMounted) {
        return null;
    }

    // Client-side guard only. Backend middleware must remain the real authorization check.
    if (!user || user.role !== "admin") {
        return null;
    }

    return (
        <div className="min-h-[calc(100vh-3.5rem)] mesh-app pb-10">
            <div className="container mx-auto py-10 px-6">
                <div className="flex flex-col gap-6 sm:flex-row sm:justify-between sm:items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-purple-600 to-indigo-600">
                            Admin Dashboard
                        </h1>
                        <p className="text-gray-500 mt-1 font-medium">
                            System administration and user management
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    {/* Premium Tab Switcher */}
                    <div className="flex p-1 bg-white/40 border border-white/20 backdrop-blur-md rounded-2xl w-fit shadow-inner">
                        <button
                            onClick={() => setActiveTab("users")}
                            className={cn(
                                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300",
                                activeTab === "users"
                                    ? "bg-white text-purple-600 shadow-sm ring-1 ring-black/5"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-white/50"
                            )}
                        >
                            <Users className="h-4 w-4" />
                            User Management
                        </button>
                        <button
                            onClick={() => setActiveTab("issues")}
                            className={cn(
                                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300",
                                activeTab === "issues"
                                    ? "bg-white text-purple-600 shadow-sm ring-1 ring-black/5"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-white/50"
                            )}
                        >
                            <Bug className="h-4 w-4" />
                            Support Tickets
                        </button>
                        <button
                            onClick={() => setActiveTab("models")}
                            className={cn(
                                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300",
                                activeTab === "models"
                                    ? "bg-white text-purple-600 shadow-sm ring-1 ring-black/5"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-white/50"
                            )}
                        >
                            <Database className="h-4 w-4" />
                            Model Catalog
                        </button>
                    </div>

                    <div className="animate-in fade-in duration-500 slide-in-from-bottom-2">
                        {activeTab === "users" ? (
                            <div className="flex flex-col gap-6">
                                <div className="flex justify-end">
                                    <RegisterUserDialog />
                                </div>
                                <UserList />
                            </div>
                        ) : activeTab === "models" ? (
                            <ModelCatalog />
                        ) : (
                            <IssueTable />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
