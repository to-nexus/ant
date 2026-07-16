## Implementation Identifiers

Ground every requirement in concrete identifiers the consuming code job can act on:

- **File paths** — e.g. `apps/console/app/api/auth/check/route.ts`.
- **Function / method names** — e.g. `verifyIdToken`, `saveToken`.
- **Route paths** the implementation step touches.
- **Env variables, command invocations, config entries.**
- **DTO field-level shapes** for fields the implementation step uses.
- **Real asset files** — real files may already be placed under `assets/service/`. Survey them (`list_assets`) and, when a file is relevant to a requirement, reference it by its exact `assets/service/...` path so the code step knows to place and wire it. Do NOT invent asset paths that no file backs.
- **Verification gates** — success criteria plus how to verify each.

**Constraint**: Reference the sealed system-design / api-contract decisions by name; inline only the DTO fields or endpoint shapes the implementation step actually consumes. Do NOT re-derive architecture already sealed upstream.

**Constraint — realization ceiling**: Record identifiers, signatures, and field shapes — never function/component bodies. A fenced block of executable implementation (roughly 10+ lines of statements) is the code job's output leaking into the spec; replace it with the signature, the state/props field names it must expose, and the verification gate that proves the behavior. Wire shapes, env vars, commands, and config values stay exact — those are contract, not realization.
