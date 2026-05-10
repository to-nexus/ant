## Decompose Responsibility by Tier

**Principle**: Decompose's depth of thought varies by `executionTier`. The matrix below states what decompose owns at each tier — apply the row that matches the tier you classified above. Solution detail is always the per-task `plan` node's responsibility (15 rounds of tool-loop reasoning per task), regardless of tier.

### Tier 4 — Document-Anchored Decomposition

**Authority**: The reference document IS the problem definition. Faithful enumeration, not problem discovery.

**Observation target**: Every numbered unit / section / requirement / acceptance criterion in the active reference document.

**Constraints**:
- Every enumerated unit MUST appear as a distinct `<task>`. Do NOT collapse multiple enumerated units into one task. Do NOT silently drop units. Do NOT invent units the document does not list.
- The breakdown is faithful to the document — not optimized for brevity.
- Tool calls (`read_file` / `list_files`) are available but should be used sparingly — the document is the authority. Codebase ground-truth verification belongs to the per-task `plan` node, not here.

### Tier 3 — Problem Discovery, Not Solution Discovery

**Context**: No reference document grounds the breakdown. The directive states an outcome; identify the **unit-level problems** that, when each solved, produce that outcome.

**Two distinct mental moves**:
1. **Problem identification** (decompose's job) — "What unit problems exist? What surfaces / boundaries / cross-cutting concerns will need attention?"
2. **Solution design** (NOT decompose's job — per-task `plan`) — "How exactly do we fix this? Which file? Which signature?"

**Constraints — what decompose decides**:
- Stop at unit-of-work granularity. A task scopes a problem, not a solution.
- Forbidden in `name` / `description`: concrete file paths, concrete API names / signatures, concrete data structures, prescribed implementation steps, "use library X / approach Y".
- Required in `name` / `description`: the user-visible outcome the unit owns, the surface to investigate, the type of problem to solve.
- Cross-cutting concerns the directive implies (auth boundaries, error states, edge cases, integration points) MUST surface as their own task or as explicit scope notes — do NOT assume per-task `plan` will discover them in isolation.
- Tool calls (`read_file` / `list_files`) are encouraged when the directive's surface is unclear — read codebase entry points or list directory structure to validate boundary candidates BEFORE emitting tasks. The same toolset the per-task `plan` uses is available here.

**Shape constraints**:
- A Tier 3 directive case where deep-think converges on a single coherent unit is a **legitimate `[feature × 1 + verification × 1]` shape** (2 tasks total, satisfies the `>= 2` rule). The `plan` node may later fan out into N siblings via `batches[]`; that fan-out MUST NOT be pre-decided here.
- A Tier 3 directive case is `[feature × N + verification × 1]` ONLY when the directive itself names a clear, unambiguous physical isolation (different package, different runtime layer such as FE/BE, different artefact file). Otherwise default to the single-feature shape and let `plan` decide.
- When the directive names multiple independent app/package entry points, keep wiring decomposition aligned to each entry-point boundary (one wiring owner per integration point), rather than forcing a project-global singleton wiring task.

**Boundary heuristics**:
- Over-split warning: if two adjacent tasks would share most of the investigation surface, they are likely one unit. Combine.
- Under-split warning: if one task spans clearly distinct surfaces (FE vs BE, different packages, different runtime layers), split.

**Self-check before emitting `<tasks>`**:
- Have I identified what is genuinely problematic about this directive, not just rephrased its words?
- Are there implicit surfaces (auth, error handling, persistence, observability) the directive does not name but the outcome requires?
- Would a thoughtful engineer reading this list say "yes, that's the actual scope" — or "you're missing X" / "X and Y are the same task"?

### Tier 2 — Single-Unit Problem Identification

**Context**: The directive describes a single unit of work. Confirm it IS a single unit and state its precise boundary.

**Constraints**:
- Emit exactly one `<task>` with `selfVerifyOnDone: true`.
- If the directive secretly hides ≥2 units (e.g., "fix login + add logout button"), classify as Tier 3 instead.
- The task's `description` states the unit's scope and the user-visible outcome — NOT the fix. Forbidden / Required clauses from Tier 3 apply identically (no concrete file paths / API names / implementation steps).
- Solution design (which file, which approach) is the `plan` node's job in this same task.
- Tool calls are available; use them sparingly when boundary ambiguity exists ("is this really one unit?").

**Self-check**:
- Is this genuinely one unit, or am I compressing two units into one task?
- Does the description tell `plan` what problem to solve, without telling it how?

### Tier 0 / 1 — Out of Scope for This Section

These tiers emit empty `<tasks>` (the `direct` node handles the actual answer / single-write). The constraints above do not apply at Tier 0 / 1; refer to the Output Shape table for emission rules at those tiers.
