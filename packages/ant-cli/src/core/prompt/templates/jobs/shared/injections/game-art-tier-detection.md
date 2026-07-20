Observe the project context, PRD, directive, refs, and contextArtifacts to determine a game-art tier policy.

Output a `<gameArtTier>` tag with the chosen axis values.

### Explicit vs Infer (per axis)

For each axis (`concept`, `perspective`, plus Phase 4 axes when active):

- If `resolvedAction.basis.gameArtTier.<axis>` is present, that value is EXPLICIT — emit it verbatim. Do not reinterpret or substitute.
- Otherwise, INFER by observing the work content (directive + refs + contextArtifacts + PRD + existing game-art artifacts).

{{#if resolvedAction.basis.gameArtTier.concept}}
Explicit `concept`: {{resolvedAction.basis.gameArtTier.concept}}
{{/if}}
{{#if resolvedAction.basis.gameArtTier.perspective}}
Explicit `perspective`: {{resolvedAction.basis.gameArtTier.perspective}}
{{/if}}

### Available values (choose from these EXACT IDs)

`concept` (each annotated with the render perspective(s) it supports):
{{{gameArtConceptsWithPerspectives}}}

- `perspective`: {{{gameArtPerspectiveCandidates}}}

(Phase 4 axes — `entityCatalog` / `motionPattern` / `particleProfile` /
`projectilePolicy` / `audioProfile` — are inactive in Phase 2; do NOT
emit them unless they appear in `resolvedAction.basis.gameArtTier`.)

### Constraints

- Do NOT invent new variant IDs.
- Do NOT override explicit values.
- Perspective support: respect the chosen `concept`'s supported perspective(s).
  A concept annotated `(2d)` MUST be paired with `perspective=2d`; a `(3d)`
  concept with `perspective=3d`; a `(both)` concept may take either — pick the
  one the work content implies.
- Do NOT cross-pollinate with `visualTier` axes (`visualLanguage`,
  `surfaceSystem`, `spatialSystem` belong to UI surface, not
  game-art surface — I7 Art Design Surface boundary).

<gameArtTier>concept=<chosen>,perspective=<chosen></gameArtTier>
