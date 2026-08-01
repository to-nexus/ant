# Design Pipeline

## Overview

The two surfaces of the Design Job — **UI Design** (service domain only) and **Game-Art Design** (game domain only) — share the same graph (`detect → decompose → execute ⇄ tool`) but are sibling pipelines with different outputs, asset pools, and decision tags. The two surfaces are **vertically split by domain** (D28) — only one surface is active per workspace.

### Surface Split (D17 / D18 / D28)

- **UI Design** (`intentGroup === 'design-ui'`) — outputs `visual/ui/{ant,figma,handoff}/...` (3-source canonical). LLM decision tag `<visualTier>`. basis tier `[visualTier]`. **Active only for domain=`service`** (D28 — `TIER_DOMAIN_MATRIX.visualTier === ['service']`, ActionDefinition.domainGate=['service']). Intents: `gen-ui-figma` / `gen-ui-desc` / `rev-ui` / `explain-ui`.
- **Game-Art Design** (`intentGroup === 'design-game-art'`) — outputs `visual/game-art/ant/{game-art-tokens,game-art-assets,game-art-spec}.json` (D24-revised v8 — sub-sourced canonical, isomorphic with `visual/ui/ant/`; `figma/`/`handoff/` are Phase 5+ hooks). LLM decision tag `<gameArtTier>`. basis tier `[gameArtTier]`. **Active only for domain=`game`** (D22/D28 — `TIER_DOMAIN_MATRIX.gameArtTier === ['game']`, ActionDefinition.domainGate=['game']). Intents: `gen-game-art-figma` / `gen-game-art-desc` / `rev-game-art` / `explain-game-art`.

The two surfaces are **vertically split by domain** (D28) — a game workspace activates only the game-art surface, a service workspace only the UI surface. A game's HUD / menus / controls are not a separate output (`visual/ui/...`); they are cataloged in a unified way inside the HUD CSS tokens of `game-art-tokens.json` plus the `hud` / `menu` / `dialog` categories of `game-art-spec.json` (naturally absorbed by D25's dictionary format).

### Asset Surface Boundary (I6)

Asset pools are split 1:1 by domain:

- `assets/service/{icons,images,fonts,misc}` — `ui-assets.json` (domain=service only)
- `assets/game/{icons,images,entities,particles,projectiles,sfx,bgm,tilemaps,atlas,models}` — `game-art-assets.json` (domain=game only, HUD assets + game assets unified)

Cross-pollution is prohibited: lint fails if a `ui-assets.json` src starts with `assets/game/...`, or if a `game-art-assets.json` `kind: 'external'` src starts with `assets/service/...`. Regression guards — `tests/asset-surface-boundary.test.ts` + production validator `infrastructure/workspace/gameArtAssetValidator.ts` (Phase 2).

### Domain-Surface Boundary (I7-revised — D28)

Lint fails if UI-surface vocabulary such as `visualLanguage` / `surfaceSystem` / `spatialSystem` appears in a game-art design template body (explicit boundary disclaimers wrapped in backticks are allowed). Conversely, art vocabulary such as `sprite tween` / `oscillator` / `particle system` appearing in a UI design template also fails. Regression guards — `tests/game-art-design-surface.test.ts` + `tests/domain-surface-boundary.test.ts` (18 cases: matrix / action cards / code-intent ref/ctx routing / zero impact on the service domain).

### Naming Unification (D28 — `art-*` → `game-art-*`)

Output directories / files / canonical / ARTIFACT_PREFIX / tier name (`gameArtTier`) are all on the `game-art-*` SSOT, but before v7 the intents / IntentGroup / prompt directories / injections / code files still carried `art-*` remnants. D28 aligned them via a hard rename.

---

# UI Design Pipeline

The UI Design pipeline is the document-generation pipeline that runs when a design job has `intentGroup === 'design-ui'`. There are two mutually exclusive source modes (by-desc, by-figma), and both produce the same output (ui-tokens.json, ui-assets.json, ui-spec.json).

## Source Modes

### Mode Decision

The `detect` node decides the pipeline via `resolvedAction.intent` and the `isFigmaPipeline()` helper.

