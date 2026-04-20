import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { vi } from "vitest";

import { HistorySidebar } from "@/sections/agent-builder/history-sidebar";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

const mockState = {
  chat: {
    chatHistory: [
      { id: "session-1", title: "Support setup", time: "Now", syncStatus: "synced" },
      { id: "session-2", title: "Sales team", time: "5m ago", syncStatus: "synced" },
    ],
    builder: {
      sessionId: "session-1",
    },
  },
};

describe("HistorySidebar", () => {
  beforeEach(() => {
    vi.mocked(useAppDispatch).mockReturnValue(vi.fn());
    vi.mocked(useAppSelector).mockImplementation((selector) => selector(mockState as never));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("makes the mobile history bar horizontally scrollable when sessions overflow", () => {
    const { container } = render(<HistorySidebar variant="bar" />);

    const bar = container.firstElementChild as HTMLElement | null;
    const scroller = bar?.firstElementChild as HTMLElement | null;

    expect(scroller?.className).toContain("overflow-x-auto");
  });

  it("hides the mobile history bar while scrolling down and shows it again when scrolling up", () => {
    const { container } = render(<HistorySidebar variant="bar" />);

    const bar = container.firstElementChild as HTMLElement | null;

    expect(bar?.getAttribute("data-mobile-bar-visible")).toBe("true");
    fireEvent.wheel(window, { deltaY: 120 });
    expect(bar?.getAttribute("data-mobile-bar-visible")).toBe("false");
    fireEvent.wheel(window, { deltaY: -120 });
    expect(bar?.getAttribute("data-mobile-bar-visible")).toBe("true");
  });
});
