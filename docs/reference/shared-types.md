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
| `RestApiServerConfig` | `custom-agents.ts` | One declared REST API connection (`apis` entry): `baseUrl` + `headers` (`${secret:KEY}` rule shared with MCP) + optional `allow` method/path rules (`parseRestAllowLine` grammar). |
| `validateMcpServers` | `custom-agents.ts` | Every MCP rule as plain messages (empty = valid). Shared by the loader (throws), the HTTP gate (400), and the settings form (disables save). |
| `MCP_SECRET_REF_PATTERN` / `parseSecretRef` / `formatSecretRef` | `custom-agents.ts` | The one marker (`${secret:KEY}`) that makes a value a credential-store lookup. Credential-ness is authored, never inferred from shape. |
| `isAllowedDefinitionPath` | `custom-agents.ts` | Write whitelist for definition files edited over HTTP. |

## Pipelines (scheduled custom-job chains)

> ⚠️ Experimental — see [concepts/pipelines.md](../concepts/pipelines.md).

| Type / function | Source | Purpose |
|-----------------|--------|---------|
| `PipelineDef` / `PIPELINE_DEF_VERSION` / `resolveRunConcurrency` | `pipeline.ts` | One definition: `version`, `name`, `on` (exactly one of `schedule` / `runCompleted` / `fetch`, or none = manual), `concurrency?` (live runs per activation, `1..PipelineCaps.maxLiveRunsPerActivation`; `resolveRunConcurrency` is the one reader, every trigger shares the cap), `defaults?`, `steps[]`, `acknowledged?`. Project-free by construction — `projectId` was a v1 field and is now rejected. |
| `PipelineAdvisory` / `PIPELINE_ADVISORY_CODES` / `PipelineAcknowledgement` / `PipelineAdvisoryResolution` / `resolvePipelineAdvisories` | `pipeline.ts` | The advisory lifecycle: a closed code vocabulary, the author's `{ code, step, reason }` disposition inside the definition, and the ONE resolver every reader (editor, save/GET responses, list count, offline CLI) calls — `{ open, acknowledged, stale }`, recomputed per read, never a gate. |
| `PipelineStepDef` = `JobStepDef` \| `ApprovalStepDef` / `isApprovalStep` | `pipeline.ts` | A step is either a custom-job dispatch (`customJobRef`, `intent?`, `directive`, `context?`) or a gate that issues no job. |
| `PipelineScheduleTrigger` | `pipeline.ts` | `cron` (5 fields, parsed server-side), `tz?`, `onMissed?`, `overlap?`. |
| `PipelineFetchTrigger` (`PipelineFetchBoundTrigger` \| `PipelineFetchInlineTrigger`) / `PipelineFetchConnection` / `fetchConnectionSource` / `PipelineRunItem` / `PipelineFetchStatus` / `parseItemPath` / `fetchItemTemplateVars` | `pipeline.ts` | The pull trigger: a REST connection in exactly one of two forms — BOUND (`customJobRef` + `api`, a job's declared `apis` entry resolved in the activator's scope) or INLINE (`connection: { baseUrl, headers? }`, the external `apis` shape minus `allow`/`self`; `fetchConnectionSource` is the one discriminator) — a read-only `request` (trigger configuration — never rendered to a model, never a tool), item-paths `items` / `key` / `fields?` (`$`, `.name`, `['name']`, `[n]`; no wildcards), `every`, `batch?`. `PipelineRunItem` is the claimed case frozen on the run; `PipelineFetchStatus` is last-poll telemetry, never a judgment input. `fetchItemTemplateVars` derives the second template grammar (`trigger.item.key` + declared fields) from one definition. |
| `StepEdgeCondition` / `StepFailurePolicy` | `pipeline.ts` | `'success' \| 'failure' \| 'always'` per edge; `'abort' \| 'continue'` for the run. |
| `PipelineAvailability` | `pipeline.ts` | The `enabled` sidecar. Gates *activatability*, not execution — a missing sidecar reads as disabled. |
| `PipelineActivation` / `ActivePipelineInfo` | `pipeline.ts` | The scheduling unit: one pipeline bound to one project, self-describing, pinning the scope its definition resolves from. `ActivePipelineInfo` / `PipelineActivationView` carry `liveRuns: PipelineLiveRun[]` (newest first) and a `state` that is always `activationStateOf(liveRuns)`. |
| `PipelineLiveRun` / `liveRunOf` / `foldLiveRun` / `activationStateOf` | `pipeline.ts` | One live run as every view sees it — `runId`, `status`, `startedAt`, `firedBy`, `itemKey?`, `currentStepIds` (steps in a live state; where the run's chips sit on the one canvas). `liveRunOf` is the ONE derivation from a run record, `foldLiveRun` the ONE upsert/removal, `activationStateOf` the ONE state rule (awaiting a person outranks working). |
| `RunRecord` / `StepRecord` / `GateRecord` / `ClarifyRecord` / `PipelinePendingApproval` | `pipeline.ts` | Run history shapes, including the `awaiting_clarify` step state and the fetch `item?`. Gate routing rides `GateRecord.assignees?` (⊆ candidates; `assigneeSource` / `assignedBy`), sourced from a human reassign or the upstream `StepRecord.assignee?` (the sealed `<assignee>` nomination, kept only when it names a candidate). Inbox rows carry `assignees?` + `candidates?` for sorting and the reassign select — a routing hint, never a permission: any candidate still decides. |
| `PipelineRunEvent` / `PipelineFiredBy` | `pipeline.ts` | The run-log line and SSE payload the Pipelines tab renders live (`fired`, `item_claimed`, `awaiting_human`, `gate_reassigned`, …). `PipelineFiredBy` = `cron` \| `manual` \| `event` \| `fetch`; the FE keys its icon/label tables as `Record` over it (`Pipelines/runIdentity.ts`). |
| `ActiveJobInfo` | `task.ts` | One live job of a feature on the SSE initial kanban (`jobType`, `jobId`, `status`, `agent?`) plus attribution — `pipelineRunId?` (the run this job is a step of) and `customJobRef?` (universal) — so N universal jobs of one project stay distinguishable. |
| `validatePipelineDef` | `pipeline.ts` | Every definition rule as plain messages (empty = valid), the `validateMcpServers` precedent. Reserved knobs fail loudly instead of no-opping. |
| `PIPELINE_TEMPLATE_VARS` / `PIPELINE_STEP_OUTPUT_FIELDS` / `DEFAULT_PIPELINE_CAPS` | `pipeline.ts` | The CLOSED template surface — 5 static directive/pin variables (`trigger.fireDate`, `trigger.fireEpoch`, `run.id`, `run.prevSuccess.fireDate|fireEpoch`) plus the 2 step-output fields (`answer`, `artifacts`) — and the default caps. The fetch trigger's `trigger.item.*` is a second, definition-derived grammar (`fetchItemTemplateVars`); it does not grow this const. The FE keys its human-label tables as `Record` over these unions (`Pipelines/templateTokens.ts`), so growing the list without labelling it fails typecheck. |

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
