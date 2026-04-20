import React from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { TokenChart } from "@/sections/dashboard/token-chart";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";

const responsiveContainerSpy = vi.fn();
const dispatchSpy = vi.fn();

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn(),
}));

vi.mock("@/lib/features/dashboard/dashboardSlice", () => ({
  fetchTokenData: (days: number) => ({ type: "dashboard/fetchTokenData", payload: days }),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({
    children,
    width,
    height,
    minWidth,
    minHeight,
  }: {
    children?: React.ReactNode;
    width?: string | number;
    height?: string | number;
    minWidth?: string | number;
    minHeight?: string | number;
  }) => {
    responsiveContainerSpy({ width, height, minWidth, minHeight });
    return <div data-testid="responsive-container">{children}</div>;
  },
  AreaChart: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Area: () => <g />,
  CartesianGrid: () => <g />,
  Tooltip: () => <g />,
  XAxis: () => <g />,
  YAxis: () => <g />,
}));

describe("TokenChart", () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    responsiveContainerSpy.mockClear();
    vi.mocked(useAppDispatch).mockReturnValue(dispatchSpy);
    vi.mocked(useAppSelector).mockImplementation((selector) =>
      selector({
        dashboard: {
          tokenUsageData: [
            { date: "Mon", input_tokens: 10, output_tokens: 20, estimated_cost_usd: 0.1 },
          ],
        },
      } as never),
    );
  });

  it("gives ResponsiveContainer a concrete minimum height to avoid zero-size warnings", () => {
    render(<TokenChart />);

    expect(responsiveContainerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 320,
      }),
    );
  });
});
