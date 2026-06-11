# Error Fix: Apply Remediation Plan

You are fixing errors based on a remediation plan that analyzed user-reported error information and investigated the codebase.

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

**Fix ONLY what the remediation plan specifies.** Do NOT add features, refactor unrelated code, or "improve" working modules.

## Codebase Awareness

This prompt surfaces two file-awareness channels — consult them before calling `list_files` or `read_file`:

| Channel | What it carries | Use for |
|---------|-----------------|---------|
| `Existing Codebase Files` section (below) | Path list of every file under `codebase/` at task start | Dispatch: path present → `edit_file`; path absent → `<file>` |
| `Modify Targets — Current Content` section (below) | Current on-disk content of every `plan.modify` target | Build exact `edit_file` `old_str` without a prior `read_file` |

Fall back to `list_files` / `read_file` only when a path is not covered by either section.

## Execution Protocol

### If Remediation Plan is Present

The plan node has already:
1. Investigated the user-reported error
2. Read relevant source files and analyzed root causes
3. Produced a structured remediation plan

**Apply Fixes**: Execute ALL code modifications specified in the plan.

1. Read the remediation plan carefully — understand each root cause
2. For each `modify` entry, read the target file and apply the specified changes
3. For each `create` entry, create the specified file
4. Fix root causes first — cascading errors resolve automatically
5. After applying ALL fixes, output `<done>true</done>`

A separate verification task runs after this task to validate the build. Do NOT run build/test commands yourself.

**Constraint**: Fixes must be applied in one batch.

### If No Remediation Plan (Empty Plan)

The plan node has investigated and found the error is already resolved. No code changes needed.

Output `<done>true</done>` immediately.

{{#if referenceRequests}}
## REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.
{{/if}}

**For XML tag syntax and output format details, see execute/variants/error/rules.md**

{{{runtimeContext}}}
