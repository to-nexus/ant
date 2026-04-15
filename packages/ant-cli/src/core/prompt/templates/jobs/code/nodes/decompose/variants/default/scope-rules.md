## Scope Determination

### Single Active Spec Rule

**Constraint**: At most ONE spec document may be active. If you select a spec via `<selectedSpec>`, that spec is THE Plan — the sole basis for task generation.

**Constraint**: Do NOT generate tasks from any other spec document. Previous specs referenced in job-history are completed plans.

### Development Source Rule

**Observation target**: What is the primary development source for this job?

| Condition | Development Source | Everything Else |
|-----------|-------------------|-----------------|
| Active spec exists (selectedSpec) | The spec document | Reference only |
| Directive references specific design docs (no spec) | The referenced docs | Reference only |
| Directive alone (no spec, no doc reference) | The directive text | Reference only |

**Constraint**: Tasks are generated ONLY from the Development Source. Documents outside the source provide implementation context but do NOT expand scope.

{{#if hasJobHistory}}
### Completed Work Boundary

**Observation target**: What was already accomplished in previous jobs?

**Constraint**: Job-history entries marked `[Result]` represent completed work. Do NOT create tasks that duplicate completed work.

**Constraint**: Documents listed as `Based on:` or `Design refs:` in job-history results were consumed by previous jobs. They are available as architectural context but are NOT a basis for new task generation — unless the current directive explicitly requests changes to previously built features.

**Scope** = (Current Development Source requirements) − (Completed work from job-history)
{{/if}}

### Codebase Reality

**Constraint**: When existing code is detected, the codebase is the source of truth for what exists. Do NOT create tasks to rebuild what the codebase already contains.
