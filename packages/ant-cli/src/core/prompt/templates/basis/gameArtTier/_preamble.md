## Game Art Tier (D28 — single SSOT for game-domain visuals)

The game-art tier is the **single visual SSOT for the game domain** (D28). It governs both the in-canvas surface (sprites / particles / projectiles / audio) and the HUD/menu surface (React overlay) — the two render paths pull from one art direction.

### 7-axis structure (D3 / D15)

| Axis | Phase | Role |
|---|---|---|
| `concept` | Phase 2 (filled) | Palette / silhouette / lighting / motion-tone identity. Drives token generation for BOTH sprite tints and HUD CSS. |
| `perspective` | Phase 2 (filled) | Camera / depth / input mapping (2D / 3D). Decides the in-canvas projection. |
| `entityCatalog` | Phase 4 (filled) | Character / object catalog policy (`minimal` / `standard` / `rich`). |
| `motionPattern` | Phase 4 (filled) | Sprite tween / animation policy (`static` / `subtle` / `expressive`). |
| `particleProfile` | Phase 4 (filled) | Particle system guidance (`none` / `light` / `heavy`). |
| `projectilePolicy` | Phase 4 (filled) | Projectile / bullet policy (`none` / `simple` / `complex`). |
| `audioProfile` | Phase 4 (filled) | Audio policy (`procedural` / `fileBased` / `hybrid`). |

### Two render paths, one art direction

A game project running React + Phaser splits its rendering between an HTML overlay (HUD / menus / dialog) and a canvas scene (game world). Both paths consume `gameArtTier`:

- **Tokens (palette / silhouette / lighting / motion-tone)** from `concept` are emitted into `game-art-tokens.json` and feed:
  - In-canvas: sprite tint, particle color, projectile silhouette, lighting filter.
  - HUD: panel background, button accent, text color, focus ring, shadow tone.
- **HUD layout decisions** (spacing rhythm / surface treatment / typography weight / corner radius) are derived from the active `concept` variant — each concept .md commits a default for these dimensions so the HUD CSS feels native to the game's visual world. Override through `game-art-tokens.json` when the LLM emits explicit HUD token entries.

This is the D28 unification: there is no separate `visualTier` for a game workspace. The HUD's rhythm / surface / interaction are concept-derived defaults, not orthogonal user decisions.

### Motion locality (I5)

- `interactionGrammar` (visualTier — service domain only) ≠ `motionPattern` (gameArtTier).
- `motionPattern` covers BOTH sprite tween/animation AND HUD entrance/hover transitions in a game workspace.
- Particle / projectile motion is delegated to `particleProfile` / `projectilePolicy` — keep them separate from sprite-tween policy so a `static` sprite world can still emit a `heavy` particle system.

### Surface partial loading order

The PromptBuilder iterates `gameArtTier` axes in the canonical order (`concept` → `perspective` → `entityCatalog` → `motionPattern` → `particleProfile` → `projectilePolicy` → `audioProfile`) so concept-level tokens are committed before downstream axes refer to them. The job overlays (`jobs/{design,code}/basis/gameArtTier/_preamble.md`) load AFTER this preamble and the active variants — they layer job-specific contracts on top of the tier-level identity.
