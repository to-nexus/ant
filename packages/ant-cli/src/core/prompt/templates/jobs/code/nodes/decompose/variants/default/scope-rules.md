## Scope Determination

### Development Source Rule

**Observation target**: What is the primary development source for this job?

The development source is decided upstream by the intent and the user's artifact selection (`role='ref'` artifacts). You do NOT choose it.

| Condition | Development Source | Everything Else |
|-----------|-------------------|-----------------|
| A spec artifact is present with `role='ref'` | That spec document | Reference only |
| Design docs are the only `role='ref'` artifacts | The referenced design docs | Reference only |
| No `role='ref'` artifacts | The directive text | Reference only |

**Constraint**: Tasks are generated ONLY from the Development Source. Artifacts with `role='context'` provide implementation context but do NOT expand scope.

**Constraint**: Do NOT emit a separate spec-selection tag — the single active spec (if any) is already fixed by the incoming refs.

### Codebase Reality

**Constraint**: When existing code is detected, the codebase is the source of truth for what exists. Do NOT create tasks to rebuild what the codebase already contains.
