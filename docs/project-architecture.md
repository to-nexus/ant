# AI Dev Framework - Architect Agent Architecture

## 1) Overview
Architect agent automates plan→code generation using the latest design doc, complete HEAD originals, and optional directives. Emphasis on minimal-change edits, strict output formatting, type-safety, and guardrails.

## Repository Layout (High-level)
- `projects/` — Per-project workspace (PRD, generated artifacts, directives, config)
- `src/` — Framework source (agents, orchestrator, tools, memory)
- `vector-memory/` — ChromaDB + embedder infra (Docker)
- `docs/` — Documentation (this file, other design docs)

## projects/ (per-project workspace)
Typical feature directory:
```
projects/<project>/<feature>/
  prd/spec.md                     # PRD input
  generated/
    design/design-*.md            # Generated design documents
    reports/code-generation-report-*.md
  directives/
    code/directive-N.md           # Code directives (incremental)
    design/directive-N.md         # Design directives
    learn/directive-N.md          # Learning targets
```
- `projects/<project>/config.json` — target repo location/branch base, e.g.:
  ```json
  { "repoType": "local", "localPath": "/path/to/target-repo", "branchBase": "main" }
  ```
- Auto-detection: latest design, latest directive (by N), feature name from path

## src/ (Architect focus)
- `agents/architect/`
  - `handlers/design.ts` — arch-design flow
  - `handlers/code.ts` — arch-code flow (Plan → Implementation → Validation → Report)
  - `handlers/learn.ts` — codebase learning
  - `prompt/ArchitectPromptor.ts` — universal prompts (strict rules, checklists)
  - `llm/createModel.ts` — model/provider config; architect temperature tuned lower
  - `utils.ts` — directive/design discovery; required integration extraction (generic)
- `tools/git.ts` — simple-git helpers (HEAD, branch ops, file IO)
- `memory/` — ChromaDB client + custom embedder integration
- `orchestrator.ts`, `index.ts` — CLI wiring

Notes (agents priority):
- Architect is primary (implemented and hardened)
- Planner/Reviewer/Doc exist, but architect-first usage is recommended now

## 3) Flow (arch-code)
1. Resolve inputs
   - Latest design (generated/design/design-*.md)
   - Optional directive (directives/code/directive-N.md)
   - HEAD originals from target repo (complete files)
2. Phase 1: Plan
   - Universal Plan Prompt merges design + directive + originals
3. Phase 2: Implementation
   - Universal Code Prompt outputs COMPLETE files (no markdown/backticks/ellipsis)
4. Post-processing
   - Output validation + guided retry
   - Learnings + report

## 4) Prompt Strategy
- Plan Prompt: produces focused plan from design/directive/originals
- Code Prompt (strict):
  - COMPLETE files only; actual repo paths
  - Minimal-change invariant; preserve structure/logic/providers/hooks
  - English-only
  - Type-safety rules and self-checklist

## 5) Context Sources
- HEAD originals (no truncation): modification base
- Plan-referenced paths: additionally loaded from HEAD
- Design doc: “how to implement” foundation
- Directive: incremental edits; no rollback unless explicit

## 6) Guardrails
- Excessive deletion detection (< ~70% of original lines) → retry once
- Ellipsis/placeholder ban: "...", "// ...", "{/* ... */}" → retry once
- Required integrations inference (generic): components/providers/hooks from design/plan; enforcement with retry
- Paths: actual paths only
- Output: pure source, COMPLETE files

## 7) Type & Style Policies
- Type safety: guard possibly-undefined (e.g., `projectId ?? ''`, `language ?? 'en'`), no implicit any
- Null vs undefined: prefer `undefined` at boundaries; convert `null`→`undefined` consistently
- Style-only edits: structure/logic preserved; only classes/styles/glue

## 8) Directive Semantics
- Treated as incremental changes to prior integrated state
- RESPONSE (explain) → implement (preserve integrations)

## 9) Configuration
- Models via env; architect temperature tuned lower for consistency
- Project config: `projects/<project>/config.json`

## 10) Paths
```
src/agents/architect/
  handlers/
  prompt/
  llm/
  utils.ts
projects/<project>/<feature>/
  prd/spec.md
  generated/design/design-*.md
  generated/reports/code-generation-report-*.md
  directives/{code,design,learn}/directive-N.md
```

## 11) Embeddings & Vector DB (ChromaDB)
- Memory layer: `src/memory/index.ts` (Chroma client + custom embedding server)
- Embedder: external HTTP server (default `EMBEDDER_URL=http://localhost:8001`) serving all-MiniLM-L6-v2
- Storage:
  - `storeLearnings` (architect) persists extracted principles per project/feature
  - `storeCodebase` can persist codebase structural nodes (imports/exports) as documents
- Retrieval:
  - `queryMemory(query, namespace)` returns top-k documents for contextualization (used by agents as needed)
- Infra:
  - Docker compose under `vector-memory/` brings up ChromaDB (`CHROMA_URL`) and the embedder

How Architect uses it:
- After arch-code, learnings are extracted and stored (per-run knowledge accumulation)
- Vector memory enables iterative improvements across runs and can be queried by other agents (review/doc)

## vector-memory/
- `vector-memory/docker-compose.yml` — starts ChromaDB + embedder
- `vector-memory/embedder/` — simple HTTP server hosting all-MiniLM-L6-v2 embeddings API
- Data persisted under `vector-memory/chroma-data/`
