# AI Dev Framework

AI-powered development framework for automated architecture design, code generation, and iterative refinement with persistent learning.

### Author: Harvey (probe@to.nexus)
### Version: 1.0 (2025-10-27)

---

## Overview

AI Development Framework는 **AI가 지속적으로 학습하고 개선하는 개발 파트너**로 진화하는 시스템입니다.

### Key Features

- **Persistent Learning**: Vector memory (ChromaDB)를 통한 조직 지식 축적
- **Three Workflows**: Design, Code, Learn - 각각 독립적이면서 연계된 워크플로우
- **Port-Adapter Architecture**: 확장 가능하고 테스트 가능한 헥사고날 아키텍처
- **Modular Prompts**: 6개로 분리된 재사용 가능한 프롬프트 템플릿
- **Quality Guardrails**: 자동 검증 및 재시도 메커니즘
- **Full Git Integration**: 브랜치 관리, 자동 커밋, diff 추적

---

## Architecture

```
src/
├── core/                   - Ports (interfaces), Policies
│   ├── ports.ts           - Interface definitions
│   ├── policies/          - Centralized policies
│   └── orchestrator.ts    - Pipeline router
├── agents/                 - Business logic (uses ports)
│   └── architect/
│       ├── graph/         - LangGraph workflows (code, design, learn)
│       ├── prompt/        - Prompt orchestrator + templates
│       └── memoryService/ - Vector memory service
└── periphery/              - Port implementations (adapters)
    ├── adapters/          - LLM, Memory, Git, Prompt, etc.
    └── integrations/      - Docker services (ChromaDB, Embedder)
```

**Dependency Direction**: `agents → core ← periphery`

자세한 내용은 [docs/project-architecture.md](docs/project-architecture.md)를 참고하세요.

---

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Environment Variables

Create `.env` file:

```bash
# Global AI Model Configuration
AI_MODEL_PROVIDER=openai        # 'openai' or 'anthropic'
AI_MODEL_NAME=gpt-4o            # Optional, uses defaults if not set

# Agent-specific Configuration (optional)
ARCHITECT_MODEL_PROVIDER=openai
ARCHITECT_MODEL_NAME=gpt-4o
ARCHITECT_MODEL_MAX_TOKENS=16000

REVIEWER_MODEL_PROVIDER=anthropic
REVIEWER_MODEL_NAME=claude-3-haiku-20240307

# API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GIT_TOKEN=ghp_...

# Vector Database
CHROMA_URL=http://localhost:8000
EMBEDDER_URL=http://localhost:8001
```

**Model Options:**
- OpenAI: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`
- Anthropic: `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, `claude-3-haiku-20240307`

### 3. Vector Database (Docker)

Start ChromaDB and Embedding Server:

```bash
cd periphery/integrations/vector-memory
docker-compose up -d
```

This starts:
- **ChromaDB** on port 8000 (persistent vector storage)
- **Embedding Server** (all-MiniLM-L6-v2) on port 8001

### 4. Project Configuration

Create `projects/<project-name>/config.json`:

```json
{
  "repoType": "local",
  "localPath": "/path/to/target-repo",
  "branchBase": "main"
}
```

---

## Usage

### Quickstart

```bash
# 1) Generate design from PRD
pnpm tsx src/index.ts arch-design projects/<project>/<feature>/prd/spec.md

# 2) Generate code from latest design
pnpm tsx src/index.ts arch-code projects/<project>/<feature>

# 3) Review changes
cd /path/to/target-repo
git diff

# 4) Check report
cat projects/<project>/<feature>/generated/reports/code-generation-report-*.md
```

### Three Workflows

#### 1. Design Workflow (arch-design)
**Purpose**: PRD → System Design Document

```bash
pnpm tsx src/index.ts arch-design projects/cross-ramp/ui-1.2.0/prd/spec.md
```

