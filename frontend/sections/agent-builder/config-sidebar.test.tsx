import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { ConfigSidebar } from "@/sections/agent-builder/config-sidebar";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import {
  fetchActiveBuilderModels,
  fetchModelAssignments,
  saveModelAssignmentsDraft,
} from "@/lib/features/chat/builderAPI";

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("@/lib/features/chat/builderAPI", () => ({
  fetchActiveBuilderModels: vi.fn(),
  fetchModelAssignments: vi.fn(),
  saveModelAssignmentsDraft: vi.fn(),
}));

vi.mock("@/components/agent-builder/knowledge-base-dialog", () => ({
  KnowledgeBaseDialog: ({ open }: { open: boolean }) => (
    <div data-testid="knowledge-base-dialog" data-open={open ? "true" : "false"} />
  ),
}));

const mockState = {
  agent: {
    selectedSpecialists: [],
    attachments: {
      items: [],
      isLoading: false,
      isUploading: false,
      isEmbedding: false,
      syncingIds: [],
      isDeletingIds: [],
      isCrawling: false,
    },
    evaluation: {
      isEvaluating: false,
      data: null,
    },
  },
  chat: {
    builder: {
      sessionId: "planning-session-id",
      messages: [],
      availableSpecialists: [
        {
          id: "researcher",
          label: "Researcher",
          desc: "Finds and verifies the most useful information for the team.",
          tools: ["web_search", "save_artifact"],
        },
      ],
      isSwitchingSession: false,
      orchestrationType: "sequential",
      isTutorialActive: true,
      tutorialStep: 2,
    },
    supervisor: {
      executionAgents: [
        {
          id: "execution-writer",
          role: "Execution Writer",
          goal: "Handles live execution work.",
          tools: ["write"],
        },
      ],
      orchestrationType: "group_chat",
    },
  },
};

