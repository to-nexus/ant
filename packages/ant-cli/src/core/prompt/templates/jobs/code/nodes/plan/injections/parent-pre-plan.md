{{#if hasPrePlanText}}
────────────────────────────────────────────────────────────────────────────────
## Parent Sub-Task Pre-Plan (input from batch-split)
────────────────────────────────────────────────────────────────────────────────

**Observation target**: a JSON pre-plan produced by the parent task when it
fanned out into physically-isolated sub-tasks. Two shapes appear here:

- **Slice declaration** (feature / ui / design-system fan-out — the common
  case): `task.goal`, `goal`, `rationale`, optional `requiredFiles`, and
  `parentReasoning`. The parent declared *which slice you own* and the
  *cross-batch contracts* siblings agreed on; the slice's internal
  `modify[]` / `create[]` / `delete[]` plan is YOUR responsibility to
  author below.
- **Diagnostic carry** (error / test-code fan-out): includes
  `implementation.*` arrays and may include `diagnostics.rootCauses[]`.
  The parent already inspected the failure and assigned each entry to a
  root cause. Use the implementation block as the basis of your plan and
  refine only where you observe divergence from sibling outputs.

**Authority**: This pre-plan is your INPUT, not your output. The `planText`
you emit replaces it for execute — execute consumes only `planText` and has
no visibility into this block.

**⚠️ Blind spot**: Sibling sub-tasks ran in parallel. Their actual file
outputs may diverge from what `parentReasoning` predicted (exact export
names, file paths, directory placement). Verify before relying on a
sibling-owned reference.

**Constraints**:
- **Slice boundary is non-negotiable**: `task.goal` / `rationale` fixes
  what you own. Do NOT widen scope into a sibling's slice, even if the
  `parentReasoning` mentions related work.
- **Cross-batch contracts are non-negotiable**: any export name, file
  path, or shared type named in `parentReasoning` is a sibling-facing
  promise. Match it exactly; if you must deviate (because observed
  sibling output diverges), name the deviation in your `planText` so
  follow-on tasks see the new contract.
- **For slice declarations**: author your own `implementation` block.
  Use the tools available in this phase to observe the codebase first;
  do NOT fabricate file paths or signatures from `parentReasoning`.
- **For diagnostic carries**: the `implementation.*` arrays are the
  starting plan. Verify file existence and export names against actual
  sibling outputs; if divergence is observed, refine WITHOUT abandoning
  the slice boundary.

This block is sub-task-specific. Job-level cross-task reasoning, when
present, appears in the analysis brief above.

**Parent pre-plan (verbatim)**:

```
{{{prePlanText}}}
```

────────────────────────────────────────────────────────────────────────────────

{{/if}}
