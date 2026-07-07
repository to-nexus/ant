## Implementation Identifiers

Ground every requirement in concrete identifiers the consuming code job can act on:

- **File paths** — e.g. `apps/console/app/api/auth/check/route.ts`.
- **Function / method names** — e.g. `verifyIdToken`, `saveToken`.
- **Route paths** the implementation step touches.
- **Env variables, command invocations, config entries.**
- **DTO field-level shapes** for fields the implementation step uses.
- **Verification gates** — success criteria plus how to verify each.

**Constraint**: Reference the sealed system-design / api-contract decisions by name; inline only the DTO fields or endpoint shapes the implementation step actually consumes. Do NOT re-derive architecture already sealed upstream.
