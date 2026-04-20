import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { BuilderTutorial } from "@/components/agent-builder/builder-tutorial";

const useReducedMotionMock = vi.fn(() => false);

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      animate,
      transition,
      layout,
      layoutId,
      initial,
      exit,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <div
        data-motion-animate={animate ? JSON.stringify(animate) : undefined}
        data-motion-transition={transition ? JSON.stringify(transition) : undefined}
        data-motion-layout={layout ? String(layout) : undefined}
        data-motion-layout-id={layoutId ? String(layoutId) : undefined}
        data-motion-initial={initial ? JSON.stringify(initial) : undefined}
        data-motion-exit={exit ? JSON.stringify(exit) : undefined}
        {...props}
      >
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => useReducedMotionMock(),
}));

const makeRect = (rect: Partial<DOMRect>) =>
  ({
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 0),
    bottom: (rect.top ?? 0) + (rect.height ?? 0),
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    toJSON: () => ({}),
  }) as DOMRect;

const installTarget = (id: string, rect: DOMRect) => {
  const el = document.createElement("div");
  el.id = id;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect);
  Object.defineProperty(el, "scrollIntoView", {
    value: vi.fn(),
    configurable: true,
  });
  document.body.appendChild(el);
  return el;
};

describe("BuilderTutorial", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useReducedMotionMock.mockReturnValue(false);
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 880, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("retargets from a curtain step to a sidebar step immediately after the step change", async () => {
    installTarget(
      "chat-area",
      makeRect({ left: 120, top: 140, width: 560, height: 320 }),
    );
    installTarget(
      "config-sidebar-knowledge",
      makeRect({ left: 1040, top: 400, width: 120, height: 48 }),
    );

    const onOpenChange = vi.fn();

    render(<BuilderTutorial open onOpenChange={onOpenChange} />);

    await act(async () => {
      vi.advanceTimersByTime(120);
    });

    const spotlightBefore = document.querySelector('[data-motion-layout-id="spotlight-frame"]') as HTMLElement | null;
    expect(spotlightBefore?.dataset.motionAnimate).toContain('"left":114');
    expect(spotlightBefore?.dataset.motionAnimate).toContain('"top":134');
    expect(spotlightBefore?.dataset.motionAnimate).toContain('"width":572');
    expect(spotlightBefore?.dataset.motionAnimate).toContain('"height":332');

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /next step/i }));
    });

    expect(screen.getByText("2. Open the knowledge area")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    const spotlightAfter = document.querySelector('[data-motion-layout-id="spotlight-frame"]') as HTMLElement | null;
    expect(spotlightAfter?.dataset.motionAnimate).toContain('"left":1034');
    expect(spotlightAfter?.dataset.motionAnimate).toContain('"top":394');
    expect(spotlightAfter?.dataset.motionAnimate).toContain('"width":132');
    expect(spotlightAfter?.dataset.motionAnimate).toContain('"height":60');
    expect(spotlightAfter?.dataset.motionAnimate).not.toContain('"left":114');
    expect(spotlightAfter?.dataset.motionAnimate).not.toContain('"top":134');
  });

  it("disables layout-based card motion for reduced-motion users", async () => {
    useReducedMotionMock.mockReturnValue(true);

    installTarget(
      "chat-area",
      makeRect({ left: 120, top: 140, width: 560, height: 320 }),
    );

    const onOpenChange = vi.fn();

    render(<BuilderTutorial open onOpenChange={onOpenChange} />);

    await act(async () => {});

    const card = Array.from(document.querySelectorAll<HTMLElement>("[data-motion-animate]"))
      .find((node) => node.className.includes("rounded-[2rem]"));

    expect(card).toBeDefined();
    expect(card?.dataset.motionLayout).toBeUndefined();
  });
});
