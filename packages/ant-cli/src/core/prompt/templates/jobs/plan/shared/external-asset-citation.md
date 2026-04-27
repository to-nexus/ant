### External design asset citation (figma / concept art / reference / sprite / sound)

When the directive supplies external design assets — Figma file URLs, concept art images, reference videos, sprite assets, sound clips — cite them **inside the section that owns the corresponding entity**, paired with the entity's stable identifier. The citation is a hand-off contract: downstream design (ui-design-by-figma, game-art-design-by-figma, etc.) reads the PRD/GDD and consumes those citations as preferred inputs over its inline-first defaults.

**Why**:

- An externally-prepared asset (a Figma frame, a concept image, a reference clip) is the planner's most concrete commitment about how an entity looks or behaves. Burying it as a free-form attachment loses the entity ↔ asset mapping; design then reverts to inferring from prose.
- Citing the asset alongside the entity ID (`SC-ProductDetail — figma: <node-id>`, `EN-Hero — concept: inputs/assets/game/concept/hero.png`) keeps the mapping explicit and survives renumber / re-section.
- ui-design-by-figma and game-art-design-by-figma decompose tasks then map figma frames / concept images directly to entity IDs. ui/asset chapters that detect a citation override their inline-first default for that specific entity only.

**Usage rules**:

- Citation format: `<ID> — <kind>: <path-or-URL>` on a separate line within the entity's owning section. Multi-asset entities list one citation per line.
- Citation kinds the domain overlay below allows are listed in `assetKinds`. Other kinds → record in §Open Questions instead of inventing a new kind here.
- Citations are **optional**. When no external asset exists for an entity, omit the line entirely; design will fall back to its default behavior (inline-first for game-art-by-desc, prose-derived for ui-design-by-desc).
- A citation MUST resolve at design time — either a checked-in path under `inputs/assets/...` or a URL the design job can fetch. Fabricated paths are forbidden.
- Conflict resolution: if a citation contradicts the prose of the same entity, the prose is the authoritative description; the citation is a visual reference. Conflicts MUST be flagged in §Open Questions, not silently overridden.
- Conflict resolution between citation and prose / between PRD/GDD and Figma source: see `jobs/design/shared/asset-conflict-policy` for the matrix downstream design follows (visual axis → Figma; behavior axis → PRD/GDD; ambiguous / role-asymmetric → cite-first + Open Questions).
