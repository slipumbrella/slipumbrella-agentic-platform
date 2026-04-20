import { render, screen } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

import { AgentSidebar } from "@/components/agents/agent-sidebar";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/aurora-text", () => ({
  AuroraText: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

const mockDispatch = vi.fn(() => ({ unwrap: vi.fn() }));

const mockState = {
  agent: {
    selectedTeamId: "team-1",
    executionSessions: [
      {
        session_id: "session-1",
        plans: [
          {
            agents: [{ id: "agent-1" }],
          },
        ],
      },
    ],
    teams: [
      {
        id: "team-1",
        name: "Sales Ops",
        sessions: [{ session_id: "session-1" }],
      },
      {
        id: "team-2",
        name: "Rev Ops",
        sessions: [],
      },
    ],
  },
};

describe("AgentSidebar", () => {
  beforeEach(() => {
    vi.mocked(useAppDispatch).mockReturnValue(mockDispatch as never);
    vi.mocked(useAppSelector).mockImplementation((selector) => selector(mockState as never));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders direct mobile team controls instead of a second Teams menu button", () => {
    render(<AgentSidebar />);

    // Both desktop and mobile render team buttons (JSDOM sees all, CSS visibility ignored)
    const allSessionsButtons = screen.getAllByRole("button", { name: /^all sessions$/i });
    const salesOpsButtons = screen.getAllByRole("button", { name: /^sales ops$/i });

    expect(allSessionsButtons[0]?.className).toContain("h-11");
    expect(salesOpsButtons[0]?.className).toContain("h-11");
    expect(screen.queryByRole("button", { name: /^teams$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^delete sales ops$/i }).className).toContain("h-11");
  });
});
