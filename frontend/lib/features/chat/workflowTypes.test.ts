// frontend/lib/features/chat/workflowTypes.test.ts
import { describe, expect, it } from "vitest";
import {
    filterWorkflowTraceNodes,
    isTerminalWorkflowStatus,
    sortWorkflowTraceNodes,
    type WorkflowTraceNode,
} from "./workflowTypes";

function makeNode(overrides: Partial<WorkflowTraceNode>): WorkflowTraceNode {
  return {
    status: "completed",
    agent_id: "agent-1",
    agent_role: "Researcher",
    order: 0,
    ...overrides,
  };
}

describe("filterWorkflowTraceNodes", () => {
  it("passes through normal agent nodes unchanged", () => {
    const nodes = [
      makeNode({ agent_id: "abc", agent_role: "Analyst" }),
      makeNode({ agent_id: "def", agent_role: "Writer" }),
    ];
    expect(filterWorkflowTraceNodes(nodes)).toHaveLength(2);
  });

  it("removes a node whose agent_id is 'input-conversation'", () => {
    const nodes = [
      makeNode({ agent_id: "input-conversation", agent_role: "input-conversation" }),
      makeNode({ agent_id: "abc", agent_role: "Analyst" }),
    ];
    const result = filterWorkflowTraceNodes(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].agent_id).toBe("abc");
  });

  it("removes a node whose agent_id is 'end'", () => {
    const nodes = [
      makeNode({ agent_id: "abc", agent_role: "Analyst" }),
      makeNode({ agent_id: "end", agent_role: "end" }),
    ];
    const result = filterWorkflowTraceNodes(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].agent_id).toBe("abc");
  });

  it("removes by agent_role when agent_id is undefined", () => {
    const nodes = [
      makeNode({ agent_id: undefined, agent_role: "input-conversation" }),
      makeNode({ agent_id: "abc", agent_role: "Analyst" }),
    ];
    const result = filterWorkflowTraceNodes(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].agent_id).toBe("abc");
  });

  it("returns empty array when all nodes are hidden", () => {
    const nodes = [
      makeNode({ agent_id: "input-conversation", agent_role: "input-conversation" }),
      makeNode({ agent_id: "end", agent_role: "end" }),
    ];
    expect(filterWorkflowTraceNodes(nodes)).toHaveLength(0);
  });

  it("composes correctly with sortWorkflowTraceNodes", () => {
    const nodes = [
      makeNode({ agent_id: "end", agent_role: "end", order: 99 }),
      makeNode({ agent_id: "abc", agent_role: "Writer", order: 2 }),
      makeNode({ agent_id: "def", agent_role: "Analyst", order: 1, is_leader: true }),
    ];
    // Sort first, then filter — hidden nodes are removed entirely
    const result = filterWorkflowTraceNodes(sortWorkflowTraceNodes(nodes));
    expect(result).toHaveLength(2);
    expect(result[0].is_leader).toBe(true); // leader sorts first
    expect(result[1].agent_id).toBe("abc");
  });

  it("keeps boundary nodes for sequential orchestration", () => {
    const nodes = [
      makeNode({ agent_id: "input-conversation", agent_role: "Input conversation", order: 0 }),
      makeNode({ agent_id: "abc", agent_role: "Analyst", order: 1 }),
      makeNode({ agent_id: "end", agent_role: "Final response", order: 2 }),
    ];
    const result = filterWorkflowTraceNodes(nodes, "sequential");
    expect(result).toHaveLength(3);
    expect(result[0].agent_id).toBe("input-conversation");
    expect(result[2].agent_id).toBe("end");
  });

  it("still hides boundary nodes for concurrent orchestration", () => {
    const nodes = [
      makeNode({ agent_id: "input-conversation", order: 0 }),
      makeNode({ agent_id: "abc", agent_role: "Worker", order: 1 }),
      makeNode({ agent_id: "end", order: 2 }),
    ];
    const result = filterWorkflowTraceNodes(nodes, "concurrent");
    expect(result).toHaveLength(1);
    expect(result[0].agent_id).toBe("abc");
  });
});

describe("isTerminalWorkflowStatus", () => {
  it("treats stopped traces as terminal", () => {
    expect(isTerminalWorkflowStatus("stopped")).toBe(true);
  });
});
