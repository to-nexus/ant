# Architecture

Hexagonal architecture with ports and adapters pattern for clean separation between business logic and infrastructure.

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

**Principles**:
- Domain independence: Business logic has no infrastructure dependencies
- Dependency inversion: High-level modules depend on abstractions
- Interface segregation: Ports are minimal and focused
- Testability: All dependencies mockable via ports

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
- `core/` depends on nothing (pure interfaces and policies)
- `agents/` depends only on `core/` (uses ports)
- `periphery/` depends only on `core/` (implements ports)
- `composition/` wires everything together

## Directory Structure

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
│   │   ├── llm.ts
│   │   ├── memory.ts
│   │   ├── git.ts
│   │   ├── session.ts
│   │   ├── command.ts
│   │   └── ...
│   ├── types.ts                    Core types
│   ├── policies/                   Centralized policies
│   │   ├── retrieval.ts
│   │   └── validations.ts
│   ├── chunk/                      Chunking engine
│   │   ├── ChunkEngine.ts
│   │   └── rerank/MMRReranker.ts
│   ├── codebase/                   Codebase analysis
│   │   ├── CodebaseRetriever.ts
│   │   ├── ImportGraphAnalyzer.ts
│   │   └── ASTAnalyzer.ts
│   └── prompt/                     Prompt engine
│       ├── engine/
│       │   ├── PromptEngine.ts
│       │   ├── InputNormalizer.ts
│       │   ├── ContextAssembler.ts
│       │   ├── ModeController.ts
│       │   ├── TemplateComposer.ts
│       │   ├── PolicyInjector.ts
│       │   └── PromptFormatter.ts
│       └── templates/
│           └── code/
│               ├── phases/
│               │   ├── plan/base.md
│               │   └── execute/base.md
│               └── languages/
│                   ├── typescript/
│                   │   └── setup/constraints.md
│                   ├── golang/
│                   └── python/
│
├── agents/                         Application layer
│   ├── architect/                  Architect agent
│   │   ├── index.ts                Entry point
│   │   ├── types.ts                Agent types
│   │   ├── graph/                  LangGraph workflows
│   │   │   └── code/               Code generation
│   │   │       ├── nodes/
│   │   │       │   ├── resolve.ts
│   │   │       │   ├── decompose.ts
│   │   │       │   ├── plan.ts
│   │   │       │   ├── execute.ts
│   │   │       │   ├── writeFiles.ts
│   │   │       │   ├── validate.ts
│   │   │       │   ├── installDeps.ts
│   │   │       │   ├── runtimeValidate.ts
│   │   │       │   ├── enforce.ts
│   │   │       │   ├── evaluate.ts
│   │   │       │   ├── learn.ts
│   │   │       │   ├── checkpoint.ts
│   │   │       │   └── diagnostics/
│   │   │       │       ├── languages/
│   │   │       │       ├── packageManagers/
│   │   │       │       ├── buildTools/
│   │   │       │       └── linters/
│   │   │       ├── graph.ts
│   │   │       ├── state.ts
│   │   │       └── runner.ts
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
    │   │   └── ChromaMemoryAdapter.ts
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
    │   └── validation/
    │       └── ValidationEngine.ts
    │
    └── integrations/               External services
        └── vector-memory/
            ├── docker-compose.yml
            └── embedder/
