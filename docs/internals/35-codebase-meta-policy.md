# Codebase Meta Document Policy

> Purpose: defines the boundaries of the meta documents that ant observes and generates in the workspace file system. Structurally prevents the fragmentation that arose when conventions / runtime outputs / agent session state got mixed into the same tree.

## 1. Domain Layer Separation Principle

The primary classification axis of a feature workspace is **domain meaning, not I/O** (`plan` / `architecture` / `visual` / `assets` / `meta` / `sessions` / `codebase`). Every file must belong to exactly one domain directory, and the following table is the SSOT for the code vs deliverable vs session boundary.

| Directory | Nature | Lifetime | Readers | Writers |
|---|---|---|---|---|
| `codebase/` | Code + the code's meta documents. Git-tracked. | Persistent | Human developers + ant agents | Code-generating tasks (setup / feature / integration / ...) |
| `plan/` · `architecture/` · `visual/` · `assets/` | Domain classification of design/generation **deliverables**. Referenced from the RAC. | Persistent (across sessions) | ant agents (via prompt injection) | design / planner / related tasks |
| `meta/` | Job meta-track container (`directives/`, `evals/`). | Persistent | ant agents + humans | design / code / evaluation jobs |
| `sessions/` | Agent **runtime / debug state**. | Ephemeral (one job or resume window) | ant agents (autonomous lookup) + humans (debugging) | Graph runtime / debug loggers |

### Why domain classification

- **Code vs deliverable distinction**: `plan/` · `architecture/` · `visual/` describe "what to build" — prompts, specs, tokens, etc. Actual source lives only in `codebase/`. Conventions — "how to write files" — are code-authoring rules and therefore belong to `codebase/`.
- **Code vs session distinction**: `sessions/` is for restart/debugging. Putting conventions there means they vanish every time the session changes.
- **Deliverable vs session distinction**: the domain directories hold "finished documents", `sessions/` holds "in-progress state". The latter may be overwritten on failure, while the former accumulates.

When the boundary blurs, fragmentation risk emerges. **When adding a new file, always assign exactly one layer from the table above**, and if it belongs to `codebase/`, follow the §2 policy below.

## 2. `codebase/ANTRULES.md` — Deviation Ledger Based on the 3-Condition Filter

### Single purpose

`codebase/ANTRULES.md` records **the residual set of facts that are valid only in this codebase, cannot be automatically derived, and that subsequent tasks must repeat to preserve consistency**. It does not encroach on the other areas of responsibility (decompose / prompt / config files).

### The 3-condition filter (record only when ALL are satisfied)

A fact qualifies for recording in ANTRULES only when it satisfies **all three** of the conditions below. If even one is missing, another SSOT is responsible and it does not go into ANTRULES.

| # | Condition | Actual owner on failure |
|---|---|---|
| 1 | **Codebase-local** — a choice valid only in this project. It must not be covered by a system-wide default / techTier hint. | System prompt / techTier hints |
| 2 | **Not auto-derivable** — recorded nowhere in `package.json`, `tsconfig.json`, the lockfile, framework conventions, explicit config files, or the existing file structure. | The relevant config file / existing code |
| 3 | **Cross-task invariant** — subsequent tasks (or sessions) must repeat the same choice to preserve consistency. Excluded if it is a one-off choice for this task only. | That task's plan / task description |

### Non-encroachment principle

ANTRULES **does not touch** the responsibilities of these three areas:

| Area | Owner | Example |
|---|---|---|
| "What this task will do" | **decompose** | "Write hero-section.tsx" |
| "How things are generally done in TypeScript / Next" | **prompt (system / techTier)** | "`moduleResolution: node` required" |
| "Machine-readable facts" | **config files** | deps in `package.json`, `tsconfig.paths` |

ANTRULES takes only the **residual set** that belongs to none of the three areas. If decompose already injects `techTier: nextjs` into every task description and ANTRULES also records "Framework: Next.js", there are now two SSOTs — the seed of drift.

