# Orchestration Engine

## Goal Description

Implement the engine responsible for executing the `PlanSpec`. This involves different orchestration strategies (`Sequential`, `Concurrent`, `GroupChat`, `Handoff`, `Magentic`) that coordinate the agents created by the `AgentFactory`.

## User Review Required

- **Strategies**: We will implement `Sequential` and `GroupChat` first. If successful, we will proceed to `Concurrent`, `Handoff`, and `Magentic`.
- **Execution**: The orchestrator will manage the flow of data between agents.

## Proposed Changes

### Orchestration

#### [NEW] [orchestrator.py](file:///c:/Users/ASUS/Ley/Senior%20Project/Capstone/egco-capstone-prog/agent/core/orchestration/orchestrator.py)

- `BaseOrchestrator`: Abstract base class.
- `SequentialOrchestrator`: Executes agents one by one, passing output as context to the next.
- `GroupChatOrchestrator`: Manages a conversation between agents (round-robin or LLM-directed).
- `ConcurrentOrchestrator`: Executes agents in parallel and aggregates results.
- `HandoffOrchestrator`: Agents explicitly hand off control to specific other agents.
- `MagenticOrchestrator`: Dynamic, single-agent loop that can spawn sub-agents or tools as needed (One-Shot Agentic).

#### [NEW] [builder.py](file:///c:/Users/ASUS/Ley/Senior%20Project/Capstone/egco-capstone-prog/agent/core/orchestration/builder.py)

- `OrchestrationBuilder`: Factory to create the appropriate orchestrator based on `PlanSpec.orchestration`.

### Core Integration

#### [MODIFY] [core_agent.py](file:///c:/Users/ASUS/Ley/Senior%20Project/Capstone/egco-capstone-prog/agent/core/core_agent.py)

- Add method `execute_plan(plan: PlanSpec)` that uses `AgentFactory` and `OrchestrationBuilder`.

## Verification Plan

### Automated Tests

- **Sequential Test**: Create `tests/test_orchestration_sequential.py`.
- **Group Chat Test**: Create `tests/test_orchestration_group.py`.
- **Concurrent Test**: Create `tests/test_orchestration_concurrent.py`.
- **Handoff Test**: Create `tests/test_orchestration_handoff.py`.
- **Magentic Test**: Create `tests/test_orchestration_magentic.py`.

### Manual Verification

- Run the test scripts incrementally as each strategy is implemented.

---

# Phase 5: Tools & Integration

## Goal Description

Finalize tool layer and achieve end-to-end execution from gRPC request → planning → dynamic agent & tool injection → orchestration → consolidated result return. This phase hardens the `BackendTool`, completes MCP tool integration (e.g. LINE), and validates full platform behavior across all orchestration modes.

## Scope

1. Implement missing `BackendTool` functionality (local Python ops, backend service hooks, simple data retrieval, logging wrappers).
2. Generalize MCP Tool integration (standard interface, capability advertisement, error isolation, timeout handling).
3. Ensure tool injection path (PlanSpec → AgentFactory → agent instance) supports multiple tool types simultaneously.
4. Add end-to-end test covering: gRPC call → CoreAgent planning → factory → orchestration → aggregated response.
5. Add resilience (fail-fast on unavailable tools, structured error payloads back to caller).
6. Optional: metrics hooks (timing + token accounting placeholders) for later observability.

## Proposed Changes

### BackendTool
- [MODIFY] `services/tools/backend_tool.py`
	- Provide `BackendTool` class with:
		- `run(action: str, payload: dict) -> dict` dispatcher
		- Predefined actions: `health_check`, `fetch_config`, `store_artifact`, `list_agents`
		- Structured result schema (success, data, error)
		- Defensive validation + logging
	- Add lightweight dependency injection for future backend adapters.

### MCP Tools
- [MODIFY] `services/tools/line_mcp.py`
	- Conform to a common `BaseMCPTool` protocol: `name`, `capabilities()`, `invoke(request: dict)`
	- Add retry + timeout wrapper, map exceptions → structured error responses.
- [NEW] `services/tools/mcp_base.py`
	- Define `BaseMCPTool` ABC and helper utilities (capability normalization, error formatting).

### Tool Registry & Injection
- [MODIFY] `core/agent_factory/registry.py`
	- Extend registry entries to include `tool_refs` list (strings mapping to tool constructors).
- [MODIFY] `core/agent_factory/factory.py`
	- Resolve tool names → instantiated tool objects (BackendTool, MCP tools).
	- Pass tools to agent constructor with unified interface (e.g., `agent.add_tool(tool)` or constructor arg).
	- Graceful degradation: if non-critical tool fails to init, log warning; if critical, raise PlanExecutionError.

### Core Agent Integration
- [MODIFY] `core/core_agent.py`
	- After PlanSpec generation, validate requested tools against registry.
	- Provide optional tool capability summary in response metadata.
	- Add `execute_plan(plan: PlanSpec)` final wiring (if not fully implemented) invoking OrchestrationBuilder.

### Error & Result Structuring
- [NEW] `utils/results.py`
	- Define `ExecutionResult` dataclass: `status`, `output`, `agents_trace`, `tools_used`, `errors`.
	- Helper to merge multi-agent outputs into canonical summary.

### End-to-End Test Harness
- [NEW] `tests/test_end_to_end.py`
	- Simulate a minimal gRPC request payload → run CoreAgent end-to-end with: Sequential + Concurrent + GroupChat sample.
	- Assertions: PlanSpec integrity, agent count, tool invocation trace, non-empty output.

### Optional Observability (Placeholder)
- Hooks (no external deps now) for timing and simple counters in `utils/metrics.py` (optional if time permits).

## Non-Goals (Phase 5)
- Advanced caching strategies
- Full production telemetry integration
- Complex retry trees for external MCP APIs (basic retry only)

## Risks & Mitigations
- Tool initialization failures → structured error with tool name, skip if non-critical.
- MCP latency → add default timeout (e.g. 8s) and surface partial results.
- Output inconsistency across orchestrations → normalize via `ExecutionResult` aggregator.

## Verification Plan

### Unit Tests
- `tests/test_backend_tool.py`: covers dispatcher actions & error paths.
- `tests/test_line_mcp_tool.py`: capability reporting, timeout behavior, error mapping.
- `tests/test_tool_injection.py`: ensure multiple tools appear on instantiated agents.

### Integration / End-to-End
- `tests/test_end_to_end.py`: gRPC-like call to CoreAgent, expect coherent aggregated result across at least one orchestration mode.
- Reuse existing orchestration tests to ensure tools do not break previously passing workflows.

### Manual Verification
1. Start Python gRPC server.
2. Invoke sample Go client request specifying multiple agent roles + tools.
3. Inspect logs for tool init and invocation ordering.
4. Confirm structured response includes `tools_used` and no uncaught exceptions.

### Completion Criteria
- All Phase 5 tests passing.
- End-to-end run produces consolidated result + metadata.
- BackendTool & at least one MCP tool integrated and callable.
- No critical unhandled exceptions during multi-agent orchestration.

## Approval Checkpoints
1. Review plan structure & scope (this document).
2. Confirm action list & file modifications.
3. Green-light implementation → proceed with code changes sequentially.

---

Awaiting approval before implementing Phase 5.
