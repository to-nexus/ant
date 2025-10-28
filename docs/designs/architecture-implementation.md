# Architecture Implementation - Technical Details

**ANT (AI-Native Transformation) - Architect Agent**  
**Version**: 1.0  
**Date**: 2025-10-27

---

## 📋 Document Purpose

This document describes **HOW** - the implementation details, file structure, and code organization.

For **WHAT** and **WHY** (conceptual architecture, design principles), see [architecture-design.md](architecture-design.md).

---

## 📁 Repository Structure

```
src/
├── index.ts                        ← Entry Point
├── cli/                            ← CLI Layer
│   ├── parser.ts
│   ├── resolver.ts
│   └── help.ts
├── composition/                    ← Composition Root
│   └── orchestrator.ts
├── core/                           ← Domain Core
│   ├── ports.ts
│   ├── config.ts
│   └── policies/
│       ├── validations.ts
│       └── retrieval.ts
├── agents/                         ← Application Layer
│   ├── architect/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   ├── graph/
│   │   │   ├── code/
│   │   │   │   ├── graph.ts
│   │   │   │   ├── runner.ts
│   │   │   │   ├── state.ts
│   │   │   │   └── nodes/
│   │   │   │       ├── resolve.ts
│   │   │   │       ├── plan.ts
│   │   │   │       ├── implement.ts
│   │   │   │       ├── validate.ts
│   │   │   │       ├── parseResponse.ts
│   │   │   │       └── index.ts
│   │   │   ├── design/
│   │   │   │   ├── graph.ts
│   │   │   │   ├── runner.ts
│   │   │   │   ├── state.ts
│   │   │   │   └── nodes/
│   │   │   └── learn/
│   │   │       ├── graph.ts
│   │   │       ├── runner.ts
│   │   │       ├── state.ts
│   │   │       └── nodes/
│   │   ├── prompt/
│   │   │   ├── ArchitectPromptor.ts
│   │   │   └── templates/
│   │   │       ├── system.md
│   │   │       ├── plan-base.md
│   │   │       ├── plan-rules.md
│   │   │       ├── code-base.md
│   │   │       ├── code-rules.md
│   │   │       └── examples.md
│   │   └── memoryService/
│   │       ├── index.ts
│   │       ├── storage.ts
│   │       └── queries.ts
│   ├── reviewer.ts
│   ├── planner.ts
│   └── doc.ts
└── periphery/                      ← Infrastructure Layer
    ├── adapters/
    │   ├── llm/
    │   │   └── GenericLLMClient.ts
    │   ├── memory/
    │   │   ├── ChromaMemoryAdapter.ts
    │   │   └── Retriever.ts
    │   ├── git/
    │   │   ├── SimpleGitAdapter.ts
    │   │   └── gitUtils.ts
    │   ├── prompt/
    │   │   ├── FilePromptAdapter.ts
    │   │   └── PromptRenderer.ts
    │   ├── validation/
    │   │   └── ValidationEngine.ts
    │   ├── reporting/
    │   │   └── FileReporter.ts
    │   └── learning/
    │       └── LearningExtractor.ts
    └── integrations/
        └── vector-memory/
            ├── docker-compose.yml
            └── embedder/
```

---

## 🎯 Layer Details

### 1. Entry Point Layer

**`index.ts`**
- Parse CLI arguments
- Resolve project and input files
- Delegate to orchestrator
- Handle top-level errors

### 2. CLI Layer

**`cli/parser.ts`**
- Parse and validate command-line arguments
- Return `ParsedArgs` or `null`

**`cli/resolver.ts`**
- `detectProject()` - Auto-detect project from path
- `findLatestDirective()` - Find latest directive file
- `resolveInputFile()` - Resolve input based on mode

**`cli/help.ts`**
- Display usage information and examples

### 3. Composition Root Layer

**`composition/orchestrator.ts`**
- Instantiate all adapters (ChromaMemoryAdapter, GenericLLMClient, etc.)
- Inject dependencies into agents
- Route commands to appropriate agents
- **Only place where concrete implementations are wired**

### 4. Core Layer

**`core/ports.ts`**
- `LLMClient` - LLM interaction interface
- `MemoryPort` - Vector database operations
- `GitPort` - Git operations
- `PromptLoader` - Prompt template loading
- `ReporterPort` - Report generation
- `ValidationPort` - Code validation

**`core/policies/validations.ts`**
- `GUARDRAILS` - Pre-run validation rules
- `VALIDATION_POLICIES` - Post-run validation policies

**`core/policies/retrieval.ts`**
- `RETRIEVAL_POLICY` - Phase-based retrieval configuration

### 5. Agents Layer

**`agents/architect/index.ts`**
- Main entry point for architect agent
- Routes to appropriate workflow (design, code, learn)
- Initializes context and dependencies