**Flow**: `resolve → plan → save`
- Reads PRD and previous design
- Generates comprehensive system design
- Saves to `generated/design/design-*.md`

#### 2. Code Workflow (arch-code)
**Purpose**: Design → Code + Learning + Report

```bash
pnpm tsx src/index.ts arch-code projects/cross-ramp/ui-1.2.0
```

**Flow**: `resolve → plan → implement → validate` (with enforce retry)
- Reads latest design and optional directive
- Generates implementation plan (Phase 1)
- Generates code (Phase 2)
- Validates output (ellipsis, deletion ratio)
- Writes files to target repo (not staged)
- Creates detailed report

**With Directive**:
```bash
# Create directive
cat > projects/cross-ramp/ui-1.2.0/directives/code/directive-1.md << EOF
- Add error handling for all async operations
- Use more descriptive function names
EOF

# Regenerate code with directive
pnpm tsx src/index.ts arch-code projects/cross-ramp/ui-1.2.0
```

#### 3. Learn Workflow (arch-learn)
**Purpose**: Analyze codebase → Extract patterns → Store in vector memory

```bash
# Create learning directive
cat > projects/cross-ramp/ui-1.2.0/directives/learn/directive-1.md << EOF
- target: /path/to/repo/src/components
- focus: 컴포넌트 구조와 상태 관리 패턴 분석
- aspects:
  - 컴포넌트 분리 기준
  - 상태 관리 방식
  - 성능 최적화 패턴
EOF

# Run learning
pnpm tsx src/index.ts arch-learn projects/cross-ramp/ui-1.2.0
```

**Flow**: `resolve → store`
- Reads learning targets from directive
- Analyzes code and extracts patterns
- Stores learnings in ChromaDB
- Creates learning report

---

## Key Behaviors

### Architect Agent

**Two-Phase Flow**:
1. **Phase 1 (Plan)**: Analyze design + directive → Generate implementation plan
2. **Phase 2 (Code)**: Execute plan → Generate actual code

**Quality Guarantees**:
- Uses **COMPLETE HEAD originals** (no truncation)
- **Minimal-change invariant**: Preserve structure/logic
- **Strict output rules**: Pure code (no backticks), actual paths, complete files (no ellipsis)
- **Type-safety**: Guard possibly-undefined values (`projectId ?? ''`)
- **Validation**: Detects excessive deletions (>30%) or skipped code

**Learning**:
- Every execution stores patterns in vector memory
- Future runs retrieve relevant context automatically

---

## Project Structure

```
projects/<project>/<feature>/
├── prd/
│   └── spec.md                          # Input PRD
├── generated/
│   ├── design/
│   │   └── design-<project>-*.md        # Generated designs
│   └── reports/
│       ├── code-generation-report-*.md   # Code gen process & learnings
│       └── learning-report-*.md          # Codebase analysis results
├── directives/
│   ├── code/                            # Code generation directives
│   │   └── directive-N.md
│   ├── design/                          # Design directives
│   │   └── directive-N.md
│   └── learn/                           # Learning directives
│       └── directive-N.md
└── config.json                          # Project configuration
```

**Auto-detection**:
- **Project**: `projects/cross-ramp/...` → `cross-ramp`
- **Design**: Latest `generated/design/design-*.md`
- **Directive**: Latest `directives/{code,design,learn}/directive-N.md` by number
- **Branch**: Reused if exists, created if not

---

## Commands

| Command | Description | Workflow |
|---------|-------------|----------|
| `arch-design` | PRD → System design document | Design |
| `arch-code` | Design → Code + Learning + Report | Code |
| `arch-learn` | Analyze and learn from codebase | Learn |
| `review` | Code review | - |
| `plan` | Sprint planning | - |
| `doc` | Documentation generation | - |

---

## Examples

### Complete Development Cycle