### Typical allowed / prohibited cases

#### ✅ Allowed — 2 axes

- **Project-specific conventions (fine-grained choices inexpressible via decompose / prompt)**
  - File naming case (`kebab-case.tsx`, `PascalCase.ts`)
  - Hooks filename prefix (`use-*.ts`)
  - Export style preference (named first, default as exception)
  - Directory organization conventions (e.g. "sections/ holds only top-level page blocks, components/ui holds only primitives")
  - Specific interpretation of a lint rule (`no-unused-vars: warn` as an intentional relaxation + reason)
  - Custom domain terminology mapping (e.g. "`pulse` = project code name; appears as `Pulse` in code")

- **Point-in-time package compatibility / pinning rationale**
  - "`shadcn X v0.4` conflicts with `react@19` — pinned to `react@18` until upstream PR #NNN merges"
  - "Pinned to Node 22.5 due to the `--experimental-strip-types` bug in 22.6"
  - "Keep `.js` instead of `jest.config.ts` until the jest 30 migration"
  - "Tailwind v4's direct `@theme` declaration style has compatibility issues with Next 15.1 — pinned to v3"

#### ❌ Prohibited — another SSOT is already responsible

| Prohibited entry | Actual SSOT |
|---|---|
| "Framework: Next.js 15, App Router" | `package.json` + techTier |
| "Styling: Tailwind v3" | `package.json` + `tailwind.config.ts` |
| "Test runner: Jest 29 via `next/jest`" | `package.json` + `jest.config.*` |
| "Source root: `src/`" | `tsconfig paths` + framework convention |
| "`@/` alias resolves to `src/`" | `tsconfig paths` |
| "Config file: `tailwind.config.ts` at codebase root" | The file system |
| "Icons: `lucide-react`" | `package.json` |
| "TypeScript strict mode" | `tsconfig.json` |
| "Scan path: `src/**/*.{ts,tsx}`" | The body of `tailwind.config.ts` |

The moment these are written into ANTRULES, there are two SSOTs. ANTRULES is not automatically updated when code / config changes, so it goes stale, and if the LLM trusts it as "authoritative", regressions follow.

### Before / After — the real `lapis-bonding-fruit` case

Of the ANTRULES (933 chars) that setup-project generated before this 3-condition filter was introduced, keeping only the entries that pass the filter yields the following.

**Before (933 chars, 7 sections)**:
```md
# ANTRULES.md

## Framework
- Next.js 15, App Router, TypeScript strict mode.
- Source root: `src/` — all application code lives under `codebase/src/`.

## Styling
- Tailwind CSS v3.
- Config file: `tailwind.config.ts` at codebase root.
- Source scan path: `src/**/*.{ts,tsx}`.
- Design tokens extend `theme.extend` in `tailwind.config.ts`.

## Testing
- Jest 29 + React Testing Library 16 via `next/jest` (SWC pipeline).
- Do NOT add `babel.config.js` — it disables SWC project-wide.
- Setup file: `jest.setup.ts` (imports `@testing-library/jest-dom`).

## Icons
- Use `lucide-react` exclusively for all icon needs.

## Aliases
- `@/` resolves to `src/`.

## File Naming
- Components: `kebab-case.tsx`.
- Hooks: `use-*.ts`.
- Utilities: `kebab-case.ts`.

## Export Style
- Named exports preferred; default export only for Next.js page/layout files.
```

**After (only 4 entries survive)**:
```md
# ANTRULES.md

## Testing
- Do NOT add `babel.config.js` — it disables SWC project-wide (an interaction hazard of next/jest).

## File Naming
- Components: `kebab-case.tsx`.
- Hooks: `use-*.ts`.
- Utilities: `kebab-case.ts`.

## Export Style
- Named exports preferred; default export only for Next.js page/layout files.
```

