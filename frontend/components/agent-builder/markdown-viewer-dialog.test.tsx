import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { MarkdownViewerDialog } from "@/components/agent-builder/markdown-viewer-dialog";

vi.mock("@/lib/features/agent/uploadAPI", () => ({
  getAttachmentContent: vi.fn(async () =>
    "<table><tr><th colspan=\"2\">Period</th></tr><tr><td>Jan</td><td>600 USD</td></tr></table>",
  ),
}));

describe("MarkdownViewerDialog", () => {
  it("renders inline HTML table content in rendered mode", async () => {
    render(
      <MarkdownViewerDialog
        open
        onOpenChange={() => {}}
        attachmentId="att-1"
        fileName="sample.pdf"
      />,
    );

    const table = await screen.findByRole("table");
    expect(table).toBeTruthy();
    expect(screen.getByText("600 USD")).toBeTruthy();
  });
});
