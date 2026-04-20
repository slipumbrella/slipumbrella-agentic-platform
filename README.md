# Slipumbrella

**Build and deploy specialist AI agent teams — no coding required.**

[https://www.slipumbrella.com](https://www.slipumbrella.com)

Slipumbrella lets you describe a business job in plain language, auto-generate a coordinated team of AI specialists, train them on your own documents, and deploy instantly to an in-portal chat or LINE messaging.

---

## What it does

| Capability | Description |
|---|---|
| **Guided team builder** | Describe your goal; the platform suggests a specialist agent mix and walks you through setup |
| **Business knowledge** | Upload PDFs, paste URLs, or provide text so your team answers from your own material |
| **Quality evaluation** | RAG quality scoring lets non-technical users catch weak knowledge setups before launch |
| **Flexible orchestration** | Choose Sequential, Concurrent, Group-chat, or Leader-follower execution patterns per team |
| **Deploy anywhere** | Chat inside the portal or connect to LINE Messaging with your channel credentials |
| **Artifact generation** | Agents can produce Google Docs/Sheets/Slides or local documents as workflow outputs |

---

## Architecture

```
Browser / LINE
      │
      ▼
┌──────────────┐        REST / WebSocket
│   Next.js    │ ──────────────────────────► ┌───────────┐
│   Frontend   │                              │  Go API   │
│  (port 3000) │ ◄────────────────────────── │ (port 8080│
└──────────────┘                              └─────┬─────┘
                                                    │ gRPC
                                                    ▼
                                           ┌──────────────────┐
                                           │  Python Agent    │
                                           │  Service         │
                                           │  (AutoGen 0.4+)  │
                                           │  (port 50051)    │
                                           └──────────────────┘
                                                    │
                              ┌─────────────────────┼─────────────────────┐
                              ▼                     ▼                     ▼
                       PostgreSQL            Redis cache           Cloudflare R2
                       + pgvector            (sessions)            (file storage)
```

### Services

| Service | Language / Framework | Purpose |
|---|---|---|
| `frontend` | Next.js 15, TypeScript, Tailwind CSS | UI, agent builder, chat |
| `backend` | Go, Gin, GORM | REST API, auth, WebSocket, business logic |
| `agent` | Python, AutoGen 0.4+, gRPC | LLM orchestration, RAG, tool execution |
| `postgres` | PostgreSQL 17 + pgvector | Persistent storage and vector search |
| `redis` | Redis | Session state and rate limiting |

---

## Getting started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- OpenRouter API key (for LLM calls)
- Jina AI API key (for web search tools)

### 1. Clone the repo

```bash
git clone https://github.com/RywJakkraphat/slipumbrella-public.git
cd slipumbrella-public
```

### 2. Configure environment variables

**Backend** (`backend/.env`):

```bash
cp backend/.env.example backend/.env
```

Required values to set:

```env
DB_PASSWORD=your_pg_password
JWT_SECRET=your_secret_min_32_chars
FRONTEND_URL=http://localhost:3000

# Cloudflare R2 (file uploads)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=
```

**Agent service** (`agent/.env`):

```bash
cp agent/.env.example agent/.env
```

Required values to set:

```env
OPENROUTER_API_KEY=your_openrouter_key
JINA_API_KEY=your_jina_key

# LLM model (via OpenRouter)
CORE_MODEL=openrouter/hunter-alpha
MODEL=openrouter/hunter-alpha
```

**Frontend** (`frontend/.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

### 3. Start development environment

```bash
make dcup-dev-build-d
```

This starts all five services (frontend, backend, agent, postgres, redis) with hot-reload enabled.

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8080 |
| Agent gRPC | localhost:50051 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### Stop

```bash
make dcdown-dev
```

---

## Make targets

| Target | Description |
|---|---|
| `make dcup-dev-d` | Start dev stack in background |
| `make dcup-dev-build-d` | Build images and start dev stack |
| `make dcdown-dev` | Stop dev stack |
| `make dcdown-dev-rmi` | Stop dev stack and remove images |
| `make dcup-prd-build-d` | Build and start production stack |
| `make dcdown-prd` | Stop production stack |

---

## Project structure

```
slipumbrella-public/
├── frontend/          # Next.js app
│   ├── app/           # App Router pages
│   ├── sections/      # Page sections (landing, builder, chat, …)
│   ├── components/    # Shared UI components
│   └── lib/           # Redux store, hooks, API client
├── backend/           # Go API server
│   ├── cmd/           # Entry point
│   ├── core/          # Domain models, services, repositories
│   ├── adapter/       # HTTP handlers, WebSocket, external adapters
│   └── router/        # Route registration
├── agent/             # Python agent service
│   ├── core/          # Agent orchestration logic
│   ├── services/      # Embedding, evaluation, tools
│   ├── grpc/          # gRPC server
│   └── configs/       # Settings (pydantic-settings)
├── docker-compose.dev.yml
├── docker-compose.prd.yml
└── Makefile
```

---

## Tech stack

**Frontend**
- Next.js 15 (App Router), TypeScript
- Tailwind CSS, shadcn/ui, Framer Motion
- Redux Toolkit, React Hook Form, Zod
- Recharts, React Flow (`@xyflow/react`)

**Backend**
- Go 1.25, Gin, GORM
- PostgreSQL 17 + pgvector
- Redis, Cloudflare R2
- LINE Messaging API

**Agent service**
- Python, AutoGen 0.4+
- gRPC (`grpcio`), Pydantic v2
- Jina AI (web search / fetch tools)
- OpenRouter (LLM routing)

---

## LINE integration

Each team can be connected to a LINE Official Account. After obtaining your **Channel Access Token** and **Channel Secret** from the [LINE Developers Console](https://developers.line.biz/), add them in the team settings. Incoming messages are routed to the agent team and replies are sent back automatically.

---

## License

See [LICENSE](LICENSE) for details.
