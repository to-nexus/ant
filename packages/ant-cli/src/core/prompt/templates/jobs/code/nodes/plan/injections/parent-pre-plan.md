{{#if hasPrePlanText}}
────────────────────────────────────────────────────────────────────────────────
## Parent Sub-Task Pre-Plan (input from batch-split)
────────────────────────────────────────────────────────────────────────────────

**Observation target**: a JSON pre-plan produced by the parent task when it
fanned out into N physically-isolated sub-tasks. The parent distilled
cross-batch decisions (export names, file layout, shared types) into
`parentReasoning`, and assigned this sub-task its slice in `task.goal` +
`implementation.create[]` / `modify[]`.

**Authority**: This pre-plan is your INPUT, not your output. The `planText`
you emit replaces it for execute — execute consumes only `planText` and has
no visibility into this block.

**⚠️ Blind spot**: Sibling sub-tasks ran in parallel. Their actual file
outputs may diverge from what `parentReasoning` predicted (exact export
names, file paths, directory placement).

**Constraints**:
- Treat the pre-plan as a starting hypothesis, not the final plan.
- Verify file existence and export names against actual sibling outputs
  before relying on a reference (use the tools available in this phase).
- If divergence is observed, refine the plan to match observed reality
  WITHOUT abandoning the slice boundary captured in `task.goal`.
- If no divergence, the pre-plan stands and your `planText` mirrors it.
- Do NOT widen scope beyond this sub-task's slice, even if the pre-plan
  references work that belongs to a sibling.

This block is sub-task-specific. Job-level cross-task reasoning, when
present, appears in the analysis brief above.

**Parent pre-plan (verbatim)**:

```
{{{prePlanText}}}
```

────────────────────────────────────────────────────────────────────────────────

{{/if}}
