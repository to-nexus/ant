## Projectile Policy: None

**Activation gate**: `gameArtTier.projectilePolicy === 'none'`.

### Promise

The `none` projectile policy commits to **zero projectile entities** — no bullets, no thrown items, no homing bombs, no shock-arcs. The genre either does not have a projectile concept at all (match3 / slidingPuzzle / cardSolitaire) or uses a non-projectile object that is positionally bound (the ball in arcadePaddle is not a "projectile" in this policy's sense — it is a deflected primary entity, not a fire-and-forget).

### What "none" looks like in code

- No `Phaser.Physics` body marked as a projectile (no `bullet: true` flag, no homing logic, no projectile pool).
- `game-art-assets.json` has no `projectiles` category, or the category is empty.
- `game-art-spec.json` `projectiles` category is omitted.

### Genre cross-reference (D31-revised v8 — guidance, not strict)

For all 5 v8 sub-genres (`match3`, `slidingPuzzle`, `cardSolitaire`, `arcadePaddle`, `arcadeSnake`), `projectilePolicy === 'none'` is the canonical match. None of the v8 sub-genres are projectile-centric. The ball in `arcadePaddle` is the central play entity, not a projectile (it is deflected, not fired). The body cells in `arcadeSnake` are the trail of the player, not projectiles.

If the project introduces a projectile mechanic (a power-up that fires a bomb, a special tile that emits a beam), the policy should step up to `simple` for that one mechanic.

### Code-time consequences

- The collision budget is minimal — only the primary entities collide.
- `BootScene.preload` does not register projectile textures.
- Audio (`audioProfile`) does not allocate slots for fire / hit-projectile SFX.

### Concept affinity

`none` pairs with all 5 v8 concepts because no concept-tier consideration applies — the policy is a hard "absent" decision.

### Blind-spot reminders

- ⚠️ A `none` project that emits `Phaser.Physics.bullet = true` configurations is inconsistent — flag.
- ⚠️ Treating the arcade-paddle ball as a `kind: external` projectile is a category error. The ball is `entities[0]`, not a projectile.
- ⚠️ If the project has any "throw / fire / shoot" verb in its directive, `projectilePolicy === 'none'` is suspicious — revisit.
