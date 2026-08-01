# Shared Contracts

## Overview

The `@ant/shared` package defines the type contracts between ant-cli and ant-ui.
It has no runtime dependencies and provides only TypeScript types and pure
functions. It is wired as a pnpm workspace dependency, so its source is referenced
directly without a build step.

## Module Layout

### job.ts

Job-level types.

| Type | Definition |
|------|------|
| `JobType` | `'code' \| 'design' \| 'learn' \| 'ask' \| 'plan' \| 'inline-ask' \| 'visual'` |
| `DecomposableJobType` | `Exclude<JobType, 'ask' \| 'plan' \| 'inline-ask' \| 'visual'>` |
| `SessionableJobType` | `DecomposableJobType \| 'plan' \| 'visual'` |
| `JobTiming` | `startedAt`, `completedAt`, `totalPausedDuration`, `phaseBreakdown` |

### task.ts

Task and Kanban types.

| Type | Definition |
|------|------|
| `TaskType` | `'setup' \| 'feature' \| 'design-system' \| 'ui' \| 'test-code' \| 'error' \| 'verification' \| 'explain' \| 'doc'` |
| `TaskStatus` | `'todo' \| 'in-progress' \| 'completed'` |
| `BaseTask` | `id`, `name`, `type`, `priority`, `description`, `completed`, `interrupted`, `exclusive`, `parallelGroup`, `packages`, `timing`, `tokenUsage` |
| `TaskTiming` | Task execution timing (`startedAt`, `completedAt`, `pausedAt`, `resumedAt`, `totalPausedDuration`, `elapsedTime`, `duration`) |
| `TaskTokenUsage` | Per-task token usage (`inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, `cacheCreationTokens`) |
| `KanbanData` | `jobId`, `todo`, `inProgress`, `completed`, `isEstimating`, `dataSource`, `recursionCount`, `recursionLimit`, `recursionTaskName`, `tokenUsage`, `estimatingTokenUsage`, `jobType`, `jobTiming`, `interruption`, `estimatingLabel`, `estimatingStartedAt`, `estimatingNodeId` |

### workflow.ts

Workflow SSE types.

| Type | Definition |
|------|------|
| `TaskInfo` | Task info (`id`, `name`, `type`, `description`, `priority`) |
| `NodeHistoryEntry` | Node entry/exit history (`nodeId`, `enteredAt`, `exitedAt`, `duration`) |
| `ActiveWorkerNode` | Active worker node (`workerId`, `nodeId`, `previousNodeId`, `taskName`, `taskId`, `enteredAt`) |
| `WorkflowRealtimeState` | `jobId`, `startedAt`, `endedAt`, `isCompleted`, `activeNodes`, `nodeHistory`, `activeActors`, `kanbanCurrentTask`, `kanbanUpdate`, `recursionCount`, `recursionLimit` |

### interruption.ts

Interruption metadata.

| Type | Definition |
|------|------|
| `InterruptionReason` | `'recursion_limit' \| 'user_stopped' \| 'api_error' \| 'process_crash' \| 'server_crash' \| 'timeout' \| 'server_shutdown' \| 'figma_rate_limited' \| 'figma_connection_lost' \| 'unknown'` |
| `InterruptionDetails` | `reason`, `message`, `timestamp`, `canResume`, `metadata` |

### detection.ts

Shared vocabulary for the Detect pipeline and the LLM inference output type.

| Type | Definition |
|------|------|
| `Mode` | `'generate' \| 'refactor' \| 'explain'` — universal mode vocabulary shared across all Jobs |
| `IntentGroup` | `'plan' \| 'design-system' \| 'design-ui' \| 'design-spec' \| 'code' \| 'visual' \| 'learn-codebase' \| 'ask'` |
| `DesignDomain` | `'game' \| 'service'` |
| `InferredAction` | Output of `strategy.run()` (infer path). See the table below |

**`InferredAction` fields**

| Field | Type | Notes |
|------|------|------|
| `intentId` | `string` | Must be a valid IntentId. If invalid: retry + hard fail |
| `target?` | `string[]` | Output target file paths |
| `refs?` | `string[]` | Reference files identified by the LLM |
| `context?` | `string[]` | Context files identified by the LLM |
| `domain?` | `DesignDomain` | design-system only |
| `reasoning?` | `{ intent?, domain? }` | Chat display only. Not stored in the RAC |
| `sourceJob` | `string` | Original job identifier |

**Removed types**: `DetectionReport`, `DetectionSummary`, `ProjectProfile`,
`JobEnvironment`, `JobMode`, `DesignWorkType`, `JobSource` — retired by the move
to the single RAC pipeline.

**Backend-only (`packages/ant-cli/src/core/types/detection.ts`)**

| Function | Role |
|------|------|
| `formatRACForChat()` | RAC + transient reasoning → chat markdown |
| `resolveDesignTargetFiles()` | intentId → target files (for system-design) |
| `parseInferredActionFromLLM()` | `<detect>` XML tag → InferredAction |

### actions.ts

Action and intent definition system. The contract between the FE ActionsPanel and
BE agent routing.

| Type/Function | Definition |
|-----------|------|
| `ActionDefinition` | Action card definition (`id`, `label`, `description`, `status`) |
| `ACTION_DEFINITIONS` | Array of all action definitions |
| `IntentDefinition` | Intent definition (`id`, `intentGroup`, `label`, `description`) |
| `INTENT_DEFINITIONS` | Array of all intent definitions — **27 unique intent IDs** (per-intentGroup counts in the table below) |
| `IntentId` | Union type of valid intent IDs derived from `INTENT_DEFINITIONS` |
| `getIntentsForAction()` | `(intentGroup: IntentGroup) => ReadonlyArray<IntentDefinition>` |
| `ActionMetadata` | `explicit?`, `intent?`, `target?`, `refs?`, `context?`, `locale?`, `basis?: Basis` |
| `deriveFromIntent()` | `(intent: IntentId) => { intentGroup?, mode, agent, jobType, targetTier? }` — mode/intentGroup are always derived from the intentId |
| `ActionReadiness` | Whether an FE action can run (`buildReady`, `hasOutput`, `detectedMode`, `subModes?`, `namingIssues`, …) |
| `SubModeStatus` | FE sub-mode active state (`id`, `active`, `blockReason?`) |
| `validateDesignFileName()` | Validates design output file-naming rules |

**`INTENT_DEFINITIONS` counts by intentGroup (total 27)**

| `intentGroup` | Count | Notes |
|---------------|------|------|
| `plan` | 3 | `gen-plan`, `rev-plan`, `explain-plan` |
| `design-system` | 5 | `gen-sys-fe`, `gen-sys-be`, `gen-sys-full`, `rev-sys`, `explain-sys` |
| `design-ui` | 4 | `gen-ui-figma`, `gen-ui-desc`, `rev-ui`, `explain-ui` |
| `design-spec` | 3 | `gen-spec`, `rev-spec`, `explain-spec` |
| `code` | 4 | `gen-code-sys`, `gen-code-spec`, `gen-code-directive`, `explain-code` |
| `visual` | 2 | `gen-visual`, `explain-visual` |
| `learn-codebase` | 1 | `gen-learn` |
| `ask` | 3 | `ask-evaluate`, `ask-ant`, `ask-general` |

**Cross-domain explain intents (6)** — already included in the per-intentGroup
counts above: `explain-code`, `explain-ui`, `explain-sys`, `explain-spec`,
`explain-plan`, `explain-visual`.

### rac.ts

ResolvedActionContext (RAC) — the immutable output of the Detect node. Both the
explicit and infer paths are produced through the single `resolveToRAC()` funnel.

**Single pipeline structure:**
```
Explicit: metadata → intentId + slots → resolveToRAC() → RAC
Infer:    strategy.run() → InferredAction → mergeWithMetadata() → resolveToRAC() → RAC
```

| Type/Function | Definition |
|-----------|------|
| `ResolvedActionContext` | `intent?`, `intentGroup?`, `mode`, `target?`, `refs?`, `context?`, `artifacts?`, `documents?`, `domain?`, `intentDescription?`, `basis?`, `source`, `hasExplicitFields` |
| `ResolvedArtifact` | role-labeled document (`path`, `content`, `role: 'ref' \| 'context' \| 'directive'`, `mediaType?`, `mimeType?`, `base64?`) |
| `TechTier` | `language?`, `framework?`, `stack?`, `runtime?`, `packageManager?` — placed at RAC.basis.techTier. Filled by decompose or set as an explicit preset |
| `VisualTier` | `designSystem?` — future extension planned |
| `Basis` | `techTier?: TechTier`, `visualTier?: VisualTier` — progressive basis (finalized incrementally across the detect → decompose span) |
| `BasisOption` | `id`, `label: { en, ko }` — UI dropdown option |
| `TECH_TIER_LANGUAGES` | `BasisOption[]` — language selection constants (typescript, go) |
| `TECH_TIER_FRAMEWORKS` | `Record<string, BasisOption[]>` — per-language framework selection constants |
| `VISUAL_TIER_DESIGN_SYSTEMS` | `BasisOption[]` — design-system selection constants (currently an empty array) |
| `buildBasisPreset()` | `(opts) => Basis` — creates a basis preset from the UI |
| `InferWorkspaceState` | Infer-path helper: `hasFigmaConfig?`, `hasPrd?`, `hasDesignDoc?`, `hasSpecDocs?`, `targetFiles?` |
| `resolveToRAC()` | `(intentId, slots?, source?, basis?) => ResolvedActionContext` — mode/intentGroup derived via `deriveFromIntent()` |
| `mergeWithMetadata()` | `(inferred, metadata?) => { intentId, target?, refs?, context?, domain?, basis? }` — supplements metadata on the infer path |
| `mergeTechTier()` | `(preset?, inferred?) => TechTier` — preset fields win; empty fields are filled from inferred |
| `getTechTier()` | `(state) => TechTier \| undefined` — helper for reading RAC.basis.techTier |
| `getBasis()` | `(state) => Basis \| undefined` — helper for reading RAC.basis |
| `buildTechTier()` | `(profile?, stack?, taskProfile?) => TechTier` — used by decompose |
| `isFigmaPipeline()` | `(intent, figmaPopulated) => boolean` |

**RAC field details**

| Field | Type | Notes |
|------|------|------|
| `intent` | `IntentId?` | Valid intent ID |
| `intentGroup` | `IntentGroup?` | Derived from `deriveFromIntent()` |
| `mode` | `Mode` | Derived from `deriveFromIntent()` |
| `target`, `refs`, `context` | `string[]?` | File slots |
| `artifacts` | `ResolvedArtifact[]?` | role-labeled artifacts (preferred) |
| `documents` | `ResolvedArtifact[]?` | @deprecated — use `artifacts` |
| `basis` | `Basis?` | progressive basis — techTier (decompose/preset), visualTier (reserved) |
| `domain` | `DesignDomain?` | design-system only |
| `source` | `'explicit' \| 'infer'` | Creation path |

**Removed items**: `resolveFromExplicit()`, `resolveFromInfer()`, the 6
`synthesize*()` functions, `TechContext`, `ResolvedDocument`,
`buildTechContext()` — replaced by the single `resolveToRAC()` funnel and the
`TechTier` split.

### action-config-matrix.ts

Intent → (refs, context, target) mapping. The SSOT for both the FE
(`ActionConfigView`) and the BE (`resolve` node).

| Type | Definition |
|------|------|
| `ConfigSlots` | `refs: SlotDef[]`, `context: SlotDef[]`, `target: TargetDef`, `basis?: BasisSlotConfig`, `chatRequiresRefs?`, `buildRequiresRefs?`, `buildRequiresContext?`, `buildDisabled?`, `refsSingleSelect?` |
| `BasisSlotConfig` | `techTier?: boolean`, `visualTier?: boolean` — BasisWizard rendering conditions |
| `SlotDef` | `path`, `label`, `type: 'dir'\|'file'`, `required`, `locked?`, `excludeSelectedRefs?`, `createIntent?`, `humanLabel?`, `codebase?`, `excludeFiles?` |
| `TargetDef` | `kind: 'generate'\|'revise'\|'codebase'\|'chat-only'` + kind-specific fields |
| `OutputSpec` | `prefix`, `ext`, `label`, `isPattern`, `warnIfExists?` |

#### Activation Policy

`deriveChatNeedsRefs`: default = `deriveBuildNeedsRefs`. Overridden by
`chatRequiresRefs`.
`deriveBuildNeedsRefs`: true when real ref slots exist. Opt out with
`buildRequiresRefs: false`.

For the resolved matrix (all 30 intents), see
[32-action-activation-policy.md](./32-action-activation-policy.md).

#### Target Resolution Rules (explicit)

The UI (`ActionConfigView`) sets `actionMetadata.target` at intent selection time.
On the explicit path, a missing target is a system error (except codebase /
chat-only).

| TargetDef kind | `actionMetadata.target` | When |
|---|---|---|
| `revise` | Same as the refs array (toggleFile synchronization) | On refs selection |
| `generate` | `["{dir}/{prefix}{ext}"]` | On intent selection |
| `codebase` | None (not applicable) | — |
| `chat-only` | None (chat response) | — |

`refsSingleSelect`: when set to true on `ConfigSlots`, only one ref can be
selected (e.g. rev-plan). `required`: a `SlotDef` field — when true, auto-select
when the file exists + amber warning when it doesn't; when false, manual
selection + gray display.

### Intent & Mode Philosophy (Phase 6+)

| Concept | Description |
|------|------|
| **Intent** | An opaque string key (intent ID). The primary axis for pipeline branching and template selection. `INTENT_DEFINITIONS` is the SSOT. |
| **Mode (`Mode`)** | `generate` \| `refactor` \| `explain` — a **universal vocabulary**, not a per-Job contract. Not every Job implements all three modes. |
| **`intentGroup` (`IntentGroup`)** | Universal enum spanning all Jobs: `plan`, `design-system`, `design-ui`, `design-spec`, `code`, `visual`, `learn-codebase`, `ask`. Derived from `deriveFromIntent()`. |
| **Intent naming** | **Prefix patterns**: `gen-*` (generate), `rev-*` (revise), `explain-*`, `ask-*`, etc. Code is split by output path into `gen-code-sys` / `gen-code-spec` / `gen-code-directive`. |

**Full intent ID list (27 per `INTENT_DEFINITIONS`)**

| intentGroup | Intent IDs |
|-------------|-----------|
| plan (3) | `gen-plan`, `rev-plan`, `explain-plan` |
| design-system (5) | `gen-sys-fe`, `gen-sys-be`, `gen-sys-full`, `rev-sys`, `explain-sys` |
| design-ui (4) | `gen-ui-figma`, `gen-ui-desc`, `rev-ui`, `explain-ui` |
| design-spec (3) | `gen-spec`, `rev-spec`, `explain-spec` |
| code (4) | `gen-code-sys`, `gen-code-spec`, `gen-code-directive`, `explain-code` |
| visual (2) | `gen-visual`, `explain-visual` |
| learn-codebase (1) | `gen-learn` |
| ask (3) | `ask-evaluate`, `ask-ant`, `ask-general` |

**Mode (`Mode`) vs contract**: `Mode` is a cross-job term used in docs, prompts,
and detection; the actually supported combinations follow `deriveFromIntent()`
and each Job graph's implementation.

**Count summary**: per-intentGroup intent counts are plan 3 · design-system 5 ·
design-ui 5 · design-spec 3 · code 5 · visual 2 · learn-codebase 1 · ask 3, for a
total of **27 unique intent IDs in `INTENT_DEFINITIONS`**. The 6 cross-domain
explain intents (`explain-*`) are already included in the corresponding
intentGroup rows above.

### figma.ts

Figma data configuration and MCP integration types. Used by both the Design Job
and the Code Job.

| Type/Function | Definition |
|-----------|------|
| `FigmaDataConfig` | `{ file: string \| null }` — a single Figma URL (canonical path: `visual/ui/figma/figma.json`; the schema contains only the URL and never stores exploration results) |
| `FigmaMCPTool` | `'get_metadata' \| 'get_design_context' \| 'get_screenshot' \| 'get_variable_defs'` |
| `MCPToolResult` | MCP tool execution result (`content`, `isError`) |
| `FigmaExplorationResult` | `variationMatrix`, `annotations`, `componentStateMatrix`, `variableDefs`, `totalFrameCount`, `downloadedAssets`, `nodeSummary`, `explorationErrors` |
| `FigmaNodeSummary` | Node summary (`nodeId`, `name`, `type`, `depth`, `childCount`, `dimensions`, `isComponent`) |
| `VariationMatrixEntry` | Per-section frame variation matrix |
| `ComponentStateEntry` | Component state/variant matrix |
| `createEmptyFigmaData()` | Creates an empty FigmaDataConfig |
| `isFigmaDataPopulated()` | Determines whether a Figma URL is present |
| `migrateFigmaConfig()` | Migrates legacy `files: string[]` → `file: string \| null` |
| `extractFigmaUrlParts()` | Extracts fileKey/nodeId from a URL |

### bridge.ts

Ant Desktop bridge protocol. The WebSocket communication contract between ant-cli
(cloud), ant-ui (frontend), and ant-desktop (desktop app).

| Type/Constant | Definition |
|-----------|------|
| `BRIDGE_WS_PATH` | `/bridge/ws` |
| `BRIDGE_HEARTBEAT_INTERVAL_MS` | 30,000ms |
| `BRIDGE_HEARTBEAT_TIMEOUT_MS` | 90,000ms |
| `BRIDGE_MCP_REQUEST_TIMEOUT_MS` | 30,000ms |
| `BridgeCapability` | `'figma-mcp'` |
| `BridgeMessage` | Union of Register, Heartbeat, Disconnect, StatusProbe, MCPRequest, MCPResponse |
| `BridgeSessionStatus` | `'detected' \| 'connected' \| 'disconnected'` |
| `BridgeSession` | `userId`, `machineId`, `capabilities`, `connectedAt`, `lastPingAt`, `status`, `figmaDesktopReachable` |
| `BridgeStatusResponse` | `connected`, `detected`, `session`, `figmaDesktopReachable` |

### canonical.ts

The SSOT for the Feature directory structure. Every canonical directory/file is
defined in one place together with a domain visibility tag (`ui:plan`,
`ui:architecture`, `ui:visual`, `ui:assets`, `ui:meta`, `internal`), and derived
constants are computed from this array.

| Type/Function | Definition |
|-----------|------|
| `CANONICAL_FEATURE_DIRS` | Array of all canonical directory paths (`plan` / `architecture/{system,spec}` / `visual/{ui,game-art}/...` / `assets/...` / `meta/{directives,evals}/...` / `sessions/...`) |
| `CANONICAL_FEATURE_FILE_PATHS` | Array of canonical file paths (`visual/ui/figma/figma.json`). The `UiSource` enum (`ant` \| `figma` \| `handoff`), `ARTIFACT_PREFIX.UI_ANT / UI_FIGMA / UI_HANDOFF / UI_ANT_SPEC`, `FIGMA_CONFIG_PATH`, and `uiSourceOfPath()` are also exported from this module. |
| `UI_VISIBLE_TOP_LEVEL_DIRS` | Domain top-level directories shown in the ArtifactsPanel (`{ name, visibility }` tuples; unified into a single export because the primary classification axis is domain semantics). |
| `UI_VISIBLE_FILES` | File names shown in the ArtifactsPanel (derived from the `ui:*` entries of CANONICAL_FILE_DEFS). |
| `isCanonicalDir()` | O(1) check whether a relative path is a canonical directory |

### org.ts

Shared types for the Org model. `OrganizationKind` (`local` \| `individual` \|
`team`), the `INDIVIDUAL_ORG_ID` / `LOCAL_ORG_ID` / `LOCAL_USER_ID` constants, and
`deriveKindFromOrgId(orgId)` (fallback classifier for tokens lacking a kind).
FE/BE share kind branching and magic-string consistency. Full model:
[40-org-model.md](40-org-model.md).

### deploy.ts

Shared deploy types. `DeployPhase` / `DeployFramework` / `DeployStatus` /
`DeployStatusPackage` / `DeployLogEntry` + `DeployVisibility` (`public` \|
`private`, absent = public). visibility exists only at the `DeployStatus`
aggregate level (not per-package).

## Boundaries

- Usage in the frontend: [30-frontend-architecture.md](30-frontend-architecture.md)
- Usage in the backend: [11-agent-architecture.md](11-agent-architecture.md)
- Feature directory structure: [20-workspace-isolation.md](20-workspace-isolation.md)
- Figma integration infrastructure: [26-figma-integration-infra.md](26-figma-integration-infra.md)
