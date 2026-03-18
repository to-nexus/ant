## 🎨 UI DESIGN DOCUMENTS GUIDE

### FOR `ui` TYPE TASKS: Observe Skeleton Before Styling

**Principle**: Skeleton files are authoritative for component STRUCTURE.
ui-spec (or visual hints from plan) is authoritative for visual PROPERTIES.
These are orthogonal inputs — read skeleton first.

**Constraint**: Read skeleton files FIRST. The DOM elements defined in the skeleton
are the contract — do NOT add, remove, or rename them. You MAY extract sections into
separate component files when complexity warrants it (same DOM, different file organization).

---

### Purpose

UI documents define the **authoritative specification** for visual implementation.

**Document Hierarchy:**
- **ui-spec.json**: Layout structure, arrangement, visual behaviors (with CSS-like properties)
- **ui-tokens.json**: Design values (colors, spacing, typography)
- **ui-assets.json**: Asset mappings (source → destination)

---

### ⚠️ UI IMPLEMENTATION PRIORITY RULE

**ui-spec is authoritative for layout. Follow it exactly.**

| Aspect | Source | Your Action |
|--------|--------|-------------|
| Layout properties (`flexDirection`, `alignItems`, `grid*`) | **ui-spec** | **Follow exactly** |
| Spacing values | **ui-spec** or **ui-tokens** | **Follow exactly** |
| Colors, typography | **ui-tokens** | **Follow exactly** |
| Visual behaviors (fills, overlays, crops) | **ui-spec** | **Follow exactly** |
| Asset paths | **ui-assets** | **Follow exactly** |
| **Not specified in ui-spec** (hover, transitions, focus rings) | Apply WCAG 2.1 AA accessibility defaults and framework conventions |

---

### Key Principle

```
ui-spec specifies WHAT + HOW for layout (CSS-like properties).
Code Job translates to framework syntax.
Unspecified details follow framework best practices.
```

**Division of Responsibility:**
- **Design Job**: Observes screenshot → Decides layout (flexDirection, alignItems, etc.)
- **Code Job**: Reads spec → Translates to framework (Tailwind, CSS, styled-components)
- **Unspecified parts**: Code Job uses best practices (hover states, transitions, accessibility)

---

### Conflict Resolution

- ui-spec specifies layout + system-design silent → **ui-spec wins**
- ui-spec and PRD conflict → **ui-spec wins for visual, PRD wins for behavior**
- ui-spec silent on detail → **Your decision (framework best practice)**

---
