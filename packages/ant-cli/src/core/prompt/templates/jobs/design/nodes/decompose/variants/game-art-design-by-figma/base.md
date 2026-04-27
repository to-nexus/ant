# Game-Art Design Task Decomposition (Figma)

You are decomposing **game-art documentation work** into executable tasks.

**Surface scope (D17/D18)**: This intent produces `game-art-tokens.json` /
`game-art-assets.json` / `game-art-spec.json` only. UI surface decisions
(`visualLanguage` / `surfaceSystem` / chapter-style page regions) are NOT
in scope here.

**Source mode**: Figma — components / sprite frames / variables drive
the breakdown via real-time MCP exploration.

**SSOT alignment**: When a GDD is available in source documents, two
SSOT inputs must be aligned:

1. **GDD §8 Content Scope** (`EN-XXX`, `LV-XXX`) — entity / level
   catalog
2. **Figma frames / nodeIds** — visual design surface

Each `EN-` / `LV-` from the GDD MUST map to one or more Figma frames;
pick the frame(s) whose name or annotation best matches the entity
semantically. When the GDD cites a Figma node-id for an entity (e.g.,
`EN-Hero — figma: 1234:5678`), use that exact node-id as the primary
input for that entity. When the GDD does not cite figma but `EN-` IDs
exist, pick the matching frame from the Figma exploration result and
record the chosen mapping in the task description as
`EN-<name> ↔ figma:<nodeId>`. When the GDD lacks `EN-` IDs (legacy or
absent), fall back to Figma frame names alone, but flag the gap
(`GDD lacks EN- IDs — categories extracted from Figma frame names`)
in each task description.

The directive **supplements** both inputs; it does NOT override them.

**Job Mode**: {{detectedMode}}

