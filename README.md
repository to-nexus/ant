# ANT (AI-Native Transformation)

AI-native development framework implementing hexagonal architecture with LangGraph-based agent orchestration.

---

## Overview

Internal framework for automated software development using AI agents. Implements a dual-memory system (vector + session), graph-based workflows with intelligent error resolution, and a 6-layer prompt engineering pipeline.

**Primary Agents:**
- `architect` - Design generation and autonomous code implementation with build error resolution
- `reviewer` - Code review and analysis
- `planner` - Project planning and breakdown
- `doc` - Documentation generation
- `evaluator` - Code quality evaluation and benchmarking

**Core Features:**
- Hexagonal architecture (ports & adapters)
- Dual memory: Vector DB (ChromaDB) + Session files (JSON)
- LangGraph workflow orchestration with dynamic error recovery
- 6-layer prompt engineering system
- Autonomous build error resolution with LLM-driven subtask management
- Dynamic validation (build, lint, type check)
- Attempt history tracking for learning from failures
- Session-based context tracking with traceability

---

## Architecture

### Hexagonal (Ports & Adapters)

```
core/              Domain logic, interfaces (ports)
  ├─ ports/        Interface definitions
  ├─ types.ts      Core types
  └─ policies/     Rules and validation

agents/            Business logic using ports
  └─ architect/    
      ├─ graph/    LangGraph workflows
      └─ memory/   Vector query service

periphery/         Port implementations (adapters)
  └─ adapters/     
      ├─ llm/      GenericLLMClient
      ├─ memory/   ChromaMemoryAdapter
      └─ session/  FileSessionAdapter

composition/       Dependency injection
  └─ orchestrator.ts
```

**Dependency flow:** `agents → core ← periphery`

### Agent Workflow Pattern

All agents follow this common structure:

```
1. Load Vector Memory    - retrieve() from ChromaDB
2. Load Session History  - session.load() from JSON
3. Create Context        - ProjectContext { memory, sessionHistory, ... }
4. Execute Graph
   ├─ resolve   - Load input files
   ├─ plan      - Generate execution plan
   ├─ execute   - Run LLM generation
   ├─ validate  - Check output (code only)
   └─ learn     - Store to vector + session
```

### Prompt Engineering (6 Layers)

```typescript
PromptEngine.buildExecutePrompt() {
  1. InputNormalizer    - Standardize inputs
  2. ContextAssembler   - Aggregate all context sources
  3. ModeController     - Select templates & config
  4. TemplateComposer   - Build prompt from templates
  5. PolicyInjector     - Inject guardrails & rules
  6. PromptFormatter    - Format for LLM API
}
```

---

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

# Environment variables
cat > .env << EOF
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
CHROMA_URL=http://localhost:8000
EOF

# Start vector DB
cd src/periphery/integrations/vector-memory
docker-compose up -d

# Create workspace
npm run init:workspace my-project
npm run init:feature my-project feature1
```

---

## 🚀 Quick Start

### 1. 새 프로젝트 시작

```bash
# 1. Workspace 생성
npm run init:workspace my-app

# 2. Feature 생성
npm run init:feature my-app auth-feature

# 3. PRD 작성
vim workspace/my-app/auth-feature/inputs/sources/prd.md

# 4. Design 생성
npm run dev -- architect design workspace/my-app/auth-feature/

# 5. Code 생성 + 평가
npm run dev -- architect code workspace/my-app/auth-feature/ --eval

# 6. 결과 확인
cat workspace/my-app/auth-feature/outputs/eval/report.md
```

### 2. 데모로 전체 워크플로우 체험

```bash
# PRD → Design → Code → Eval 전체 플로우 (이미 준비됨)
npm run dev -- architect design workspace/demo-app/features/todo-list/
npm run dev -- architect code workspace/demo-app/features/todo-list/ --eval

