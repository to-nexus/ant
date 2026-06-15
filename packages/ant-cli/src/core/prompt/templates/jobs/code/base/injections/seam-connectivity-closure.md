{{#if (eq taskType "seam")}}
## SEAM — CROSS-FEATURE REFERENCE + AFFORDANCE CLOSURE (one module / package)

You own the **closure** of ONE module — the inter-feature seams that bind
separately-authored parts into an operable whole. Closure is **bidirectional**: a
part is bound when the references it emits resolve AND, if it has a reach-role,
something actually reaches it. You run AFTER all authoring (feature AND ui), so
the module is fully materialized and observable, including the controls and
navigation the ui layer introduced. A *reference* is any
address this module emits to a destination it does not itself define: a
navigation target, an invoked endpoint/handler, an emitted event or message key,
an injected/required dependency, an imported symbol, **a style-selector a
rendered element names** (a class/selector whose visual definition lives in the
styling source — absent from it, the element renders but is silently unstyled).
An *affordance* is any rendered control whose purpose is to cause an effect
(create, open a detail, transition, switch identity/mode, edit).

{{#if seamPlanning}}
{{#unless isSliceDeclaration}}
**Planning (this whole module — enumerate over a fixed denominator, then partition):**
Your enumeration is not a recall sweep — it has an explicit denominator. The
manifest of files prior tasks already authored is available to you; **restrict it
to the files under THIS module's own path, and treat that file set as your
denominator.** Walk it file by file in BOTH directions. **Outbound** — for EACH file, account
for every reference it emits (navigation/call/event/dependency/import/style-selector)
and every interactive control it renders, and record each as resolved, to-fix, or
to-remove. **Inbound** — for each part the module authored that has a reach-role
(a routable surface, an attachable/embeddable component, a named mount/extension
slot), account for whether anything actually reaches it: routes to it, mounts it,
or fills it. A reach-role part nothing reaches is recorded to-wire or to-remove,
exactly like a reference that reaches nothing. A file left unexamined — in either
direction — is a hole in the closure. Where parts diverge on a shared
destination, decide ONE canonical authority (or, when the destination is owned by
another module, conform to that module's published contract — do not redefine it).

Then partition the recorded fixes into **slices that write disjoint file sets**.
You may remediate inline ONLY when every fix touches a single disjoint file set;
when the fixes span more than one disjoint file set, emit ONE batch per file set —
do not collapse them into a flat plan. (Thorough enumeration over the denominator
will normally span several file sets, so partition is the expected outcome, not the
exception.) When slices must run in a fixed order (one slice's closure depends on
another's), put them in the SAME `parallelGroup` and order them with
`priorityInParallelGroup`; independent slices take distinct groups so they run in
parallel. Derive every address from what the destination actually defines, never
from intent or recall.
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
- **Reach-role parts are reached (the closure is bidirectional).** Just as a
  reference that resolves to nothing is a defect, a part the module authored that
  HAS a reach-role yet nothing reaches is the same defect mirrored: a routable
  surface no navigation targets, an attachable/embeddable component nothing mounts,
  a named mount/extension slot left empty (a placeholder waiting for a sibling that
  was authored elsewhere but never wired in). Each builds green and is silently
  dead — unreachable, exactly like a reference that reaches nothing. Resolve by
  wiring it to its intended host (route it; mount the component into the slot that
  declared it, conforming to the host module's contract when the host lives in
  another module); remove it only when no requirement backs it. Both ends already
  exist in the materialized code — this is observation, not intent recall.
- **Style-selectors resolve.** Every class/selector a rendered element names MUST
  be defined in the styling source (authored stylesheet or generated by the
  configured styling framework). A named selector absent from it builds green and
  silently renders the element unstyled. Resolve by conforming the element to a
  selector the styling source defines, or — when this module owns that styling
  source — adding the missing definition; never leave a named selector the styling
  source does not back.
- **Gated entry lands.** Where access depends on an established identity/session,
  the transition firing ON success MUST be owned and reachable — not assumed
  elsewhere. "Lands" means the entry the consumer is sent to **resolves within the
  closed system** (the running app's own runtime origin) and **completes back into
  an authenticated session** — a target that typechecks but cannot be navigated to
  or completed (a placeholder/blank/external address) dead-ends the gate and is a
  defect to resolve, exactly like a reference that resolves to nothing.
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
