import { render } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatPage from "@/app/(private)/chats/page";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";

const mockSearchParams = {
  get: vi.fn((key: string) => {
    if (key === "exec_session_id") return "session-url";
    if (key === "team_id") return null;
    if (key === "agent_id") return null;
    return null;
  }),
};

const actionMocks = {
  setSelectedTeam: vi.fn((payload: string | null) => ({ type: "agent/setSelectedTeam", payload })),
  setActiveSessionId: vi.fn((payload: string | null) => ({ type: "agent/setActiveSessionId", payload })),
  setSelectedAgent: vi.fn((payload: string | null) => ({ type: "chat/setSelectedAgent", payload })),
  fetchExecutionArtifacts: vi.fn((payload: { teamId: string }) => ({ type: "chat/fetchExecutionArtifacts", payload })),
  clearSupervisorChat: vi.fn(() => ({ type: "chat/clearSupervisorChat" })),
  setExecSessionId: vi.fn((payload: string | null) => ({ type: "chat/setExecSessionId", payload })),
  loadSupervisorHistory: vi.fn((payload: { sessionId: string }) => ({ type: "chat/loadSupervisorHistory", payload })),
  fetchExecutionAgents: vi.fn((payload: { sessionId: string }) => ({ type: "chat/fetchExecutionAgents", payload })),
};

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("@/sections/chat/chat-interface", () => ({
  ChatInterface: () => <div data-testid="chat-interface" />,
}));

vi.mock("@/sections/chat/chat-list", () => ({
  ChatList: () => <div data-testid="chat-list" />,
}));

vi.mock("@/sections/chat/chat-sidebar", () => ({
  ChatSidebar: () => <div data-testid="chat-sidebar" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("lucide-react", () => ({
  Menu: () => <div data-testid="menu-icon" />,
}));

vi.mock("@/lib/features/agent/agentSlice", () => ({
  setSelectedTeam: (payload: string | null) => actionMocks.setSelectedTeam(payload),
  setActiveSessionId: (payload: string | null) => actionMocks.setActiveSessionId(payload),
}));

vi.mock("@/lib/features/chat/chatSlice", () => ({
  clearSupervisorChat: () => actionMocks.clearSupervisorChat(),
  fetchExecutionAgents: (payload: { sessionId: string }) => actionMocks.fetchExecutionAgents(payload),
  fetchExecutionArtifacts: (payload: { teamId: string }) => actionMocks.fetchExecutionArtifacts(payload),
  loadSupervisorHistory: (payload: { sessionId: string }) => actionMocks.loadSupervisorHistory(payload),
  setExecSessionId: (payload: string | null) => actionMocks.setExecSessionId(payload),
  setSelectedAgent: (payload: string | null) => actionMocks.setSelectedAgent(payload),
  closeActiveSupervisorConnection: vi.fn(),
}));

const team = {
  id: "team-1",
  name: "Team One",
  sessions: [{ session_id: "session-url" }],
};

const makeState = (currentExecSessionId: string | null) => ({
  chat: {
    supervisor: {
      execSessionId: currentExecSessionId,
    },
  },
  agent: {
    executionSessions: [{ session_id: "session-url", title: "URL Session" }],
    teams: [team],
  },
});

describe("ChatPage URL seeding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppDispatch).mockReturnValue(vi.fn());
  });

  it("does not reapply a stale URL session after the user already switched sessions manually", () => {
    const dispatch = vi.fn();
    vi.mocked(useAppDispatch).mockReturnValue(dispatch);

    const selector = vi.mocked(useAppSelector);
    selector.mockImplementation((selected) => selected(makeState("session-url") as never));

    const { rerender } = render(<ChatPage />);

    dispatch.mockClear();

    selector.mockImplementation((selected) => selected(makeState("session-manual") as never));
    rerender(<ChatPage />);

    expect(actionMocks.setExecSessionId).not.toHaveBeenCalledWith("session-url");
    expect(actionMocks.loadSupervisorHistory).not.toHaveBeenCalledWith({ sessionId: "session-url" });
    expect(actionMocks.fetchExecutionAgents).not.toHaveBeenCalledWith({ sessionId: "session-url" });
    expect(dispatch).not.toHaveBeenCalled();
  });
});