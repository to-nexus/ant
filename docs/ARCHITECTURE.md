# Architecture

ANT (AI-Native Transformation) follows **Hexagonal Architecture** (Ports and Adapters) to achieve clean separation between business logic and infrastructure.

---

## Architectural Style

### Hexagonal Architecture

```
┌─────────────────────────────────┐
│   External (UI, DB, API, CLI)  │
└────────────┬────────────────────┘
             │
        ┌────▼─────┐
        │ Adapters │ ← Infrastructure (periphery/)
        └────┬─────┘
             │
        ┌────▼─────┐
        │  Ports   │ ← Interfaces (core/ports/)
        └────┬─────┘
             │
        ┌────▼─────┐
        │  Domain  │ ← Business Logic (agents/)
        └──────────┘
```

**Key Principles**:
- **Domain Independence**: Business logic has no infrastructure dependencies
- **Dependency Inversion**: High-level modules depend on abstractions
- **Interface Segregation**: Ports are minimal and focused
- **Testability**: All dependencies are mockable via ports

---

## Dependency Direction

```
         index.ts (Entry Point)
              ↓
         cli/ (CLI Layer)
              ↓
    composition/ (Composition Root)
              ↓
      ┌───────┴────────┐
      │                │
  agents/ ──→ core/ ←─── periphery/
  (Use)      (Ports)    (Implement)
```

**Rules**:
- ✅ `core/` depends on nothing (pure interfaces and policies)
- ✅ `agents/` depends only on `core/` (uses ports)
- ✅ `periphery/` depends only on `core/` (implements ports)
- ✅ `composition/` wires everything together

---

## Repository Structure

```
src/
├── index.ts                        Entry point
├── cli/                            CLI layer
│   ├── parser.ts                   Argument parsing
│   ├── resolver.ts                 File resolution
│   └── help.ts                     Usage information
│
├── composition/                    Composition root
│   └── orchestrator.ts             Dependency wiring
│
├── core/                           Domain core
│   ├── ports/                      Interface definitions
│   │   ├── index.ts
│   │   ├── llm.ts
│   │   ├── memory.ts
│   │   ├── git.ts
│   │   └── ...
│   ├── types.ts                    Core types
│   ├── policies/                   Centralized policies
│   │   ├── retrieval.ts
│   │   └── validations.ts
│   ├── chunk/                      Chunking engine
│   ├── codebase/                   Codebase analysis
│   └── prompt/                     Prompt engine
│
├── agents/                         Application layer
│   ├── architect/                  Architect agent
│   │   ├── index.ts                Entry point
│   │   ├── types.ts                Agent types
│   │   ├── graph/                  LangGraph workflows
│   │   │   ├── code/               Code generation
│   │   │   ├── design/             Design generation
│   │   │   └── learn/              Learning extraction
│   │   ├── memory/                 Memory service
│   │   └── utils/                  Agent utilities
│   ├── planner.ts                  Planner agent
│   ├── reviewer.ts                 Reviewer agent
│   └── doc.ts                      Doc agent
│
└── periphery/                      Infrastructure layer
    ├── adapters/                   Port implementations
    │   ├── llm/
    │   │   └── GenericLLMClient.ts
    │   ├── memory/
    │   │   ├── ChromaMemoryAdapter.ts
    │   │   └── Retriever.ts
    │   ├── git/
    │   │   └── SimpleGitAdapter.ts
    │   ├── command/
    │   │   └── NodeCommandAdapter.ts
    │   ├── chunk/
    │   │   └── ChunkingAdapter.ts
    │   ├── config/
    │   │   └── FileConfigAdapter.ts
    │   ├── prompt/
    │   │   └── FilePromptAdapter.ts
    │   ├── session/
    │   │   └── FileSessionAdapter.ts
    │   ├── reporting/
    │   │   └── FileReporter.ts
    │   └── validation/
    │       └── ValidationEngine.ts
    │
    ├── integrations/               External services
    │   └── vector-memory/
    │       ├── docker-compose.yml
    │       └── embedder/
    │
    └── profiles/                   Language/framework profiles
        ├── languages/
        └── frameworks/
```

---

## Core Ports

All ports are defined in `src/core/ports/`:

