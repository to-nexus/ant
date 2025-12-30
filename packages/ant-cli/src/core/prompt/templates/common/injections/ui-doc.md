{{#if uiDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🎨 UI SPEC (Figma-derived)

Use this for UI behavior/layout/components/tokens.
If it conflicts with immutable API contract, the API contract wins.

Runtime note:
- `inputs/references/**` are reference-only (may be injected as images).
- `inputs/assets/**` are runtime assets (NOT injected into the prompt). You must copy them into the correct static root for the target app (monorepo-aware).

────────────────────────────────────────────────────────────────────────────────

{{uiDoc}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}


