# Z-Index Layer Policy

## Overview
This document defines the z-index layering system for the Ant UI to ensure consistent stacking order across all components.

## Layer Hierarchy

```
┌─────────────────────────────────────────┐
│ 9999: Tooltips (최상위)                  │ ← Always on top
├─────────────────────────────────────────┤
│ 60: Notifications & Toasts              │ ← System alerts
├─────────────────────────────────────────┤
│ 50: Modal Overlays                      │ ← Blocks interaction
├─────────────────────────────────────────┤
│ 40: Dropdown Menus                      │ ← Above fixed headers
├─────────────────────────────────────────┤
│ 30: Fixed Headers/Footers               │ ← Persistent UI
├─────────────────────────────────────────┤
│ 20: Floating Action Buttons             │ ← Above content
├─────────────────────────────────────────┤
│ 10: Sticky Elements                     │ ← Slightly raised
├─────────────────────────────────────────┤
│  1: Task Cards & Workflow               │ ← Interactive elements
├─────────────────────────────────────────┤
│  0: Base Content                        │ ← Default layer
└─────────────────────────────────────────┘
```

## Layer Definitions

### Layer 9999: Tooltips (HIGHEST)
**z-index: 9999**
- Click-to-toggle tooltips
- Must be visible above EVERYTHING
- Single instance at a time (global state)
- **Rendered via React Portal to `document.body`**

**Components:**
- `<Tooltip>` component
- Token usage breakdown
- Time breakdown
- Help popovers

**Why 9999 + Portal?**
- Tooltips provide critical contextual information
- Must be visible above modals, workflow, cards, everything
- User-triggered information layer should never be obscured
- **Portal ensures escape from parent stacking contexts** (overflow, transform, filter, etc.)
- Even z-9999 alone cannot escape parent's stacking context without Portal

**Technical Implementation:**
```tsx
// ✅ Rendered to document.body via Portal
{tooltipContent && createPortal(tooltipContent, document.body)}
```

**Why Portal is Critical:**
- Parent components with `overflow: hidden` create new stacking contexts
- Parent components with `transform`, `filter`, or `position + z-index` also create new contexts
- Without Portal, child's z-index is only relative to parent's stacking context
- Portal bypasses ALL parent constraints by rendering directly to body

---

### Layer 60: Notifications & Toasts
**z-index: 60**
- System notifications
- Toast messages
- Critical alerts

**Examples:**
- Success/Error toasts
- System status alerts
- Browser notifications overlay

---

### Layer 50: Modal Overlays
**z-index: 50**
- Full-screen modals
- Dialog boxes
- Confirmation prompts
- Modal backdrop (z-index: 49)

**Components:**
- Modal dialogs
- Confirmation dialogs
- Settings panels

**Behavior:**
- Blocks interaction with underlying content
- Backdrop prevents clicks through

---

### Layer 40: Dropdown Menus
**z-index: 40**
- Select dropdowns
- Context menus
- Action menus
- Command palettes

**Components:**
- Select component dropdowns
- Right-click context menus
- Kebab menu (⋮) dropdowns

---

### Layer 30: Fixed Headers/Footers
**z-index: 30**
- App header/navbar
- Persistent footers
- Tab bars
- Bottom navigation

**Components:**
- Main navigation header
- Footer with actions
- Fixed toolbars

---

### Layer 20: Floating Action Buttons
**z-index: 20**
- FABs (Floating Action Buttons)
- Quick action buttons
- Scroll-to-top buttons

**Components:**
- Floating add/create buttons
- Quick access controls

---

### Layer 10: Sticky Elements
**z-index: 10**
- Sticky table headers
- Sticky sidebar sections
- Pinned cards

**Components:**
- `position: sticky` elements
- Scrollable containers with fixed headers

---

### Layer 1: Task Cards & Workflow
**z-index: 1**
- Task cards
- Workflow nodes
- Interactive kanban elements

