# Error Fix: Apply Remediation Plan

You are fixing errors based on a diagnostic remediation plan that analyzed build output and/or user-reported error information.

## PATH CONVENTION (feature root)

**All paths are relative to the feature root.**
- Code files: `codebase/...` (e.g., `codebase/src/main.ts`, `codebase/package.json`)

When writing files, use `codebase/` prefix for all code files.

**Wrong paths (do NOT use):** `app/page.tsx` (missing prefix), `src/app/page.tsx` (wrong structure), `features/<feature>/codebase/...` (codebase is at feature root, NOT inside features/).

## Scope

**Fix ONLY what the remediation plan specifies.** Do NOT add features, refactor unrelated code, or "improve" working modules.

## Pre-loaded Context

Configuration files, entry points, and the directory tree are already in your context.

| Context | Use for |
|---------|---------|
| **Config files** | Build commands, dependencies |
| **Entry point** | Environment variable requirements |
| **Directory tree** | Project structure — do NOT call `list_files` for exploration |

## Execution Protocol

### If Remediation Plan is Present

The plan node has already:
1. Run build commands to reproduce errors
2. Cross-referenced with user-reported error information
3. Analyzed all errors and grouped by root cause
4. Produced a structured remediation plan

**Phase 1 — Apply Fixes**: Execute ALL code modifications specified in the plan.

1. Read the remediation plan carefully — understand each root cause
2. For each `modify` entry, read the target file and apply the specified changes
3. For each `create` entry, create the specified file
4. Fix root causes first — cascading errors resolve automatically

**Phase 2 — Build Verification**: After applying ALL fixes, verify your changes.

1. Run the build command from `diagnostics.command` using `run_command`
2. If build succeeds with no errors → output `<done>true</done>`
3. If NEW errors appear (not in the original `diagnostics.rootCauses`) → fix them, then re-run build once more
4. If build still fails after one fix attempt → output `<done>true</done>` (the diagnostic cycle handles remaining errors)

**Constraint**: Phase 1 fixes must be applied in one batch. Phase 2 allows at most one additional fix cycle.
**Constraint**: In Phase 2, only fix errors in files listed in YOUR `implementation.modify` or `implementation.create`. Errors in other files belong to other error tasks or will be caught by the diagnostic cycle.

### If No Remediation Plan (Empty Plan)

The plan node has verified that the error is already resolved. No code changes needed.

Output `<done>true</done>` immediately.

{{#if referenceRequests}}
## REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.
{{/if}}

**For XML tag syntax and output format details, see execute/tasks/error/rules.md**
