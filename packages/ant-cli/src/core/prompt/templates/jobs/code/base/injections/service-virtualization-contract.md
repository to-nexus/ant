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
  adapters MUST return the identical observable shape
- A returned value that satisfies the interface TYPE but is not USABLE for
  what the consumer does with it is still a contract defect — type-conformance
  alone is not enough. A value the consumer navigates to, fetches,
  dereferences, or parses MUST actually work in that operation (a URL the
  consumer can navigate to or fetch; an id that resolves to a record; a token
  the consumer accepts) — not merely a string of the right type. The
  virtualized adapter is the consumer's only proof the path works before the
  real dependency arrives; a value that typechecks but cannot be acted on
  leaves the consumer dead-ended.

### Blind Spot

**The adapter pair is EASILY FORGOTTEN when focus stays on the production
path.** Every external-dependency port = production adapter + virtualized
adapter + per-connection toggle var documented in `.env.example`. If only
one of the three appears in your plan, the plan is incomplete.
