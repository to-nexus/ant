{{#if layoutValidityFloorActive}}
## Layout Validity Floor — content sits in a contained, centered, responsive region

This task renders a content-bearing surface. Its primary content MUST occupy a
container with a **bounded maximum width** that stays **centered within the viewport**
on wide viewports, and that **adapts responsively** (narrow viewport: the container
fills the available width with edge breathing room; wide viewport: it stops growing
and centers, rather than stretching the content flush across the entire width).

**This is a structural validity floor, not visual treatment.** It is the layout sibling
of the no-flush-padding rule: just as content must not touch the container edge, a
content region must not stretch unbounded and pin to one side of a wide viewport. It
holds for EVERY renderable surface regardless of whether a visual design source is
present.

**Authority boundary (observe, do not override):** a design source / handoff governs
how the surface LOOKS — its colour, type, spacing rhythm, surface treatment. It does
NOT govern whether content is contained, centered, and responsive. When the source is
**silent on containment** (it shows components but not the page-level container), this
floor still applies — supply the contained, centered, responsive region yourself. Do
not read the source's silence as "let content stretch flush."

⚠️ **Blind spot — host/shell layouts.** A surface with a sidebar or navigation chrome
still owes its MAIN content region this floor: the presence of a fixed side column does
NOT satisfy containment of the content area. The content region beside the chrome MUST
itself be bounded, centered within its available space, and responsive — otherwise the
content pins flush to the chrome edge on wide viewports.
{{/if}}
