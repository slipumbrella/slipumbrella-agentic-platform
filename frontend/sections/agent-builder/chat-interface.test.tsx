import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { ChatInterface } from "@/sections/agent-builder/chat-interface";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  fetchActiveBuilderModels,
  fetchModelAssignments,
} from "@/lib/features/chat/builderAPI";

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("@/lib/features/chat/builderAPI", () => ({
  fetchActiveBuilderModels: vi.fn(),
  fetchModelAssignments: vi.fn(),
  confirmModelAssignments: vi.fn(),
}));

vi.mock("@/components/ui/typing-animation", () => ({
  TypingAnimation: ({ children }: { children: string }) => (
    <div data-testid="typing-animation">{children}</div>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mockState = {
  auth: {
    user: {
      id: "user-1",
      username: "demo",
      role: "admin",
      lastLogin: "2026-03-30T00:00:00Z",
    },
  },
  chat: {
    chatHistory: [],
    builder: {
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "Your team is ready.",
          timestamp: 1,
        },
      ],
      sessionId: "planning-session-id",
      isLoading: false,
      isStreaming: false,
      streamingContent: "",
      builderThinkContent: "",
      isBuilderThinking: false,
      latestExecSessionId: null,
      error: null,
      availableSpecialists: [
        {
          id: "researcher",
          label: "Researcher",
          desc: "Finds and verifies information.",
          tools: [],
        },
        {
          id: "writer",
          label: "Writer",
          desc: "Turns the work into a polished deliverable.",
          tools: [],
        },
      ],
      isTutorialActive: false,
      tutorialStep: 0,
    },
    supervisor: {
      isLoading: false,
    },
  },
};

describe("ChatInterface", () => {
  const waitForModelReviewToSettle = async () => {
    await waitFor(() => {
      expect(
        (screen.getByRole("button", {
          name: /^create team$/i,
        }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  };

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(useAppDispatch).mockReturnValue(vi.fn());
    vi.mocked(useAppSelector).mockImplementation((selector) => selector(mockState as never));
    vi.mocked(fetchActiveBuilderModels).mockResolvedValue([
      {
        uuid: "model-1",
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        description: "Balanced quality for planning, writing, and review work.",
        context_length: 200000,
        input_price: 0,
        output_price: 0,
        is_reasoning: false,
        is_active: true,
      },
      {
        uuid: "model-2",
        id: "openai/gpt-4.1",
        name: "GPT-4.1",
        description: "Fast, reliable responses for broad task coverage.",
        context_length: 128000,
        input_price: 0,
        output_price: 0,
        is_reasoning: false,
        is_active: true,
      },
    ]);
    vi.mocked(fetchModelAssignments).mockResolvedValue({
      baseline: {
        researcher: "anthropic/claude-sonnet-4",
        writer: "anthropic/claude-sonnet-4",
      },
      overrides: {
        writer: "openai/gpt-4.1",
      },
      final: {
        researcher: "anthropic/claude-sonnet-4",
        writer: "openai/gpt-4.1",
      },
      confirmed: false,
      reviewed_at: null,
      confirmed_at: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("enables the create-team action when model review is valid", async () => {
    render(<ChatInterface />);

    await waitFor(() => {
      const createButton = screen.getByRole("button", {
        name: /^create team$/i,
      }) as HTMLButtonElement;
      expect(createButton.disabled).toBe(false);
    });
  });

  it("keeps the launch action visible but disabled until a builder plan exists", () => {
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        ...mockState,
        chat: {
          ...mockState.chat,
          builder: {
            ...mockState.chat.builder,
            sessionId: null,
            messages: [],
            availableSpecialists: [],
          },
        },
      } as never),
    );

    render(<ChatInterface />);

    const createButton = screen.getByRole("button", {
      name: /^create team$/i,
    }) as HTMLButtonElement;

    expect(createButton.disabled).toBe(true);
    expect(
      screen.queryByRole("button", { name: /review setup/i }),
    ).toBeNull();
  });

  it("blocks review continuation when any specialist is missing a valid active model", async () => {
    vi.mocked(fetchModelAssignments).mockResolvedValue({
      baseline: {
        researcher: "anthropic/claude-sonnet-4",
        writer: "legacy/model",
      },
      overrides: {},
      final: {
        researcher: "anthropic/claude-sonnet-4",
        writer: "legacy/model",
      },
      confirmed: false,
      reviewed_at: null,
      confirmed_at: null,
    });

    render(<ChatInterface />);

    const reviewButton = await screen.findByRole("button", {
      name: /review setup/i,
    });
    fireEvent.click(reviewButton);

    expect(await screen.findByText(/needs update/i)).toBeTruthy();
    expect(
      screen.getAllByText(/this saved model is not in the active model list right now/i).length,
    ).toBeGreaterThan(0);

    const continueButton = screen.getByRole("button", {
      name: /continue to team details/i,
    }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    expect(screen.queryByPlaceholderText(/team name/i)).toBeNull();
  });

  it("uses typing animation for the live streaming assistant bubble", async () => {
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        ...mockState,
        chat: {
          ...mockState.chat,
          builder: {
            ...mockState.chat.builder,
            isStreaming: true,
            streamingContent: "Streaming reply in progress",
          },
        },
      } as never),
    );

    render(<ChatInterface />);
    await waitForModelReviewToSettle();

    expect(screen.getByTestId("typing-animation").textContent).toContain(
      "Streaming reply in progress",
    );
  });

  it("keeps the quick-start guide in one or two columns until wider screens", () => {
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        ...mockState,
        chat: {
          ...mockState.chat,
          builder: {
            ...mockState.chat.builder,
            messages: [],
            sessionId: null,
            availableSpecialists: [],
          },
        },
      } as never),
    );

    render(<ChatInterface />);

    const guideGrid = screen
      .getByText("Start with the job")
      .closest("div[class*='grid-cols']") as HTMLElement | null;

    expect(guideGrid).toBeTruthy();
    expect(guideGrid?.className).toContain("md:grid-cols-2");
    expect(guideGrid?.className).toContain("xl:grid-cols-3");
  });

  it("keeps the mobile header compact and allows the action row to wrap", async () => {
    render(<ChatInterface />);
    await waitForModelReviewToSettle();

    const title = screen.getByRole("heading", {
      name: /create your ai agent/i,
    });
    const actionRow = screen
      .getByRole("button", { name: /^create team$/i })
      .closest("div[class*='flex-wrap']") as HTMLElement | null;

    expect(title.className).toContain("text-sm");
    expect(actionRow).toBeTruthy();
    expect(actionRow?.className).toContain("flex-wrap");
  });

  it("forces long assistant content to wrap inside the chat viewport", async () => {
    render(<ChatInterface />);
    await waitForModelReviewToSettle();

    const assistantMessage = screen
      .getByText("Your team is ready.")
      .closest("div[class*='prose']") as HTMLElement | null;

    expect(assistantMessage).toBeTruthy();
    expect(assistantMessage?.className).toContain("[overflow-wrap:anywhere]");
    expect(assistantMessage?.className).toContain("[&_pre]:whitespace-pre-wrap");
  });

  it("keeps the user bubble narrower on mobile instead of stretching across the chat", async () => {
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        ...mockState,
        chat: {
          ...mockState.chat,
          builder: {
            ...mockState.chat.builder,
            messages: [
              {
                id: "msg-1",
                role: "user",
                content: "Please build a team for contract review and vendor comparison.",
                timestamp: 1,
              },
            ],
          },
        },
      } as never),
    );

    render(<ChatInterface />);
    await waitForModelReviewToSettle();

    const userBubble = screen
      .getByText(/Please build a team for contract review/i)
      .closest("div[class*='bg-primary']")?.parentElement as HTMLElement | null;

    expect(userBubble).toBeTruthy();
    expect(userBubble?.className).toContain("max-w-[85%]");
  });

  it("shows a floating jump button when the builder chat is away from the latest message", async () => {
    render(<ChatInterface />);

    const viewport = document.querySelector(
      "[data-slot='scroll-area-viewport']",
    ) as HTMLDivElement | null;

    expect(viewport).toBeTruthy();

    Object.defineProperty(viewport!, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(viewport!, "clientHeight", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(viewport!, "scrollTop", {
      configurable: true,
      writable: true,
      value: 200,
    });
    viewport!.scrollTo = vi.fn();

    fireEvent.scroll(viewport!);

    const jumpButton = await screen.findByRole("button", {
      name: /jump to latest message/i,
    });

    fireEvent.click(jumpButton);

    expect(viewport!.scrollTo).toHaveBeenCalledWith({
      top: 1200,
      behavior: "smooth",
    });
  });

  it("adds accessible labels and live log semantics to the builder chat", async () => {
    render(<ChatInterface />);
    await waitForModelReviewToSettle();

    expect(
      screen.getByRole("button", { name: /open builder tutorial/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: /builder job description/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /send builder prompt/i }),
    ).toBeTruthy();

    const log = screen.getByRole("log", {
      name: /builder conversation/i,
    });
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.getAttribute("aria-relevant")).toBe("additions text");
  });

  it("announces builder load failures as alerts", () => {
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        ...mockState,
        chat: {
          ...mockState.chat,
          builder: {
            ...mockState.chat.builder,
            messages: [],
            sessionId: null,
            error: "Network request failed",
            availableSpecialists: [],
          },
        },
      } as never),
    );

    render(<ChatInterface />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Failed to load conversation");
    expect(alert.textContent).toContain("Network request failed");
  });

  it("binds team dialog fields to labels and names the custom close button", async () => {
    render(<ChatInterface />);
    await waitForModelReviewToSettle();

    fireEvent.click(
      screen.getByRole("button", { name: /^create team$/i }),
    );

    const continueButton = await screen.findByRole("button", {
      name: /continue to team details/i,
    });
    await waitFor(() => {
      expect((continueButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(continueButton);

    expect(await screen.findByRole("textbox", { name: /team name/i })).toBeTruthy();
    expect(await screen.findByRole("textbox", { name: /^description/i })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /close team dialog/i }),
    ).toBeTruthy();
  });
});
