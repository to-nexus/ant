# Shared types (`@ant/shared`)

`@ant/shared` is the **only** mechanism for cross-package type contracts.
It's a source-only workspace package — no build step. Both `ant-cli` and
`ant-ui` import directly from `@ant/shared/...`.

For the canonical type definitions, read the source. This page lists the
key types and their meaning.

## Job and task model

| Type | Source | Purpose |
|------|--------|---------|
| `JobType` | `task.ts` | `'code' \| 'design' \| 'learn' \| 'plan' \| 'ask' \| 'inline-ask'` |
| `DecomposableJobType` | `task.ts` | Subset that produces task decompositions (`code`, `design`). |
| `SessionableJobType` | `task.ts` | Jobs whose state checkpoints to disk. |
| `BaseTask` | `task.ts` | Discriminated union by `task.type` — `feature` / `error` / `verification` / `ui` / `design-system` / `test-code` / `doc` / `setup` / `explain`. |
| `TaskBand` | `task.ts` | `'foundation' \| 'integration' \| undefined` — orchestrator scheduling axis (FeatureTask only). |
| `TaskStatus` | `task.ts` | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled'`. |
| `KanbanData` | `task.ts` | The per-feature task queue snapshot. |

## Action / RAC

| Type | Source | Purpose |
|------|--------|---------|
| `InferredAction` | `rac.ts` | Triage output: intent + tags. |
| `Mode` | `rac.ts` | `'generate' \| 'refactor' \| 'explain'`. |
| `IntentGroup` | `action-config-matrix.ts` | High-level intent grouping. |
| `ResolvedActionContext` | `rac.ts` | The complete RAC: `refs`, `context`, `target`, `mcpSources`, `basis`. |
| `ResolvedArtifact` | `rac.ts` | One slot in the RAC with role (`'ref'` / `'context'`) and path. |
| `TechTier` | `rac.ts` | Stack identification (frontend / backend / fullstack, framework, language). |

## Workflow / SSE

| Type | Source | Purpose |
|------|--------|---------|
| `WorkflowRealtimeState` | `workflow.ts` | Live workflow event payload broadcast to the UI. |
| `InterruptionDetails` | `workflow.ts` | Why a job was interrupted. |
| `InterruptionReason` | `workflow.ts` | `'user-stopped' \| 'verification-terminal' \| 'budget-exhausted' \| ...`. |

## Domain / tier

| Type | Source | Purpose |
|------|--------|---------|
| `Domain` | `tier-matrix.ts` | `'service' \| 'game'`. Workspace-level selector. |
| `TierKey` | `tier-matrix.ts` | `'techTier' \| 'visualTier' \| 'gameArtTier' \| 'gameContentTier'`. |
| `isTierActive(tier, slot, domain, runtime)` | `tier-matrix.ts` | The single tier-activation predicate. Used by FE wizard, FE summary, BE decompose, BE PromptBuilder. |

## Canonical paths

| Type / function | Source | Purpose |
|-----------------|--------|---------|
| `UI_SOURCES` | `canonical.ts` | `['ant', 'figma', 'handoff']` — the three first-class UI inputs. |
| `ARTIFACT_PREFIX` | `canonical.ts` | Path prefixes for canonical artifact directories. |
| `normalizeUiSourceRefs` | `canonical.ts` | The hard-exclusivity SSOT for UiSource. |
| `pickDefaultUiSourceRefs` | `canonical.ts` | Auto-pick logic for FE wizard. |
| `pathsContainUiDoc` / `pathsContainGameArtDoc` | `canonical.ts` | Per-domain helpers for design-presence checks. |
| `designDirOf` / `designSubdirOf` | `canonical.ts` | Map artifact filenames to their canonical directory. |

## Game-specific

> ⚠️ The game vertical is **in development**. The types below are
> wired and stable enough to compile against, but end-to-end game
> generation paths are still being validated.

| Type | Source | Purpose |
|------|--------|---------|
| `GameGenreVariant` | `game-content-tier-registry.ts` | Phase 4 genre set. |
| `GameCoreLoopVariant` | `game-content-tier-registry.ts` | Phase 4 core-loop set. |
| `GENRE_CORELOOP_MATRIX` | `game-content-tier-registry.ts` | The genre × coreLoop validity matrix. |
| `coreLoopCandidatesFor(genre)` | `game-content-tier-registry.ts` | The narrowing helper used by decompose. |

## Adding a shared type

A new `@ant/shared` type is a contract change. The expected workflow:

1. Add the type with concise JSDoc.
2. Update both BE and FE consumers in the same PR (or stack).
3. Add a regression test in `packages/ant-cli/tests/` that exercises the
   shape end-to-end.
4. If the type affects an SSE event, update the realtime adapter and the
   FE store slice that consumes it.

For binding rules around discriminated unions and the three-axis task
model, see [AGENTS.md § Three-Axis Task Modeling](../../AGENTS.md#three-axis-task-modeling--type--band--priority).

## Read next

- [internals/01-shared-contracts.md](../internals/01-shared-contracts.md)
  — the SSOT including BE-only fields and historical migrations.
- [internals/36-output-tag-matrix.md](../internals/36-output-tag-matrix.md)
  — canonical `<tag>` registry that interacts with shared types.
