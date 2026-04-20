import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { DataSourcesSection } from "@/components/agents/data-sources-section";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("@/components/agent-builder/data-quality-gauge", () => ({
  DataQualityGauge: ({ compact }: { compact?: boolean }) => (
    <div data-testid="mock-gauge" data-compact={compact ? "true" : "false"}>Gauge</div>
  ),
  getDataQualityColor: () => "#E2E8F0",
}));

vi.mock("@/components/agent-builder/knowledge-base-dialog", () => ({
  KnowledgeBaseDialog: ({ providedSessionId }: { providedSessionId?: string }) => (
    <div data-testid="knowledge-dialog" data-session-id={providedSessionId ?? ""} />
  ),
}));

vi.mock("@/components/agent-builder/markdown-viewer-dialog", () => ({
  MarkdownViewerDialog: () => null,
}));

const mockDispatch = vi.fn();

const mockState = {
  agent: {
    attachments: {
      items: [],
      isLoading: false,
      isEmbedding: false,
    },
    evaluation: {
      data: null,
      isEvaluating: false,
    },
    selectedTeamId: "team-1",
    activeSessionId: "session-1",
    teams: [
      {
        id: "team-1",
        name: "Sales Operations",
        sessions: [],
      },
    ],
    executionSessions: [
      {
        session_id: "session-1",
        title: "Sales Session",
      },
    ],
  },
};

describe("DataSourcesSection", () => {
  beforeEach(() => {
    vi.mocked(useAppDispatch).mockReturnValue(mockDispatch as never);
    vi.mocked(useAppSelector).mockImplementation((selector) => selector(mockState as never));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses a true compact mobile gauge slot without extra left padding", () => {
    render(<DataSourcesSection />);

    const gaugeWrapper = screen.getAllByTestId("mock-gauge")[0]?.parentElement;
    const mobileBar = gaugeWrapper?.parentElement;
    const knowledgeButton = screen.getAllByRole("button", { name: /knowledge/i })[0];
    const mobileGauge = screen.getAllByTestId("mock-gauge")[0];

    expect(gaugeWrapper?.className).toContain("w-11");
    expect(gaugeWrapper?.className).toContain("h-11");
    expect(mobileGauge.getAttribute("data-compact")).toBe("true");
    expect(mobileBar?.className).not.toContain("pl-12");
    expect(mobileBar?.className).not.toContain("sm:pl-14");
    expect(knowledgeButton.className).toContain("h-11");
  });

  it("uses session scope for the knowledge base when both team and session are selected", () => {
    render(<DataSourcesSection />);

    expect(screen.getByTestId("knowledge-dialog").getAttribute("data-session-id")).toBe("session-1");
  });
});
