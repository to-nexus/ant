{{#if (eq taskType "seam")}}
## SEAM — CROSS-FEATURE REFERENCE + AFFORDANCE CLOSURE (one module / package)

You own the **closure** of ONE module — the inter-feature seams that bind
separately-authored parts into an operable whole. You run AFTER all authoring
(feature AND ui), so the module is fully materialized and observable, including
the controls and navigation the ui layer introduced. A *reference* is any
address this module emits to a destination it does not itself define: a
navigation target, an invoked endpoint/handler, an emitted event or message key,
an injected/required dependency, an imported symbol. An *affordance* is any
rendered control whose purpose is to cause an effect (create, open a detail,
transition, switch identity/mode, edit).

{{#if seamPlanning}}
{{#unless isSliceDeclaration}}
**Planning (this whole module — enumerate & partition):** Enumerate this module's
references AND rendered affordances over the materialized code — every
navigation/call/event/dependency/import that crosses a part boundary, and every
interactive control the surfaces render. Where parts diverge on a shared
destination, decide ONE canonical authority (or, when the destination is owned by
another module, conform to that module's published contract — do not redefine it).
Then partition the remediation into **independent slices that write disjoint file
sets** and emit them as batches; if the work is small, remediate inline. When
slices must run in a fixed order (one slice's closure depends on another's), put
them in the SAME `parallelGroup` and order them with `priorityInParallelGroup`;
independent slices take distinct groups so they run in parallel. Derive every
address from what the destination actually defines, never from intent or recall.
{{/unless}}
{{#if isSliceDeclaration}}
**This is one slice.** Remediate ONLY the references/affordances in your declared
slice. Do NOT re-enumerate the whole module and do NOT re-partition — your slice
boundary is non-negotiable.
{{/if}}
{{/if}}

**Remediation — resolve OR remove (your scope):** Observe, do not assume:
- **References resolve.** Every reference MUST reach a real, registered
  destination. If the destination is missing and belongs to this module, create
  it; if it belongs to another module, conform your reference to that module's
  published contract; if the reference is wrong, correct it. A reference resolving
  to nothing builds green and fails at runtime (a dead link, a 404, an unhandled
  call, an event no one consumes, an unprovided dependency).
- **Affordances resolve or are removed.** Every rendered control meant to cause an
  effect MUST reach the surface/handler that performs it — wire it or implement
  it; never a no-op or a deferral comment. A control whose destination is defined
  by NO part of the system — a visual element rendered because a design reference
  showed it, with no requirement behind it — has no legitimate effect to reach: it
  MUST be removed, not left inert. Resolve when a destination exists; remove when
  none does. Never leave a dead control.
- **Gated entry lands.** Where access depends on an established identity/session,
  the transition firing ON success MUST be owned and reachable — not assumed
  elsewhere.
- **One authority per shared contract.** References to the same destination MUST
  derive from ONE shared definition (the producer owns it); this module conforms
  rather than carrying a divergent copy. Consolidate duplicated derivations.

**Constraints:**
- This is closure remediation, NOT a build/test run. Do NOT run build/typecheck/
  dev/test — physical verification is a separate stage.
- Preserve existing behavior and presentation; change only what closes a seam
  (resolve a reference/affordance, or remove a control that resolves to nothing).
- Write only this module's files; read other modules' surfaces/contracts read-only.
- How references are physically expressed (a route tree the filesystem produces, a
  router registration, a constants module, an event registry, a DI container) is
  pinned by the framework guidance injected for this run — follow it; derive, do
  not re-invent.
{{/if}}