# 결과 확인
cat workspace/demo-app/features/todo-list/outputs/eval/report.md
```

자세한 내용: 
- [Quick Start Guide](docs/guides/QUICK_START.md)
- [Workflow Flow](docs/guides/WORKFLOW_FLOW.md)
- [Demo App](workspace/demo-app/README.md)

---

## Usage

### CLI Structure

```bash
npm run dev -- <agent> <task> [options] <input>
```

### Examples

```bash
# Create workspace and feature first
npm run init:workspace my-app
npm run init:feature my-app auth-feature

# Architecture design from PRD
npm run dev -- architect design workspace/my-app/auth-feature/

# Code generation from design
npm run dev -- architect code workspace/my-app/auth-feature/

# Code generation with automatic evaluation
npm run dev -- architect code workspace/my-app/auth-feature/ --eval

# Code with edit mode
npm run dev -- arch code workspace/project/feature/ --mode edit

# Learn from existing code
npm run dev -- arch learn workspace/project/common/inputs/directives/learn/directive.md

# Code review
npm run dev -- review workspace/project/feature/

# Project planning
npm run dev -- plan workspace/project/requirements.md
```

### Architect Agent

**Tasks:**
- `design` - PRD/directive → Design document
- `code` - Design → Code files (with intelligent error resolution)
- `learn` - Code analysis → Vector storage

**Code Generation Modes:**
- `generate` (default) - Create new files
- `edit` - Modify existing files (uses Git HEAD)
- `refactor` - Restructure code

**Workflow (Code Task with Divide & Conquer):**
```
┌─────────────────────────────────────────────────────────┐
│ 1. INITIALIZATION & DECOMPOSITION                      │
│    resolve → plan (LLM decomposes spec into subtasks)  │
│              ↓                                          │
│    Creates: [Feature 1], [Feature 2], [Feature N]      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. DIVIDE & CONQUER (Loop over subtasks)               │
│                                                         │
│  [Subtask K] plan → execute → validate → postProcess   │
│               ↑         ↑         ↓           ↓         │
│               └─────────┴──────enforce   dynamicValidate│
│                       (retry)                ↓          │
│                                              │          │
│  Success? ─→ Next subtask ──────────────────┘          │
│  Failed?  ─→ Skip to next (if max retries reached)     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. FINALIZATION                                         │
│    evaluate → learn → END                               │
└─────────────────────────────────────────────────────────┘

Validation Split:
- validate (static): Fast checks (ellipsis, deletion ratio)
- postProcess: npm install (needed for build)
- dynamicValidate: Real build/lint/type check
```

**Intelligent Error Resolution with Dual-Track Subtask System:**
- **Dual-Track Subtasks**: 
  - **Feature Subtasks** (priority 200-299): Original goals from spec, persistent across retries
  - **Error Subtasks** (priority 1-100): Temporary blockers, removed when resolved
- **LLM-Driven Management**: AI analyzes spec + errors, creates/updates both types of subtasks
- **Automatic Prioritization**: Error subtasks interrupt features when needed, then resume features after fixing
- **Attempt History Tracking**: Records each attempt to prevent repeated mistakes
- **Spec Persistence**: Original requirements remain visible through all error-fixing cycles
- **Progress Detection**: Resets retry counter when progress is detected

**Priority System:**
- Features: 200-299 (user value)
- Errors: Missing files (95-100) > Dependencies (85-94) > Config (75-84) > Types (50-74) > Lint (20-30)

Detailed flow: [Workflow Guide](docs/guides/WORKFLOW_FLOW.md)

### Code Evaluation

**Purpose:** Quantitatively measure AI-generated code quality

**Evaluation Types:**
- **Static Analysis**: Lines of code, complexity, maintainability index
- **Dynamic Validation** (optional): Build, lint, type check, tests

**Usage:**

```bash
# Auto-evaluate after code generation
npm run dev -- architect code workspace/project/feature/ --eval

