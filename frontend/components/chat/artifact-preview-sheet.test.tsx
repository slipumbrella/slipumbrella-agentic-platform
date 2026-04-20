import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactPreviewSheet } from "./artifact-preview-sheet";
import type { Artifact } from "@/lib/features/chat/builderAPI";

const mockArtifact: Artifact = {
  id: "test-id-123",
  team_id: "team-id-456",
  file_id: "local-abc",
  file_type: "local_doc",
  title: "Q1 Sales Report",
  url: "/artifacts/local-abc",
  content: "# Q1 Sales Report\n\nRevenue was **$4.2M**.",
  created_at: "2026-03-31T10:24:00Z",
};

describe("ArtifactPreviewSheet", () => {
  it("renders nothing when open is false", () => {
    render(
      <ArtifactPreviewSheet artifact={mockArtifact} open={false} onClose={vi.fn()} onDownload={vi.fn()} />,
    );
    expect(screen.queryByText("Q1 Sales Report")).toBeNull();
  });

  it("renders the artifact title when open", () => {
    render(
      <ArtifactPreviewSheet artifact={mockArtifact} open={true} onClose={vi.fn()} onDownload={vi.fn()} />,
    );
    expect(screen.getByText("Q1 Sales Report")).toBeDefined();
  });

  it("calls onDownload when Download button is clicked", () => {
    const onDownload = vi.fn();
    render(
      <ArtifactPreviewSheet artifact={mockArtifact} open={true} onClose={vi.fn()} onDownload={onDownload} />,
    );
    const btn = screen.getByRole("button", { name: /download/i });
    fireEvent.click(btn);
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ArtifactPreviewSheet artifact={mockArtifact} open={true} onClose={onClose} onDownload={vi.fn()} />,
    );
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders empty state when content is empty", () => {
    const emptyArtifact = { ...mockArtifact, content: "" };
    render(
      <ArtifactPreviewSheet artifact={emptyArtifact} open={true} onClose={vi.fn()} onDownload={vi.fn()} />,
    );
    expect(screen.getByText(/no content available/i)).toBeDefined();
  });

  it("strips leading heading when it matches artifact title", () => {
    render(
      <ArtifactPreviewSheet artifact={mockArtifact} open={true} onClose={vi.fn()} onDownload={vi.fn()} />,
    );
    // Title "Q1 Sales Report" should appear exactly once (in SheetTitle, not also in content)
    const matches = screen.getAllByText("Q1 Sales Report");
    expect(matches).toHaveLength(1);
  });

  it("preserves heading when it does not match artifact title", () => {
    const differentHeading = {
      ...mockArtifact,
      title: "Something Else",
      content: "# Different Heading\n\nBody text.",
    };
    render(
      <ArtifactPreviewSheet artifact={differentHeading} open={true} onClose={vi.fn()} onDownload={vi.fn()} />,
    );
    expect(screen.getByText("Different Heading")).toBeDefined();
  });
});
