# ANT (AI-Native Transformation)

AI-driven code generation framework with autonomous error resolution.

## 🚀 Quick Start

### UI + Server 모드 (권장)

```bash
# 터미널 1: ant-cli HTTP 서버 시작 (포트 4100)
pnpm dev:cli

# 터미널 2: ant-ui 웹 인터페이스 시작 (포트 4200)
pnpm dev:ui
```

그 후 브라우저에서 **http://localhost:4200** 을 엽니다.

### CLI 모드 (기존 방식)

```bash
# CLI 명령어로 직접 실행
pnpm dev
```

## 📦 Monorepo Structure

```
ant/
├── packages/
│   ├── ant-cli/              # CLI tool + HTTP Server
│   │   ├── src/
│   │   │   ├── core/         # 비즈니스 로직 (Hexagonal Architecture)
│   │   │   ├── periphery/    # Adapters (HTTP, DB, etc.)
│   │   │   └── composition/  # 의존성 조립
│   │   ├── dist/
│   │   └── package.json
│   └── ant-ui/               # Web UI (React)
│       ├── src/
│       └── package.json
├── workspace/                # Projects (workspace/project/feature/)
├── docs/                     # Documentation
└── package.json              # Root workspace
```

## 🎯 주요 기능

### Web UI (ant-ui)

**3단 레이아웃:**
- **좌측**: Projects & Features 관리
  - Feature 생성/삭제
  - Feature별 세션 관리
- **중앙**: Session, TaskQueue, Terminal Output
  - 실시간 로그 스트리밍 (SSE)
  - Task 진행 상황 모니터링
- **우측**: File Browser & Editor
  - inputs/outputs 디렉토리 탐색
  - 파일 편집 및 저장

**Agent & Task 선택:**
- **Agents**: Architect, Reviewer, Planner, Doc
- **Tasks**: Design, Code, Learn, Review, Plan, Document
- 상단 우측에서 Agent와 Task 선택 후 "Run" 버튼으로 실행

### HTTP API (ant-cli Server)

```
GET    /api/projects                                    # 프로젝트 목록
GET    /api/projects/:id/features                       # Feature 목록
POST   /api/projects/:id/features                       # Feature 생성
DELETE /api/projects/:id/features/:feature              # Feature 삭제
GET    /api/projects/:id/features/:feature/session      # Session 조회
GET    /api/projects/:id/features/:feature/files        # 파일 트리
GET    /api/projects/:id/features/:feature/files/*      # 파일 내용
PUT    /api/projects/:id/features/:feature/files/*      # 파일 저장
POST   /api/projects/:id/execute                        # Task 실행
GET    /api/tasks/:taskId/stream                        # SSE 로그 스트림
```

## 🔧 포트 설정

- **ant-cli 서버**: 4100 (기본값, `PORT` 환경변수로 변경 가능)
- **ant-ui**: 4200 (vite.config.ts에서 설정)

## 📁 Workspace 구조

```
workspace/
├── ant-ui/              # 프로젝트 1
│   ├── skeleton/        # Feature 1
│   │   ├── inputs/
│   │   │   ├── directives/  # 지시사항
│   │   │   └── sources/     # 소스 파일
│   │   └── outputs/
│   │       ├── design/      # 설계 문서
│   │       ├── reports/     # 보고서
│   │       └── session.json # 세션 상태
│   └── fix-bug/         # Feature 2
└── test-app/            # 프로젝트 2
```

- **Project**: workspace 디렉토리 내의 각 폴더
- **Feature**: 프로젝트 내의 각 기능/작업 단위
- **Session**: Feature 실행 상태가 저장되는 session.json

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
