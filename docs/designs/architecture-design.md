# Architecture Design - Conceptual Overview

**ANT (AI-Native Transformation) - Architect Agent**  
**Version**: 1.0  
**Date**: 2025-10-27

---

## 📋 Document Purpose

This document describes **WHAT** and **WHY** - the conceptual architecture, design principles, and architectural patterns.

For **HOW** (implementation details, file structure), see [architecture-implementation.md](architecture-implementation.md).

---

## 🎯 Overview

Architect agent automates plan→code generation using:
- Latest design documents
- Complete HEAD originals
- Optional directives

**Emphasis**: Minimal-change edits, strict output formatting, type-safety, and guardrails.

---

## 🏛️ Architectural Style

### Hexagonal Architecture (Ports and Adapters)

```
┌─────────────────────────────────────┐
│   External World (UI, DB, API)     │
└────────────┬────────────────────────┘
             │
        ┌────▼─────┐
        │ Adapters │ ← Infrastructure (periphery/)
        └────┬─────┘
             │
        ┌────▼─────┐
        │  Ports   │ ← Interfaces (core/ports.ts)
        └────┬─────┘
             │
        ┌────▼─────┐
        │  Domain  │ ← Business Logic (agents/)
        │  (Core)  │
        └──────────┘
```

**Key Principles**:
1. **Domain Independence**: Business logic doesn't depend on infrastructure
2. **Dependency Inversion**: High-level modules don't depend on low-level modules
3. **Interface Segregation**: Ports define minimal, focused interfaces
4. **Testability**: Easy to mock and test via port injection

---

## 📐 Dependency Direction

```
         index.ts (Entry Point)
              ↓
         cli/ (Utilities)
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
- ✅ `composition/` depends on everything (wires dependencies)

---

## 🎨 Design Patterns

### 1. Port-Adapter Pattern
**Purpose**: Decouple business logic from infrastructure

```typescript
// Port (core/ports.ts)
export interface MemoryPort {
  store(docs: Document[], namespace: string): Promise<void>;
  query(query: string, namespace: string): Promise<string[]>;
}

// Adapter (periphery/adapters/memory/)
export class ChromaMemoryAdapter implements MemoryPort {
  // Implementation using ChromaDB
}

// Usage (agents/)
function useMemory(deps: { memory: MemoryPort }) {
  await deps.memory.query(...);  // Works with any adapter
}
```

### 2. Composition Root Pattern
**Purpose**: Single place for dependency wiring

```typescript
// composition/orchestrator.ts
const memory = new ChromaMemoryAdapter();  // Create adapters
const llm = new GenericLLMClient();
await architectAgent(..., { memory, llm });  // Inject
```

### 3. Dependency Injection Pattern
**Purpose**: Provide dependencies from outside

```typescript
// Agent receives dependencies via parameters
export async function architectAgent(
  spec: string,
  project: string,
  mode: AgentMode,
  inputFile?: string,
  deps?: { memory?: MemoryPort; llm?: LLMClient }  // Injected
) {
  // Use injected dependencies
  const context = await deps.memory.query(...);
}
```

### 4. Template Method Pattern
**Purpose**: Define algorithm structure with customizable steps

```typescript
// Modular prompt templates
system.md        → Core rules (shared)
plan-base.md     → Plan structure
plan-rules.md    → Plan-specific rules
code-base.md     → Code structure
code-rules.md    → Code-specific rules
examples.md      → Examples
```

---

## 🎯 Design Modules

### 1. Framework Core Skeleton
**Role**: Foundation - ports, policies, orchestration  
**Outcome**: Consistent execution flow, dependency direction enforced

### 2. Prompt Engine
**Role**: Pre-run prompts/templates and model parameters  
**Note**: No post-run validation (that's in Guardrail Engine)

### 3. Agent Workflow Graph
**Role**: LangGraph state transitions (plan → code → validate) with retry  
**Outcome**: Deterministic control flow with explicit state

### 4. Validation & Guardrail Engine
**Role**: Apply centralized policies (ellipsis, line ratio)  
**Outcome**: Violations detected and retries triggered

### 5. Chunker & Embedder
**Role**: Split code/docs into chunks and embed to vector memory  
**Outcome**: Searchable context with stable embedding

### 6. Retriever
**Role**: Fetch relevant snippets by phase policy  
**Outcome**: Focused, compact context per phase

### 7. Learning Extractor
**Role**: Convert execution traces into reusable patterns  
**Outcome**: Persisted learnings for future runs

### 8. Git Integration Layer
**Role**: HEAD comparison, diff computation, branch management  
**Outcome**: Safe, auditable code changes

### 9. Reporting & Analytics
**Role**: Generate reports (phase logs, retries, violations)  
**Outcome**: Traceability and operational insights

---

## 🔄 Workflows

### Design Workflow
```
resolve → plan → save
```
- Input: PRD + previous design
- Output: System design document
- State: `DesignGraphState`

### Code Workflow
```
resolve → plan → implement → validate
         ↑_______________|
         (if violations)