```
isFigmaPipeline(resolvedAction.intent, isFigmaDataPopulated(figmaConfig))
  intent === 'gen-ui-figma'                       →  figma pipeline
  intent === 'rev-ui' && figmaConfig populated    →  figma pipeline
  otherwise (gen-ui-desc, rev-ui, etc.)           →  description (by-desc) pipeline
```

The Figma pipeline takes precedence. Figma mode is entered when the intent is `gen-ui-figma`, or when figma.json is populated for `rev-ui`.

`visual/ui/handoff/` (free-form visual materials) is used only as additional context for the code job's multimodal channel, not as a design-job decompose input. The design job itself proceeds in by-desc mode with directive + PRD only.

### Input/Output Summary

| Item | by-desc | by-figma |
|------|---------|----------|
| Input source | Directive + PRD (`plan/`) | `visual/ui/figma/figma.json` config |
| Auxiliary input | `assets/` (user-provided) | `assets/` (user-provided) |
| Output | `visual/ui/ant/{ui-tokens,ui-assets,ui-spec}.json` | Same |
| Document dependency chain | tokens ∥ assets → spec | Same |

## Common Structure

The execution structure both modes share:

### Graph Flow

```
detect
  → [figma mode] figmaExplore → decompose → plan → execute ⇄ tool → checkTaskStatus → ...
  → [ref mode]                   decompose → plan → execute ⇄ tool → checkTaskStatus → ...
```

### Task Decomposition (decompose)

decompose performs per-document chaptering:

- ch1~chN: ui-tokens (no dependencies, chapters run in parallel)
- ch1~chN: ui-assets (no dependencies, parallel with tokens, chapters sequential)
- ch1~chN: ui-spec (references ui-tokens + ui-assets, multiple chapters depending on complexity)

Each chapter enters the taskQueue as a DesignTask and runs the plan → execute → tool loop individually.

### Document Generation (execute)

Generates JSON documents via XML streaming. New files via the `<file>` tag, extending existing files via the `<append>` tag. Task completion is declared with the `<done>true</done>` signal. Multi-turn conversation based on conversationHistory, including tool calling.

`<append>` handling for JSON files is done by `FileRenderer.handleDesignAppend`, which merges the existing JSON with the new JSON via `deepMerge` (objects merged recursively, arrays concatenated, primitives source-wins).

### Large-Document Strategy

When continuing chapters, the full content of the existing document is not injected into the prompt. Instead:

- `previousChaptersSummary`: only the list of existing top-level keys/section names is injected (to prevent duplication)
- `lastSectionNumber`: the previous last section number (guarantees consecutive numbering)
- `sectionPattern`: the structural pattern of the existing document (`top-level` or `nested`)
- If the LLM needs detailed confirmation, it drills into specific ranges via `read_file`

In refactor mode (modifying existing sections), the full file is likewise not put into the prompt; surgical edits are performed via `read_file` + `edit_file`.

### Document Authority (Code Job contract)

The authority level, in the Code Job, of the documents the Design Job produces:

- **ui-tokens.json**: SSOT — the sole source of visual values. No fallback
- **ui-assets.json**: SSOT — the sole source of asset paths. No fallback
- **ui-spec.json**: Primary — the primary reference for layout. Details on which the spec is silent follow framework best practices

## The by-desc Pipeline (Description / Directive based)

### Methodology

The LLM writes the design tokens, asset structure, and UI spec directly from the directive + PRD / source documents alone. Without multimodal visual input, the directive's explicit requirements and PRD intent are the design authority.

### Data Flow

```
plan/ + directive (+ visualTier)
  → detect: workspace scan for directive + PRD / asset counts only
  → decompose: complexity assessment based on PRD volume + visualTier → taskQueue
  → execute: buildResourcesSummary(directive/PRD/assets) → injected into the LLM prompt
  → LLM: generates JSON documents directly (calls only list_assets / read_file as needed)
```

### Tool Set (TOOL_SETS.uiDesign)

| Tool | Role |
|------|------|
| `list_assets` | List assets/ files |
| `read_file` | Read existing documents, PRD |
| `edit_file` | Modify documents |
| `list_files`, `delete_file`, `mkdir` | File manipulation |

### Prompt Templates

