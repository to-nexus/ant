# ANT (AI-Native Transformation)

AI-driven code generation framework with autonomous error resolution.

## Monorepo Structure

```
ant/
├── packages/
│   ├── ant-cli/              # CLI tool (main)
│   │   ├── src/
│   │   ├── dist/
│   │   └── package.json
│   └── ant-ui/               # Web UI (monitoring)
│       ├── src/
│       └── package.json
├── workspace/                # Projects
├── docs/                     # Documentation
└── package.json              # Root workspace
```

## Overview

Internal framework for automated software development using LLM agents. Core features:
- Hexagonal architecture (ports & adapters)
- LangGraph workflow orchestration
- Dual memory (ChromaDB vector + JSON session)
- Task-based error resolution with retry strategies
- Dynamic validation (build, lint, type check)
- Session-based checkpointing for interruption recovery

## Installation

### Prerequisites

- Node.js 18+
- pnpm
- Docker (for ChromaDB)
- OpenAI or Anthropic API key

### Setup

```bash
# Install dependencies
pnpm install

# Environment
cat > .env << EOF
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
CHROMA_URL=http://localhost:8000
EOF

# Start ChromaDB
cd packages/ant-cli/src/periphery/integrations/vector-memory
docker-compose up -d
cd ../../../../../..

# Build
pnpm build
```

## Usage

### CLI Commands

```bash
# Architecture design
pnpm dev arch design workspace/my-app/feature/

# Code generation
pnpm dev arch code workspace/my-app/feature/

# Code with evaluation
pnpm dev arch code workspace/my-app/feature/ --eval
```

### Web UI (Development)

```bash
# Start UI dev server
pnpm dev:ui

# Access at http://localhost:3000
```

## Architecture

### CLI Package (@ant/cli)

```
packages/ant-cli/src/
├── agents/           # Business logic
│   └── architect/
│       ├── graph/    # LangGraph workflows
│       └── memory/   # Vector query
├── core/             # Domain logic
│   ├── ports/        # Interfaces
│   ├── types.ts
│   ├── policies/
│   └── prompt/       # 6-layer prompt engineering
└── periphery/        # Infrastructure
    └── adapters/
        ├── llm/
        ├── memory/
        ├── git/
        └── session/
```

Dependency flow: `agents → core ← periphery`

### UI Package (@ant/ui)

```
packages/ant-ui/src/
├── components/       # React components
├── repositories/     # Data access (file watcher / API)
├── services/         # CLI command execution
└── App.tsx
```

UI imports types directly from `@ant/cli`:
```typescript
import { Task, Session, Violation } from '@ant/cli/src/agents/architect/graph/code/state';
```

## Code Task Workflow

```
resolve → decompose → [Task Loop] → evaluate → learn
                         ↓
           ┌─────────────┴─────────────┐
           │ plan → execute → writeFiles →
           │ validate → installDeps →
           │ runtimeValidate
           │   ↓ (if errors)
           │ enforce → plan (retry)
           └─────────────┬─────────────┘
                         ↓
                    (next task)
```

**Key Features:**
- Task decomposition with priority queue
- Checkpointing (after plan/execute/validate)
- Recursion limit handling with auto-resume
- Language-specific validation
- Diagnostics system

## Development

### Build All

```bash
pnpm build
```

### Build CLI Only

```bash
pnpm build:cli
```

### Build UI Only

```bash
pnpm build:ui
```

### Type Check

```bash
cd packages/ant-cli
npx tsc --noEmit
```

## Documentation

- [Architecture](docs/designs/ARCHITECTURE.md) - System architecture
- [Workflow](docs/designs/ARCHITECT_CODE_TASK_WORKFLOW.md) - Code task workflow
- [CLI Guide](docs/guides/CLI_GUIDE.md) - Command-line usage
- [Quick Start](docs/guides/QUICK_START.md) - Getting started
- [Evaluation](docs/guides/EVALUATION.md) - Code evaluation

## Tech Stack

- **Runtime**: Node.js 18+, TypeScript
- **Package Manager**: pnpm workspaces
- **Orchestration**: LangGraph (@langchain/langgraph)
- **LLM**: OpenAI / Anthropic
- **Vector DB**: ChromaDB
- **Template**: Handlebars
- **Validation**: Zod
- **CLI**: Commander.js
- **Git**: simple-git
- **UI**: React + Vite

## License

ISC