```
- Input: Design + directive + HEAD files
- Output: Modified code files + report
- State: `ArchitectGraphState`
- Validation: Ellipsis detection, deletion ratio check

### Learn Workflow
```
resolve → store
```
- Input: Learning directive (targets + aspects)
- Output: Extracted patterns stored in vector memory
- State: `LearnGraphState`

---

## 📦 Key Concepts

### Ports (Interfaces)
Defined in `core/ports.ts`:
- `LLMClient` - LLM interaction
- `MemoryPort` - Vector database operations
- `GitPort` - Git operations
- `PromptLoader` - Prompt template loading
- `ReporterPort` - Report generation
- `ValidationPort` - Code validation

### Adapters (Implementations)
Located in `periphery/adapters/`:
- `GenericLLMClient` - OpenAI/Anthropic wrapper
- `ChromaMemoryAdapter` - ChromaDB client
- `SimpleGitAdapter` - simple-git wrapper
- `FilePromptAdapter` - File system prompt loader
- `FileReporter` - Markdown report writer
- `ValidationEngine` - Code validation logic

### Services (Business Logic)
Located in `agents/`:
- `memoryService` - Memory retrieval with query strategies
- `ArchitectPromptor` - Prompt composition orchestrator
- Graph nodes - Workflow steps (resolve, plan, implement, validate)

---

## 🎓 Architectural Principles

### 1. Separation of Concerns
Each layer has a single, well-defined responsibility:
- **Entry Point**: CLI handling
- **CLI**: Argument parsing and file resolution
- **Composition**: Dependency wiring
- **Core**: Interface definitions and policies
- **Agents**: Business logic
- **Periphery**: Infrastructure implementations

### 2. Dependency Inversion Principle
```
High-level (agents) → Abstraction (ports) ← Low-level (adapters)
```
Business logic depends on interfaces, not implementations.

### 3. Open/Closed Principle
```typescript
// Open for extension (new adapter)
class PostgresMemoryAdapter implements MemoryPort { ... }

// Closed for modification (business logic unchanged)
```

### 4. Interface Segregation Principle
Ports are minimal and focused:
```typescript
// Good: Focused interface
interface MemoryPort {
  store(...);
  query(...);
}

// Bad: Fat interface
interface DatabasePort {
  store(...);
  query(...);
  backup(...);
  migrate(...);
  // Too many responsibilities
}
```

### 5. Single Responsibility Principle
Each module has one reason to change:
- Ports change when business needs new capabilities
- Adapters change when infrastructure changes
- Agents change when business rules change

---

## 🔐 Quality Attributes

### Testability
- Mock adapters for unit tests
- Test business logic in isolation
- No need for real DB/API in tests

### Maintainability
- Clear separation of concerns
- Easy to locate and modify code
- Documentation matches implementation

### Flexibility
- Swap adapters without touching business logic
- Add new agents without changing core
- Change infrastructure independently

### Scalability
- Add new workflows (graphs) easily
- Extend with new adapters
- Parallel development (different teams on different layers)

---

## 📊 Design Decisions

### Why Hexagonal Architecture?
**Problem**: Traditional layered architecture couples business logic to infrastructure  
**Solution**: Hexagonal isolates domain from external concerns  
**Benefit**: Testable, flexible, maintainable

### Why LangGraph?
**Problem**: Complex state machines are hard to maintain  
**Solution**: Visual, declarative workflow definition  
**Benefit**: Clear flow, easy to debug, built-in retry logic

### Why Modular Prompts?
**Problem**: Monolithic prompts are hard to maintain  
**Solution**: 6 modular templates (system, plan-base, plan-rules, code-base, code-rules, examples)  
**Benefit**: Reusability, easier to update, clear separation of concerns

### Why Composition Root?
**Problem**: Dependencies scattered throughout codebase  
**Solution**: Single place (`composition/orchestrator.ts`) for all wiring  
**Benefit**: Clear dependency graph, easy to understand and modify

### Why Port-Adapter for Prompts?
**Problem**: Direct file system access in business logic  
**Solution**: `PromptLoader` port with `FilePromptAdapter`  
**Benefit**: Can swap to DB-based prompts, API-based, etc.

---

## 🎯 Architecture Compliance

### ✅ Achieved Goals
1. **Pure Core**: No dependencies on external libraries
2. **Dependency Direction**: Strictly enforced (agents → core ← periphery)
3. **Testability**: All dependencies injectable via ports
4. **Flexibility**: Easy to swap implementations
5. **Maintainability**: Clear structure, well-documented

### 📈 Metrics
- **Coupling**: Low (via interfaces)
- **Cohesion**: High (each module has single purpose)
- **Complexity**: Managed (clear layers, focused responsibilities)
- **Test Coverage**: Enabled (mockable dependencies)

---

## 📚 Related Documents

- [architecture-implementation.md](architecture-implementation.md) - Implementation details and file structure
- [hexagonal-architecture-guide.md](hexagonal-architecture-guide.md) - Detailed hexagonal architecture explanation
- [project-roadmap.md](project-roadmap.md) - Development roadmap and progress
- [README.md](../README.md) - Quick start and usage guide

---