# Enable strict validation (build/lint/test)
# Set in workspace/project/config.json:
{
  "strictValidation": true,
  "runTests": false
}
```

**Workspace Structure:**
```
workspace/project/feature/
  ├── inputs/directives/eval/
  │   ├── tests.json                # Requirements checklist
  │   └── quality-thresholds.json   # Quality criteria (optional)
  └── outputs/eval/
      ├── report.md                 # Markdown report
      └── report.json               # JSON report

Note: Generated code is written directly to the repository (e.g., src/, lib/),
      not to workspace/outputs/code/.
```

**Details:** See [Evaluation Guide](docs/guides/EVALUATION.md)

---

## Memory System

### Dual Memory Architecture

| Type | Scope | Storage | Content | Loaded |
|------|-------|---------|---------|--------|
| Vector | Cross-feature | ChromaDB | Patterns, learnings, decisions | Before graph |
| Session | Feature-specific | JSON file | Turn history, artifacts | Before graph |

### Storage Flow

```typescript
// Turn execution
architectAgent() {
  // Load memories (before graph)
  const memory = await retrieve(task, project, feature);
  const session = await sessionPort.load(project, feature);
  
  // Create context
  const context = { 
    project, 
    memory,              // Vector content (string)
    sessionHistory       // Session formatted (string)
  };
  
  // Execute graph
  const result = await runCodeGraph(context);
  
  // Store in learn node (after graph)
  await sessionPort.addTurn(project, feature, turn);
  await memoryPort.store(chunks, metadata);
}
```

### Session Tracking

Each turn stored with:
```json
{
  "sessionId": "uuid-v4",
  "turnId": 1,
  "task": "code",
  "input": "user request",
  "output": {
    "files": ["path/to/file.ts"],
    "decisions": ["decision text"]
  }
}
```

Vector learnings include `sessionId` and `turnId` for traceability.

---

## Quality Control

### Validation System

**Code generation only** (Design has no validation)

```typescript
// validate node
validate(state) {
  violations = []
  
  // Check 1: Ellipsis patterns
  if (/\.{3}|\/\/\s*\.\.\./.test(code)) {
    violations.push("contains ellipsis")
  }
  
  // Check 2: Excessive deletion
  if (newLines < origLines * 0.7) {
    violations.push("excessive deletion")
  }
  
  return { ...state, violations }
}

// Conditional edge
if (violations && retries < 3) {
  return "enforce"  // Retry with stronger warning
} else {
  return "learn"    // Success or max retries
}
```

### Guardrails

**Two-stage prevention:**

1. **Prompt-level** (PolicyInjector)
   - Injects rules into prompt
   - Warns LLM about prohibited patterns
   - Not enforceable (LLM may ignore)

2. **Validation-level** (Validate node)
   - Pattern matching on output
   - Hard enforcement via retry
   - Up to 3 attempts

---

## Project Structure

```
workspace/
  project/
    config.json
    feature/
      inputs/
        directives/
          design/directive.md
          code/directive.md
          eval/tests.json           # Evaluation tests (optional)
        sources/prd.md
      outputs/
        design/design-*.md
        eval/report.md              # Evaluation reports (if --eval used)
      session.json                  # Session history

Note: Generated code is written to the repository root (e.g., src/, lib/),
      not to workspace/outputs/code/.