**Components:**
- TaskCard components
- Agent Workflow diagram
- Kanban columns

**Why separate layer?**
- Needs to be above base content
- But below tooltips, modals, menus
- Maintains visual hierarchy

---

### Layer 0: Base Content
**z-index: 0 (or unset)**
- Regular page content
- Chat messages
- Lists
- Text

**Default behavior:**
- No explicit z-index needed
- Natural stacking order

---

## Tailwind CSS Classes

Use these standardized Tailwind classes:

```tsx
// Layer 9999: Tooltips (ALWAYS USE THIS)
className="z-[9999]"

// Layer 60: Notifications
className="z-60"

// Layer 50: Modals
className="z-50"

// Layer 40: Dropdowns
className="z-40"

// Layer 30: Fixed Headers
className="z-30"

// Layer 20: FABs
className="z-20"

// Layer 10: Sticky
className="z-10"

// Layer 1: Cards/Workflow
className="z-1"

// Layer 0: Base
className="z-0" // or omit
```

---

## Custom Tailwind Config

Add to `tailwind.config.js`:

```javascript
module.exports = {
  theme: {
    extend: {
      zIndex: {
        '1': '1',
        '60': '60',
        '9999': '9999',
      }
    }
  },
  // ✅ Enable arbitrary values for z-index
  safelist: [
    'z-[9999]'
  ]
}
```

---

## Usage Guidelines

### ✅ DO
- Use `z-[9999]` for ALL tooltips (no exceptions)
- Use defined layers consistently
- Document any exceptions
- Test stacking with overlapping elements
- Consider dark/light mode for all layers

### ❌ DON'T
- Use `z-50` for tooltips (TOO LOW)
- Use arbitrary z-index values without documentation
- Nest high z-index inside low z-index containers
- Mix Tailwind and inline styles for z-index

---

## Common Pitfalls

### Pitfall 1: Tooltip Clipping
```tsx
// ❌ BAD: Tooltip clipped by lower z-index parent
<div className="z-1">  // Task card
  <Tooltip content="Help">...</Tooltip>  // z-50 → CLIPPED!
</div>

// ✅ GOOD: Tooltip uses z-9999, appears above everything
<div className="z-1">  // Task card
  <Tooltip content="Help">...</Tooltip>  // z-9999 → VISIBLE!
</div>
```

### Pitfall 2: Multiple Tooltips Open
```tsx
// ❌ BAD: Each tooltip manages its own state
const [isOpen, setIsOpen] = useState(false);

// ✅ GOOD: Global state ensures only one tooltip at a time
// (Implemented in Tooltip component automatically)
```

---

## Testing Checklist

When adding new components with z-index:

- [ ] Test with modal open
- [ ] Test with dropdown open
- [ ] Test with tooltip visible (both token and time)
- [ ] Test with Agent Workflow visible
- [ ] Test with task cards
- [ ] Test in light mode
- [ ] Test in dark mode
- [ ] Test with multiple instances
- [ ] Test on mobile viewport
- [ ] Verify click-outside behavior

---

## Migration Notes

**Critical z-index updates:**

| Component | Old Value | New Value | Reason |
|-----------|-----------|-----------|--------|
| `Tooltip` | `z-50` | `z-[9999]` | ✅ **FIXED: Was being clipped** |
| Task Cards | unset | `z-1` | Establish base interactive layer |
| Workflow | unset | `z-1` | Match task cards |

---

## Related Components

- `Tooltip.tsx` - **z-[9999]** (Layer 9999) ✅ **HIGHEST**
- `Modal.tsx` - z-50 (Layer 50)
- `Dropdown.tsx` - z-40 (Layer 40)
- `Header.tsx` - z-30 (Layer 30)
- `TaskCard.tsx` - z-1 (Layer 1)
- `AgentWorkflow.tsx` - z-1 (Layer 1)

---

**Last Updated:** 2025-12-20 (Fixed tooltip z-index)
**Maintained By:** Frontend Team

