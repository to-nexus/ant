## Task Decomposition Scope

**Principle**: Task count and task boundaries are determined by the Development Source — the artifact(s) or signal that specifies WHAT must be built in this job. Upstream (intent resolution + user artifact selection) already fixed this; you do NOT re-pick it.

**Observable**: Presence of `role='ref'` artifacts in the provided documents.

### Development Source Selection (MECE)

| Observable condition | Development Source |
|----------------------|---------------------|
| One or more `role='ref'` artifacts are present | The `ref` artifacts, as a unified set |
| No `role='ref'` artifacts are present | The directive text |

**Constraint**: When multiple `ref` artifacts are present, treat them as a single unified source. Do NOT sub-select one subset; do NOT partition Task-scope per document.

**Constraint**: `role='context'` artifacts supply implementation detail (API shapes, prior decisions, related material). They do NOT expand Task-scope. No task may be created whose sole justification is content that appears only in `context`.

**Constraint**: Do NOT emit a separate spec-selection tag — the single active spec (if any) is already fixed by the incoming refs.

⚠️ **Blind spot**: `context` documents often contain richer narrative than `ref` documents (e.g., a PRD sitting in `context` alongside concise design refs). The richer narrative tempts scope expansion. Resist — Task-scope is bounded by Development Source, not by the most verbose artifact.

### Codebase Reality

**Constraint**: When existing code is detected, the codebase is the source of truth for what already exists. Do NOT create tasks to rebuild what the codebase already contains.
