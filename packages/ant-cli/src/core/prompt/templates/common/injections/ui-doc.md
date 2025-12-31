{{#if uiDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🎨 UI SPEC (Figma-derived)

Use this for UI behavior/layout/components/tokens.
If it conflicts with immutable API contract, the API contract wins.

### ⚠️ RUNTIME ASSETS (CRITICAL)

**All paths are relative to PROJECT ROOT.**
- Code files: `codebase/...` (e.g., `codebase/src/App.tsx`)
- Asset source: `features/{{featureFolder}}/inputs/assets/...`
- Asset destination: `codebase/public/...`

To use runtime assets (logos, icons, images):
```bash
# Copy from feature inputs to codebase public/
cp features/{{featureFolder}}/inputs/assets/logos/logo.svg codebase/public/logos/
```

**DO NOT** assume assets are auto-copied. You MUST explicitly copy them!

────────────────────────────────────────────────────────────────────────────────

{{uiDoc}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}


