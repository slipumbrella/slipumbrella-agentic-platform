import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { ModelEditor } from "@/app/(private)/admin/components/model-editor";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const setMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(min-width: 1536px)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe("ModelEditor", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
    setMatchMedia(false);
  });

  it("keeps the dialog constrained to the viewport and scrollable", () => {
    render(
      <ModelEditor
        open
        mode="create"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");

    expect(dialog.className).toContain("max-w-[min(64rem,calc(100vw-1rem))]");
    expect(dialog.className).toContain("sm:max-w-[min(72rem,calc(100vw-2rem))]");
    expect(dialog.className).toContain("xl:max-w-[min(96rem,calc(100vw-2rem))]");
    expect(dialog.className).toContain("2xl:max-w-[min(132rem,calc(100vw-3rem))]");
    expect(dialog.className).toContain("overflow-hidden");
    expect(screen.queryByText("Catalog Snapshot")).toBeNull();
    expect(screen.queryByText("Editing Notes")).toBeNull();
    expect(screen.getByText("Register OpenRouter Model")).toBeTruthy();
  });

  it("uses direct numeric entry for the context length field", () => {
    render(
      <ModelEditor
        open
        mode="create"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/^context length$/i).getAttribute("step")).toBeNull();
    expect(
      screen.getByText(/enter the full context window as a whole number greater than 0/i),
    ).toBeTruthy();
  });

  it("shows the snapshot pane on very wide screens", () => {
    setMatchMedia(true);

    render(
      <ModelEditor
        open
        mode="edit"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Catalog Snapshot")).toBeTruthy();
    expect(screen.getByText("Editing Notes")).toBeTruthy();
  });

  it("updates current state when toggling live form values in create mode", () => {
    setMatchMedia(true);

    render(
      <ModelEditor
        open
        mode="create"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: /reasoning model/i }));
    fireEvent.click(screen.getByRole("switch", { name: /active in builder/i }));

    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(screen.getByText("Enabled")).toBeTruthy();
  });

  it("updates current state when toggling live form values in edit mode", () => {
    setMatchMedia(true);

    render(
      <ModelEditor
        open
        mode="edit"
        model={{
          uuid: "b1a0d2a9-20f0-45a2-a9dd-7db4dd1d3f03",
          id: "openai/gpt-4.1-mini",
          name: "GPT-4.1 Mini",
          description: "",
          tags: ["Steady", "Preview"],
          selection_hint: "Balanced for general workflows",
          advanced_info: "Strong everyday model with predictable behavior.",
          context_length: 128000,
          input_price: 0.4,
          output_price: 1.6,
          is_reasoning: false,
          is_active: false,
        }}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getAllByText("Steady").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("switch", { name: /reasoning model/i }));
    fireEvent.click(screen.getByRole("switch", { name: /active in builder/i }));

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Enabled")).toBeTruthy();
  });

  it("captures tags, selection hint, and advanced info as live admin fields", async () => {
    setMatchMedia(true);
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ModelEditor
        open
        mode="create"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Swift tag" }));
    fireEvent.change(screen.getByLabelText(/^custom tag$/i), {
      target: { value: "Preview" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add custom tag/i }));
    fireEvent.change(screen.getByLabelText(/^selection hint$/i), {
      target: { value: "Best when the team needs slower, deeper analysis." },
    });
    fireEvent.change(screen.getByLabelText(/^advanced info$/i), {
      target: { value: "Stronger for multi-step planning and review, but usually slower." },
    });
    fireEvent.change(screen.getByLabelText(/^model id$/i), {
      target: { value: "openai/o3-mini" },
    });
    fireEvent.change(screen.getByLabelText(/^display name$/i), {
      target: { value: "o3 Mini" },
    });
    fireEvent.change(screen.getByLabelText(/^context length$/i), {
      target: { value: "200000" },
    });
    fireEvent.change(screen.getByLabelText(/^input price$/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/^output price$/i), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save model/i }));

    expect((screen.getByLabelText(/^selection hint$/i) as HTMLTextAreaElement).value).toBe(
      "Best when the team needs slower, deeper analysis.",
    );
    expect((screen.getByLabelText(/^advanced info$/i) as HTMLTextAreaElement).value).toBe(
      "Stronger for multi-step planning and review, but usually slower.",
    );
    expect(screen.getAllByText("Swift").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Preview").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 tags").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ["Swift", "Preview"],
        }),
      );
    });
  });

  it("rejects a context length of 0", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ModelEditor
        open
        mode="create"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^model id$/i), {
      target: { value: "openai/o3-mini" },
    });
    fireEvent.change(screen.getByLabelText(/^display name$/i), {
      target: { value: "o3 Mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Swift tag" }));
    fireEvent.change(screen.getByLabelText(/^context length$/i), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText(/^input price$/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/^output price$/i), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save model/i }));

    expect(await screen.findByText("Context length must be greater than 0")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