```

## Core Ports

All ports defined in `src/core/ports/`:

| Port | Purpose | Implementation |
|------|---------|----------------|
| `LLMClient` | LLM interaction | `GenericLLMClient` (OpenAI/Anthropic) |
| `MemoryPort` | Vector database | `ChromaMemoryAdapter` (ChromaDB) |
| `GitPort` | Git + file operations | `SimpleGitAdapter` (simple-git + fs) |
| `CommandPort` | Shell commands | `NodeCommandAdapter` (child_process) |
| `ChunkPort` | Text chunking | `ChunkingAdapter` (custom) |
| `ConfigPort` | Configuration | `FileConfigAdapter` (JSON files) |
| `PromptPort` | Prompt loading | `FilePromptAdapter` (Handlebars) |
| `SessionPort` | Session management | `FileSessionAdapter` (JSON files) |
| `ReporterPort` | Report generation | `FileReporter` (Markdown) |
| `ValidationPort` | Code validation | `ValidationEngine` (custom) |

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

### 2. Dependency Injection

All dependencies injected via parameters:

```typescript
export async function architectAgent(
  spec: string,
  project: string,
  mode: string,
  deps?: {
    memory?: MemoryPort;
    llm?: LLMClient;
    git?: GitPort;
    session?: SessionPort;
    command?: CommandPort;
  }
) {
  // Use injected dependencies
}
```

### 3. Composition Root

Single place for dependency wiring (`src/composition/orchestrator.ts`):

```typescript
export async function orchestrate(args: ParsedArgs) {
  // Create all adapters
  const memory = new ChromaMemoryAdapter();
  const llm = new GenericLLMClient();
  const git = new SimpleGitAdapter();
  const session = new FileSessionAdapter();
  const command = new NodeCommandAdapter();
  
  // Wire dependencies
  const deps = { memory, llm, git, session, command };
  
  // Route to agent
  if (args.agent === 'architect') {
    return await architectAgent(args.spec, args.project, args.mode, deps);
  }
}
```

### 4. State Management (LangGraph)

Each workflow defines its own state interface:

```typescript
// src/agents/architect/graph/code/state.ts
export interface ArchitectGraphState {
  // Context & Input
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
  
  // Task Queue
  taskQueue: TaskQueue;
  currentTask?: Task;
  completedTasks: string[];
  
  // Dependencies (injected)
  deps?: {
    llm?: LLMClient;
    memory?: MemoryPort;
    git?: GitPort;
    session?: SessionPort;
    command?: CommandPort;
  };
}
```

Nodes return partial updates:

```typescript
export async function plan(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  const planText = await state.deps?.llm.invoke(...);
  await saveCheckpoint(state);
  return { planText };
}
```

## Key Modules

### Prompt Engine (`src/core/prompt/engine/`)

6-layer modular prompt composition:

```
PromptEngine
├── InputNormalizer    Normalize input formats
├── ContextAssembler   Gather artifacts
├── TemplateComposer   Load and compose templates (Handlebars)
├── PolicyInjector     Inject guardrails
├── PromptFormatter    Format for LLM API
└── ModeController     Handle mode-specific logic
```

### Template System

**Handlebars-based** for conditional logic:

```handlebars
{{#if currentCode}}
⚠️ EXISTING FILES (DO NOT REGENERATE):
{{#each currentCode}}
- {{this.path}}
{{/each}}
{{/if}}

{{#if currentTask}}
🎯 CURRENT TASK:
**Name**: {{currentTask.name}}
**Type**: {{currentTask.type}}
**Description**: {{currentTask.description}}
{{/if}}
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

Intelligent context retrieval:

```
CodebaseRetriever
├── ImportGraphAnalyzer    Analyze import relationships
├── ASTAnalyzer            Parse code structure
├── WorkSizeEstimator      Estimate implementation size
└── CodebaseCache          Cache parsed results
```

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

## Quality Attributes

### Testability
- All dependencies mockable via ports
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

## Architecture Compliance

### Hexagonal Architecture Checklist

- ✅ Domain core has no external dependencies
- ✅ Dependency direction strictly enforced
- ✅ All external I/O via ports
- ✅ Adapters implement ports
- ✅ Composition root wires dependencies
- ✅ Business logic testable in isolation

### SOLID Principles

- ✅ **Single Responsibility**: Each module has one reason to change
- ✅ **Open/Closed**: Open for extension, closed for modification
- ✅ **Liskov Substitution**: Adapters are interchangeable
- ✅ **Interface Segregation**: Ports are minimal and focused
- ✅ **Dependency Inversion**: Depend on abstractions, not concretions
