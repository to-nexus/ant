## game-art-spec.json Generation Guide (Figma)

### Purpose
Author one category of behavior / motion / policy spec entries in
`game-art-spec.json`. Categories are LLM-decided dictionary keys (D25).
Each Figma frame describing behavior (states / interactions / variants)
maps to one category.

### Surface scope (sub-sourced canonical)
- Output path: `visual/game-art/ant/game-art-spec.json`
- `ant/` is the LLM-generated canonical sub-source (mirrors `visual/ui/ant/`); `figma/` / `handoff/` sub-directories are Phase 5+ hooks. When `handoff/` is activated, its `*-by-handoff.md` variant MUST include `{{> jobs/shared/injections/handoff-code-shape-discipline }}` so the same code-shape vs token-shape discipline that governs UI handoff applies to game-art handoff.

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

### Code-fulfillable floor

The code job must be able to render this behavior with a **primitive stand-in** when no external asset is present — so each entry is authored so the floor still plays:

- Express motion as **numeric fields** (`durationMs` / `tweenMs` / `speedPxPerSec` / `lifetimeMs` — see the conservative-default ranges in the by-desc guide), never as adjectives read off a Figma frame ("fast" / "snappy"). Code drives motion from numbers, so a primitive stand-in animates identically to a production sprite.
- Every entry references an asset `id` that resolves to something renderable as a **primitive at the baseline scope** (a shape via the engine draw API, or an inline payload). Encode the observed motion numerically even when the Figma frame implies richer art, so the floor render remains playable.

### ⚠️ CRITICAL: Scope & Surface Boundary

**🚨 READ YOUR TASK DESCRIPTION — generate ONLY the category it specifies!**

- Each category has its own task
- Do NOT write `visual/ui/...` paths

### JSON Structure (per task — one category)

```json
{
  "_meta": {
    "genre": "<the game's genre, from the PRD Genre & Coreloop section>",
    "coreLoop": "<the player's core loop, from the PRD Genre & Coreloop section>"
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
**Parallel category task**: call `append_file` to merge your category.

```
append_file(path="visual/game-art/ant/game-art-spec.json", content="""
{
  "<your-category>": {
    "<entry-id>": { /* spec */ }
  }
}
""")
```
{{else}}
**First task**: call `create_file` with `_meta`.

```
create_file(path="visual/game-art/ant/game-art-spec.json", content="""
{
  "_meta": {
    "genre": "...", "coreLoop": "..."
  },
  "<your-category>": {
    "<entry-id>": { /* spec */ }
  }
}
""")
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