The 5 removed sections (`Framework`, `Styling`, `Icons`, `Aliases`, `Styling/Scan path`, etc.) were all facts auto-derivable from `package.json` / `tsconfig.json` / `tailwind.config.ts`. Surviving entries:
- The `babel.config.js` prohibition — **satisfies all of conditions 1·2·3** (a hazard specific to next/jest, written in no config file, easy for a subsequent task to trip over)
- The 3 file-naming rules — **satisfies condition 2** (next.js is indifferent to file names; not in tsconfig either) + condition 3 (subsequent tasks must stay consistent)
- Export style — same as above

### Location

- `codebase/ANTRULES.md` (a flat file at the root). Subdirectories / hidden directories are prohibited — a human developer must be able to spot it immediately at the repository root.

### Size constraint

- Recommended ceiling: **1500 characters**. On overflow, the ant pipeline truncates + logs a warning.
- Rationale: it is auto-injected into every plan / execute prompt, directly affecting token cost and cache stability.
- With the 3-condition filter properly applied, most projects converge below 500 characters. Approaching 1500 characters is a signal to re-examine the filter.

### Section structure — free-form, no fixed skeleton

There are **no** fixed sections. Create a section with the relevant heading only when an entry has passed the 3-condition filter. If no entry passes, **do not create the file at all** (no empty skeletons). The `setup` task no longer "pre-seeds all categories" — append only on a discovery basis.

### Write / read ownership — every task may write

| Party | Permission |
|---|---|
| Every code-job task (setup / feature / ui / integration / design-system / test-code / error / verification / doc) | read + write. Record **only** cross-task invariants that pass the 3-condition filter. Recording is prohibited if the filter is not passed. |
| verification task | Especially important — the primary producer appending empirically confirmed deviations (e.g. "do not use a `.ts` config until jest 30; keep `.js`"). But facts derivable from official schemas — like "`setupFilesAfterEnv` is the correct key" — belong to techTier hints, not ANTRULES. |

**There is no single writer.** Each task may record and edit based on its own observations. Conflicts (parallel tasks editing concurrently) resolve naturally via SharedFileBuffer + LLM-merge logic (no separate lock needed — reuses the existing cross-worker conflict mechanism of `edit_file` / `<file>`).

### Agent dispatch

`loadAntrules(featureRoot)` (`core/artifact/antrules.ts`) returns a single field `antrulesContent: string | undefined`:

- `undefined` — file missing / read failure / empty string after trim
- Non-empty string — the content (truncated with a `read_file` pointer footer when over 1500 characters)

The shared partial `jobs/code/base/injections/antrules.md` gates on `{{#if antrulesContent}}` and renders the content. The partial's body re-surfaces the 3-condition filter every time — in the content-present branch, with softened framing ("suspect this block may be stale and trust the actual code"), and in the undefined branch, by reminding the LLM to "verify the 3-condition filter passes before creating a new file".

The file path is stated at the top of the partial, so if the LLM judges the section to be stale it can autonomously look it up with `read_file codebase/ANTRULES.md`. In other words, triple delivery: "injected into every prompt + autonomous read when needed + suspicion-driven SSOT re-verification".

### Preventing call-path fragmentation

If each plan hook (generic / verification / error) called `loadAntrules` individually, every new hook would risk forgetting the injection. The phase layer (`buildPlanPrompt` in `planGeneration.ts`) pre-populates `PlanPromptCtx.antrulesContent`, and every hook merely consumes `ctx.antrulesContent`. The execute side likewise calls `loadAntrules` at exactly one site, `buildMessages.ts` — one call site for plan, one for execute.

### Dependency self-containment principle — not ANTRULES's responsibility

