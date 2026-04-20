import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import AgentBuilderPage from "@/app/(private)/agent-builder/page";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("@/components/agent-builder/builder-tutorial", () => ({
  BuilderTutorial: () => <div data-testid="builder-tutorial" />,
}));

vi.mock("@/components/ui/light-rays", () => ({
  LightRays: () => <div data-testid="light-rays" />,
}));

vi.mock("@/sections/agent-builder/chat-interface", () => ({
  ChatInterface: ({ layoutMode }: { layoutMode?: string }) => (
    <div data-testid="chat-interface" data-layout-mode={layoutMode} />
  ),
}));

vi.mock("@/sections/agent-builder/config-sidebar", () => ({
  ConfigSidebar: ({ className }: { className?: string }) => (
    <div data-testid="config-sidebar" className={className} />
  ),
}));

vi.mock("@/sections/agent-builder/history-sidebar", () => ({
  HistorySidebar: ({
    className,
    variant,
  }: {
    className?: string;
    variant?: "sidebar" | "bar";
  }) => <div data-testid={`history-${variant ?? "sidebar"}`} className={className} />,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      transition?: unknown;
    }) => {
      void _initial;
      void _animate;
      void _transition;

      return <div {...props}>{children}</div>;
    },
  },
}));

const mockState = {
  chat: {
    builder: {
      messages: [],
      sessionId: null,
      isSwitchingSession: false,
      isTutorialActive: false,
      tutorialStep: 0,
    },
  },
};

describe("AgentBuilderPage", () => {
  beforeEach(() => {
    vi.mocked(useAppDispatch).mockReturnValue(vi.fn());
    vi.mocked(useAppSelector).mockImplementation((selector) => selector(mockState as never));
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses dvh-safe height and keeps responsive controls scoped to smaller breakpoints", () => {
    const { container, getByTestId, getByText } = render(<AgentBuilderPage />);

    const root = container.firstElementChild as HTMLElement | null;
    const tabSwitcher = getByText("Chat").closest("div[class*='md:hidden']") as HTMLElement | null;

    expect(root?.className).toContain("h-[calc(100dvh-3.5rem)]");
    expect(getByTestId("history-bar").className).toContain("lg:hidden");
    expect(tabSwitcher).toBeTruthy();
    expect(tabSwitcher?.className).toContain("md:hidden");
  });

  it("exposes the mobile switcher as tabs with selected state", () => {
    render(<AgentBuilderPage />);

    const tablist = screen.getByRole("tablist", {
      name: /builder panel switcher/i,
    });
    const chatTab = screen.getByRole("tab", { name: /chat/i });
    const dataTab = screen.getByRole("tab", { name: /data/i });

    expect(tablist).toBeTruthy();
    expect(chatTab.getAttribute("aria-selected")).toBe("true");
    expect(dataTab.getAttribute("aria-selected")).toBe("false");
  });

  it("does not render decorative light rays when reduced motion is requested", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<AgentBuilderPage />);

    expect(screen.queryByTestId("light-rays")).toBeNull();
  });
});