```
templates/jobs/design/nodes/execute/
  variants/ui-design-by-desc/{base,rules}.md
  injections/
    ui-tokens-guide-by-desc.md       ← token authoring guide
    ui-assets-guide-by-desc.md       ← asset classification guide
    ui-spec-guide-by-desc.md         ← spec authoring guide

templates/jobs/design/nodes/decompose/
  variants/ui-design-by-desc/{base,rules}.md
```

## The by-figma Pipeline (Figma MCP based)

### Methodology

Extracts design data structurally via Figma Desktop MCP tools. Rather than visually analyzing screenshots, it programmatically interprets node trees, CSS variables, and design variables.

### Graph Flow (with figmaExplore)

```
detect (isFigmaPipeline → true)
  → figmaExplore (Phase 0: programmatic structure exploration + matrix generation)
  → decompose (matrix-based task decomposition)
  → plan → execute ⇄ tool (Phases 1-3: document generation)
```

### Phase 0: The figmaExplore Node

A node that programmatically calls the Figma MCP adapter directly. Without LLM calls or prompt templates, code logic explores the Figma file's structure and generates the matrices for subsequent document generation.

Work performed:

- Fetch the page list (based on the fileKey + rootNodeId extracted from the URL in `figma.json`)
- Explore the node tree with `get_metadata`
- Build the **Variation Matrix**: per-section page frames + theme variants (light/dark)
- Collect **Annotations**: text nodes directly under sections (designer notes)
- Build the **Component State Matrix**: variant frames under COMPONENT_SETs + variant parsing
- Build the **nodeSummary**: converts the node tree into a compact list (guiding the LLM to query specific nodeIds)
- Check design variables with `get_variable_defs`

Output: `state.figmaExplorationResult` + sidecar files `figma-exploration.json`, `figma-exploration-debug.json`

Tool set: `TOOL_SETS.figmaExplore` (`read_file`, `edit_file`, `list_files`, `mkdir`, `figma_get_metadata`, `figma_get_design_context`, `figma_get_screenshot`, `figma_get_variable_defs`)

### figmaExplore Core Algorithms

**nodeSummary generation** (`scanAllNodes` + `buildNodeSummary`):

- `NODE_SUMMARY_MAX_ENTRIES = 300` — adaptive depth based on an entry budget
- Starts at depth 0 and collects to the maximum depth within budget
- Node types collected: `NODE_SUMMARY_TYPES` (FRAME, COMPONENT, COMPONENT_SET, INSTANCE, GROUP, SECTION, TEXT, VECTOR, BOOLEAN_OPERATION)
- Each entry includes `dimensions` (width/height) and an `isComponent` flag

**Component State Matrix** (`buildComponentStateMatrix`):

- Iterates over the children of COMPONENT_SET nodes
- The `parseVariantName(name)` function parses the "Property1=Value1, Property2=Value2" format into `VariantProperty[]`
- Result: `ComponentStateEntry.variantAxes` (list of property names), `frames[].variantProperties` (per-frame variant values)

**Variable Definitions** (`extractVariableDefsSummary`):

- Summarizes `get_variable_defs` results (variable counts per collection)
- If `modes` or `valuesByMode` keys exist, the mode list is also preserved
- Token budget: switches to a summary when `MAX_VARIABLE_DEFS_TOKENS = 8000` is exceeded

### Phase 1: Generating ui-tokens.json

- Extract CSS variable definitions from the code returned by `get_design_context`
- Identify light/dark pairs in the Variation Matrix and call both
- Derive dual-theme tokens by comparing CSS variable fallback values
- Use `get_variable_defs` data (spacing, sizing, color)
- Mode support: when Figma variables have modes/valuesByMode, the per-mode value structure is preserved

### Phase 2: Generating ui-assets.json

- Asset classification based on user-provided assets/
- Asset categories: iconLibrary, icons, images, dynamicAssets
- figmaNodeId recorded as mandatory (for re-export)
- Includes the rendering field and SVG themeAdaptation

### Phase 3: Generating ui-spec.json

- Individual `get_design_context` call for every frame in the Variation Matrix
- Individual calls for every frame in the Component State Matrix
- Shared-component extraction (patterns repeated across 2+ pages)
- Minimum component depth validation

### Data Flow

