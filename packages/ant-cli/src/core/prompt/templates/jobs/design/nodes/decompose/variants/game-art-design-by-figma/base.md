# Game-Art Design Task Decomposition (Figma)

You are decomposing **game-art documentation work** into executable tasks.

**Surface scope (D17/D18)**: This intent produces `game-art-tokens.json` /
`game-art-assets.json` / `game-art-spec.json` only. UI surface decisions
(`visualLanguage` / `surfaceSystem` / chapter-style page regions) are NOT
in scope here.

**Source mode**: Figma — components / sprite frames / variables drive
the breakdown via real-time MCP exploration.

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

{{#if directiveContext}}
### Directive

{{{directiveContext}}}
{{/if}}

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
| `game-art-tokens` | 100 | Palette, silhouette, lighting, motion-tone tokens — derived from `gameArtTier.concept` and the Figma color/effect variables. |

---

### game-art-assets.json (category-parallel tasks)

**One task per asset category present in the Figma file.** Map Figma
component sets to asset categories — `entities` for character /
collectible components, `particles` for VFX components, `projectiles`
for projectile components, etc. Categories with zero items SHOULD be
omitted.

| Task ID format | Priority | Topic |
|----------------|----------|-------|
| `game-art-assets-{category}` | 200..249 | Asset entries scoped to one Figma frame group. |

**Figma → asset mapping policy**:

- A Figma component instance with stable variants → `kind: 'external'`
  if a sprite export was placed under `inputs/assets/game/...`,
  otherwise `kind: 'inline'` with simple-shape SVG approximation.
- A Figma effect / overlay frame → `kind: 'inline'` SVG or CSS only.

**Asset-source kind policy (D20)** — see rules.md.

---

### game-art-spec.json (category-parallel tasks)

**One task per spec category** — derived from Figma frame names that
describe behavior (e.g. an "interactions" page → `effects` spec; a
"states" frame → `characters` spec).

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
