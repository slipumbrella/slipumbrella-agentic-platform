# Compile gRPC
```
$ python -m grpc_tools.protoc -I=protobuf/ --python_out=src/proto --grpc_python_out=src/proto protobuf/*.proto
```

# Dependency
-   pip install grpcio grpcio-tools

## AutoGen 0.4+ integration

This service now uses AutoGen 0.4+ for LLM calls with structured outputs via Pydantic. Install the new dependencies in the `agent` environment:

- Requirements are listed in `agent/requirements.txt` (added: `autogen-agentchat` and `autogen-ext[openai]`).

### Environment variables

Use OpenAI-compatible settings. For OpenAI models:

- `OPENAI_API_KEY` – your OpenAI API key
- `OPENAI_MODEL` – e.g., `gpt-4o-mini` (default)

For Gemini via the OpenAI-compatible API (beta):

- `OPENAI_API_KEY` – set to your `GEMINI_API_KEY` value (or leave `GEMINI_API_KEY` and the code will fall back)
- `OPENAI_BASE_URL` – provider’s OpenAI-compatible base URL (see Gemini docs)
- `OPENAI_MODEL` – e.g., `gemini-1.5-flash-8b`

### Notes

- The gRPC server uses `CoreAgent.process_query()` (sync wrapper). If you need to call from async code, use `await CoreAgent.aprocess_query(...)`.
- Output is strictly validated against the Pydantic schema: `{ message: str, agent_list: [{ name, description }] }`.