## Projectile Policy: Complex

**Activation gate**: `gameArtTier.projectilePolicy === 'complex'`.

### Promise

The `complex` projectile policy commits to **multi-kind projectiles with non-trivial behaviors** — homing, spread / fan, piercing, chained bounces, splash-radius damage, gravity-affected arcs. Each behavior is a per-projectile-kind decision. The catalog grows to 3+ distinct projectile entries with distinct collision rules. The css-only inline scope **cannot reasonably author `complex`** — it is the **Phase 5+ recommended tier**.

### What "complex" looks like in code

- Multiple `Phaser.GameObjects.Group` instances or a typed-projectile pool, one per projectile kind.
- Per-kind motion logic: homing (per-frame seek-target), spread (multiple velocity vectors at spawn), piercing (does not destroy on first hit), gravity-affected (downward acceleration applied per-frame).
- Splash-radius collision: a projectile that hits target A also damages targets within R units (Phaser overlap check or distance loop).
- Per-kind audio cues, particle effects, and visual variants.

### Phase scope contract

`complex` typically requires **`_meta.visualScope === 'atlas-enabled'`** AND `entityCatalog === 'standard'` or `'rich'` AND `motionPattern === 'expressive'` to feel cohesive. The baseline visual scope cannot author the visual variety this policy implies; the SFX expectations are similarly broader than `procedural` can deliver, so pairing with `_meta.audioScope === 'external-enabled'` is typical.

### Genre cross-reference (guidance, not strict)

For `match3` / `slidingPuzzle` / `cardSolitaire` / `arcadePaddle` / `arcadeSnake`, `complex` is **a mismatch**. None of these sub-genres are projectile-centric. Adopting `complex` for any of them is a strong signal that the project is drifting outside its declared genre — revisit the genre choice or downgrade the projectile policy.

For `crowdRunner`, `complex` is reachable when the op universe introduces multiple projectile kinds (bolt + bomb + beam variants), homing / piercing variants, or split-projectile attribute ops — the visual variety must justify the production cost. The default `crowdRunner` projectile policy is `simple`; `complex` is opt-in for ambitious twists.

For Phase 5+ super-categories (bullet-hell / RPG-with-spells — legacy / archived) `complex` is the lookahead policy when the registry widens.

### Code-time consequences

- Per-frame projectile update loop iterates all active projectiles and applies their kind-specific behavior. Object pooling is mandatory; allocation per shot tanks performance.
- Particle system (`particleProfile === 'heavy'`) coordinates with each projectile kind — fire trail, hit explosion, splash radius indicator.
- Audio (`audioProfile === 'fileBased'` or `'hybrid'`) carries multi-clip per-kind audio — fire / travel / hit / splash all distinct.
- HUD overlay typically needs a per-kind ammo / cooldown indicator.

### Concept affinity

`complex` is largely concept-agnostic; whichever concept the project commits, the projectile system itself becomes the dominant visual language during play. `neonArcade` is the most natural fit for the Phase 5+ shooter / bullet-hell projects that would actually benefit.

### Blind-spot reminders

- ⚠️ `complex` while `entityCatalog === 'minimal'` is incoherent — the catalog needs distinct entries for each projectile kind (and probably their hit / explosion variants).
- ⚠️ `complex` while `visualScope === 'baseline'` is rejected — the design-time inline-payload ceiling cannot author the visual variety.
- ⚠️ `complex` adopted by a non-shooter sub-genre is a category drift signal — the design pipeline should question the genre choice rather than the policy.
- ⚠️ Performance budget at `complex` requires explicit testing on lower-end devices; the policy CAN ship at 60fps but only with disciplined pooling and per-kind rate limiting.
