import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { ModelCatalog } from "@/app/(private)/admin/components/model-catalog";
import type { OpenRouterModel } from "@/lib/features/admin/adminAPI";

const {
  mockGetOpenRouterModels,
  mockGetOpenRouterModel,
  mockCreateOpenRouterModel,
  mockUpdateOpenRouterModel,
  mockDeleteOpenRouterModel,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockGetOpenRouterModels: vi.fn(),
  mockGetOpenRouterModel: vi.fn(),
  mockCreateOpenRouterModel: vi.fn(),
  mockUpdateOpenRouterModel: vi.fn(),
  mockDeleteOpenRouterModel: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/lib/features/admin/adminAPI", async () => {
  const actual = await vi.importActual("@/lib/features/admin/adminAPI");

  return {
    ...actual,
    getOpenRouterModels: mockGetOpenRouterModels,
    getOpenRouterModel: mockGetOpenRouterModel,
    createOpenRouterModel: mockCreateOpenRouterModel,
    updateOpenRouterModel: mockUpdateOpenRouterModel,
    deleteOpenRouterModel: mockDeleteOpenRouterModel,
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

const sampleModels: OpenRouterModel[] = [
  {
    uuid: "8b4ad286-1f95-46fd-9848-958a1bbbe2af",
    id: "openai/gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    description: "Balanced model",
    tags: ["Steady", "Preview"],
    selection_hint: "Balanced for most Builder workflows.",
    advanced_info: "Reliable model for general planning, drafting, and review.",
    context_length: 128000,
    input_price: 0.4,
    output_price: 1.6,
    is_reasoning: false,
    is_active: true,
  },
];

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("ModelCatalog", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
    mockGetOpenRouterModels.mockResolvedValue(sampleModels);
    mockGetOpenRouterModel.mockImplementation(async (uuid: string) => ({
      ...sampleModels[0],
      uuid,
    }));
    mockCreateOpenRouterModel.mockResolvedValue({
      ...sampleModels[0],
      uuid: "11bdb62c-7a2a-4cc0-986a-4f6f9af47397",
      id: "anthropic/claude-3.7-sonnet",
      name: "Claude 3.7 Sonnet",
    });
    mockUpdateOpenRouterModel.mockImplementation(
      async (_uuid: string, payload: Partial<OpenRouterModel>) => ({
        ...sampleModels[0],
        ...payload,
      }),
    );
    mockDeleteOpenRouterModel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders models and exposes create and edit actions", async () => {
    render(<ModelCatalog />);

    expect(await screen.findByText("GPT-4.1 Mini")).toBeTruthy();
    expect(screen.getByRole("table").className).toContain("table-fixed");
    expect(screen.getByText("Steady")).toBeTruthy();
    expect(screen.getByText("Preview")).toBeTruthy();
    expect(screen.getByText("Balanced for most Builder workflows.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /create model/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit gpt-4.1 mini/i })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /toggle active for gpt-4.1 mini/i })).toBeTruthy();
  });

  it("creates a model and deletes an existing model after confirmation", async () => {
    render(<ModelCatalog />);

    await screen.findByText("GPT-4.1 Mini");

    fireEvent.click(screen.getByRole("button", { name: /create model/i }));

    fireEvent.change(screen.getByLabelText(/^model id$/i), {
      target: { value: "anthropic/claude-3.7-sonnet" },
    });
    fireEvent.change(screen.getByLabelText(/^display name$/i), {
      target: { value: "Claude 3.7 Sonnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Deep tag" }));
    fireEvent.change(screen.getByLabelText(/^custom tag$/i), {
      target: { value: "Preview" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add custom tag/i }));
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "Reasoning-oriented model" },
    });
    fireEvent.change(screen.getByLabelText(/^selection hint$/i), {
      target: { value: "Better for deeper analysis." },
    });
    fireEvent.change(screen.getByLabelText(/^advanced info$/i), {
      target: { value: "Handles more complex planning, with a slower and pricier profile." },
    });
    fireEvent.change(screen.getByLabelText(/^context length$/i), {
      target: { value: "200000" },
    });
    fireEvent.change(screen.getByLabelText(/^input price$/i), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/^output price$/i), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save model/i }));

    await waitFor(() => {
      expect(mockCreateOpenRouterModel).toHaveBeenCalledWith({
        id: "anthropic/claude-3.7-sonnet",
        name: "Claude 3.7 Sonnet",
        description: "Reasoning-oriented model",
        tags: ["Deep", "Preview"],
        icon: null,
        icon_file: null,
        selection_hint: "Better for deeper analysis.",
        advanced_info: "Handles more complex planning, with a slower and pricier profile.",
        context_length: 200000,
        input_price: 3,
        output_price: 15,
        is_reasoning: false,
        is_active: true,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /delete gpt-4.1 mini/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete model/i }));

    await waitFor(() => {
      expect(mockDeleteOpenRouterModel).toHaveBeenCalledWith(sampleModels[0].uuid);
    });
  });

  it("blocks save when required numeric fields are left blank", async () => {
    render(<ModelCatalog />);

    await screen.findByText("GPT-4.1 Mini");

    fireEvent.click(screen.getByRole("button", { name: /create model/i }));

    fireEvent.change(screen.getByLabelText(/^model id$/i), {
      target: { value: "anthropic/claude-3.7-sonnet" },
    });
    fireEvent.change(screen.getByLabelText(/^display name$/i), {
      target: { value: "Claude 3.7 Sonnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save model/i }));

    await waitFor(() => {
      expect(mockCreateOpenRouterModel).not.toHaveBeenCalled();
    });
    expect(screen.getByText("Context length is required")).toBeTruthy();
    expect(screen.getByText("Input price is required")).toBeTruthy();
    expect(screen.getByText("Output price is required")).toBeTruthy();
  });

  it("blocks save when context length is 0", async () => {
    render(<ModelCatalog />);

    await screen.findByText("GPT-4.1 Mini");

    fireEvent.click(screen.getByRole("button", { name: /create model/i }));

    fireEvent.change(screen.getByLabelText(/^model id$/i), {
      target: { value: "anthropic/claude-3.7-sonnet" },
    });
    fireEvent.change(screen.getByLabelText(/^display name$/i), {
      target: { value: "Claude 3.7 Sonnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Deep tag" }));
    fireEvent.change(screen.getByLabelText(/^context length$/i), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText(/^input price$/i), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/^output price$/i), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save model/i }));

    await waitFor(() => {
      expect(mockCreateOpenRouterModel).not.toHaveBeenCalled();
    });
    expect(screen.getByText("Context length must be greater than 0")).toBeTruthy();
  });

  it("refreshes latest model details before toggling activation", async () => {
    const staleRow = {
      ...sampleModels[0],
      description: "Stale row description",
      context_length: 64000,
      input_price: 0.1,
      output_price: 0.2,
    };
    const latestModel = {
      ...sampleModels[0],
      description: "Latest server description",
      tags: ["Swift", "Preview"],
      selection_hint: "Fast for lightweight workflows.",
      advanced_info: "Lower cost and quicker responses for simpler tasks.",
      context_length: 256000,
      input_price: 0.9,
      output_price: 2.7,
      is_reasoning: true,
    };

    mockGetOpenRouterModels.mockResolvedValue([staleRow]);
    mockGetOpenRouterModel.mockResolvedValue(latestModel);

    render(<ModelCatalog />);

    await screen.findByText("GPT-4.1 Mini");

    fireEvent.click(screen.getByRole("switch", { name: /toggle active for gpt-4.1 mini/i }));

    await waitFor(() => {
      expect(mockGetOpenRouterModel).toHaveBeenCalledWith(staleRow.uuid);
      expect(mockUpdateOpenRouterModel).toHaveBeenCalledWith(staleRow.uuid, {
        id: latestModel.id,
        name: latestModel.name,
        description: latestModel.description,
        tags: latestModel.tags,
        selection_hint: latestModel.selection_hint,
        advanced_info: latestModel.advanced_info,
        context_length: latestModel.context_length,
        input_price: latestModel.input_price,
        output_price: latestModel.output_price,
        is_reasoning: latestModel.is_reasoning,
        is_active: false,
      });
    });
  });

  it("toggles long descriptions in the catalog table", async () => {
    const longDescription =
      "This model is used for complex multi-step analysis, richer tool coordination, and longer-form reasoning across planning, review, and summarization workflows.";
    mockGetOpenRouterModels.mockResolvedValue([
      {
        ...sampleModels[0],
        description: longDescription,
      },
    ]);

    render(<ModelCatalog />);

    await screen.findByText("GPT-4.1 Mini");

    const toggleButton = screen.getByRole("button", { name: /show more/i });
    expect(toggleButton).toBeTruthy();
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /show less/i }).getAttribute("aria-expanded")).toBe(
        "true",
      );
    });
  });

  it("ignores a late edit response after closing edit and opening create", async () => {
    const lateEditModel = {
      ...sampleModels[0],
      id: "late/provider-model",
      name: "Late Edit Model",
      description: "Should not overwrite create mode",
    };

    let resolveLateEdit: ((value: OpenRouterModel) => void) | undefined;
    mockGetOpenRouterModel.mockImplementation(
      () =>
        new Promise<OpenRouterModel>((resolve) => {
          resolveLateEdit = resolve;
        }),
    );

    render(<ModelCatalog />);

    await screen.findByText("GPT-4.1 Mini");

    fireEvent.click(screen.getByRole("button", { name: /edit gpt-4.1 mini/i }));

    await waitFor(() => {
      expect(mockGetOpenRouterModel).toHaveBeenCalledWith(sampleModels[0].uuid);
      expect(resolveLateEdit).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    fireEvent.click(screen.getByRole("button", { name: /create model/i }));

    fireEvent.change(screen.getByLabelText(/^model id$/i), {
      target: { value: "draft/new-model" },
    });

    expect((screen.getByLabelText(/^model id$/i) as HTMLInputElement).value).toBe("draft/new-model");

    resolveLateEdit!(lateEditModel);

    await waitFor(() => {
      expect((screen.getByLabelText(/^model id$/i) as HTMLInputElement).value).toBe("draft/new-model");
      expect(screen.queryByDisplayValue("Late Edit Model")).toBeNull();
    });
  });
});
