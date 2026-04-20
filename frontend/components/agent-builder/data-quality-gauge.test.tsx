import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

import { DataQualityGauge } from "@/components/agent-builder/data-quality-gauge";

vi.mock("recharts", () => ({
  PolarAngleAxis: () => null,
  RadialBar: () => null,
  RadialBarChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-radial-bar-chart">{children}</div>
  ),
}));

describe("DataQualityGauge", () => {
  it("uses a compact loading skeleton when the compact gauge is still fetching", () => {
    const { container } = render(
      <DataQualityGauge
        score={0}
        compact
        isLoading
      />,
    );

    const skeletons = Array.from(container.querySelectorAll('[data-slot="skeleton"]'));

    expect(skeletons).toHaveLength(1);
    expect(skeletons[0]?.className).toContain("h-11");
    expect(skeletons[0]?.className).toContain("w-11");
  });

  it("opens the audit dialog from an explicit action button when details exist", async () => {
    vi.stubGlobal("IntersectionObserver", class IntersectionObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "";
      thresholds = [];
    });

    render(
      <DataQualityGauge
        score={82}
        metrics={[
          {
            metric_name: "Coverage",
            score: 0.82,
            passed: true,
            reason: "The uploaded files cover the expected scope.",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /view audit details/i }));

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Quality breakdown for this knowledge base")).toBeTruthy();
    expect(within(dialog).getByText("Coverage")).toBeTruthy();
  });
});