```

**Auto-detection:**
- Project: from path `workspace/{project}/...`
- Design: latest `outputs/design/design-*.md`
- Directive: latest `inputs/directives/{task}/directive-N.md`

---

## Context Assembly

LLM prompt components:

| Level | Element | Source | Load Time |
|-------|---------|--------|-----------|
| Context | memory | Vector DB | Before graph |
| Context | sessionHistory | Session file | Before graph |
| Context | config | Config file | Before graph |
| Resolved | directive | File system | Resolve node |
| Resolved | spec | File system | Resolve node |
| Resolved | previousDesign | File system | Resolve node |
| Resolved | originalFiles | Git HEAD | Resolve node |
| Assembled | codebaseProfile | Runtime | ContextAssembler |
| Template | system | Template file | TemplateComposer |
| Template | rules | Template file | TemplateComposer |
| Policy | guardrails | Policy code | PolicyInjector |

---

## Code Structure

```
src/
├── agents/
│   ├── architect/
│   │   ├── index.ts              Entry point
│   │   ├── graph/
│   │   │   ├── design/           Design graph (no validation)
│   │   │   ├── code/             Code graph (with validation)
│   │   │   └── learn/            Learning graph
│   │   ├── memory/
│   │   │   ├── index.ts          retrieve()
│   │   │   └── queries.ts        Query configs
│   │   └── session-formatter.ts  Format session for prompts
│   ├── reviewer.ts
│   ├── planner.ts
│   └── doc.ts
│
├── core/
│   ├── ports/                    Interface definitions
│   │   ├── llm.ts
│   │   ├── memory.ts
│   │   ├── session.ts
│   │   ├── chunk.ts
│   │   └── ...
│   ├── prompt/
│   │   ├── engine/               6-layer system
│   │   │   ├── PromptEngine.ts
│   │   │   ├── InputNormalizer.ts
│   │   │   ├── ContextAssembler.ts
│   │   │   ├── ModeController.ts
│   │   │   ├── TemplateComposer.ts
│   │   │   ├── PolicyInjector.ts
│   │   │   └── PromptFormatter.ts
│   │   └── templates/            Prompt templates
│   ├── chunk/
│   │   ├── ChunkEngine.ts
│   │   └── rerank/MMRReranker.ts
│   ├── policies/
│   │   ├── validations.ts        Validation rules
│   │   └── prompts/ruleset.json  Policy definitions
│   ├── types.ts
│   └── schemas/                  Zod schemas
│       └── session.schema.ts
│
├── periphery/
│   ├── adapters/
│   │   ├── llm/GenericLLMClient.ts
│   │   ├── memory/ChromaMemoryAdapter.ts
│   │   ├── session/FileSessionAdapter.ts
│   │   ├── chunk/ChunkingAdapter.ts
│   │   ├── git/SimpleGitAdapter.ts
│   │   └── ...
│   └── integrations/
│       └── vector-memory/
│           ├── docker-compose.yml
│           └── chroma-data/
│
├── composition/
│   └── orchestrator.ts           Wire dependencies
│
└── cli/
    ├── command.ts                Commander.js
    ├── parser.ts
    └── resolver.ts
```

---

## Development

### Type Checking

```bash
npx tsc --noEmit
```

### Running

```bash
# Development mode
npm run dev -- arch design workspace/project/feature/directive.md

# Build
npm run build
```

### Adding New Agent

1. Define port interfaces in `core/ports/`
2. Implement agent logic in `agents/`
3. Create adapter in `periphery/adapters/`
4. Wire in `composition/orchestrator.ts`
5. Add CLI command in `cli/command.ts`

---

## Documentation

- [Architecture Design](docs/designs/architecture-design.md) - Conceptual overview
- [Architecture Implementation](docs/designs/architecture-implementation.md) - Technical details
- [Workflow Context Loading](docs/designs/WORKFLOW_CONTEXT_LOADING.md) - Context flow
- [CLI Guide](docs/guides/CLI_GUIDE.md) - CLI usage
- [Project Roadmap](docs/designs/project-roadmap.md) - Development plan

---

## Tech Stack

- **Runtime**: Node.js 18+, TypeScript
- **Orchestration**: LangGraph (@langchain/langgraph)
- **LLM**: OpenAI / Anthropic (via @langchain)
- **Vector DB**: ChromaDB
- **Validation**: Zod
- **CLI**: Commander.js
- **Git**: simple-git

---

## License

ISC

---

**Version**: 1.0.0  
**Status**: Research/Internal Use  
**Last Updated**: 2025-10-28
