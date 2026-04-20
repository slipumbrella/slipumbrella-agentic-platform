import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { AgentTeamList } from "@/sections/my-agents/agent-team-list";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/agents/agent-card", () => ({
  AgentCard: ({ agent }: { agent: { role: string } }) => <div>{agent.role}</div>,
}));

vi.mock("@/components/agents/aggregated-metrics", () => ({
  AggregatedMetrics: () => <div>Aggregated Metrics</div>,
}));

vi.mock("@/lib/features/agent/uploadAPI", () => ({
  listAttachments: vi.fn().mockResolvedValue({ attachments: [] }),
  createEmbeddings: vi.fn(),
}));

const mockDispatch = vi.fn(() => ({ unwrap: vi.fn() }));

const mockState = {
  agent: {
    executionSessions: [
      {
        session_id: "session-1",
        title: "Sales Ops Session",
        plans: [
          {
            orchestration: "sequential",
            agents: [
              {
                id: "agent-1",
                role: "Researcher",
                is_leader: true,
                tools: [],
              },
            ],
          },
        ],
      },
    ],
    selectedTeamId: "team-1",
    activeSessionId: null,
    teams: [
      {
        id: "team-1",
        name: "Sales Ops",
        description: "Handles lead triage and CRM follow-up.",
        sessions: [{ session_id: "session-1" }],
      },
    ],
    googleSaEmail: null,
  },
};

describe("AgentTeamList", () => {
  beforeEach(() => {
    vi.mocked(useAppDispatch).mockReturnValue(mockDispatch as never);
    vi.mocked(useAppSelector).mockImplementation((selector) => selector(mockState as never));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens a main-header dialog to edit the selected team details", async () => {
    render(<AgentTeamList />);

    expect(screen.getByRole("heading", { name: "Sales Ops" })).toBeTruthy();
    expect(screen.getByText("Handles lead triage and CRM follow-up.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /edit details/i }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /team name/i })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /description/i })).toBeTruthy();
  });

  it("uses a touch-friendly assign action for session management", () => {
    render(<AgentTeamList />);

    const assignButton = screen.getByRole("button", { name: /assign session to a team/i });

    expect(assignButton.className).toContain("h-11");
    expect(assignButton.className).toContain("w-11");
  });

  it("places the primary chat action before topology content in the mobile card flow", () => {
    render(<AgentTeamList />);

    const chatButton = screen.getAllByRole("button", { name: /chat with researcher/i })[0];
    const topologyLabel = screen.getByText("Pipeline");

    expect(
      chatButton.compareDocumentPosition(topologyLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
