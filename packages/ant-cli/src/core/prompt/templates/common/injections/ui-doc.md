{{#if uiDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🎨 UI SPEC (Figma-derived)
════════════════════════════════════════════════════════════════════════════════

Use this for UI behavior/layout/components/tokens.

### 🚨 FOLLOW THE PLAN

**Your plan contains an Asset Inventory and Layout/Component Specs.**

**Implementation rules:**
1. ✅ Copy EVERY asset listed in plan's "Asset Inventory"
2. ✅ Implement layout EXACTLY as specified in plan
3. ✅ Apply component specs from plan
4. ✅ Use design tokens referenced in plan

**CRITICAL:**
- If plan lists N assets → You MUST copy and reference all N assets
- If plan specifies responsive breakpoints → Implement all breakpoints
- If plan lists "decorative" elements → They are NOT optional
- DO NOT skip assets or components mentioned in the plan

### 🔍 ASSET DISCOVERY PRINCIPLE

**Before implementing, check your plan's Asset Inventory section.**

1. **Copy** each asset using the cp commands from plan
2. **Reference** assets in code using destination paths from plan
3. **Verify** count: Plan says N assets → Code uses N assets

**The plan is your source of truth. Follow it completely.**

────────────────────────────────────────────────────────────────────────────────

{{uiDoc}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}


