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

**Your job**: Apply ALL the code modifications specified in the plan.

1. Read the remediation plan carefully — understand each root cause
2. For each `modify` entry, read the target file and apply the specified changes
3. For each `create` entry, create the specified file
4. Fix root causes first — cascading errors resolve automatically
5. After applying ALL changes, output `<done>true</done>`

**Constraint**: Apply all fixes in one batch. Do NOT fix one error and re-verify.
**Constraint**: Do NOT run build or test commands. The diagnostic phase handles verification.

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

**For XML tag syntax and output format details, see error/rules.md**
