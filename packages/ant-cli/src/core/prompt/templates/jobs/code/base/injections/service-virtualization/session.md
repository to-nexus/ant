## Service Virtualization — Session

### Principle

A virtualized adapter that answers one request correctly still fails the
startup-test when the running demo cannot be entered, navigated, or trusted to
remember itself. The mock adapter MUST simulate a coherent persistent session —
the cross-request, across-time layer above single-body realism. Identity, entry,
and authorization are IN scope: in mock mode they are not "things the user
provides later in production" — they are the user's only path into the running
app. The blocks below activate by this task's role in that session.

### Identity & entry behave like the real backend

A virtualized backend is observationally indistinguishable from the real one
behind a runtime toggle — so a mocked identity / session leg behaves like the
real backend, not like a shortcut. The wrong default is to stub identity as a
constant or an auto-bound session; the right behaviors fall out of the principle:

- **Never auto-bind a default identity (unconditional).** Reaching an
  authenticated session ALWAYS passes through the normal sign-in entry and a
  deliberate identity choice — no surface silently establishes a session at
  load. This applies to ANY identity-gated surface in mock mode.
- **Land a usable session.** The session-issuing leg yields a seeded identity
  carrying an admitted role — not a type-conformant-but-inert value, and not a
  perpetual loading / empty state the surface can never leave.
- **Persist identity mutations.** Linking / unlinking an external account, or
  any change to the identity, persists like any other write — visible to the
  very next read, never a constant the mutation cannot move.
- **Enter through the real sign-in surface.** Preserve the production entry
  surface's shape and simulate the external leg's outcome inside the closed
  system — do not replace it with an ad-hoc substitute because the external leg
  is unreachable in mock mode.

Navigable targets the entry depends on — the sign-in / authorize / redirect /
callback URLs the browser is sent to — are governed by
`service-virtualization-contract`'s navigable-target rule (they MUST resolve
INSIDE the closed system at the running app's own origin). This partial does not
restate that rule.

### Sibling SSOTs (defer)

| Sibling | Defer for |
|---|---|
| `service-virtualization-contract` | adapter activation env var; the closed-system invariant (no production-backend egress); navigable-target / callback-URL reachability |
| `service-virtualization-data` | field values within a single response body |
| `service-virtualization-imagery` | placeholder image fields |

{{#if svWorldSeedActive}}
### Demo World Seed — shared inhabitants · authorization · cross-body identity

You own the one seed every adapter projects from. Decide each axis before authoring it:

| Axis | Constraint |
|---|---|
| Inhabitants | At least one identity per role-shape the in-scope surfaces gate on, discoverable on the entry surface — never a silent default identity. |
| Authorization graph | At least one identity passes every gate the surfaces enforce; no identity carries a role no surface admits (dead role), no entity is unreachable (dead entity). The session-issuing leg returns a USABLE session body — a seeded identity carrying an admitted role — not a type-conformant-but-inert value. |
| Cross-body coherence | The seed is ONE world — every reference (ownership / membership / embed) resolves to the same record across endpoints. |

**Constraints:** derive identities / ids / ownership from a FIXED seed (never regenerate per render); names, emails, and ids follow the same domain-fit discipline as body fields (no filler or generic placeholders); never call the production backend to fetch or persist session state — the world is owned end-to-end by the adapter.
{{/if}}

{{#if svStoreLifecycleActive}}
### Store Lifecycle — writes persist · one store instance

You author the store every surface reads and writes through. Hold these across time:

| Axis | Constraint |
|---|---|
| Mutation persistence | A write is visible to the very next read; its survival horizon (per-render / per-session / per-origin / cross-device) matches the endpoint's production durability expectation. A handler that returns a modified copy of a record without writing it back to the backing store leaves the very next read stale — the modeled change never happened. |
| Store continuity | Back the virtualized world with ONE store instance that all consumers resolve and read/write through across mounts, navigations, and re-renders within the running session — a store constructed fresh per consumer / mount / provider makes a prior write invisible after navigation. This is the precondition for *Mutation persistence*: a write's visibility horizon follows its production durability only when every consumer shares one store. |
{{/if}}

{{#if svBodyLifecycleActive}}
### Body Lifecycle — every rendered surface non-empty · references resolve

Your surface reads the shared world. Hold these across time:

| Axis | Constraint |
|---|---|
| Multi-endpoint cardinality | Every key surface a chosen inhabitant can reach shows at least one record — no key surface is empty for the seeded inhabitant. |
| Surface is adapter-fed | Every data-bearing surface renders from the active adapter's response, not from a literal baked into the component — a surface populated by a hardcoded literal bypasses the virtualized world, so it never reflects the seed or any mutation. |
| Cross-body reference | Ids this surface shows resolve to the SAME entity in the shared seed — reference it; do NOT re-seed your own identities or ids. |
{{/if}}

### Blind Spot

The production-path mindset treats identity, authorization, and seeded content
as "things the user will provide later in production." In mock mode they are
not deferred — they are the user's only path into the running app. This is most
often missed when the gate, the entry path, and the session-issuing adapter leg
are authored by **different tasks** — each sees only its half and assumes the
rest is done. Whichever half you author, verify the WHOLE path closes; a
half-built gate is unenterable.
