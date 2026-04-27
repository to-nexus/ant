## Projectile Policy: Simple

**Activation gate**: `gameArtTier.projectilePolicy === 'simple'`.

### Promise

The `simple` projectile policy commits to **one projectile kind, straight-line motion, fixed velocity, single-hit collision**. A bullet that travels until it hits a target or leaves the world. No homing, no spread, no piercing, no chained bounces. The css-only inline scope can author a `simple` projectile as a small inline shape; the css-only ceiling is well within reach.

### What "simple" looks like in code

| Surface | Realization |
|---|---|
| Projectile entity | Single `kind: 'inline'` entry under `game-art-assets.json` `projectiles` category — a small svg circle, line, or arrow. |
| Spawn | `Phaser.GameObjects.Group` with a fixed pool size (≤ 8 active at once). |
| Motion | Constant velocity vector applied at spawn (`body.setVelocity(vx, vy)`); no per-frame steering. |
| Collision | Single overlap check against target group; first hit destroys both projectile and target (or deducts target HP). |
| Lifetime | Either fixed (`destroy after 2 seconds`) or world-bounds-leaving (`worldBounce && body.checkWorldBounds`). |

### `game-art-assets.json` projectiles category shape

```jsonc
"projectiles": [
  { "id": "energy-bolt", "kind": "inline", "format": "svg", "svg": "<rect width='12' height='3' fill='#FFD700'/>" }
]
```

The `projectiles` category in `game-art-spec.json` records the per-projectile behavior:
```jsonc
"projectiles": {
  "energy-bolt": { "speed": 480, "lifetimeMs": 1500, "damage": 1, "collidesWith": ["enemy"] }
}
```

### Genre cross-reference (D31-revised v9 — guidance, not strict)

- `match3`, `slidingPuzzle`, `cardSolitaire`, `arcadePaddle`, `arcadeSnake` — `simple` is **unusual** for these 5 v9 sub-genres. None of them are projectile-centric in their canonical form. Adopt `simple` only when the project explicitly introduces a projectile mechanic (e.g. a "shoot the queue" power-up in match-3, a paddle that fires a beam after a brick combo).
- `crowdRunner` — `simple` is **canonical** when the auto-firing crowd uses one projectile kind with straight-line motion and single-hit behaviour. The crowd is the firing pool; per-unit projectiles spawn at a fixed cadence per `fireRate` attribute. Step up to `complex` only when the op universe introduces multi-projectile / piercing / homing variants.
- For super-category Phase 5+ projectile-centric domains (action / platformer / arcade-shoot — legacy / archived), `simple` is the entry point when the registry widens.

### Code-time consequences

- Phaser physics body needs `setCollideWorldBounds(true)` and a destroy-on-leave handler (or a fixed lifetime timer).
- The collision pool is bounded — projectile object pooling is recommended even at `simple` to avoid gc thrash on rapid-fire mechanics.
- Audio at `simple` typically wants a fire SFX and a hit SFX (procedural OscillatorNode for css-only scope; external short clip if `audioProfile === 'fileBased'`).

### Phase scope

`simple` is css-only-feasible. The single projectile shape stays inside the inline complexity ceiling.

### Concept affinity (D32-revised v8 — guidance, not strict)

`simple` pairs naturally with `neonArcade` (a glowing energy bolt is its canonical projectile), `pixelRetro` (8-bit shoot-em-up bullet), and `flatMinimal` (a clean arrow shape). `softPastel` and `cardClassic` mismatch — projectile mechanics fight those concepts' calm tones.

### Blind-spot reminders

- ⚠️ `simple` while `entityCatalog === 'minimal'` may need a category bump if the projectile is a 4th distinct entity. The policy and catalog axes are independent — but the catalog should reflect the projectile entry.
- ⚠️ A `simple` projectile that homes / spreads / pierces is no longer simple — escalate the policy to `complex` or downgrade the mechanic.
- ⚠️ Projectile rate-of-fire matters even at `simple` — without a cooldown / fire-budget, the screen fills with bullets and the simple policy is nominally violated by the player's autonomy.