| Port | Purpose | Implementation |
|------|---------|----------------|
| `LLMClient` | LLM interaction | `GenericLLMClient` (OpenAI/Anthropic) |
| `MemoryPort` | Vector database | `ChromaMemoryAdapter` (ChromaDB) |
| `GitPort` | Git operations | `SimpleGitAdapter` (simple-git) |
| `CommandPort` | Shell commands | `NodeCommandAdapter` (child_process) |
| `ChunkPort` | Text chunking | `ChunkingAdapter` (custom) |
| `ConfigPort` | Configuration | `FileConfigAdapter` (JSON files) |
| `PromptPort` | Prompt loading | `FilePromptAdapter` (file system) |
| `SessionPort` | Session management | `FileSessionAdapter` (JSON files) |
| `ReporterPort` | Report generation | `FileReporter` (Markdown) |
| `ValidationPort` | Code validation | `ValidationEngine` (custom) |

---

## Design Patterns

### 1. Port-Adapter Pattern

**Port (Interface)**:
```typescript
// src/core/ports/memory.ts
export interface MemoryPort {
  store(docs: Document[], namespace: string): Promise<void>;
  query(query: string, namespace: string): Promise<string[]>;
}
```

**Adapter (Implementation)**:
```typescript
// src/periphery/adapters/memory/ChromaMemoryAdapter.ts
export class ChromaMemoryAdapter implements MemoryPort {
  async store(docs: Document[], namespace: string) {
    // ChromaDB implementation
  }
  
  async query(query: string, namespace: string) {
    // ChromaDB implementation
  }
}
```

**Usage (Business Logic)**:
```typescript
// src/agents/architect/memory/index.ts
export async function retrieve(
  query: string,
  project: string,
  deps?: { memory?: MemoryPort }
) {
  const results = await deps.memory.query(query, project);
  return results;
}
```

**Wiring (Composition Root)**:
```typescript
// src/composition/orchestrator.ts
const memory = new ChromaMemoryAdapter();
const llm = new GenericLLMClient();

await architectAgent(spec, project, mode, {
  memory,
  llm
});
```

### 2. Dependency Injection

All dependencies are injected via parameters:

```typescript
export async function architectAgent(
  spec: string,
  project: string,
  mode: string,
  deps?: {
    memory?: MemoryPort;
    llm?: LLMClient;
    git?: GitPort;
    // ... other ports
  }
) {
  // Use injected dependencies
}
```

### 3. Composition Root

Single place for all dependency wiring (`src/composition/orchestrator.ts`):

```typescript
export async function orchestrate(args: ParsedArgs) {
  // Create all adapters
  const memory = new ChromaMemoryAdapter();
  const llm = new GenericLLMClient();
  const git = new SimpleGitAdapter();
  // ...
  
  // Wire dependencies
  const deps = { memory, llm, git, ... };
  
  // Route to agent
  if (args.agent === 'architect') {
    return await architectAgent(args.spec, args.project, args.mode, deps);
  }
  // ...
}
```

### 4. State Management (LangGraph)

Each workflow defines its own state interface:

```typescript
// src/agents/architect/graph/code/state.ts
export interface ArchitectGraphState {
  // Input
  context: ProjectContext;
  spec: string;
  
  // Artifacts
  prd: string;
  design: string;
  directive: string;
  code: string;
  
  // Execution
  planText: string;
  files: GeneratedFile[];
  violations?: Violation[];
  
  // Dependencies (injected)
  deps?: {
    llm?: LLMClient;
    memory?: MemoryPort;
    git?: GitPort;
    // ...
  };
}
```

Nodes return partial updates:

```typescript
export async function plan(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  const llm = state.deps?.llm;
  const planText = await llm.invoke(...);
  
  return { planText }; // Only update planText
}
```

---

## Workflows

### Architect Agent Workflows

1. **Design**: `resolve → plan → save`
2. **Code**: `resolve → decompose → plan → execute → validate → postProcess → dynamicValidate`
3. **Learn**: `resolve → extract → store`

See [ARCHITECT_CODE_TASK_WORKFLOW.md](designs/ARCHITECT_CODE_TASK_WORKFLOW.md) for detailed code workflow documentation.

---

## Key Modules

### Prompt Engine (`src/core/prompt/engine/`)

Modular prompt composition system:

