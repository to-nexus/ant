## game-art-tokens.json Generation Guide (Directive only)

### Purpose
Capture the global game-art-tier tokens — palette, silhouette, lighting,
motion tone — derived from the project's `gameArtTier.concept` and the
written directive / PRD.

### Surface scope (sub-sourced canonical)
- Output path: `visual/game-art/ant/game-art-tokens.json`
- `ant/` is the LLM-generated canonical sub-source (mirrors `visual/ui/ant/`).
- `figma/` / `handoff/` sub-directories are Phase 5+ hooks — parser-only today. When `handoff/` is activated, its `*-by-handoff.md` variant MUST include `{{> jobs/shared/injections/handoff-code-shape-discipline }}` so the same code-shape vs token-shape discipline that governs UI handoff applies to game-art handoff.

### Core Principles

#### 1. Concept-derived
The chosen `gameArtTier.concept` is the primary signal. Its full art direction
— palette identity, silhouette weight, lighting tone, motion easing, and HUD
defaults — is supplied to you as the injected `<basis axis="...concept/...">`
block above. Derive each token field from that block's corresponding dimension:
palette prose → `palette.*`, silhouette prose → `silhouette.*`, lighting prose →
`lighting.*`, motion prose → `motionTone.*`, HUD defaults → `hud.*`. Do NOT
restate the concept block here — read it and translate it into the discrete
token fields below (the concept block is the design authority; this JSON is the
discrete authority the code job consumes). The concept block gives the starting
mood; the directive may shift any axis.

#### 2. Directive-grounded
When the directive specifies a particular palette ("neon cyan and
magenta"), follow it; the concept's default mood gives the unspecified
axes (silhouette / lighting / motion).

#### 3. Single Source of Truth
This file is the palette SSOT. All assets and spec entries reference these
tokens by dot notation — they `read_file` this catalog and MUST use the exact
key paths defined here.

### Canonical palette namespace (fixed — do NOT invent parallel keys)

- `palette.primary` / `accent` / `danger` / `outline` are **single role
  colors** — each is a string hex. Do NOT turn `primary` into an object of
  sub-colors (`palette.primary.mint`) — that breaks every downstream reference.
- `palette.entities` is the **canonical home for the N distinct per-entity
  colors** a board / puzzle / arcade game needs (blocks, tiles, pieces, …).
  It is a dictionary keyed by the entity/block/tile id — one stable key per
  distinct color. Assets and spec reference `palette.entities.<id>`. This is
  the ONLY place N-way entity colors live; do NOT scatter them under invented
  keys.

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
    "outline": "#xxxxxx",
    "entities": {
      "<entity-or-block-id>": "#xxxxxx"
    }
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
  },
  "hud": {
    "spacingRhythm": "<base unit or scale name>",
    "cornerRadius": { "panel": "<value>", "button": "<value>" },
    "shadow": { "blurPx": 0, "opacity": 0.0, "offsetYPx": 0 },
    "typography": { "fontFamily": "<font stack>", "weightDefault": 400, "weightBold": 700 }
  }
}
```

**HUD layer (D28)**: a game project has no separate `ui-tokens.json` — the
React HUD overlay (menus / score / dialog) pulls its spacing / radius / shadow /
typography from `hud` here. Populate it from the concept's mood so the HUD
reads as one system with the in-canvas art. Omit `hud` only for a pure
canvas-only game with no HTML overlay.

### Single-task constraint

`game-art-tokens` is a single task — never split.

### Output Format

```xml
<file path="visual/game-art/ant/game-art-tokens.json">
{
  "_meta": { "gameArtTier": { "concept": "...", "perspective": "2d" } },
  "palette": { "primary": "...", "accent": "...", "danger": "...", "background": ["...","..."], "outline": "...", "entities": { "...": "..." } },
  "silhouette": { ... },
  "lighting": { ... },
  "motionTone": { ... },
  "hud": { ... }
}
</file>
```

### Quality Criteria

1. **Concept-aligned**: every value matches the injected concept basis
   block (or a documented directive-driven shift)
2. **Canonical namespace**: role colors are string hex under `palette.*`;
   N-way entity colors live only under `palette.entities.<id>` — no invented
   parallel keys, no object-valued `palette.primary`
3. **HUD present** when the game has an HTML overlay (D28)
4. **Token-only**: no asset paths / behavior here
5. **Valid JSON**: proper syntax, no trailing commas

### Workflow

1. Read the injected concept basis block and extract its palette / silhouette / lighting / motion / HUD direction
2. Enumerate the distinct entities/blocks/tiles the directive/PRD implies and
   assign each a stable `palette.entities.<id>` color (strong mutual contrast)
3. Apply directive-specified shifts (palette overrides, etc.)
4. Populate `hud` from the concept mood if the game has an HTML overlay
5. Encode as `game-art-tokens.json`
