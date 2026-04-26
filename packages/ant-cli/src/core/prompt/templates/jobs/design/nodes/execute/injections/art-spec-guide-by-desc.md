## game-art-spec.json Generation Guide (Directive only)

### Purpose
Author one category of behavior / motion / policy spec entries in
`game-art-spec.json` from a directive only. Categories are LLM-decided
dictionary keys (D25).

### Surface scope (D24 — flat structure)
- Output path: `outputs/design/game-art/game-art-spec.json`

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
      /* see Common Patterns in art-spec-guide-by-ref */
    }
  }
}
```

`_meta` is written only by the FIRST task.

### Asset-Reference Discipline

Every reference inside a spec entry MUST be the `id` of an asset entry
in `game-art-assets.json`. Without references / Figma, your sibling
assets task is likely producing inline-first entries — use those ids.

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
3. **Asset references valid**: every id matches a sibling
   `game-art-assets.json` entry
4. **Conservative numerics**: stay within the default ranges above
   unless the directive explicitly specifies otherwise
5. **No UI surface keywords**
6. **Valid JSON**

### Workflow

1. Re-read the directive's behavior descriptions
2. For each entry's category, list the entries needed
3. Fill in conservative-default fields, referencing asset ids from
   the sibling assets task
4. If a behavior specification feels under-determined, prefer fewer
   entries with cleaner specs over many speculative ones
