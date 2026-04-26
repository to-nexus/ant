## Game-Art Specification Policy

### Follow the plan + game-art source

**Your plan contains an inventory derived from `outputs/design/game-art/ant/`** — the three sub-sourced artifacts `game-art-tokens.json`, `game-art-assets.json`, and `game-art-spec.json` (D24-revised v8 — sub-sourced canonical, mirrors `outputs/design/ui/ant/`). The per-artifact reading rules are injected via `game-art-source`.

**Implementation rules:**

1. Cover every catalog entry, token, or behaviour the plan records.
2. Honor the `kind: 'inline' | 'external'` discriminator (D20) for each asset entry — inline payloads are materialized in code (CSS / SVG / OscillatorNode), external payloads load from `inputs/assets/game/{category}/`.
3. Apply per-category specs (effects / characters / projectiles / npcs / objectives / ...) exactly as the plan records — category keys are LLM-chosen but stable within the document (D25).
4. Reference design values by the keys or observable values the plan recorded.

**Critical:**

- If the plan lists N catalog entries → the code MUST copy and reference all N.
- If the plan records `_meta.phaseScope` = `'p2-css-only'` → external sfx/bgm are suppressed at load time (Phase 4 hook gates external audio).
- When system-design and the game-art source conflict on art / motion / audio → the game-art source wins.
- HUD / menu / dialog rendering belongs to the game-art surface in game-domain workspaces (D28). Service-domain UI artifacts (`outputs/design/ui/ant/ui-*.json`) are NOT consulted in a game workspace.

### Asset discovery principle

**Before implementing, check the plan's inventory.** Every asset, token, or behaviour that reaches the code MUST be traceable to a plan line that itself was traceable to a `game-art-*.json` entry.

1. For `kind: 'external'` entries — copy or import from the `src` path (always under `inputs/assets/game/`).
2. For `kind: 'inline'` entries — materialize the `css` / `svg` / `oscillator` payload at sprite-spawn / play time. Do NOT base64-encode or fabricate beyond the css-only ceiling (D21).
3. Verify count: plan says N → code uses N.

### Domain-Surface Boundary (I7-revised)

A game-domain code job consumes ONLY the game-art catalog. Cross-pollination is forbidden:

- ❌ HUD glyphs MUST NOT be sourced from `outputs/design/ui/ant/ui-assets.json` (that catalog is service-only — D28).
- ❌ In-canvas sprites MUST NOT come from a UI-source slot.
- ✅ Both HUD and in-canvas surfaces consume `game-art-tokens.json` (palette / silhouette / lighting / motion-tone / HUD CSS tokens) so the two render paths share one art direction.
