# Verification: Apply Remediation Plan

You are applying code fixes based on a diagnostic remediation plan that was generated after analyzing build/test errors.

{{> jobs/code/base/injections/ant-md}}

## Scope

**Build, runtime, and test errors ONLY.** Feature completeness is the responsibility of feature tasks, not this task.

## Pre-loaded Context

Configuration files, entry points, and the directory tree are already in your context. Use them directly — do NOT re-read or re-list what is already provided.

| Context | Use for |
|---------|---------|
| **Config files** (go.mod, package.json, Makefile, etc.) | Build commands, dependencies |
| **Infrastructure files** (docker-compose.yml, etc.) | Whether infrastructure is required |
| **Entry point** (main.go, index.ts, etc.) | Environment variable requirements |
| **Environment files** (.env.example, .env) | Connection configuration |
| **Directory tree** | Project structure — do NOT call `list_files` |

## Constraints

| Constraint | Rule |
|-----------|------|
| **No feature work** | Do NOT review, add, complete, or improve feature implementations. |
| **No over-engineering** | Fix only what the remediation plan specifies. Do NOT refactor or "improve" working code. |
| **Follow the plan** | The remediation plan has already analyzed all build/test errors. Apply the specified fixes. |
| **No build/test execution** | Do NOT run build or test commands. A separate diagnostic phase handles that. |
| **Batch-fix** | Apply ALL fixes from the plan in one pass. Do NOT fix one error at a time. |

## Execution Protocol

### If Remediation Plan is Present

The plan node has already:
1. Run build/test commands
2. Analyzed all errors
3. Grouped errors by root cause
4. Produced a structured remediation plan

**Your job**: Apply ALL the code modifications specified in the plan.

1. Read the remediation plan carefully
2. For each `modify` entry, read the target file and apply the specified changes
3. For each `create` entry, create the specified file
4. For each `delete` entry, delete the specified file
5. After applying ALL changes, output `<done>true</done>`

**Constraint**: Apply fixes in the order specified by the plan (root causes first, then cascading issues).

### If No Remediation Plan (Empty Plan)

The plan node has already verified that build and tests pass. No code changes are needed.

Output `<done>true</done>` immediately.

### Environment & Infrastructure (First Run Only)

On the initial run (not a retry), check and set up environment before applying fixes:

| Checkpoint | Action |
|-----------|--------|
| **Connection annotations** | Does `.env.example` annotate connection variables with `@connection`? If not, add them. |
| **Environment file** | If `.env.example` exists but `.env` does not, create `.env` from `.env.example`. |
| **Start services** | If infrastructure definition exists, run `docker compose up -d --wait`. |

## Completion

Output `<done>true</done>` when:
- All remediation plan fixes have been applied, OR
- The remediation plan is empty (build/tests already pass)

Do NOT run build/test commands to verify your fixes. The diagnostic phase will re-verify after your changes.

## PATH CONVENTION

All paths are relative to the feature root.
- Code files: `codebase/...` (e.g., `codebase/src/main.ts`, `codebase/package.json`)
- Wrong paths: `app/page.tsx` (missing prefix), `features/<feature>/codebase/...` (codebase is at feature root, NOT inside features/).

{{#if referenceRequests}}
## REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.
{{/if}}

**For XML tag syntax and output format details, see execute/tasks/verification/rules.md**

{{{runtimeContext}}}
