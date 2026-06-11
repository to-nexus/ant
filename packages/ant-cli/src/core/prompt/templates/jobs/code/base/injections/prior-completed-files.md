{{#if priorCompletedFiles}}
## 📂 Files Already Created by Prior Tasks (this job)

**Authority**: These files already exist on disk, authored by earlier tasks in this same job. Together they are the source of truth for what the system already provides — shared runtime services and data stores, routes and their mounting entries, components, types, and contracts.

**Principle**: When your task's concern overlaps one of these files, read it and build on it. A shared decision another unit already made is consumed, not re-decided.

**Constraints**:
- Do NOT recreate a parallel version of something already present — do not stand up a second data store / seed, redefine an existing type or component, or invent a route, address, or export that one of these files already defines. Import and reuse it.
- These are paths, not contents. When a listed file is relevant to your task, read it before authoring against it rather than assuming its shape.
- This list is additive context, not your task scope. It does not expand what you must build — it constrains you from duplicating what exists.

{{#each priorCompletedFiles}}
- **{{this.name}}**{{#if this.band}} — {{this.band}}{{/if}}
{{#each this.files}}
  - {{this}}
{{/each}}
{{/each}}

────────────────────────────────────────────────────────────────────────────────

{{/if}}