```
PromptEngine
├── InputNormalizer    Normalize input formats
├── ContextAssembler   Gather required artifacts
├── TemplateComposer   Load and compose templates
├── PolicyInjector     Inject retrieval policies
├── PromptFormatter    Format for LLM
└── ModeController     Handle mode-specific logic
```

### Chunk Engine (`src/core/chunk/`)

Document chunking pipeline:

```
ChunkEngine
├── Loader      Load documents
├── Cleaner     Clean content
├── Splitter    Split into chunks
├── Annotator   Add metadata
└── Reranker    MMR reranking
```

### Codebase Retriever (`src/core/codebase/`)

Intelligent codebase context retrieval:

```
CodebaseRetriever
├── ImportGraphAnalyzer    Analyze import relationships
├── ASTAnalyzer            Parse code structure
├── WorkSizeEstimator      Estimate implementation size
└── CodebaseCache          Cache parsed results
```

---

## Naming Conventions

### Directories
- **lowercase**: `cli/`, `core/`, `agents/`, `periphery/`
- **camelCase** for services: `memoryService/`

### Files
- **PascalCase** for classes: `ArchitectPromptor.ts`, `ChromaMemoryAdapter.ts`
- **camelCase** for utilities: `parser.ts`, `resolver.ts`
- **lowercase** for special: `index.ts`, `state.ts`, `graph.ts`

### Exports
- **Named exports** preferred: `export function architectAgent(...)`
- **Default exports** avoided (better refactoring support)

---

## Development Guidelines

### Adding a New Port

1. Define interface in `src/core/ports/`:
```typescript
export interface NewPort {
  method(): Promise<Result>;
}
```

2. Implement adapter in `src/periphery/adapters/`:
```typescript
export class NewAdapter implements NewPort {
  async method(): Promise<Result> {
    // Implementation
  }
}
```

3. Wire in composition root:
```typescript
const newAdapter = new NewAdapter();
await agent(..., { newPort: newAdapter });
```

### Adding a New Graph Node

1. Create node file in `src/agents/architect/graph/[workflow]/nodes/`:
```typescript
export async function newNode(
  state: WorkflowState
): Promise<Partial<WorkflowState>> {
  // Node logic
  return { /* updates */ };
}
```

2. Export from `nodes/index.ts`:
```typescript
export { newNode } from './newNode';
```

3. Add to graph definition in `graph.ts`:
```typescript
graph.addNode("newNode", newNode);
graph.addEdge("prevNode", "newNode");
```

### Adding a New Adapter

1. Implement port interface
2. Add to `src/periphery/adapters/`
3. Instantiate in composition root
4. Inject via `deps` parameter

---

## Quality Attributes

### Testability
- All dependencies are mockable via ports
- Business logic is pure (no side effects)
- Easy to write unit tests

### Maintainability
- Clear separation of concerns
- Single responsibility per module
- Explicit dependencies

### Flexibility
- Swap adapters without touching business logic
- Add new agents independently
- Extend with new workflows

### Scalability
- Add new ports/adapters easily
- Parallel development (teams work on different layers)
- Independent testing

---

## Architecture Compliance

### Hexagonal Architecture Checklist

- ✅ Domain core has no external dependencies
- ✅ Dependency direction strictly enforced
- ✅ All external I/O via ports
- ✅ Adapters implement ports
- ✅ Composition root wires dependencies
- ✅ Business logic is testable in isolation

### SOLID Principles

- ✅ **Single Responsibility**: Each module has one reason to change
- ✅ **Open/Closed**: Open for extension, closed for modification
- ✅ **Liskov Substitution**: Adapters are interchangeable
- ✅ **Interface Segregation**: Ports are minimal and focused
- ✅ **Dependency Inversion**: Depend on abstractions, not concretions

---

## Related Documentation

- [ARCHITECT_CODE_TASK_WORKFLOW.md](designs/ARCHITECT_CODE_TASK_WORKFLOW.md) - Code generation workflow
- [CLI_GUIDE.md](guides/CLI_GUIDE.md) - Command-line usage
- [QUICK_START.md](guides/QUICK_START.md) - Getting started guide
- [HEXAGONAL_ARCHITECTURE_SUMMARY.md](audits/HEXAGONAL_ARCHITECTURE_SUMMARY.md) - Architecture audit

