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

Refer to the **Visual Source Authority** section for priority rules and conflict resolution.

---
