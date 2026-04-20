# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Install dependencies and compile protobuf stubs.
# Build tools (uv, git, grpcio-tools) are NOT carried into the runtime image.
FROM python:3.12-slim AS builder

WORKDIR /app

# Pin uv to a specific major version — avoids silent breakage from :latest
COPY --from=ghcr.io/astral-sh/uv:0.6 /uv /uvx /usr/local/bin/

# git required for any VCS-sourced dependencies in pyproject.toml
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy lockfile first — dependency layer is cached unless lockfile changes
COPY pyproject.toml uv.lock ./

# Sync into .venv; --no-cache avoids writing uv's download cache into the image
RUN uv sync --frozen --no-dev --no-cache

# Copy application source so grpc_tools.protoc can find the proto file
COPY . /app/agent/

# Compile protobuf stubs into the source tree
RUN uv run python -m grpc_tools.protoc \
    -I/app/agent/proto \
    --python_out=/app/agent/grpc/generated \
    --grpc_python_out=/app/agent/grpc/generated \
    /app/agent/proto/core_agent.proto


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Lean image with no build tooling.
FROM python:3.12-slim AS runtime

WORKDIR /app

ENV PYTHONPATH="/app:/app/agent/grpc/generated"
ENV PYTHONUTF8=1
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PYTHONIOENCODING=utf-8
# Flush logs immediately — critical for container log streaming
ENV PYTHONUNBUFFERED=1
# No .pyc files — cleaner filesystem
ENV PYTHONDONTWRITEBYTECODE=1
# Use the venv's binaries directly; uv is not present in this stage
ENV PATH="/app/.venv/bin:$PATH"

# Non-root user for principle of least privilege
RUN addgroup --system --gid 1001 appuser \
    && adduser --system --uid 1001 --gid 1001 --no-create-home appuser

# Copy the populated virtual environment from the builder
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv

# Copy application source (includes the compiled gRPC stubs)
COPY --from=builder --chown=appuser:appuser /app/agent /app/agent

USER appuser

EXPOSE 50051

CMD ["python", "-m", "agent.grpc.server.server"]
