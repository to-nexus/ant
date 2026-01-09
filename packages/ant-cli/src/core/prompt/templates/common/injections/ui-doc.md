{{#if uiDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🎨 UI SPEC (Figma-derived)

Use this for UI behavior/layout/components/tokens.

### 🔍 ASSET DISCOVERY PRINCIPLE (CRITICAL!)

**Before implementing ANY UI element, search the asset mapping table.**

1. **Identify** what you're building (component, element, section)
2. **Search** the mapping table for that element (by name, type, or purpose)
3. **If asset exists → USE IT** (image/icon file), do NOT substitute with text or placeholder

**The mapping table is the source of truth for visual assets.**
- Asset exists in table → MUST copy and use that file
- Asset NOT in table → May use text or other approach

### ⚠️ ANTI-PATTERN: Text Substitution & TODO Placeholders

If the mapping table specifies an **image asset** for an element (logo, icon, background, typography image):
- ❌ DO NOT render it as plain text
- ❌ DO NOT skip copying the asset
- ❌ DO NOT leave `{/* TODO: Add logo */}` comments
- ✅ Copy the asset file and reference it in code IMMEDIATELY

**WRONG:**
```tsx
{/* TODO: Add logo image from /public/logos/logo.svg */}
<span className="font-bold">Company Name</span>
```

**CORRECT:**
```tsx
<img src="/logos/logo.svg" alt="Logo" className="h-8" />
```

### 📋 ASSET USAGE PROCESS

1. **Copy**: `features/{{featureFolder}}/inputs/assets/[Source]` → `codebase/public/[Runtime Path]`
2. **Reference**: Use the Runtime Path from the mapping table in your code
3. **Verify**: Asset must exist at destination before code references it

────────────────────────────────────────────────────────────────────────────────

{{uiDoc}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}


