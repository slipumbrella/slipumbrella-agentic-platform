

import { AgentSidebar } from "@/components/agents/agent-sidebar";
import { DataSourcesSection } from "@/components/agents/data-sources-section";
import { AgentTeamList } from "@/sections/my-agents/agent-team-list";

export default function MyAgentsPage() {
    return (
        <div className="flex flex-col lg:flex-row h-[calc(100dvh-3.5rem)] mesh-app relative">
            {/* Left Sidebar - Desktop Only */}
            <AgentSidebar />

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
                <DataSourcesSection />
                <AgentTeamList />
            </div>
        </div>
    );
}