```
visual/ui/figma/figma.json
  → resolve: load state.figmaConfig
  → detect: isFigmaPipeline(intent, figmaPopulated) → true
  → figmaExplore: direct MCP adapter calls → state.figmaExplorationResult
  → decompose: matrix-based complexity assessment → taskQueue
  → execute: buildResourcesSummary(figmaExplorationResult) → injected into the LLM prompt
  → LLM: extracts detailed data via figma_get_design_context etc. → generates JSON documents
```

### Tool Set (TOOL_SETS.uiDesignFigma)

| Tool | Role |
|------|------|
| `figma_get_metadata` | Node tree structure (XML) |
| `figma_get_design_context` | Detailed design data (code + screenshot + hints) |
| `figma_get_screenshot` | Node screenshot |
| `figma_get_variable_defs` | Figma Variables definitions |
| `list_assets` | List assets/ files |
| `download_asset` | Download an asset |
| `read_file` | Read existing documents, PRD |
| `edit_file` | Modify documents |
| `list_files`, `delete_file`, `mkdir` | File manipulation |

### Prompt Templates

```
templates/design/phases/execute/
  base-ui-design-by-figma.md         ← top-level template (WHAT)
  rules-ui-design-by-figma.md        ← mode rules (HOW)
  injections/
    ui-tokens-guide-by-figma.md      ← MCP-based token extraction guide
    ui-assets-guide-by-figma.md      ← asset mapping guide
    ui-spec-guide-by-figma.md        ← matrix-based spec authoring guide
    ui-continuation-by-figma.md      ← continuation guidance

templates/design/phases/decompose/
  base-ui-design-by-figma.md         ← decompose template
  rules-ui-design-by-figma.md        ← decompose rules
```

## Template Structure

### Two-Layer Split (by-desc / by-figma)

by-desc and by-figma each have an independent rule set. Common rules are managed without duplication within each rules file.

### Code-Layer Branching (execute/intent/ui.ts)

```
buildUiDesignSystemPrompt():
  isFigmaPipeline(resolvedAction.intent, figmaPopulated)
    → 'jobs/design/nodes/execute/variants/ui-design-by-figma/base'
    → figmaExplorationResult variables injected
  otherwise
    → 'jobs/design/nodes/execute/variants/ui-design-by-desc/base'

buildResourcesSummary():
  figma pipeline → MCP tool guidance + matrix summary + asset counts
  desc pipeline  → directive / PRD / asset count guidance
```

Tool set selection in execute/index.ts:

```
isFigmaPipeline(intent, figmaPopulated) → TOOL_SETS.uiDesignFigma
otherwise                               → TOOL_SETS.uiDesign
```

### nodeSummary LLM Display (buildNodeSummaryDisplay)

When displaying the nodeSummary in the execute prompt, the strategy varies with token size:

- At or below `NODESUMMARY_TOKEN_THRESHOLD = 2500`: display the full nodeSummary as-is (dimensions, isComponent shown per node)
- Above it: switch to a structural outline — depth 0-1 nodes + COMPONENT_SET/SECTION nodes only + child-node counts

### nodeSummary Tool-Result Truncation (toolResultManager)

When results of tools like figma_get_metadata are large, `buildFigmaChildOutline` condenses child nodes into an outline. Each child node includes dimensions information to support layout judgment.

## Figma Integration Infrastructure

→ Details: [26-figma-integration-infra.md](26-figma-integration-infra.md) (detection/auth/connection flow, MCP transport paths, frontend state determination)

### visual/ui/figma/figma.json (canonical)

The single canonical reference file for Figma integration (`FIGMA_CONFIG_PATH`). Auto-created as an empty document at feature creation, and stores nothing beyond URL/fileKey/nodeId metadata — no exploration results.

```json
{
  "files": [
    "https://www.figma.com/design/ABC/My-Design?node-id=0-1"
  ]
}
```

Type: `FigmaDataConfig` (`@ant/shared/figma.ts`). `files` is an array of Figma URL strings, and `parseFigmaUrl()` extracts fileKey and nodeId.

The legacy format (array of objects, with config) is auto-converted by `migrateFigmaConfig()`.

### Figma Integration Condition (All-or-Nothing)

Figma mode requires full MCP access. `detect` verifies MCP availability. When MCP is incomplete, the job is blocked with a `designError` and the user is guided to complete the integration. For MCP transport paths (local/cloud), see [26-figma-integration-infra.md](26-figma-integration-infra.md).