**`agents/architect/graph/`**
- **code/** - Code generation workflow
  - `graph.ts` - LangGraph definition
  - `runner.ts` - Execution runner
  - `state.ts` - State interface
  - `nodes/` - Workflow nodes (resolve, plan, implement, validate, parseResponse)
- **design/** - Design generation workflow
  - Similar structure
- **learn/** - Learning extraction workflow
  - Similar structure

**`agents/architect/prompt/`**
- `ArchitectPromptor.ts` - Prompt orchestrator
  - `buildUniversalPlanPrompt()` - Compose plan prompt
  - `buildUniversalCodePrompt()` - Compose code prompt
- `templates/` - 6 modular prompt templates

**`agents/architect/memoryService/`**
- `index.ts` - `retrieve()` function for context retrieval
- `storage.ts` - `storeLearnings()` function for learning storage
- `queries.ts` - Query configurations (design/code mode)

### 6. Periphery Layer

**`periphery/adapters/`**
- Each adapter implements a port from `core/ports.ts`
- **llm/** - OpenAI/Anthropic client
- **memory/** - ChromaDB client
- **git/** - simple-git wrapper
- **prompt/** - File system prompt loader
- **validation/** - Code validation engine
- **reporting/** - Markdown report writer
- **learning/** - Learning extraction logic

**`periphery/integrations/`**
- **vector-memory/** - Docker-based ChromaDB + Embedder services

---

## 🔄 Workflows

### Design Workflow
```
resolve → plan → save
```
**Purpose**: Generate system design from PRD

### Code Workflow
```
resolve → plan → implement → validate
         ↑_______________|
         (if violations)
```
**Purpose**: Generate code from design + directive

### Learn Workflow
```
resolve → store
```
**Purpose**: Extract and store learnings from codebase

---

## 🎨 Implementation Patterns

### Pattern 1: Port-Adapter

**1. Define Port** (`core/ports.ts`)
```typescript
export interface MemoryPort {
  store(documents: Array<...>, namespace: string): Promise<void>;
  query(query: string, namespace: string, k?: number): Promise<string[]>;
}
```

**2. Implement Adapter** (`periphery/adapters/memory/`)
```typescript
export class ChromaMemoryAdapter implements MemoryPort {
  async store(...) { /* ChromaDB implementation */ }
  async query(...) { /* ChromaDB implementation */ }
}
```

**3. Use in Agent** (`agents/`)
```typescript
async function retrieve(deps?: { memory: MemoryPort }) {
  const results = await deps.memory.query(...);
}
```

**4. Wire in Composition** (`composition/orchestrator.ts`)
```typescript
const memory = new ChromaMemoryAdapter();
await architectAgent(..., { memory });
```

### Pattern 2: Dependency Injection

**Constructor Injection**
```typescript
export class ArchitectPromptor {
  constructor(
    private loader: PromptLoader,
    private renderer: PromptRenderer
  ) {}
}
```

**Parameter Injection**
```typescript
export async function architectAgent(
  spec: string,
  deps?: { memory?: MemoryPort; llm?: LLMClient }
) { ... }
```

### Pattern 3: State Management (LangGraph)

**Define State**
```typescript
export interface ArchitectGraphState {
  context: ProjectContext;
  planText: string;
  files: GeneratedFile[];
  violations?: string[];
  retries: number;
  maxRetries: number;
}
```

**Node Returns Partial Update**
```typescript
export async function plan(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  return { planText: "..." };  // Only update planText
}
```

---

## 🔍 File Naming Conventions

### Directories
- **lowercase**: `cli/`, `composition/`, `core/`, `agents/`, `periphery/`
- **camelCase for services**: `memoryService/`

### Files
- **PascalCase for classes**: `ArchitectPromptor.ts`, `ChromaMemoryAdapter.ts`
- **camelCase for utilities**: `parser.ts`, `resolver.ts`, `help.ts`
- **kebab-case for templates**: `plan-base.md`, `code-rules.md`
- **lowercase for special**: `index.ts`, `state.ts`, `graph.ts`

### Exports
- **Named exports preferred**: `export function architectAgent(...)`
- **Default exports avoided**: Better for refactoring and IDE support

---

## 🚀 Development Workflow

### Adding a New Agent
1. Create `agents/new-agent/index.ts`
2. Define agent function with dependency injection
3. Add case to `composition/orchestrator.ts`
4. Update CLI help in `cli/help.ts`

### Adding a New Port
1. Add interface to `core/ports.ts`
2. Create adapter in `periphery/adapters/`
3. Instantiate in `composition/orchestrator.ts`
4. Inject into agent via `deps` parameter

### Adding a New Graph Node
1. Create node file in `graph/[workflow]/nodes/`
2. Export from `nodes/index.ts`
3. Add node to graph definition in `graph.ts`
4. Update state in `state.ts` if needed

### Adding a New Prompt Template
1. Create `.md` file in `prompt/templates/`
2. Load in `ArchitectPromptor.ts` using `loader.load("template-name")`
3. Compose into final prompt

---

## 📊 Key Implementation Details

### Dependency Direction
```
agents/ → core/ports.ts  (Use)
periphery/ → core/ports.ts  (Implement)
composition/ → agents/ + periphery/  (Wire)
```

### State Management
- Each workflow has its own state interface
- Nodes return partial state updates
- LangGraph merges updates into full state

### Error Handling
- Entry point catches all errors
- CLI validation before orchestrator
- Graph nodes handle business logic errors
- Adapters handle infrastructure errors

### Configuration
- Environment variables for adapter configuration
- `core/config.ts` for project configuration
- `core/policies/` for centralized policies

---

## 📚 Related Documents

- [architecture-design.md](architecture-design.md) - Conceptual architecture (WHAT & WHY)
- [hexagonal-architecture-guide.md](hexagonal-architecture-guide.md) - Detailed hexagonal pattern guide
- [project-roadmap.md](project-roadmap.md) - Development timeline and progress

---

**Status**: ✅ Implementation Complete - Clean, maintainable structure
