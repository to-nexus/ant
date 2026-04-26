## game-art-tokens.json Generation Guide (References + PRD)

### Purpose
Capture the global art-tier tokens — palette, silhouette, lighting,
motion tone — derived from the project's `gameArtTier.concept` and
grounded in the supplied reference images.

### Surface scope (D24 — flat structure)
- Output path: `outputs/design/game-art/game-art-tokens.json`
- No `ant` / `figma` / `handoff` sub-directory — game-art is flat.

### Core Principles

#### 1. Concept-derived
Every token MUST be traceable to the chosen `gameArtTier.concept`. The
concept variant defines the silhouette weight, palette mood, lighting
tone, and motion easing — the tokens document is its concrete encoding.

#### 2. Single Source of Truth
All assets and spec entries reference these tokens by dot notation
(e.g. `palette.primary`, `lighting.tone`). Never duplicate token values
inline in `game-art-assets.json` or `game-art-spec.json`.

#### 3. Visual-first when refs are present
Extract palette / silhouette / lighting from the reference images first.
PRD provides intent; references provide the concrete values.

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

`game-art-tokens` is a single task — never split. Append-merge is unsafe
for top-level scalar tokens (last-write wins on the same key would
corrupt the document).

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
2. **Reference-grounded**: palette swatches match the reference images
3. **Token-only**: this document contains no asset paths or behavior —
   those belong to `game-art-assets.json` / `game-art-spec.json`
4. **No raw color in non-palette fields**: `lighting.tone` etc. use the
   enum values listed above, not hex codes
5. **Valid JSON**: proper syntax, no trailing commas

### Workflow

1. `list_reference_images` → discover available concept art / refs
2. `read_reference_image` → load the most representative ref(s)
3. Extract dominant palette + silhouette weight + lighting tone
4. Encode as `game-art-tokens.json`