describe("ConfigSidebar", () => {
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
        tags: ["Steady", "Preview"],
        selection_hint: "A reliable default for structured planning and writing.",
        advanced_info: "A stable all-rounder when you want consistent output quality.",
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
        tags: ["Swift", "Preview"],
        selection_hint: "A faster model for general task coverage.",
        advanced_info: "Good when speed matters more than deep multi-step reasoning.",
        context_length: 128000,
        input_price: 0,
        output_price: 0,
        is_reasoning: false,
        is_active: true,
      },
    ]);
    vi.mocked(fetchModelAssignments).mockResolvedValue({
      baseline: { researcher: "anthropic/claude-sonnet-4" },
      overrides: {},
      final: { researcher: "anthropic/claude-sonnet-4" },
      confirmed: false,
      reviewed_at: null,
      confirmed_at: null,
    });
    vi.mocked(saveModelAssignmentsDraft).mockResolvedValue({
      baseline: { researcher: "anthropic/claude-sonnet-4" },
      overrides: { researcher: "openai/gpt-4.1" },
      final: { researcher: "openai/gpt-4.1" },
      confirmed: false,
      reviewed_at: null,
      confirmed_at: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("auto-opens the knowledge dialog during the tutorial knowledge step without a seeded message", () => {
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        ...mockState,
        chat: {
          ...mockState.chat,
          builder: {
            ...mockState.chat.builder,
            sessionId: null,
            availableSpecialists: [],
          },
        },
      } as never),
    );

    const { container } = render(<ConfigSidebar />);

    const sidebar = container.firstElementChild as HTMLElement | null;

    expect(sidebar?.className).toContain("w-full");
    expect(sidebar?.className).toContain("md:w-[19rem]");
    expect(sidebar?.className).toContain("xl:w-80");
    expect(screen.getByTestId("knowledge-base-dialog").getAttribute("data-open")).toBe("true");
  });

  it("uses simple files language in the sidebar summary", async () => {
    render(<ConfigSidebar />);

    expect(await screen.findByText("Files & Links")).toBeTruthy();
    expect(screen.getByRole("button", { name: /open files manager/i })).toBeTruthy();
    expect(screen.queryByText("Knowledge Base")).toBeNull();
    expect(screen.queryByText("Manage Knowledge")).toBeNull();
  });

  it("renders Builder specialists instead of execution agents", async () => {
    render(<ConfigSidebar />);

    expect(await screen.findByText("Researcher")).toBeTruthy();
    expect(screen.getByText("Sequential Mode")).toBeTruthy();
    expect(screen.queryByText("Group Chat Mode")).toBeNull();
    expect(screen.queryByText("Execution Writer")).toBeNull();
  });

  it("allows the mobile data panel to scroll so the specialists section stays reachable", async () => {
    const { container } = render(<ConfigSidebar />);

    await waitFor(() => {
      const sidebar = container.firstElementChild as HTMLElement | null;

      expect(sidebar?.className).toContain("overflow-y-auto");
      expect(sidebar?.className).toContain("md:overflow-hidden");
    });
  });

  it("uses a compact data quality gauge on mobile so specialists stay higher in view", async () => {
    render(<ConfigSidebar />);

    await waitFor(() => {
      const gaugeChart = screen.getByTestId("data-quality-gauge-chart");
      const gaugeLayout = screen.getByTestId("data-quality-gauge-layout");
      const gaugeStatus = screen.getByTestId("data-quality-gauge-status");

      expect(gaugeLayout.className).toContain("flex-row");
      expect(gaugeChart.className).toContain("scale-[0.82]");
      expect(gaugeChart.className).toContain("md:scale-100");
      expect(gaugeStatus.className).toContain("hidden");
      expect(gaugeStatus.className).toContain("sm:block");
    });
  });

  it("shows the builder-picked model and lets the user change it for a specialist", async () => {
    render(<ConfigSidebar />);

    fireEvent.click(await screen.findByRole("button", { name: /config/i }));

    expect(await screen.findByText("Builder picked")).toBeTruthy();
    expect(screen.getAllByText("Claude Sonnet 4").length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("combobox", { name: /model for researcher/i }));
    fireEvent.click(await screen.findByText("GPT-4.1"));

    await waitFor(() => {
      expect(saveModelAssignmentsDraft).toHaveBeenCalledWith(
        "planning-session-id",
        expect.objectContaining({
          baseline: { researcher: "anthropic/claude-sonnet-4" },
          overrides: { researcher: "openai/gpt-4.1" },
        }),
      );
    });

    expect(await screen.findByText("You changed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /apply to all specialist/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.getAllByText("Swift").length).toBeGreaterThan(0);
    expect(await screen.findByText("Input Price")).toBeTruthy();
    expect(screen.getByText("Logic")).toBeTruthy();
    expect(screen.getAllByText("Context").length).toBeGreaterThan(0);
  });

  it("shows the specialist tools inside the model customization dialog", async () => {
    render(<ConfigSidebar />);

    fireEvent.click(await screen.findByRole("button", { name: /config/i }));

    expect(await screen.findByText("web search")).toBeTruthy();
    expect(await screen.findByText("save artifact")).toBeTruthy();
  });

  it("renders every model tag in the model selection UI", async () => {
    render(<ConfigSidebar />);

    fireEvent.click(await screen.findByRole("button", { name: /config/i }));
    fireEvent.click(await screen.findByRole("combobox", { name: /model for researcher/i }));

    expect((await screen.findAllByText("Steady")).length).toBeGreaterThanOrEqual(2);
    expect((await screen.findAllByText("Preview")).length).toBeGreaterThanOrEqual(2);
  });

  it("disables apply-to-all when the current model is no longer active", async () => {
    vi.mocked(fetchModelAssignments).mockResolvedValueOnce({
      baseline: { researcher: "legacy/model" },
      overrides: {},
      final: { researcher: "legacy/model" },
      confirmed: false,
      reviewed_at: null,
      confirmed_at: null,
    });

    render(<ConfigSidebar />);

    fireEvent.click(await screen.findByRole("button", { name: /config/i }));

    expect(await screen.findByText(/not in the current active list/i)).toBeTruthy();
    const applyButton = screen.getByRole("button", {
      name: /apply to all specialist/i,
    });

    expect((applyButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(applyButton);
    expect(saveModelAssignmentsDraft).not.toHaveBeenCalled();
  });

  it("does not reload model choices when only builder output changes", async () => {
    let selectorState = mockState;
    vi.mocked(useAppSelector).mockImplementation((selector) => selector(selectorState as never));

    const { rerender } = render(<ConfigSidebar />);

    await waitFor(() => {
      expect(fetchModelAssignments).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Claude Sonnet 4")).toBeTruthy();

    selectorState = {
      ...mockState,
      chat: {
        ...mockState.chat,
        builder: {
          ...mockState.chat.builder,
          messages: [
            {
              id: "msg-2",
              role: "assistant",
              content: "Builder replanned the team.",
              timestamp: 2,
            },
          ],
          availableSpecialists: [...mockState.chat.builder.availableSpecialists],
        },
      },
    };

    rerender(<ConfigSidebar />);

    await waitFor(() => {
      expect(fetchModelAssignments).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Claude Sonnet 4")).toBeTruthy();
  });
});