### FigmaExplorationResult

The output type of the figmaExplore node. Defined in `@ant/shared/figma.ts` and stored in DesignGraphState.

```typescript
interface FigmaExplorationResult {
  variationMatrix: VariationMatrixEntry[];
  annotations: AnnotationEntry[];
  componentStateMatrix: ComponentStateEntry[];
  variableDefs?: unknown;
  totalFrameCount: number;
  downloadedAssets: string[];
  nodeSummary?: FigmaNodeSummary[];
}
```

`ComponentStateEntry` includes `variantAxes?: string[]` and `frames[].variantProperties?: VariantProperty[]`, and `parseVariantName()` extracts structural data from variant names.

`FigmaNodeSummary` includes the `dimensions?: { width: number; height: number }` and `isComponent?: boolean` fields.

### Known Constraints

- `downloadedAssets` is currently always an empty array. Automatic asset download is unimplemented; the user places assets manually in `assets/`
- figmaExplore operates as a pure code node without prompt templates (there is no `templates/design/phases/explore/` directory)

## Consumption in the Code Job

→ Details: the "UI Design Document Consumption" section of [14-code-job.md](14-code-job.md)

Design Job outputs (ui-tokens.json, ui-assets.json, ui-spec.json) are loaded in the Code Job via `ArtifactService.loadParsedUiContext()`, and `UiDocParser` splits ui-spec.json into logical sections in memory so that only the parts each task needs are injected.

---

# Game-Art Design Pipeline

The Game-Art Design pipeline is the document-generation pipeline that runs when a design job has `intentGroup === 'design-game-art'`. Its card appears in the ActionsPanel only when the workspace domain is `game` (D22 matrix gate). When the domain is `service`, this entire section is inactive.

## Outputs / Asset Pool

Direct comparison with UI Design:

| Item | UI Design | Game-Art Design |
|------|-----------|-----------------|
| intent | `gen-ui-figma` / `gen-ui-desc` / `rev-ui` / `explain-ui` | `gen-game-art-figma` / `gen-game-art-desc` / `rev-game-art` / `explain-game-art` |
| Active domain (D28) | service only | game only |
| Outputs | `visual/ui/{ant,figma,handoff}/...` (3-source canonical) | `visual/game-art/ant/{game-art-tokens,game-art-assets,game-art-spec}.json` (D24-revised v8 — sub-sourced canonical; `figma/`/`handoff/` are Phase 5+ hooks) |
| Active asset pool | `assets/service/{icons,images,fonts,misc}` | `assets/game/{icons,images,entities,particles,projectiles,sfx,bgm,tilemaps,atlas,models}` (HUD assets + game assets unified) |
| LLM decision tag | `<visualTier>` | `<gameArtTier>` (visualTier not emitted, D18) |
| basis tier | `[visualTier]` | `[gameArtTier]` |

## Decomposition (`decomposeGameArtDesign`)

`packages/ant-cli/src/agents/architect/graph/design/nodes/decompose/gameArtDesignDecompose.ts` is entered when `intentGroup === 'design-game-art'`. Differences from UI decomposition:

