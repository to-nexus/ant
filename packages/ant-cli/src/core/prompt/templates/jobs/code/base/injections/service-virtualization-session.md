## Service Virtualization — Session

### Principle

A virtualized adapter that answers one request correctly still fails the
startup-test when the running demo cannot be entered, navigated, or trusted to
remember itself. The mock adapter MUST simulate a coherent persistent session —
the cross-request, across-time layer above single-body realism. The blocks
below activate by this task's role in that session.

### Sibling SSOTs (defer)

| Sibling | Defer for |
|---|---|
| `service-virtualization-contract` | adapter activation env var; the closed-system invariant (no production-backend egress) |
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

{{#if svBodyLifecycleActive}}
### Body Lifecycle — every rendered surface non-empty · writes persist · references resolve

Your surface reads and writes the shared world. Hold these across time:

| Axis | Constraint |
|---|---|
| Multi-endpoint cardinality | Every key surface a chosen inhabitant can reach shows at least one record — no key surface is empty for the seeded inhabitant. |
| Mutation persistence | A write is visible to the very next read; its survival horizon (per-render / tab / origin / device) matches the surface's production durability expectation. |
| Cross-body reference | Ids this surface shows resolve to the SAME entity in the shared seed — reference it; do NOT re-seed your own identities or ids. |
{{/if}}

{{#if svAuthFlowActive}}
### Auth-Flow Fidelity

**Applies ONLY if this task authors a sign-in / identity surface or adapter (OAuth / SSO / magic-link / passkey). If this task does not touch the sign-in flow, skip this section.**

- **Preserve the production entry surface.** Do NOT replace an external-leg authentication surface (OAuth / SSO) with an ad-hoc credential form because the external leg is unreachable in mock mode — keep its shape and simulate the external leg's outcome inside the closed system.
- **Make identity an explicit choice.** Do NOT collapse a login attempt into instant, silent binding to one identity. Surface the seeded identities as a **selection affordance** (mirroring how an external authority presents account selection); from a fresh state, reaching an authenticated session requires at least one deliberate identity choice, and the chosen identity determines the session.
- **Do NOT conflate sign-up role-selection with login identity-selection.** Choosing a role during initial **sign-up** (which role a brand-new identity will hold) is a DIFFERENT event from choosing which already-seeded identity to authenticate as. The **returning-user** path MUST also reach the seeded-identity choice — implementing only the sign-up role step leaves a returning user silently bound to one default.
- **Per-authority fidelity.** When the entry offers a choice among several external authorities, the issued session's **linked authority equals the authority the chooser actually picked** — never a fixed default: selecting one yields a session linked to that authority, a different one yields the different one, and no selection resolves to an authority the chooser did not pick.
- **Callback URI is opaque — append only the grant.** The virtualized leg emulates only what the external authority contributes: the grant (`code` / `state` / token). Treat the handed redirect / callback URI as opaque and preserve it verbatim, appending only the issued grant; do NOT re-stamp a parameter the URI already carries, discard the URI, or invent a non-standard scheme. Derive the returned URL from **the redirect / callback URI you were actually handed** (equivalently the running app's **own origin at request time** / **runtime origin**) — do NOT **hardcode a fixed host** (a constant `localhost:PORT`, a deployment domain, or any **baked-in origin**). A hardcoded origin breaks the instant the app is served from a different origin, and a non-navigable target means the callback never fires and the demo is unenterable.
- **Identity is not terminal.** Returning to the selection affordance and **switching identity** requires no source or environment edit; where the surface gates capabilities or **scopes records** by identity, each seeded identity observes its own admitted surfaces and its own scoped records.
{{/if}}

### Blind Spot

The production-path mindset treats identity, authorization, and seeded content
as "things the user will provide later in production." In mock mode they are
not deferred — they are the user's only path into the running app. This is most
often missed when the gate, the entry path, and the session-issuing adapter leg
are authored by **different tasks** — each sees only its half and assumes the
rest is done. Whichever half you author, verify the WHOLE path closes; a
half-built gate is unenterable.
