## game-art-spec.json Generation Guide (Figma)

### Purpose
Author one category of behavior / motion / policy spec entries in
`game-art-spec.json`. Categories are LLM-decided dictionary keys (D25).
Each Figma frame describing behavior (states / interactions / variants)
maps to one category.

### Surface scope (D24 — flat structure)
- Output path: `outputs/design/game-art/game-art-spec.json`

### Spec vs Assets distinction (CRITICAL)

| Document               | What it captures                                                      |
|------------------------|------------------------------------------------------------------------|
| `game-art-assets.json` | **Bytes** — visual data: SVG markup, image paths, oscillator configs   |
| `game-art-spec.json`   | **Behavior** — motion, lifecycle, spawn policy, interaction rules     |

Spec entries REFERENCE asset ids; they never duplicate asset bytes.

### Figma → spec mapping

| Figma observation | Spec entry hint |
|-------------------|-----------------|
| Component variants describing state transitions (idle / hover / active) | `<entity>.states: [...]` |
| Effect frames with motion descriptors (durationMs, easing) | `effects.<id>` |
| Interaction prototype connections | `effects.<id>.trigger` |
| Variant of projectile / NPC frame | `<category>.<id>.behavior` |

### ⚠️ CRITICAL: Scope & Surface Boundary

**🚨 READ YOUR TASK DESCRIPTION — generate ONLY the category it specifies!**

- Each category has its own task
- Do NOT write `outputs/design/ui/...` paths

### JSON Structure (per task — one category)

```json
{
  "_meta": {
    "gameContentTier": {
      "genre": "<from resolvedAction.basis.gameContentTier.genre>",
      "coreLoop": "<from resolvedAction.basis.gameContentTier.coreLoop>"
    }
  },
  "<your-category>": {
    "<entry-id>": {
      /* category-specific shape — see by-desc guide for examples */
    }
  }
}
```

`_meta` is written only by the FIRST task.

### Asset-Reference Discipline

Every reference inside a spec entry MUST be the `id` of an asset entry
in `game-art-assets.json` (your sibling task with `figmaNodeId` field).
Cross-reference by id, never by Figma nodeId — the spec is engine-facing,
not Figma-facing.

### Output Format

{{#if forceAppend}}
**Parallel category task**: use `<append>` to merge your category.

```xml
<append path="outputs/design/game-art/game-art-spec.json">
{
  "<your-category>": {
    "<entry-id>": { /* spec */ }
  }
}
</append>
```
{{else}}
**First task**: use `<file>` with `_meta`.

```xml
<file path="outputs/design/game-art/game-art-spec.json">
{
  "_meta": {
    "gameContentTier": { "genre": "...", "coreLoop": "..." }
  },
  "<your-category>": {
    "<entry-id>": { /* spec */ }
  }
}
</file>
```
{{/if}}

### Quality Criteria

1. **Single category** per task
2. **Behavior-only**: no asset bytes here
3. **Asset references valid**: every id matches a `game-art-assets.json` entry
4. **Figma traceability optional**: spec entries MAY include
   `figmaNodeId` for the source frame, but the engine consumer ignores it
5. **No UI surface keywords**: no `visualLanguage`, `surfaceSystem`,
   `spatialSystem`, page-region terms
6. **Valid JSON**

### Workflow

1. `figma_get_design_context` against your task's frame
2. Observe state machines / interaction prototypes / variant motion
3. Encode each entry's behavior, referencing asset ids defined by the
   sibling assets task
