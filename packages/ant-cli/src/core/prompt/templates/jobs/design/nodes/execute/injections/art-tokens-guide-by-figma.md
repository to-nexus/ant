## game-art-tokens.json Generation Guide (Figma)

### Purpose
Capture the global game-art-tier tokens — palette, silhouette, lighting,
motion tone — derived from the project's `gameArtTier.concept` and the
Figma file's color / effect / style variables.

### Surface scope (D24 — flat structure)
- Output path: `outputs/design/game-art/game-art-tokens.json`
- No `ant` / `figma` / `handoff` sub-directory — game-art is flat.

### Core Principles

#### 1. Concept-derived
Every token MUST be traceable to the chosen `gameArtTier.concept`.

#### 2. Figma variables as source
Use `figma_get_variable_defs` against root or the concept frame nodeId
to extract palette / lighting tokens. Local style frames provide
silhouette weight and motion-tone hints.

#### 3. Single Source of Truth
All assets and spec entries reference these tokens by dot notation.

### JSON Structure

```json
{
  "_meta": {
    "gameArtTier": {
      "concept": "<one of the chosen concept variants>",
      "perspective": "2d" | "3d"
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
<file path="outputs/design/game-art/game-art-tokens.json">
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
2. **Figma-grounded**: palette swatches map to Figma variables when
   available; never invent colors not visible in the file
3. **Token-only**: no asset paths / behavior here
4. **Valid JSON**: proper syntax, no trailing commas

### Workflow

1. `figma_get_variable_defs` → extract palette / lighting from variables
2. `figma_get_design_context` against the concept frame for silhouette
   and motion-tone observation
3. Encode as `game-art-tokens.json`
