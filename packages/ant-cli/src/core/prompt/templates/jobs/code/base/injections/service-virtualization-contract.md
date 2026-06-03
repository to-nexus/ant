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
`preview-env-contract.md §4.5`.** SV adapter selection code reads from
exactly that name. Do not invent or shorten it (`USE_MOCK_API`,
`MOCK_BACKEND`, ad-hoc abbreviations, etc. are defects).

### .env / .env.example Discipline

- Every `business` `@connection` MUST have its toggle line declared in
  `.env.example` with a comment describing what the virtualized adapter
  provides — exact toggle name per `preview-env-contract.md §4.5`
- The master broadcast toggle MAY be present in `.env.example` to
  default-broadcast every business connection that lacks a per-connection
  override — same naming rule applies
- `.env` MUST mirror `.env.example` keys (per existing
  `preview-env-contract` invariant)
- Adapter-specific config that ONLY the virtualized adapter reads MUST
  also appear in `.env.example` so the contract is self-documenting

### Constraints

- Virtualization activation MUST come from boolean env var(s) only — NOT
  derived from `NODE_ENV`, build mode, or any environment-level flag
- Adapter pair MUST satisfy the same interface contract (TypeScript
  interface, Go interface, Python protocol — language equivalent)
- A virtualized adapter that diverges from the production adapter's DTO
  shape, error mapping, or status code mapping is a contract defect — both
  adapters MUST return the identical observable shape

### Blind Spot

**The adapter pair is EASILY FORGOTTEN when focus stays on the production
path.** Every external-dependency port = production adapter + virtualized
adapter + per-connection toggle var documented in `.env.example`. If only
one of the three appears in your plan, the plan is incomplete.
