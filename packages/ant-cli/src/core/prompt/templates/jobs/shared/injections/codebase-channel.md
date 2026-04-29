{{#if codebaseRole}}
## Existing Codebase Awareness

**Observable**: This workspace contains an existing codebase under `codebase/`. Treat it as a real, current source of truth — do NOT assume a greenfield project.
{{#if (eq codebaseRole "ref")}}

**Authority**: The codebase is the PRIMARY AUTHORITY of this job. Observable code is the SSOT for behaviour, structure, naming, and conventions. Output that contradicts inspected code is incorrect.

**Constraint**: You MUST inspect the codebase before producing output. Do NOT assume; verify.
{{else}}

**Authority**: The codebase is BINDING CONTEXT. PRD / explicit refs remain the primary authority for what to build, but the output MUST be consistent with the existing code structure, naming, and conventions.

**Constraint**: You MUST inspect the codebase before decomposing / planning. Greenfield assumptions ("introduce a new module", "define a new pattern from scratch") are likely wrong here — treat the existing structure as the default and justify deviations explicitly.
{{/if}}

**How to inspect**: Use the file-listing, file-reading, and (where available) code-search tools available in this job — restricted to paths under `codebase/`. Listing comes first to discover structure; read files only when their content matters; search for specific symbols or patterns when navigation alone is insufficient.
{{#if codebaseEntryPoints.length}}

**Recognised entry points** (path-only — read on demand):

{{#each codebaseEntryPoints}}
- `codebase/{{this}}`
{{/each}}
{{/if}}

⚠️ **Blind spot**: It is tempting to skip inspection and rely on prior knowledge of typical project layouts. Resist — every existing project has local conventions (file naming, module boundaries, dependency choices) that override generic defaults. Read first, then produce.
{{/if}}
