## game-art-tokens.json Generation Guide (Directive only)

### Purpose
Capture the global game-art-tier tokens — palette, silhouette, lighting,
motion tone — derived from the project's `gameArtTier.concept` and the
written directive / PRD.

### Surface scope (sub-sourced canonical)
- Output path: `outputs/design/game-art/ant/game-art-tokens.json`
- `ant/` is the LLM-generated canonical sub-source (mirrors `outputs/design/ui/ant/`).
- `figma/` / `handoff/` sub-directories are Phase 5+ hooks — parser-only today.

### Core Principles

#### 1. Concept-derived
The chosen `gameArtTier.concept` is the primary signal. Each concept
variant has a canonical palette mood:

| concept variant | palette mood                   | silhouette weight | lighting tone     | motion easing | natural-fit sub-genre (gentle hint, not enforced) |
|-----------------|--------------------------------|-------------------|-------------------|---------------|---------------------------------------------------|
| flatMinimal     | single + 1–2 accents           | medium / soft     | flat (no shadow)  | snappy        | match3, slidingPuzzle, cardSolitaire              |
| pixelRetro      | 16-color limited (NES / GB)    | bold (pixel block)| hard-edge / step  | step          | slidingPuzzle (Sokoban), arcadeSnake              |
| neonArcade      | dark bg + neon complementary   | thin-line (glow)  | radial neon glow  | snappy        | arcadePaddle (Tron), arcadeSnake                  |
| softPastel      | pastel hue (#FFD8E4 / #C7E2FF) | rounded / soft    | pillowy / soft    | slow ease-out | match3 (Two Dots / Threes), cardSolitaire         |
| cardClassic     | green felt + white face + suits| flat (suit picto) | flat shadow / flip| snappy        | cardSolitaire (Solitaire / FreeCell — primary)    |

These rows are starting points — the directive may shift any axis. The "natural-fit sub-genre" column is a soft hint: no genre × concept matrix is enforced — the directive may legitimately pair any concept with any sub-genre.

#### 2. Directive-grounded
When the directive specifies a particular palette ("neon cyan and
magenta"), follow it; the concept's default mood gives the unspecified
axes (silhouette / lighting / motion).

#### 3. Single Source of Truth
All assets and spec entries reference these tokens by dot notation.

### JSON Structure

```json
{
  "_meta": {
    "gameArtTier": {
      "concept": "<one of the chosen concept variants>",
      "perspective": "2d"
    }
  },
  "palette": {
    "primary": "#xxxxxx",
    "accent": "#xxxxxx",
    "danger": "#xxxxxx",
    "background": ["#xxxxxx", "#xxxxxx"],
    "outline": "#xxxxxx"
  },
  "silhouette": {
    "weight": "thin" | "medium" | "bold",
    "complexity": "simple" | "moderate" | "detailed"
  },
  "lighting": {
    "tone": "neon" | "soft" | "dramatic" | "flat",
    "shadow": "none" | "soft" | "hard"
  },
  "motionTone": {
    "easing": "snappy" | "smooth" | "weighted",
    "scale": "subtle" | "moderate" | "expressive"
  }
}
```

### Single-task constraint

`game-art-tokens` is a single task — never split.

### Output Format

```xml
<file path="outputs/design/game-art/ant/game-art-tokens.json">
{
  "_meta": { "gameArtTier": { "concept": "...", "perspective": "2d" } },
  "palette": { ... },
  "silhouette": { ... },
  "lighting": { ... },
  "motionTone": { ... }
}
</file>
```

### Quality Criteria

1. **Concept-aligned**: every value matches the chosen concept's mood
   table above (or a documented directive-driven shift)
2. **Token-only**: no asset paths / behavior here
3. **Valid JSON**: proper syntax, no trailing commas

### Workflow

1. Look up the concept's row in the table above
2. Apply directive-specified shifts (palette overrides, etc.)
3. Encode as `game-art-tokens.json`
