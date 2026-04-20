# 🧠 AI Agent Platform — System Summary + To-Do Specification

🚀 Project Summary

We are building a Python-based Core Agent Platform that exposes a gRPC server, allowing the Go backend to communicate with a dynamic multi-agent system.

The Python Core Agent is responsible for:

- Communicating with the user (through Go → Python gRPC → LLM)
- Understanding user requirements
- Generating a Plan Spec defining sub-agents & orchestration patterns
- Creating sub-agents dynamically (Tester, QA, Researcher, etc.)
- Executing workflows (Sequential, Concurrent, GroupChat, Magnetic)
- Returning results to the Go backend via gRPC

We decided:

- gRPC direction = Go is client → Python is server
- Tools = BackendTool (Python local), MCP Tools (external), JSON internal, TOON for LLM communication
- Internal data = JSON + Pydantic models
- LLM communication = TOON format to reduce hallucinations & LLM token cost

The long-term architecture supports:

- Dynamic agent creation
- Dynamic orchestration
- Tool injection
- Multi-agent workflows
- Expandable MCP integration
- Cross-language backend coordination

🧩 Core Components in Python

1. gRPC Server (Python)

- Implements CoreAgent service defined in core_agent.proto
- Handles unary and streaming RPCs
- Routes incoming requests to the Core Agent logic

2. Core Agent

- Central decision-maker
- Generates a Plan Spec (JSON)
- Chooses orchestration type
- Chooses agent roles
- Outputs a structured blueprint for the workflow
- Converts JSON ↔ TOON when communicating with the LLM

3. Plan Spec Schema

- Pydantic models describing:
  - orchestration type
  - list of agents (role, goal, tools, context)
  - workflow inputs
- This is the contract between CoreAgent ↔ AgentFactory ↔ OrchestrationBuilder.

4. Agent Factory

- Receives PlanSpec
- Maps role → template (registry)
- Creates dynamic Python agent instances
- Injects tools (BackendTool, MCP tools, internal utils)

5. Orchestration Builder

- Uses PlanSpec.orchestration to select:
  - sequential workflow
  - concurrent execution
  - group chat
  - magnetic routing
- Executes workflow and returns results

6. Tools

- **BackendTool** wraps Python logic that interacts with backend or internal modules
- **MCP Tools** integrate external services (e.g., LINE API)
- Tools are injected into dynamic agents

7. TOON Format (optional but recommended)

- Used for LLM generation only
- Reduces token cost
- More reliable structured output than JSON
- Internally always convert TOON → JSON → PlanSpec

📦 Folder Structure

- `agent/`
  - `core/`
    - `core_agent.py`
    - `spec.py`
    - `context_manager.py`
    - `agent_factory/`
      - `templates.py`
      - `registry.py`
      - `factory.py`
    - `orchestrations/`
      - `builder.py`
      - `sequential.py`
      - `concurrent.py`
      - `group_chat.py`
      - `magnetic.py`
  - `services/`
    - `agents/`
      - `(dynamic agents created from templates)`
    - `tools/`
      - `backend_tool.py`
      - `(future) line_mcp.py`
  - `grpc/`
    - `server/`
      - `core_agent_server.py`
    - `generated/`
      - `*_pb2.py`
      - `*_pb2_grpc.py`
  - `proto/`
    - `core_agent.proto`
