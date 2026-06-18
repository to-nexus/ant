## Spatial System: Validity Floor

A UI design source is the authority for this product's spacing values — its
rhythm, scale, and density govern. This floor does NOT introduce a competing
scale; it states only the structural spacing invariants that must hold whatever
values the source defines, so a source that omits a value never yields a broken
layout.

**Observable invariants (a property, not a px scale):**
- A container that holds content establishes padded boundaries — content does
  NOT render flush against its container's edges. When the source specifies the
  container's padding, that value governs; when the source is silent on a
  container that visibly holds content, give it padding consistent with its
  siblings rather than leaving it at zero.
- Spacing is consistent across sibling surfaces — comparable containers (cards,
  panels, list rows, page bodies) share a comparable inset rather than each
  drifting to its own arbitrary value or to none.
- Separation between distinct content groups is observable — adjacent sections
  read as distinct, not run together.

**Constraint**: This is a floor, not a system. Do NOT invent a numeric scale or
override a spacing value the design source defines — only ensure no content-
bearing container renders with absent or inconsistent spacing.