- **Category dictionary decomposition (D25)**: the sub-sections of `game-art-spec.json` / `game-art-assets.json` are not chapters (page regions) but a dictionary of category keys (`effects` / `characters` / `projectiles` / `npcs` / `objectives` / `hud` / `menu` / `dialog`, etc. — with D28, the HUD area also lives in the same dictionary). The standard-category guide is provided only in the prompt overlay; the schema does not enforce it.
- **Task decomposition**: a single `game-art-tokens` task + `game-art-assets-{category}` parallel + `game-art-spec-{category}` parallel. The set of categories is decided dynamically by the LLM based on the game context (the PRD's genre/core-loop prose + `gameArtTier.entityCatalog`).
- **RAC pool**: `plan/` + `visual/game-art/ant/` (D28 — cross-surface context via UI ant docs is retired; the game domain has the single game-art surface).
- **Decision tag**: `<gameArtTier>` in the response is absorbed via `parseDecisionTags` and applied to `state.resolvedAction.basis.gameArtTier` (explicit values take precedence, LLM fill comes second).

## Modes (`game-art-design-by-desc` / `game-art-design-by-figma`)

1:1 correspondence with UI Design's two modes (by-desc / by-figma). Mode decision is an `intent` mapping:

- `gen-game-art-desc` / `rev-game-art` (figma not connected) → by-desc mode
- `gen-game-art-figma` → by-figma mode (exploring game-art assets / concept boards via Figma MCP)

Tool sets are `TOOL_SETS.gameArtDesign` (by-desc) and `TOOL_SETS.gameArtDesignFigma` (by-figma) — same shape as the UI-side tool sets, but the authoring targets change to `game-art-*.json`.

## Asset entries — `kind: 'inline' | 'external'` (D20/D21)

Entries in `game-art-assets.json` come in two kinds:

| `kind`     | Origin                                                   | Design-time inline-payload ceiling (D21) |
|------------|--------------------------------------------------------|------------------------|
| `inline`   | Authored directly by the LLM inside the JSON (`css` / `svg` / `oscillator`) | ✅ Simple shapes / simple sounds only (D21) — the complexity ceiling of what design can author inline |
| `external` | Files the user placed under `assets/game/{cat}/`      | All production assets (mp3 / png / 3D models, etc.) |

D21's "css-only" wording refers to the complexity ceiling of design-time inline payloads and is separate from the code job's canvas rendering policy (the engine canvas cannot create assets from CSS, so the code job commits a separate "available canvas methods" catalog — see `templates/jobs/code/basis/gameArtTier/_preamble.md` §7).

Runtime validation:

- `validateAssetReferences` disk-validates only `kind: 'external'` src paths; `kind: 'inline'` is skipped (the `extractGameArtExternalSrcs` helper in `design/graph.ts`).
- `infrastructure/workspace/gameArtAssetValidator.ts` enforces the D20 + I6 invariants as a programmatic backstop — throws when a `kind: 'external'` src starts with the service pool, issues when outside the game pool, issues when nonexistent. Regression guard `tests/art-asset-validation.test.ts` (9 cases).

## Scope Markers (`_meta.audioScope` / `_meta.visualScope` — D21)

`game-art-assets.json` carries two independent scope markers (splitting the earlier single `_meta.phaseScope`):

| Marker | Values | Effect |
|---|---|---|
| `_meta.audioScope` | `'procedural-only'` (default) / `'external-enabled'` | `'procedural-only'` suppresses external audio (`sfx`/`bgm`) at code time — procedural OscillatorNode is the only audio path. `'external-enabled'` enables external audio loading. |
| `_meta.visualScope` | `'baseline'` (default) / `'atlas-enabled'` | `'baseline'` allows cataloged inline / single external images + engine procedural APIs + build-time static assets + runtime procedural texture synthesis. Atlas / multi-emitter / multi-projectile groups are blocked. `'atlas-enabled'` enables them. Image-LLM calls / inserting image-LLM output assets is an absolute cut across both values. |

The two markers are orthogonal — their decision surfaces differ, so pairing `audioScope: 'external-enabled'` with `visualScope: 'baseline'` (or the reverse) is also legal. The code job prioritizes the `audioScope` marker over an LLM-emitted `audioProfile` (protecting the baseline boundary). For the full contract, see `templates/jobs/code/basis/gameArtTier/_preamble.md`.

## Tool Routing (D22 — `pickAssetsRoot`)

The two tools `download_asset` / `list_assets` route only to the domain-keyed pool:

```
workspaceDomain  ?? racDomain
  ?? (intentGroup === 'design-game-art' ? 'game' : 'service')
  ?? 'service'
```

The pure helper `pickAssetsRoot` is exported from `infrastructure/...handlers/assets.ts` — regression guard `tests/assets-handler-routing.test.ts` (12 cases) guarantees surface isolation (a service workspace never routes to the game pool).

## Boundaries

- Design Job overview: [15-design-job.md](15-design-job.md)
- Figma integration infrastructure: [26-figma-integration-infra.md](26-figma-integration-infra.md)
- Code Job consumption of UI/Game-Art documents: [14-code-job.md](14-code-job.md)
- Prompt system: [13-prompt-system.md](13-prompt-system.md)
- Shared contract types: [01-shared-contracts.md](01-shared-contracts.md)
