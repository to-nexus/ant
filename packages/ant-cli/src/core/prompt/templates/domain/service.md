## Domain Identity — Service

**Activation gate**: `domain === 'service'`. Always-on for every job (plan / design / code / learn / ask). The gate decides nothing about tech stack, intent, or task type — those are orthogonal axes.

This partial states **what kind of project this is** so every downstream prompt shares a vocabulary about value, iteration cadence, and failure cost. Job-specific overlays (e.g. `jobs/plan/domain/service.md`) layer on top of this one.

### Core value axis

| Axis | Service prioritizes |
|---|---|
| Correctness vs novelty | **Correctness** — repeatable workflows must not regress |
| Stability vs delight | **Stability** — uptime / latency / data integrity |
| Scale vs feel | **Scale** — concurrent users, growing data volume |
| Compliance vs speed | **Compliance** — privacy / access control / audit are first-class |

### Iteration cadence

- Incremental — a new feature is **additive**, not a rewrite of existing flows
- Backward compatibility for existing data and integrations is the default
- Migration paths are explicit (versioned APIs, schema migrations, feature flags)

### Failure cost ranking (highest to lowest)

1. Data loss or corruption affecting user-owned records
2. Privacy / authorization breach (wrong user sees wrong data)
3. Availability degradation on a critical path
4. Performance regression on a high-frequency flow
5. Cosmetic or content drift

### First-class domain entities

- **Users / personas / roles** — who acts, with what permissions
- **Resources / records** — what is owned, by whom, with what lifecycle
- **Workflows / use-cases** — how actors operate on resources
- **Integrations** — external systems this domain talks to
- **Audit / observability** — who did what, when, with what outcome

### Universal constraint (every job)

Do NOT treat a service project like a game — there is no notion of "fun", "session", "core loop", or "fail-and-retry as design". Recovery from failure is a defect to fix, not a designed experience.
