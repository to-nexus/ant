{{#if hasPrePlanText}}
────────────────────────────────────────────────────────────────────────────────
## Parent Sub-Task Pre-Plan (input from batch-split)
────────────────────────────────────────────────────────────────────────────────

**Observation target**: a JSON pre-plan produced by the parent task when it
fanned out into physically-isolated sub-tasks.

{{#if isSliceDeclaration}}
**Slice declaration**: `task.goal`, `goal`, `rationale`, optional
`requiredFiles`, optional `implementation.create[] / modify[] / delete[]`,
and `parentReasoning`. The parent declared *which slice you own* and the
*cross-batch contracts* siblings agreed on. If the parent's pre-plan
already authored an `implementation` block, treat it as your spec — your
responsibility is the internal detail (imports, assertions, signatures,
fixture wiring) rather than re-deciding which files to create. If the
pre-plan only declares the slice boundary, the internal `modify[]` /
`create[]` / `delete[]` plan is YOUR responsibility to author below.
{{/if}}

{{#if isDiagnosticCarry}}
**Diagnostic carry**: `implementation.*` arrays and (optionally)
`diagnostics.rootCauses[]`. The parent inspected a failure and authored
this recipe — it is your **starting plan and carried evidence, not
verified fact**. The parent's causal claims were written without seeing
what you can observe now.

**Verification before adoption** (required):
- When the carried diagnostics quote a machine failure signal that names
  this batch's defect site (compiler error with file+line, failing test
  assertion, stack trace frame) AND the `implementation` changes target
  that named site: verification is the single confirming read of that
  site. Read it, confirm the quoted signal matches the code, then adopt
  the implementation block as your plan. Do NOT explore further.
- Otherwise (the causal chain is inferred — from reading code, from
  symptoms, from a user report): read the claimed defect site AND trace
  the claimed causal chain end-to-end against actual code before
  adopting. A diagnosis that names a mechanism you can disprove by
  reading the code it describes must be rejected, not implemented.
- If observation falsifies the parent's diagnosis: plan the verified
  cause instead. The slice boundary still holds — if the verified cause
  lies outside this batch's surface, name it explicitly in your
  `planText` (so the verification gate sees it) instead of widening
  into it.
{{/if}}

**Authority**: This pre-plan is your INPUT, not your output. The `planText`
you emit replaces it for execute — execute consumes only `planText` and has
no visibility into this block.

{{#if hasCrossBatchContracts}}
**⚠️ Blind spot**: Sibling sub-tasks ran in parallel. The cross-batch
contracts (export names, file paths, shared types) named in
`parentReasoning` are sibling-facing promises — their actual file outputs
may diverge from what was predicted. Verify before relying on a
sibling-owned reference.
{{/if}}

**Constraints**:
- **Slice boundary is non-negotiable**: `task.goal` / `rationale` fixes
  what you own. Do NOT widen scope into a sibling's slice, even if the
  `parentReasoning` mentions related work.
{{#if hasCrossBatchContracts}}
- **Cross-batch contracts are non-negotiable**: any export name, file
  path, or shared type named in `parentReasoning` is a sibling-facing
  promise. Match it exactly; if you must deviate (because observed
  sibling output diverges), name the deviation in your `planText` so
  follow-on tasks see the new contract.
{{/if}}
{{#if isSliceDeclaration}}
- **For slice declarations**: author your own `implementation` block
  (or refine the one the parent already authored). Use the tools
  available in this phase to observe the codebase first; do NOT
  fabricate file paths or signatures from `parentReasoning`.
{{/if}}
{{#if isDiagnosticCarry}}
- **For diagnostic carries**: the `implementation.*` arrays are the
  starting plan, adopted only after the verification above. Also verify
  file existence and export names against actual sibling outputs; if
  divergence is observed, refine WITHOUT abandoning the slice boundary.
{{/if}}

This block is sub-task-specific. Job-level cross-task reasoning, when
present, appears in the analysis brief above.

**Parent pre-plan (verbatim)**:

```
{{{prePlanText}}}
```

────────────────────────────────────────────────────────────────────────────────

{{/if}}
