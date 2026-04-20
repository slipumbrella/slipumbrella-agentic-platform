import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { HeroSection } from "@/sections/landing/hero-section";

vi.mock("@/lib/hooks", () => ({
  useAppSelector: (selector: (state: { auth: { user: null } }) => unknown) =>
    selector({ auth: { user: null } }),
}));

vi.mock("@/components/ui/aurora-text", () => ({
  AuroraText: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <span className={className}>{children}</span>,
}));

vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: (_, tag) =>
        ({
          children,
          ...props
        }: Record<string, unknown> & { children?: React.ReactNode }) =>
          React.createElement(tag as string, props, children),
    },
  );

  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
  };
});

describe("HeroSection", () => {
  it("gives the desktop preview a larger footprint and more breathing room", () => {
    const { container } = render(<HeroSection />);

    const previewShell = container.querySelector(".glass-strong");
    expect(previewShell?.className).toContain("lg:w-[560px]");
    expect(previewShell?.className).toContain("xl:w-[620px]");

    const describedPanel = screen.getByText("You described").parentElement;
    expect(describedPanel?.className).toContain("lg:px-6");
    expect(describedPanel?.className).toContain("lg:py-5");

    const jobCopyFrame = describedPanel?.querySelector(".min-h-\\[52px\\]");
    expect(jobCopyFrame?.className).toContain("lg:min-h-[68px]");

    const teamStackFrame = screen
      .getByText("What we will create")
      .parentElement
      ?.querySelector(".min-h-\\[210px\\]");
    expect(teamStackFrame?.className).toContain("lg:min-h-[252px]");
  });
});
