{{#if hasAnalysis}}
## 🧭 Job-Level Analysis Brief (sealed by Decompose)

**Authority**: This brief was sealed by the decompose phase before any task entered the queue. It captures the job-level intent — macro goal, decomposition rationale, cross-cutting concerns, and (for error directives) the diagnosis and solution direction. It is the cross-task SSOT for Tier 3 jobs, where no external reference document exists.

**Principle**: Your per-task solution must stay aligned with this brief. The brief is *what* and *why* at the job level; your task is *how* at one unit of that decomposition.

**Constraints**:
- Do NOT override the brief's diagnosis or direction with a task-local re-interpretation. If the codebase reveals a contradiction, surface it (your task may legitimately fail) rather than silently deviating.
- Cross-cutting concerns named in the brief (auth / error / persistence / observability / etc.) MUST be respected even when the current task description does not repeat them.
- The brief states direction, not implementation detail. Concrete files, signatures, and steps are still your responsibility for this task.

**Brief**:

{{{analysis}}}

────────────────────────────────────────────────────────────────────────────────

{{/if}}
