import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { ChatInterface } from "@/sections/chat/chat-interface";

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("@/lib/features/chat/chatSlice", () => ({
  addSupervisorMessage: vi.fn(() => ({ type: "chat/addSupervisorMessage" })),
  closeWorkflowTraceDialog: vi.fn(() => ({ type: "chat/closeWorkflowTraceDialog" })),
  fetchSupervisorWorkflowTraceDetail: vi.fn(() => ({ type: "chat/fetchSupervisorWorkflowTraceDetail" })),
  fetchSupervisorWorkflowTraces: vi.fn(() => ({ type: "chat/fetchSupervisorWorkflowTraces" })),
  openWorkflowTraceDialog: vi.fn(() => ({ type: "chat/openWorkflowTraceDialog" })),
  resolvePresentationPrompt: vi.fn(() => ({ type: "chat/resolvePresentationPrompt" })),
  sendSupervisorMessage: vi.fn(() => ({ type: "chat/sendSupervisorMessage" })),
  stopSupervisorRun: vi.fn(() => ({ type: "chat/stopSupervisorRun" })),
}));

vi.mock("@/components/chat/presentation-choice-card", () => ({
  PresentationChoiceCard: () => null,
}));

vi.mock("@/components/chat/thinking-block", () => ({
  ThinkingBlock: () => null,
}));

vi.mock("@/components/chat/workflow-trace-dialog", () => ({
  WorkflowResultCard: () => null,
  WorkflowTraceDialog: () => null,
  shouldRenderWorkflowResultCard: () => false,
}));

vi.mock("@/components/ui/hyper-text", () => ({
  HyperText: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockState = {
  chat: {
    supervisor: {
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "# Summary\n\n- First point\n- Second point",
          timestamp: 1,
          agentRole: "LeaderAgent",
        },
      ],
      execSessionId: "execution-session",
      activeRunId: null,
      runStatus: "completed",
      isStopping: false,
      isLoading: false,
      streamingContent: "",
      isStreaming: false,
      thinkingContent: "",
      isThinking: false,
      executionAgents: [],
      selectedAgentId: null,
      streamingAgentId: null,
      orchestrationType: "handoff",
      workflowTraces: [],
      activeWorkflowTraceId: null,
      isWorkflowDialogOpen: false,
      isWorkflowTraceLoading: false,
    },
  },
  agent: {
    executionSessions: [],
  },
};

describe("Chats ChatInterface", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(useAppDispatch).mockReturnValue(vi.fn());
    vi.mocked(useAppSelector).mockImplementation((selector) => selector(mockState as never));
  });

  it("uses a transparent assistant block with the tightened markdown spacing", () => {
    const { container } = render(<ChatInterface />);

    const assistantText = screen.getByText("Summary");
    const assistantMarkdown = assistantText.closest("div[class*='prose']");

    expect(assistantMarkdown?.className).toContain("prose-p:my-0");
    expect(assistantMarkdown?.className).toContain("prose-ul:my-0");

    const frostedBubble = container.querySelector(".bg-white\\/50.backdrop-blur-md");
    expect(frostedBubble).toBeNull();
  });

  it("styles the chat scroll viewport with the design-system scrollbar", () => {
    const { container } = render(<ChatInterface />);

    const viewport = container.querySelector("[data-slot='scroll-area-viewport']");
    expect(viewport?.className).toContain("[scrollbar-width:thin]");
    expect(viewport?.className).toContain("[&::-webkit-scrollbar-thumb]:rounded-full");
    expect(viewport?.className).toContain("[scrollbar-gutter:stable]");
  });

  it("keeps the input enabled while workflow sync text is still showing after the answer is done", () => {
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        ...mockState,
        chat: {
          ...mockState.chat,
          supervisor: {
            ...mockState.chat.supervisor,
            isWorkflowRunning: true,
            isLoading: false,
            isStreaming: false,
            activeRunId: "run-sync",
          },
        },
      } as never),
    );

    render(<ChatInterface />);

    expect(
      (screen.getByPlaceholderText("Give instructions to the team...") as HTMLTextAreaElement)
        .disabled,
    ).toBe(false);
  });

  it("does not show the waiting bubble after an assistant response is already visible", () => {
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        ...mockState,
        chat: {
          ...mockState.chat,
          supervisor: {
            ...mockState.chat.supervisor,
            isWorkflowRunning: true,
            isLoading: false,
            isStreaming: false,
            activeRunId: "run-sync",
          },
        },
      } as never),
    );

    render(<ChatInterface />);

    expect(screen.queryByText(/searching through documentation/i)).toBeNull();
  });

  it("clears the draft when the execution session changes", () => {
    const selector = vi.mocked(useAppSelector);
    selector.mockImplementation((selected) => selected(mockState as never));

    const { rerender } = render(<ChatInterface />);
    const input = screen.getByPlaceholderText("Give instructions to the team...") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "draft for previous chat" } });
    expect(input.value).toBe("draft for previous chat");

    selector.mockImplementation((selected) =>
      selected({
        ...mockState,
        chat: {
          ...mockState.chat,
          supervisor: {
            ...mockState.chat.supervisor,
            execSessionId: "execution-session-2",
          },
        },
      } as never),
    );

    rerender(<ChatInterface />);

    expect(
      (screen.getByPlaceholderText("Give instructions to the team...") as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });
});