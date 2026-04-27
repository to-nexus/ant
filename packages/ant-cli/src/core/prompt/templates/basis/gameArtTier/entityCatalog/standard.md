## Entity Catalog: Standard

**Activation gate**: `gameArtTier.entityCatalog === 'standard'`.

### Promise

The `standard` entity catalog declares a hero + 1–2 antagonists + 1–2 collectibles — distinct shapes per role, each authorable inline as a multi-primitive svg / CSS box, but not yet a multi-frame animated sprite roster. This is the catalog the project commits when a single rectangle no longer carries the genre's identity.

### Entity catalog shape (2–4 rows typical)

When this variant is active, `game-art-assets.json`'s `entities` category lists 2–4 distinct entries:

| Role | Geometry | css-only / external |
|---|---|---|
| Hero / player | One multi-primitive svg or composed CSS box (head + body two-shape composition). Inline OK. | `kind: 'inline'` — composed of 2–4 primitives. |
| Antagonist / hazard | A distinct silhouette, not a tinted hero variant. May carry a "menacing" cue (sharp corners vs. round hero). | `kind: 'inline'` at baseline visual scope; `kind: 'external'` allowed once `visualScope === 'atlas-enabled'`. |
| Collectible / reward | A small recognizable token (coin / star / heart / power-up icon). | `kind: 'inline'` baseline. |
| Optional NPC / variant | Up to one extra NPC or a single elite enemy variant. | `kind: 'inline'` baseline. |

Beyond 4 entries → `entityCatalog === 'rich'`. Below 2 entries → `entityCatalog === 'minimal'`.

### Genre cross-reference (guidance, not strict)

- `match3` → standard typically introduces a "special tile" entity beyond the gem (line-clear / bomb / color-bomb sprite). Each special is its own entry.
- `slidingPuzzle` → in tile-puzzle subgenres with NPCs (Sokoban with a pusher character) the hero shape is its own entry.
- `cardSolitaire` → standard is unusual — the canonical card frame is a single shape; only adopt when the project introduces companion characters (e.g. a dealer mascot).
- `arcadePaddle` → standard introduces brick variants (multi-hit brick, power-up brick), each a distinct entry.
- `arcadeSnake` → standard introduces obstacle variants (wall segment, moving hazard) and a distinct food shape.
- `crowdRunner` → standard is canonical — the unit silhouette + at least one threat silhouette + the gate / pickup affordance are distinct entries; modifier-gate variants (op-flavoured glyphs) are entity-catalog rows when their visual identity matters.

### Code-time consequences

- Phaser `texture.add*` is allowed but not required at the baseline visual scope; inline svg is rendered into a `Graphics` context or as a DOM overlay.
- When `_meta.visualScope === 'atlas-enabled'`, the entity catalog can also adopt `kind: 'external'` for hero / NPC sprite atlases — this is the upgrade step-up. Pair with `_meta.audioScope === 'external-enabled'` if file-based audio is desired together.
- Animation in `standard` may use transform tweens AND sprite-state swaps (idle ↔ active CSS class swap, opacity-pulse on hit). Multi-frame spritesheet animation belongs to `rich`.

### Phase scope

`standard` is feasible at the baseline visual scope: composed inline svg + CSS box compositing covers a hero / antagonist / collectible / NPC trio. Activating `_meta.visualScope === 'atlas-enabled'` lifts the same catalog to use external sprite atlases for the same entities — the catalog rows do not change shape, only the `kind` discriminator on each entry.

### Blind-spot reminders

- ⚠️ A `standard` catalog with all entries pointing at the same svg with only color tints applied is a `minimal` catalog in disguise — recategorize.
- ⚠️ Multi-frame spritesheet animation (idle / walk / hit cycles per entity) is a `rich` signal. If the spec describes per-entity animation cycles with named frames, switch to `rich`.
- ⚠️ A baseline-scope (`visualScope === 'baseline'`) project that lists 4 inline entities with intricate svg path data may exceed the design-time inline-payload ceiling (D21) — the validator rejects oversized inline payloads. Migrate to `kind: 'external'` once `visualScope === 'atlas-enabled'` is active.
