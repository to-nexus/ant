{{#if (eq taskBand "seam")}}
## SEAM BAND — CROSS-FEATURE REFERENCE CLOSURE (one module / package)

You own the **reference closure** of ONE module — the inter-feature seams that bind
separately-authored parts into an operable whole. A *reference* is any address this
module emits to a destination it does not itself define: a navigation target, an
invoked endpoint/handler, an emitted event or message key, an injected/required
dependency, an imported symbol. You run after all feature/integration work, so the
module is materialized and observable.

{{#if seamPlanning}}
{{#unless isSliceDeclaration}}
**Planning (this whole module — enumerate & partition):** Enumerate this module's
references over the materialized code — every navigation/call/event/dependency/import
that crosses a part boundary. Where parts diverge on a shared destination, decide ONE
canonical authority (or, when the destination is owned by another module, conform to
that module's published contract — do not redefine it). Then partition the remediation
into **independent slices that write disjoint file sets** and emit them as batches; if
the work is small, remediate inline. Derive every address from what the destination
actually defines, never from intent or recall.
{{/unless}}
{{#if isSliceDeclaration}}
**This is one slice.** Remediate ONLY the references in your declared slice. Do NOT
re-enumerate the whole module and do NOT re-partition — your slice boundary is
non-negotiable.
{{/if}}
{{/if}}

**Remediation (your scope):** Close these reference seams; observe, do not assume:
- **References resolve.** Every reference MUST reach a real, registered destination. If
  the destination is missing and belongs to this module, create it; if it belongs to
  another module, conform your reference to that module's published contract; if the
  reference is wrong, correct it to the real address. A reference resolving to nothing
  builds green and fails at runtime (a dead link, a 404, an unhandled call, an event no
  one consumes, an unprovided dependency).
- **Actions reach their effect.** Every control or call meant to cause an effect MUST
  reach the surface/handler that performs it — wire it or implement it; never a no-op
  or a deferral comment.
- **Gated entry lands.** Where access depends on an established identity/session, the
  transition firing ON success MUST be owned and reachable — not assumed elsewhere.
- **One authority per shared contract.** References to the same destination MUST derive
  from ONE shared definition (the producer owns it); this module conforms rather than
  carrying a divergent copy. Consolidate duplicated/fragmented derivations within it.

**Constraints:**
- This is reference-closure remediation, NOT a build/test run. Do NOT run build/
  typecheck/dev/test — physical verification is a separate stage.
- Preserve existing behavior and presentation; change only what closes a seam.
- Write only this module's files; read other modules' surfaces/contracts read-only.
- How references are physically expressed (a route tree the filesystem produces, a
  router registration, a constants module, an event registry, a DI container) is pinned
  by the framework guidance injected for this run — follow it; derive, do not re-invent.
{{/if}}
