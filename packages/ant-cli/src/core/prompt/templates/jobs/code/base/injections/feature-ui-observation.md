{{#if featureObservesUiSource}}
## Renderable Feature — Observe the UI Source for Affordances (not styling)

This task builds a **renderable** surface. A UI design source is present in your
inputs (visible in the action-context inventory) — **observe it** to learn the full
set of **affordances, controls, and content** the surface must expose, then **build
and wire every one of them**. Read the source on-demand from the inventory path
(its bodies are not pre-loaded here — the paired styling pass loads those).

**What you own (affordance existence + wiring):** every control the design shows —
links, buttons, menu entries, tabs, secondary actions, popovers/dialogs an action
opens, the navigation a control triggers, and the content the surface displays —
MUST exist and reach a real destination/handler. This includes affordances the
written requirements (PRD / spec) do NOT enumerate but the design implies: when the
design shows a control and the requirements are silent, build the control and wire
it to the destination the design indicates (creating the destination when a
requirement backs it). A control that the design shows but that you render inert
(a placeholder target, a handler that does nothing) is an unfinished affordance, not
a deferral.

**What you do NOT own (styling):** do NOT apply visual styling tokens, theme values,
spacing/colour/typography systems, or asset polish — the paired styling task owns the
visual pass. "Headless" means unstyled, NOT affordance-blind: structure + behaviour
complete, visual polish deferred.

**Observation discipline:** report only what the source actually shows; do not invent
controls the design does not contain, and do not drop ones it does. Where the design
and the requirements diverge on whether an affordance exists, the design's presence of
a control is authority that the control must exist and work.
{{/if}}
