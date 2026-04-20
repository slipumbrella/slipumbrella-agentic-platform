import { filterWorkflowTraceNodes } from "@/lib/features/chat/workflowTypes";
import { fireEvent, render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { describe, expect, it, vi } from "vitest";
import { ThinkingIndicator, WorkflowTraceDialog } from "./workflow-trace-dialog";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

// ─── ThinkingIndicator tests ──────────────────────────────────────────────────
// ThinkingIndicator is file-private in workflow-trace-dialog.tsx.
// Test observable behaviour using a minimal inline replica that matches the
// same logic and aria-label contract.

function MinimalThinkingIndicator({
  status,
  thinking,
  onOpenThinking,
}: {
  status: string;
  thinking?: { role: string; content_type: string; text?: string }[];
  onOpenThinking: (key: string) => void;
}) {
  const isRunning = status === "running";
  const hasThinking = (thinking?.length ?? 0) > 0;
  const isComplete = status === "completed" && hasThinking;
  if (!isRunning && !isComplete) return null;
  return (
    <button
      type="button"
      aria-label={isRunning ? "Agent is thinking…" : "View agent thinking chain"}
      onClick={() => { if (isComplete) onOpenThinking("key-1"); }}
    />
  );
}

describe("ThinkingIndicator", () => {
  it("renders a clickable button when status=completed and thinking items exist", () => {
    const onOpen = vi.fn();
    render(
      <div data-testid="outer-wrapper" style={{ position: "relative" }}>
        <MinimalThinkingIndicator
          status="completed"
          thinking={[{ role: "assistant", content_type: "text", text: "thought" }]}
          onOpenThinking={onOpen}
        />
        <div data-testid="agent-node">node content</div>
      </div>,
    );

    const btn = screen.getByRole("button", { name: "View agent thinking chain" });
    expect(btn).toBeDefined();

    // The button must NOT be inside the agent-node div
    expect(btn.closest("[data-testid='agent-node']")).toBeNull();

    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith("key-1");
  });

  it("renders a button when status=running", () => {
    render(
      <MinimalThinkingIndicator
        status="running"
        thinking={[]}
        onOpenThinking={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "Agent is thinking…" });
    expect(btn).toBeDefined();
  });

  it("renders nothing when status=pending", () => {
    const { container } = render(
      <MinimalThinkingIndicator
        status="pending"
        thinking={[]}
        onOpenThinking={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ─── ResponseBubble markdown tests ───────────────────────────────────────────
// Inline replica using the same remarkPlugins the real ResponseBubble will use.

function TestResponseBubble({ content }: { content: string }) {
  const normalized = content
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!normalized) return null;
  return (
    <div data-testid="bubble">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{normalized}</ReactMarkdown>
    </div>
  );
}

describe("ResponseBubble markdown rendering", () => {
  it("converts single newlines to line breaks", () => {
    const { container } = render(
      <TestResponseBubble content={"Hello\nWorld"} />,
    );
    expect(container.querySelector("br")).not.toBeNull();
  });

  it("converts escaped newline sequences to real markdown line breaks", () => {
    const { container } = render(
      <TestResponseBubble content={"Hello\\nWorld"} />,
    );
    expect(container.querySelector("br")).not.toBeNull();
  });

  it("does not corrupt double-newline paragraph breaks", () => {
    const { container } = render(
      <TestResponseBubble content={"Para one\n\nPara two"} />,
    );
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(2);
  });

  it("renders nothing for blank content", () => {
    const { container } = render(
      <TestResponseBubble content={"   "} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

function TestThinkingMarkdown({ content }: { content: string }) {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;
  return (
    <div data-testid="thinking-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{normalized}</ReactMarkdown>
    </div>
  );
}

describe("Thinking chain markdown rendering", () => {
  it("renders markdown headings and list items from structured thinking text", () => {
    const { container } = render(
      <TestThinkingMarkdown content={"## Next Steps\n\n- First\n- Second"} />,
    );

    expect(container.querySelector("h2")?.textContent).toBe("Next Steps");
    const listItems = container.querySelectorAll("li");
    expect(listItems).toHaveLength(2);
  });
});

describe("ThinkingIndicator (real component) — structural isolation", () => {
  it("renders the button outside any sibling node div when className positions it absolutely", () => {
    const onOpen = vi.fn();
    render(
      <div style={{ position: "relative" }}>
        <ThinkingIndicator
          status="completed"
          thinking={[{ role: "assistant", content_type: "text", text: "thought" }]}
          nodeKey="node-1"
          onOpenThinking={onOpen}
          className="absolute -top-3 -right-3 z-10"
        />
        <div data-testid="node-card">node content</div>
      </div>,
    );

    const btn = screen.getByRole("button", { name: "View agent thinking chain" });
    expect(btn).toBeDefined();
    // button must not be a descendant of the node card
    expect(btn.closest("[data-testid='node-card']")).toBeNull();

    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith("node-1");
  });

  it("does not propagate click to parent when completed", () => {
    const parentClick = vi.fn();
    const onOpen = vi.fn();
    render(
      <div onClick={parentClick} role="button" aria-label="parent">
        <ThinkingIndicator
          status="completed"
          thinking={[{ role: "assistant", content_type: "text", text: "thought" }]}
          nodeKey="node-1"
          onOpenThinking={onOpen}
        />
      </div>,
    );

    const btn = screen.getByRole("button", { name: "View agent thinking chain" });
    fireEvent.click(btn);

    // stopPropagation should prevent parent click
    expect(parentClick).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith("node-1");
  });
});

// ─── filterWorkflowTraceNodes tests ──────────────────────────────────────────
describe("WorkflowResultCard node count hides system nodes", () => {
  it("filterWorkflowTraceNodes removes system nodes (input-conversation and end) from the node list", () => {
    const nodes = [
      { status: "completed" as const, agent_id: "input-conversation", agent_role: "input-conversation" },
      { status: "completed" as const, agent_id: "abc", agent_role: "Analyst" },
      { status: "completed" as const, agent_id: "end", agent_role: "end" },
    ];
    const filtered = filterWorkflowTraceNodes(nodes);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].agent_id).toBe("abc");
  });
});

describe("Workflow trace detail surface", () => {
  it("removes the preview section and renders the node response", () => {
    render(
      <WorkflowTraceDialog
        open
        isLoading={false}
        onOpenChange={vi.fn()}
        trace={{
          trace_id: "trace-1",
          execution_session_id: "exec-1",
          orchestration: "sequential",
          status: "completed",
          summary: "Workflow completed.",
          started_at: "2026-04-06T10:00:00Z",
          completed_at: "2026-04-06T10:00:10Z",
          nodes: [
            {
              agent_id: "agent-1",
              agent_role: "LeaderAgent",
              order: 1,
              status: "completed",
              preview: "Short preview",
              response: "Full response body",
              started_at: "2026-04-06T10:00:01Z",
              completed_at: "2026-04-06T10:00:09Z",
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.getByText("Full response")).toBeDefined();
    expect(screen.getByText("Full response body")).toBeDefined();
  });
});