```bash
# 1. Generate Design
pnpm tsx src/index.ts arch-design projects/cross-ramp/ui-1.2.0/prd/spec.md

# 2. Generate Code (first iteration)
pnpm tsx src/index.ts arch-code projects/cross-ramp/ui-1.2.0

# 3. Review changes
cd /path/to/target-repo
git diff

# 4. Create directive for improvements
cat > projects/cross-ramp/ui-1.2.0/directives/code/directive-1.md << EOF
- Add comprehensive error handling
- Improve variable naming
- Add JSDoc comments
EOF

# 5. Regenerate with directive
pnpm tsx src/index.ts arch-code projects/cross-ramp/ui-1.2.0

# 6. Learn from existing codebase
cat > projects/cross-ramp/ui-1.2.0/directives/learn/directive-1.md << EOF
- target: /path/to/repo/src
- focus: Architectural patterns and conventions
EOF

pnpm tsx src/index.ts arch-learn projects/cross-ramp/ui-1.2.0

# 7. Final commit
cd /path/to/target-repo
git add .
git commit -m "feat: implement ui-1.2.0"
git push origin feature/ui-1.2.0
```

---

## Architecture Highlights

### Port-Adapter Pattern (Hexagonal Architecture)

```typescript
// 1. Define Port (Core)
export interface PromptLoader {
  load(name: string): Promise<string>;
}

// 2. Implement Adapter (Periphery)
export class FilePromptAdapter implements PromptLoader {
  async load(name: string): Promise<string> { ... }
}

// 3. Use in Agent (Dependency Injection)
export class ArchitectPromptor {
  constructor(
    private loader: PromptLoader,
    private renderer: PromptRenderer
  ) {}
}
```

### Modular Prompt Templates

6개 템플릿으로 분리되어 재사용성 극대화:
- `system.md` - Shared rules & philosophy (~130 lines)
- `plan-base.md` - Phase 1 structure (~20 lines)
- `plan-rules.md` - Phase 1 analysis protocol (~80 lines)
- `code-base.md` - Phase 2 structure (~50 lines)
- `code-rules.md` - Phase 2 validation rules (~100 lines)
- `examples.md` - Few-shot examples (~110 lines)

### Memory Service

Vector memory 관리를 위한 서비스 레이어:
- `retrieve()` - Context retrieval with mode-specific queries
- `storeLearnings()` - Learning storage
- Query configurations for design/code modes

---

## Documentation

### Architecture
- [Architecture Design](docs/architecture-design.md) - Conceptual architecture (WHAT & WHY)
- [Architecture Implementation](docs/architecture-implementation.md) - Implementation details (HOW)
- [Hexagonal Architecture Guide](docs/hexagonal-architecture-guide.md) - Port-Adapter pattern explained

### Project
- [Roadmap](docs/project-roadmap.md) - Development roadmap and progress
- [Vision](docs/ai-dev-vision.md) - Long-term vision and goals
- [Layers](docs/ai-dev-layers.md) - Layer responsibilities

---

## Status (2025-10-27)

### ✅ Completed (All 9 Modules)
1. Framework Core Skeleton
2. Prompt Engine (Port-Adapter pattern, 6 modular templates)
3. Agent Workflow Graph (Code, Design, Learn)
4. Validation & Guardrail Engine
5. Chunker + Embedder (Docker-based)
6. Retriever (Policy-based service)
7. Learning Extractor
8. Git Integration Layer
9. Reporting & Analytics

### ⚠️ Known Issues
- `core/orchestrator.ts` imports from `agents/` and `periphery/` (violates dependency principle)
- Should move to `index.ts` or separate as composition root

### 📋 Next Steps
1. Refactor orchestrator (fix dependency violation)
2. Add comprehensive tests
3. Performance optimization
4. Enhance other agents (Reviewer, Planner, Doc)

---

## License

MIT

---

## Author

**Harvey** (probe@to.nexus)

**AI-Native Development Framework** - 조직이 함께 학습하고 성장하는 개발 환경