{{#if (eq detectedMode "refactor")}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REFACTOR MODE - Modify Existing Game-Art Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Principle**: Create ONE focused task for the specific modification requested.

### Constraints

- ❌ Multiple category-based tasks
- ❌ Full document regeneration
- ✅ Single task targeting specific category or token group
- ✅ Task ID format: `refactor-{document}-{category}`
- ✅ Task name format: `Refactor: {brief description}`

### Output Format

```json
{
  "jobMode": "refactor",
  "targetFiles": ["{target-file}.json"],
  "tasks": [
    {
      "id": "refactor-{document}-{category}",
      "name": "Refactor: {brief description}",
      "targetFile": "{target-file}.json",
      "description": "{what to modify}. Keep all other content unchanged.",
      "priority": 300
    }
  ]
}
```

{{else}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE - Create New Game-Art Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are creating NEW game-art design documents from scratch.**

**Philosophy**: One token document; multiple parallel category tasks for
assets and spec. Figma component / frame ids scope each category task.
{{/if}}

---

## 📥 INPUT CONTEXT

### Requirements ({{documentName}})

{{> jobs/design/nodes/decompose/shared/input-context}}

---

## ⚖️ GDD ↔ FIGMA CONFLICT POLICY

{{> jobs/design/shared/asset-conflict-policy}}

---

{{#unless (eq detectedMode "refactor")}}
## 🎯 SELECTIVE DOCUMENT GENERATION

**Check the Directive above for explicit document requests.**

| If directive mentions...                                    | Generate ONLY...        |
|-------------------------------------------------------------|-------------------------|
| "only game-art-spec" / "regenerate game-art-spec"           | game-art-spec.json tasks  |
| "only game-art-tokens" / "regenerate game-art-tokens"       | game-art-tokens.json tasks|
| "only game-art-assets" / "regenerate game-art-assets"       | game-art-assets.json tasks|
| No specific document request                                | ALL 3 documents         |

### Available Resources

| Resource                | Details                                                                  |
|-------------------------|--------------------------------------------------------------------------|
| Figma Exploration Result | Pre-analyzed structure from `figmaExplore` node                          |
| Figma MCP Tools         | `figma_get_design_context`, `figma_get_metadata`, `figma_get_screenshot`, `figma_get_variable_defs` |
| External assets         | `inputs/assets/game/` ({{assetCount}} files placed by user)              |

{{#if nodeSummary}}
### Figma Node Structure (nodeSummary)

Use these nodeIds to scope tasks to specific design areas:

```
{{{nodeSummary}}}
```

**CONSTRAINT**: Assign relevant nodeIds to each task description so the
executor can query specific nodes instead of root.
{{/if}}

{{#if variationMatrixSummary}}
### Frame / Variation Groups

Each line: a Figma section with potential variation (e.g. character
states, projectile flavors).

```
{{{variationMatrixSummary}}}
```
{{/if}}

---

## 📊 CATEGORY-BASED TASK BREAKDOWN

**Game-art docs use categories, not chapters.** Choose categories that
match the Figma structure observed (concept frames → tokens; sprite
frames → entities / particles; effect frames → effects spec).

**Token Safety**: Each task output ≤ 600 lines (~7,200 tokens, with margin
under the 8K cap).

---

### game-art-tokens.json (single task)

| Task ID | Priority | Topic |
|---------|----------|-------|
| `game-art-tokens` | 100 | Palette, silhouette, lighting, motion-tone tokens — derived from **GDD §4 MDA Aesthetic** + **GDD §6 Reward & Feedback** + the Figma color / effect variables when GDD is present; fall back to `gameArtTier.concept` + Figma variables only when GDD is absent. Description MUST cite `GDD §4 / §6` (when GDD present) and the Figma variable groups consumed. |

---

### game-art-assets.json (category-parallel tasks)

**Category derivation**:

- **When GDD §8 Content Scope is present**: one task per `EN-XXX` (or
  `LV-XXX`) cluster from GDD §8, mapped to Figma frames. Category task
  ID prefers GDD entity ID alignment (e.g.,
  `game-art-assets-entities-hero` for `EN-Hero`). Description MUST
  cite (a) the GDD IDs (`Implements GDD §8 (EN-Hero, EN-Hero-Wounded)`),
  (b) the Figma node-id mapping (`Figma: <nodeId list>`), and (c) the
  alignment source (`figma node cited by GDD` / `frame name match: <name>` /
  `unmapped — Figma frame proposes new EN-`).
- **When GDD is absent**: fall back to mapping Figma component sets to
  asset categories — `entities` for character / collectible components,
  `particles` for VFX components, `projectiles` for projectile
  components, etc. Categories with zero items SHOULD be omitted. Flag
  the gap (`GDD absent — categories extracted from Figma frames`) in
  each task description.

| Task ID format | Priority | Topic |
|----------------|----------|-------|
| `game-art-assets-{category}` | 200..249 | Asset entries scoped to one Figma frame group. |

**Figma → asset mapping policy**:

- A Figma component instance with stable variants → `kind: 'external'`
  if a sprite export was placed under `inputs/assets/game/...`,
  otherwise `kind: 'inline'` with simple-shape SVG approximation.
- A Figma effect / overlay frame → `kind: 'inline'` SVG or CSS only.
- **GDD asset citation precedence**: When GDD §8 cites a sprite path
  for a specific `EN-XXX` (e.g.,
  `EN-Hero — sprite: inputs/assets/game/entities/hero.png`), use that
  cited path as the asset's `external` `src` regardless of Figma
  state — the GDD citation is the planner's explicit commitment.

**Asset-source kind policy (D20)** — see rules.md.

---

### game-art-spec.json (category-parallel tasks)

**Category derivation**:

- **When GDD is present**: one task per `MC-XXX` from §4 MDA Mechanics
  or `RW-XXX` from §6 Reward & Feedback. Spec task description MUST
  cite the GDD ID and the Figma frames that visualize the mechanic /
  reward (e.g., `Implements GDD §4 / MC-Combat → Figma: <nodeId list>`).
- **When GDD is absent**: fall back to deriving spec categories from
  Figma frame names that describe behavior (e.g. an "interactions"
  page → `effects` spec; a "states" frame → `characters` spec). Flag
  the gap (`GDD absent — spec categories extracted from Figma frames`)
  in each task description.

| Task ID format | Priority | Topic |
|----------------|----------|-------|
| `game-art-spec-{category}` | 300..349 | Spec entries for one category, referencing asset ids defined above. |

---

## 📏 CATEGORY COUNT GUIDELINES

| Figma project complexity | game-art-tokens | game-art-assets | game-art-spec |
|--------------------------|-----------------|-----------------|---------------|
| Single style guide       | 1 task | 2 categories | 1 category |
| Multi-frame asset pack   | 1 task | 3-4 categories | 2-3 categories |
| Full game pre-production | 1 task | 4-6 categories | 4-6 categories |

**Your resources**: Figma MCP + nodeSummary + external assets={{assetCount}}

{{/unless}}

---

{{! Execute-phase injection guides: static partial refs for manifest/matrix audits; branch never renders. }}
{{#if false}}
{{> jobs/design/nodes/execute/injections/game-art-tokens-guide-by-figma}}
{{> jobs/design/nodes/execute/injections/game-art-assets-guide-by-figma}}
{{> jobs/design/nodes/execute/injections/game-art-spec-guide-by-figma}}
{{/if}}

{{> jobs/design/nodes/decompose/variants/game-art-design-by-figma/rules}}
