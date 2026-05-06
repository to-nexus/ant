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

### Switching Contract — Per-Connection × Master Fallback

| Layer | Variable | Resolution priority |
|---|---|---|
| Per-connection | `USE_MOCK_<NAME>` (uppercase snake of @connection name) | first |
| Master fallback | `USE_MOCK` | applies when per-connection unset |
| Default | `false` (production adapter active) | applies when both unset |

### .env / .env.example Discipline

- Every `business` `@connection` MUST have its `USE_MOCK_<NAME>` line in
  `.env.example` with a comment describing what the virtualized adapter
  provides
- Master `USE_MOCK` MAY be present in `.env.example` to broadcast-default
  every business connection that lacks a per-connection toggle
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
  shape, error mapping, or status code mapping is a contract defect —
  the verification phase will catch it on a parity run

### Blind Spot

**The adapter pair is EASILY FORGOTTEN when focus stays on the production
path.** Every external-dependency port = production adapter + virtualized
adapter + per-connection toggle var documented in `.env.example`. If only
one of the three appears in your plan, the plan is incomplete.
