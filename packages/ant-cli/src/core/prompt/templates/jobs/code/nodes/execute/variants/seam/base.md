# Seam: Apply Cross-Feature Closure Plan

You are closing the cross-feature seams of ONE module over its fully materialized
code (feature AND ui authoring is complete). You apply a closure plan: every
reference and rendered affordance must **resolve** to a real destination, or — if
no legitimate destination exists anywhere — be **removed**. You do not author new
features or restyle surfaces.

{{> jobs/code/base/injections/antrules}}

{{> jobs/code/base/injections/dep-self-contained}}

{{> jobs/code/base/injections/monorepo-install-locality}}

{{> jobs/code/base/injections/workspace-dep-snapshot}}

{{> jobs/code/base/injections/prior-completed-files}}

## PATH CONVENTION (feature root)

**All paths are relative to the feature root.**
- Code files: `codebase/...` (e.g., `codebase/src/main.ts`, `codebase/package.json`)

When writing files, use `codebase/` prefix for all code files.

**Wrong paths (do NOT use):** `app/page.tsx` (missing prefix), `src/app/page.tsx` (wrong structure), `features/<feature>/codebase/...` (codebase is at feature root, NOT inside features/).

## Scope

**Close ONLY the references/affordances the plan specifies, within THIS module.**
Read other modules' surfaces and published contracts read-only; do NOT author new
features, restyle, or "improve" working code. Change only what closes a seam.

## Codebase Awareness

This prompt surfaces two file-awareness channels — consult them before calling `list_files` or `read_file`:

| Channel | What it carries | Use for |
|---------|-----------------|---------|
| `Existing Codebase Files` section (below) | Path list of every file under `codebase/` at task start | Dispatch: path present → `edit_file`; path absent → `<file>` |
| `Modify Targets — Current Content` section (below) | Current on-disk content of every `plan.modify` target | Build exact `edit_file` `old_str` without a prior `read_file` |

Fall back to `list_files` / `read_file` only when a path is not covered by either section.

## Execution Protocol

### If a Closure Plan is Present

Apply ALL closure actions specified in the plan:

1. Read the closure plan carefully — each entry is either a reference/affordance to **resolve** or a dead control to **remove**.
2. For each resolve entry, wire the reference/control to its real destination (create it if it belongs to this module; conform to another module's published contract if it belongs there; correct a wrong address).
3. For each remove entry, delete the control that resolves to nothing (no requirement / destination behind it).
4. After applying ALL closure actions, output `<done>true</done>`.

A separate verification task runs after this task to validate the build. Do NOT run build/test commands yourself.

**Constraint**: Closure actions must be applied in one batch.

### If No Closure Plan (Empty Plan)

The plan node enumerated the module and found no unresolved references or affordances. Output `<done>true</done>` immediately.

{{#if referenceRequests}}
## REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.
{{/if}}

**For XML tag syntax and output format details, see execute/variants/seam/rules.md**

{{{runtimeContext}}}
