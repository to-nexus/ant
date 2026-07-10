## game-art-spec.json Generation Guide (Directive only)

### Purpose
Author one category of behavior / motion / policy spec entries in
`game-art-spec.json` from a directive only. Categories are LLM-decided
dictionary keys (D25).

### Surface scope (sub-sourced canonical)
- Output path: `visual/game-art/ant/game-art-spec.json`
- `ant/` is the LLM-generated canonical sub-source (mirrors `visual/ui/ant/`); `figma/` / `handoff/` sub-directories are Phase 5+ hooks. When `handoff/` is activated, its `*-by-handoff.md` variant MUST include `{{> jobs/shared/injections/handoff-code-shape-discipline }}` so the same code-shape vs token-shape discipline that governs UI handoff applies to game-art handoff.

### Spec vs Assets distinction (CRITICAL)

| Document               | What it captures                                                      |
|------------------------|------------------------------------------------------------------------|
| `game-art-assets.json` | **Bytes** — visual data: SVG markup, image paths, oscillator configs   |
| `game-art-spec.json`   | **Behavior** — motion, lifecycle, spawn policy, interaction rules     |

Spec entries REFERENCE asset ids; they never duplicate asset bytes.

### Directive → spec mapping

The directive describes intended gameplay behavior. Common signals:

| Directive phrase | Spec entry hint |
|------------------|-----------------|
| "match clears with a sparkle" | `effects.match-clear: { particles: 'spark', ... }` |
| "hero snaps to grid" | `characters.hero: { movement: 'grid-snap', ... }` |
| "arrows fly across the screen" | `projectiles.arrow: { trajectory: 'straight', ... }` |
| "coins are worth 10 points" | `objectives.coin: { rewardScore: 10, ... }` |

Without references, default to **conservative durations and sensible
defaults** — directive-only spec should be playable without polish:

| Field           | Conservative default      |
|-----------------|---------------------------|
| `durationMs`    | 200–400 ms                |
| `tweenMs`       | 100–200 ms                |
| `speedPxPerSec` | 200–600                   |
| `lifetimeMs`    | 1000–2000                 |

### Code-fulfillable floor

The code job must be able to render this behavior with a **primitive stand-in** when no external asset is present — so each entry is authored so the floor still plays:

- Express motion as **numeric fields** (the table above), never as adjectives ("fast" / "snappy" / "juicy"). Code drives motion from numbers, so a primitive stand-in animates identically to a production sprite — the number is the contract, the art is not.
- Every entry references an asset `id` that resolves to something renderable as a **primitive at the baseline scope** (a shape via the engine draw API, or an inline payload). Behavior whose *reading* would need production-grade art must still state its motion numerically, so the floor render remains playable.

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
      /* see Common Patterns in game-art-spec-guide-by-figma */
    }
  }
}
```

`_meta` is written only by the FIRST task.

### Upstream-Reference Discipline (read both catalogs FIRST)

`game-art-tokens.json` (palette/motion/lighting/hud) and
`game-art-assets.json` (asset ids) are both authored before this task.
`read_file` BOTH FIRST, then:

- Every asset reference MUST be the `id` of an entry that actually exists
  in `game-art-assets.json`.
- Every color / motion / lighting / hud reference MUST name a token key
  that actually exists in `game-art-tokens.json` (e.g. `palette.accent`,
  `motionTone.combo.easing`) — do NOT invent keys (`palette.primary.*`
  when the catalog has no such key) or inline raw values that the tokens
  catalog already defines.

### Output Format

{{#if forceAppend}}
**Parallel category task**: use `<append>` to merge your category.

```xml
<append path="visual/game-art/ant/game-art-spec.json">
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
<file path="visual/game-art/ant/game-art-spec.json">
{
  "_meta": {
    "genre": "...", "coreLoop": "..."
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
3. **References valid**: every asset id matches a `game-art-assets.json`
   entry AND every token ref matches a `game-art-tokens.json` key
4. **Conservative numerics**: stay within the default ranges above
   unless the directive explicitly specifies otherwise
5. **No UI surface keywords**
6. **Valid JSON**

### Workflow

1. `read_file game-art-tokens.json` and `read_file game-art-assets.json` —
   the token keys and asset ids you may reference. Do not proceed until you
   know the exact keys/ids they define.
2. Re-read the directive's behavior descriptions
3. For each entry's category, list the entries needed
4. Fill in conservative-default fields, referencing existing asset ids and
   token keys only
5. If a behavior specification feels under-determined, prefer fewer
   entries with cleaner specs over many speculative ones
