{{#if uiDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🎨 UI SPEC (Figma-derived)
════════════════════════════════════════════════════════════════════════════════

Use this for UI behavior/layout/components/tokens.

### 🚨 IMPLEMENTATION MANDATE

**You received a structured plan with UI Implementation Checklist.**

**Your implementation MUST:**
1. ✅ Copy EVERY asset listed in "Asset Inventory" section of the plan
2. ✅ Implement EXACT layout structure from "Layout & Structure" section
3. ✅ Apply ALL component specifications from "Component Specifications" section
4. ✅ Use EXACT design token references from "Design Token References" section
5. ✅ Follow implementation steps from the plan

**CRITICAL RULES:**
- ❌ DO NOT skip assets marked in the plan (even "decorative" ones)
- ❌ DO NOT deviate from layout specifications in the plan
- ❌ DO NOT use raw values instead of design tokens
- ❌ DO NOT leave `{/* TODO: Add image */}` placeholders
- ✅ If plan says "copy 8 assets" → You MUST copy all 8 assets
- ✅ If plan says "3-column grid → 5-column desktop" → Implement exactly
- ✅ If plan says "use token(color.accent.teal)" → Use that token

### 🔍 ASSET DISCOVERY PRINCIPLE (CRITICAL!)

**The plan already identified assets. Now you MUST use them.**

1. **Copy** each asset from plan's "Asset Inventory" using exact `cp` commands
2. **Reference** copied assets in your code using destination paths from plan
3. **Verify** asset count: If plan lists N assets → Your code must reference N assets

**The mapping table is the source of truth for visual assets.**
- Asset in plan's inventory → MUST copy and use that file
- Asset NOT in plan → May use text or other approach (but check plan first!)

### ⚠️ ANTI-PATTERN: Ignoring the Plan

**WRONG:**
```tsx
// Plan said: "Copy token-hero-image.png"
// But developer skipped it and just made cards:
<div className="grid grid-cols-5">
  {cards.map(...)}
</div>
```

**CORRECT:**
```tsx
// Plan said: "Copy token-hero-image.png + implement hero image + cards"
<div className="flex justify-center mb-16">
  <Image src="/assets/images/token-hero-image.png" width={400} height={400} />
</div>
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
  {cards.map(...)}
</div>
```

### 📋 ASSET USAGE PROCESS

1. **Copy**: Use EXACT `cp` commands from plan's "Asset Inventory" section
2. **Reference**: Use destination paths from plan in your code
3. **Verify**: Cross-check with plan - did you use all listed assets?

**Example from plan:**
```
Asset Inventory:
- bg.token.hero: inputs/assets/bg/token-hero-image.png → codebase/public/assets/images/token-hero-image.png
- icon.token.gas: inputs/assets/icons/icon-gas.svg → codebase/public/assets/icons/icon-gas.svg
Total: 8 assets
```

**Your implementation must:**
```bash
# Copy all 8 assets
cp inputs/assets/bg/token-hero-image.png codebase/public/assets/images/
cp inputs/assets/icons/icon-gas.svg codebase/public/assets/icons/
# ... (all 8)
```

```tsx
// Reference all 8 assets in code
<Image src="/assets/images/token-hero-image.png" />
<Image src="/assets/icons/icon-gas.svg" />
// ... (all 8)
```

────────────────────────────────────────────────────────────────────────────────

{{uiDoc}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}


