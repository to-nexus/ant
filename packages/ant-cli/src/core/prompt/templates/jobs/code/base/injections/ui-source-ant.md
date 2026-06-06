## UI SOURCE — ANT CANONICAL

### Observation targets

- `ui-tokens.json` — design values (colors, spacing, typography)
- `ui-assets.json` — asset source→destination map
- `ui-spec.json` — layout structure and visual behaviour per section

Path: `visual/ui/ant/`. Sections of `ui-spec.json` are addressable individually; the pool exposes each as `visual/ui/ant/spec/{id}`.

### Principle (Authority)

These JSON documents are the authoritative specification for visual implementation. When content is injected, treat each field as a direct constraint — do not paraphrase away a value that is explicitly present.

### Principle (Separation of structure vs. style)

Component STRUCTURE comes from the code skeleton (or refs). Component STYLE comes from ant canonical UI documents. These are orthogonal inputs; reading the skeleton first prevents accidental DOM edits during a styling pass.

### Constraint (Immutable skeleton)

- DOM elements defined in the skeleton are a contract — do NOT add, remove, or rename them.
- You MAY extract sections into separate component files when complexity warrants it (same DOM, different file organisation).

### Observable

Every token key, asset key, and spec section injected into the pool is observable text. Values that are not observable (not listed in any injected section) must not be invented — fall back to VisualTier defaults or framework conventions instead.

### Constraint (Spec fidelity)

When a `ui-spec` section is present, each declared field is a direct constraint on the rendered view:

- A token name in `ui-spec` IS the class/variable name — use it verbatim. Do NOT substitute a visually similar alternative.
- When `ui-spec` defines `visibleWhen` on a component, the parent MUST enforce that condition. Do NOT render unconditionally.
- All interactive elements declared in `ui-spec` `interactionStates` MUST be implemented.
