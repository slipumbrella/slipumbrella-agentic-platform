'use client';

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SendIcon } from "lucide-react";

export function MasterControl() {
    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-purple-100 mb-8">
            <div className="mb-4">
                <h2 className="text-xl font-bold text-purple-600 mb-1">Master Control - All Agents</h2>
                <p className="text-gray-500 text-sm">Send commands and monitor all your sales & marketing agents from one place</p>
            </div>

            <div className="relative">
                <Input
                    className="w-full pl-6 pr-14 py-6 rounded-xl border-gray-100 bg-white shadow-sm text-gray-700 placeholder:text-gray-400 focus-visible:ring-purple-200"
                    placeholder="Send instruction to all active agents..."
                />
                <Button
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 bg-purple-200 hover:bg-purple-300 text-purple-600 rounded-lg"
                >
                    <SendIcon size={20} />
                </Button>
            </div>
        </div>
    );
}
