## Single-session capacity (plan-time only)

One `batches[]` entry executes inside a single LangGraph subgraph invocation bounded by the environment-tunable `RECURSION_LIMIT`. The step ceiling is not the LLM-round ceiling — multiple nodes intervene per round, so the usable LLM-round budget is a fraction of the step ceiling.

### Orthogonality

This axis is orthogonal to the separability rubric above. The rubric decides whether the work *can* be split. This axis decides whether the work *fits* in one session. When this axis fires, split — even when the separability rubric supports bundling. When that happens, `parentReasoning` names single-session capacity (not coherence) as the concrete benefit.

### Cost model

The dominant per-file cost is the **reads required before the edit can be written**. A file edited blindly — the recipe applies without consulting the file's current contents or any reference file — costs minimally. A file whose edit depends on reading the file's existing state, or on consulting sibling references (paired types, design-system components, adjacent markup), costs proportionally more. Search and listing operations add overhead where they materially shape the budget.

The honest per-file cost is what *this* batch in *this* codebase actually needs — not a generic table. The planner's own context-aware judgement is the signal.

### When this axis fires

When the sum of per-file costs across the batch approaches the usable round budget for one session, capacity binds. The threshold is the planner's own honest estimate against the prevailing `RECURSION_LIMIT`, sourced from the directive's observable surface — not a fixed number.

### Articulation — fail-closed constraint

A bundle decision MUST articulate the per-file cost shape in `parentReasoning`: name, per file or per file group, the reads required before the edit and why the combined cost fits in one session. Two articulation failures rule out the bundle:

- `parentReasoning` does not name per-file cost shape — the planner skipped the capacity check. Split.
- The bundle's only defense is "the recipe is uniform across locations" without addressing whether each location's existing state must be read first. Split — and re-run Authorship density's per-location-state self-check, because uniform-recipe defenses are the failure mode this axis exists to catch.

### Blind-spot reminder

**Pattern**: *Recipe uniformity hides per-location inspection.* Multiple locations appear to share one transformation rule, but each location requires its own read of existing state (markup, paired types, sibling references) before the rule can be applied correctly. Surface uniformity of the recipe is necessary but not sufficient for the mechanical case in Authorship density above — this pattern is the failure mode where the recipe looks mechanical but the work is rewrite-each-X. When you recognise it, the capacity articulation above is required even when 1–4 of the rubric support bundling.