**Class-of-bug baseline principles** like "to use a library you must install it" are not ANTRULES's responsibility. The `jobs/code/base/injections/dep-self-contained.md` partial is **unconditionally injected into every code-job execute / plan variant** (except doc / explain). ANTRULES relies on this principle but does not replace it — "this project uses Jest 29" is the decompose / package.json SSOT; "the Jest this project chose requires `@types/jest`" is the dep-self-contained SSOT. ANTRULES owns only **point-in-time deviations** like "this project keeps its config file as `.js` until the jest 30 migration".

## 3. Practical Guidelines

### Checklist when adding a new file / directory

1. Should a human developer see this file in `ls codebase/`? → the `codebase/` layer.
2. Is this file an **input** spec for code generation? → domain mapping: PRD/GDD → `plan/`, system/spec → `architecture/`, UI/game-art deliverables → `visual/`, asset pools → `assets/`, directives/evaluation reports → `meta/`.
3. Is this file internal agent state carried into the next run? → the `sessions/` layer.

Confusion cases:
- ❌ Creating "project conventions" as `architecture/system/project-conventions.md` — choosing 2 when 1 is correct. Conventions belong in `codebase/ANTRULES.md` (only if they pass the 3-condition filter).
- ❌ Writing runtime logs to `codebase/.ant/logs/` — mixing 3 into 1. They go to `sessions/`.
- ❌ Permanently storing the PRD at `codebase/docs/PRD.md` — putting something with nature 2 into 1 mixes the deliverable lifecycle (versioning · updates) into the code's git history.

### Self-check before recording in ANTRULES

Before writing a fact into ANTRULES, answer these four questions. It qualifies for recording **only when all are NO**.

1. Is it already in `package.json` / `tsconfig.json` / `*.config.*` / the lockfile?
2. Can it be inferred from official framework conventions / techTier defaults?
3. Is it information decompose already injects into the task description?
4. Is it a one-off choice for this task only (no need for subsequent tasks to repeat it)?

If any answer is YES, record it in **the corresponding SSOT** instead of ANTRULES, or do not record it at all.

### Coexistence with other agent tooling

If `CLAUDE.md`, `AGENTS.md`, or `.cursorrules` already exist, they can coexist with ANTRULES.md. Per-agent configuration is read **only by that agent**, so there is no conflict. However, duplicating the same rule across multiple files causes drift, so if ANTRULES.md is the reference, prefer keeping only a pointer to ANTRULES.md in the other files.

## 4. Related Documents

- [.cursorrules](/.cursorrules) — ant's baseline working conventions + summary pointer for ANTRULES.md
- [14-code-job.md](14-code-job.md) — how the code job's setup task initializes ANTRULES.md (the reduced seed scope after applying the 3-condition filter)
- [28-context-management.md](28-context-management.md) — how the ArtifactPipeline constructs the pool

## 5. Change History

- 2026-04-22: Initial version (policy introduced). Formalized as a principle upon discovering, during the `attempted-cycle-removal` work, that a draft `architecture/system/project-conventions.md` violated the boundary.
- 2026-04-23: §2 rewritten. The drift between the original intent (a discovery-based live log) and the implementation at the time (setup pre-seeding a skeleton, 4 fixed sections, read-only) surfaced in `plum-molding-bench`, where setup generated fabricated prohibitions like `Do not add test files` → infinite loop in test-code tasks. Lifted the "4 fixed sections" restriction, made "every task can read+write" explicit, prohibited fabricated prohibitions, and stated the scope as broad cross-task invariants.
- 2026-04-23 (dep-self-contained refactor): In `lapis-bonding-fruit`, 5 of the 7 sections in the 933-character ANTRULES generated by setup-project turned out to be re-declarations of `package.json` / `tsconfig.json`, structurally exposing the SSOT-drift risk. §2 rewritten around the 3-condition filter. Renamed the partial file `ant-md.md` → `antrules.md` so the filename matches its subject. Softened the "Treat them as authoritative" framing to "suspect staleness; trust the actual code as SSOT". Split the "dependency self-containment principle" into a separate partial (`dep-self-contained`) — removed from ANTRULES's responsibility.
