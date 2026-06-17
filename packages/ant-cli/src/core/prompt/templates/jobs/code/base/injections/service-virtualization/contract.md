## Service Virtualization Contract

### Principle

**External dependencies (third-party APIs, peer services, cross-project
references) MUST be reachable through a port whose production and
virtualized adapters are wired side-by-side. The runtime selects the
active adapter via env var; both adapters satisfy the SAME interface
contract.**

This is the implementation of Service Virtualization at the code-job
level. Local infrastructure (database, cache, queue via docker-compose)
is real and is NOT a virtualization target.

### Switching Contract

Activation MUST come from a boolean env var per business connection, with
a master broadcast variable as fallback when the per-connection toggle is
unset. Default (both unset) is `false` — production adapter active.

**The concrete env var name follows the framework-aware naming rule in
`preview-env-contract.md §4.5`** (form `USE_MOCK_<NAME>`; an adapter
selected in client-bundled code requires that runtime's client-exposure
prefix). The adapter selection code reads from exactly that name. A toggle
name not derived from the connection name, or missing the client-exposure
prefix where the adapter is selected in client code, is a defect — it
inlines as undefined and the production adapter activates silently.

### .env / .env.example Discipline

Toggle declaration, the master-broadcast fallback, the `.env` ↔
`.env.example` mirror, and any adapter-specific config the virtualized
adapter reads are all governed by `preview-env-contract.md §4.5`.

### Constraints

- Virtualization activation MUST come from boolean env var(s) only — NOT
  derived from `NODE_ENV`, build mode, or any environment-level flag
- Adapter pair MUST satisfy the same interface contract (TypeScript
  interface, Go interface, Python protocol — language equivalent)
- A virtualized adapter that diverges from the production adapter's DTO
  shape, error mapping, or status code mapping is a contract defect — both
  adapters MUST return the identical observable shape. "Observable shape" is
  the field / type / error / status contract the consumer branches on — NOT
  the concrete reachability of a navigable target (next bullet). Where the
  production value resolves OUTSIDE the closed system (a URL pointing at a
  third-party host, an externally-issued grant), parity is satisfied by an
  equivalently-shaped value that resolves INSIDE the closed system — never by
  mirroring the external host itself
- A returned value that satisfies the interface TYPE but is not USABLE for
  what the consumer does with it is still a contract defect — type-conformance
  alone is not enough. Every value the consumer acts on — navigates to,
  fetches, dereferences, renders, or parses — MUST actually carry out that
  operation, not merely be a value of the right type. The virtualized adapter
  is the consumer's only proof the path works before the real dependency
  arrives; a value that typechecks but cannot be acted on dead-ends the
  consumer exactly like a wrong-typed value. State the requirement as ONE
  positive property and let it bind every form: **a usable value is one the
  consumer's own resolution mechanism can carry through to completion against
  the running system itself.**
  - A navigable target is usable when it is expressed in a form that mechanism
    can actually follow AND its destination is one the running app itself
    serves (so the app can answer it). Being free of an external host is not
    sufficient — a value can name no external host and still be unusable if its
    form is one nothing the consumer runs against can resolve.
  - An identifier is usable when it resolves to a seeded record.
  - A token / grant is usable when the consumer's own verification accepts it.
  A value the consumer cannot carry to completion fails this property however
  it is malformed — there is no catalogue of bad shapes to match against, only
  the one property to satisfy. This binds EVERY method of every virtualized
  adapter, including a single such value folded among many data methods — not
  only a dedicated redirect/auth adapter.
- **An externally-issued grant or callback** (a sign-in / authorization / payment
  return the consumer dereferences) follows the same property, with one added
  discipline: the virtualized leg emulates only what the external authority
  contributes — the grant (`code` / `state` / token). Treat the redirect /
  callback URI the consumer hands you as OPAQUE — preserve it verbatim and append
  only the issued grant; do NOT discard it, re-stamp a parameter it already
  carries, or invent a non-standard scheme. Derive the returned URL from the
  redirect / callback URI **you were actually handed** — equivalently the running
  app's **own origin at request time** (its **runtime origin**) — never
  **hardcode a fixed host** (a constant `localhost:PORT`, a deployment domain, or
  any **baked-in origin**): a baked-in origin breaks the instant the app is served
  from a different origin. A redirect step that **no-ops** — navigates nowhere, on
  the reasoning that mock mode has no real authority to send the browser to —
  leaves the entry unreachable and the sign-in unable to even begin; in the closed
  system that redirect MUST carry the browser to the in-app authorize / return
  surface the running app itself serves.
- A virtualized method MUST return a usable, seeded value at the time it is
  called — not an empty/absent placeholder whose real body is deferred to "a
  later unit". A method that returns nothing usable (an absent value, or an
  empty collection where the consumer needs populated data) and leaves the real
  body to some unnamed future task is an incomplete adapter: unless that owner
  is named and scheduled, the value stays permanently empty and every consumer
  of it dead-ends. A surface that is genuinely empty by design is fine — the
  defect is deferring a body the consumer needs to no owner.

### Blind Spot

**The adapter pair is EASILY FORGOTTEN when focus stays on the production
path.** Every external-dependency port = production adapter + virtualized
adapter + per-connection toggle var documented in `.env.example`. If only
one of the three appears in your plan, the plan is incomplete.

**A virtualized method that returns empty/absent and defers the real body to "a
later unit" reads as done but is not.** When a method hands back nothing the
consumer can use and the real body is left to some future task, that task's
owner must be named and scheduled — an unowned deferral leaves the surface
permanently empty.
