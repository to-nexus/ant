## UI Specification Policy

### Follow the plan + active UI source

**Your plan contains an inventory derived from the active `UiSource` (ant / figma / handoff).** The per-source reading rules were injected via `ui-source-dispatch`.

**Implementation rules (source-agnostic):**

1. Cover every asset, token, or layout directive that the plan records.
2. Implement layout EXACTLY as the plan describes.
3. Apply component specs as the plan describes.
4. Reference design values by the keys or observable values the plan recorded.

**Critical:**

- If the plan lists N assets → the code MUST copy and reference all N.
- If the plan records responsive breakpoints → implement all of them.
- If the plan calls out decorative elements → they are NOT optional.
- When system-design and the active UI source conflict on visuals → the active UI source wins.

### Asset discovery principle

**Before implementing, check the plan's inventory.** Every asset, token, or layout item that reaches the code MUST be traceable to a plan line that itself was traceable to the active UI source.

1. Copy every asset using the commands from the plan.
2. Reference assets in code using the paths from the plan.
3. Verify count: plan says N → code uses N.
