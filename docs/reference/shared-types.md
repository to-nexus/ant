# Shared types (`@ant/shared`)

`@ant/shared` is the **only** mechanism for cross-package type contracts.
It's a source-only workspace package — no build step. Both `ant-cli` and
`ant-ui` import directly from `@ant/shared/...`.

For the canonical type definitions, read the source. This page lists the
key types and their meaning.

## Job and task model

| Type | Source | Purpose |
|------|--------|---------|
| `JobType` | `job.ts` | `'code' \| 'design' \| 'learn' \| 'ask' \| 'plan' \| 'inline-ask' \| 'visual' \| 'universal'` |
| `DecomposableJobType` | `job.ts` | Subset that produces task decompositions (`code`, `design`, `learn`). |
| `SessionableJobType` | `job.ts` | Jobs whose state checkpoints to disk. |
| `BaseTask` | `task.ts` | Discriminated union by `task.type` — `feature` / `error` / `verification` / `seam` / `ui` / `design-system` / `test-code` / `doc` / `setup` / `explain`. |
| `TaskBand` | `task.ts` | `FeatureBand \| SetupBand` — orchestrator scheduling axis. `FeatureBand = 'foundation' \| 'platform' \| 'integration'` (FeatureTask), `SetupBand = 'root'` (SetupTask). |
| `TaskStatus` | `task.ts` | `'todo' \| 'in-progress' \| 'completed'`. |
| `KanbanData` | `task.ts` | The per-feature task queue snapshot. |
| `UniversalChecklistItem` / `UniversalChecklistItemState` | `task.ts` | The workspace progress plane — the agent-authored checklist that stands in for tasks in a `universal` job. Not tasks: never queued, never billed. |

## Custom agents (universal runtime)

> ⚠️ The universal runtime is **experimental** — see
> [concepts/custom-agents.md](../concepts/custom-agents.md).

| Type / function | Source | Purpose |
|-----------------|--------|---------|
| `UNIVERSAL_FEATURE` | `custom-agents.ts` | `'universal'` — the reserved constant a workspace project passes in the `:feature` slot, resolving to `{project}/universal`. |
| `CustomJobRef` / `formatCustomJobRef` / `parseCustomJobRef` | `custom-agents.ts` | The composite `{agentId}/{jobId}` key that identifies a custom job on the wire. `parse` returns `null` on malformed input — callers decide 400 vs throw. |
| `CustomAgentSummary` / `CustomJobSummary` | `custom-agents.ts` | Discovery shapes the FE lists (id, name, scope, readonly, jobs). |
| `CustomIntentDef` / `GENERAL_INTENT` | `custom-agents.ts` | A job's intent catalog entry, and the reserved no-match fallback. Intent ids are runtime strings, deliberately outside the compile-time `IntentId` union. |
| `UniversalTurnMeta` | `custom-agents.ts` | The per-turn axes: `intents[]`, `context[]`, `plan?` (`@intent:` / `@ctx:` / `@plan`). |
| `McpServerConfig` | `custom-agents.ts` | One MCP server declaration: `transport` (`stdio` \| `http`), plus `command`/`args`/`env` or `url`/`headers`. |
| `validateMcpServers` | `custom-agents.ts` | Every MCP rule as plain messages (empty = valid). Shared by the loader (throws), the HTTP gate (400), and the settings form (disables save). |
| `MCP_SECRET_REF_PATTERN` / `parseSecretRef` / `formatSecretRef` | `custom-agents.ts` | The one marker (`${secret:KEY}`) that makes a value a credential-store lookup. Credential-ness is authored, never inferred from shape. |
| `isAllowedDefinitionPath` | `custom-agents.ts` | Write whitelist for definition files edited over HTTP. |

## Action / RAC

| Type | Source | Purpose |
|------|--------|---------|
| `InferredAction` | `detection.ts` | Triage output: intent + tags. |
| `Mode` | `detection.ts` | `'generate' \| 'refactor' \| 'explain'`. |
| `IntentGroup` | `detection.ts` | High-level intent grouping. |
| `ResolvedActionContext` | `rac.ts` | The complete RAC: `refs`, `context`, `target`, `mcpSources`, `basis`. |
| `ResolvedArtifact` | `rac.ts` | One slot in the RAC with role (`'ref'` / `'context'`) and path. |
| `TechTier` | `tech-tier-registry.ts` | Stack identification (frontend / backend / fullstack, framework, language). |

## Workflow / SSE

| Type | Source | Purpose |
|------|--------|---------|
| `WorkflowRealtimeState` | `workflow.ts` | Live workflow event payload broadcast to the UI. |
| `InterruptionDetails` | `interruption.ts` | Why a job was interrupted. |
| `InterruptionReason` | `interruption.ts` | `'user-stopped' \| 'verification-terminal' \| 'budget-exhausted' \| ...`. |

## Domain / tier

| Type | Source | Purpose |
|------|--------|---------|
| `Domain` | `detection.ts` | `'game' \| 'service'`. Workspace-level selector. |
| `TierKey` | `tier-matrix.ts` | `'techTier' \| 'visualTier' \| 'gameArtTier'`. |
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
| `GameArtTierAxisKey` / `GAME_ART_TIER_AXIS_KEYS` | `game-art-tier-registry.ts` | The 7 game-art tier axes (concept / perspective / entityCatalog / motionPattern / particleProfile / projectilePolicy / audioProfile). |
| `GameArtConceptVariant` / `GAME_ART_CONCEPT_VARIANTS` | `game-art-tier-registry.ts` | The concept variant set. |
| `GameArtPerspectiveVariant` | `game-art-tier-registry.ts` | Render dimension (`2d` / `3d`). |

(Genre and core loop are expressed as free prose in the PRD, not as a closed tier enum — the former `game-content-tier-registry` was removed.)

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
