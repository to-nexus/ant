{{#if uiDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🎨 UI SPEC (Figma-derived)

Use this for UI behavior/layout/components/tokens.

### ⚠️ RUNTIME ASSETS - MANDATORY COPY (CRITICAL)

**If this spec contains asset mapping tables (Source → Runtime Path):**
1. **ALL mapped assets MUST be copied** from `features/{{featureFolder}}/inputs/assets/` to `codebase/public/`
2. Copy BEFORE referencing in code (or code will 404)
3. Use exact Runtime Path from the mapping table

```bash
# Example: copy logo
cp features/{{featureFolder}}/inputs/assets/logos/logo.svg codebase/public/ogf/logos/
```

**Assets are NOT auto-copied. YOU MUST run cp commands for EVERY asset in the mapping table.**

────────────────────────────────────────────────────────────────────────────────

{{uiDoc}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}


