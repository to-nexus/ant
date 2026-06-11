# Verification: Apply Remediation Plan

You are applying code fixes based on a diagnostic remediation plan that was generated after analyzing build/test errors.

{{> jobs/code/base/injections/antrules}}

{{> jobs/code/base/injections/dep-self-contained}}

{{> jobs/code/base/injections/monorepo-install-locality}}

{{> jobs/code/base/injections/workspace-dep-snapshot}}

{{> jobs/code/base/injections/prior-completed-files}}

## Scope

**Build, runtime, and test errors ONLY.** Feature completeness is the responsibility of feature tasks, not this task.

## Codebase Awareness

This prompt surfaces two file-awareness channels — consult them before calling `list_files` or `read_file`:

| Channel | What it carries | Use for |
|---------|-----------------|---------|
| `Existing Codebase Files` section (below) | Path list of every file under `codebase/` at task start | Dispatch: path present → `edit_file`; path absent → `<file>` |
| `Modify Targets — Current Content` section (below) | Current on-disk content of every `plan.modify` target | Build exact `edit_file` `old_str` without a prior `read_file` |

Fall back to `list_files` / `read_file` only when a path is not covered by either section (e.g. config or entry-point files not listed in the remediation plan's modify set).

## Constraints

| Constraint | Rule |
|-----------|------|
| **No feature work** | Do NOT review, add, complete, or improve feature implementations. |
| **No over-engineering** | Fix only what the remediation plan specifies. Do NOT refactor or "improve" working code. |
| **Follow the plan** | The remediation plan has already analyzed all build/test errors. Apply the specified fixes. |
| **Batch-fix** | Apply ALL fixes from the plan in one pass. Do NOT fix one error at a time. |
| **Respect gate state** | The Session tracks which gates (typecheck / build / test) have already passed. Do not re-run a gate that already passed. |

## Execution Protocol

### If Remediation Plan is Present

The plan node has already:
1. Run build/test commands
2. Analyzed all errors
3. Grouped errors by root cause
4. Produced a structured remediation plan

**Your job**: Apply ALL the code modifications specified in the plan, then self-validate.

1. Read the remediation plan carefully
2. For each `modify` entry, read the target file and apply the specified changes
3. For each `create` entry, create the specified file
4. For each `delete` entry, delete the specified file
5. Self-validate in order (see Self-Validation below)
6. After all required gates pass, output `<done>true</done>`

**Constraint**: Apply fixes in the order specified by the plan (root causes first, then cascading issues).

### If No Remediation Plan (Empty Plan)

The plan node has already verified that required gates pass. No code changes are needed.

Output `<done>true</done>` immediately.

### Environment & Infrastructure (First Run Only)

On the initial run (not a retry), check and set up environment before applying fixes:

| Checkpoint | Action |
|-----------|--------|
| **Connection annotations** | Does `.env.example` annotate connection variables with `@connection`? If not, add them. |
| **Environment file** | If `.env.example` exists but `.env` does not, create `.env` from `.env.example`. |
| **Start services** | If infrastructure definition exists, run `docker compose up -d --wait`. |

## Self-Validation

After applying fixes, validate the next unsatisfied gate only. Gate order:
`typecheck → build → test`.

| Observation | Action |
|-------------|--------|
| Gate already passed and its inputs are unchanged since | Skip it — re-running cannot change the result; move to the next gate. |
| Next gate passes | Move to the following gate. |
| Next gate fails on an error covered by the current plan's `modify`/`create`/`delete` targets | Re-read those targets, correct within that file scope, re-run. |
| Next gate fails on a NEW root cause (new file, new symptom, new dependency not in the plan) | Output `<done>true</done>` immediately. Do NOT patch outside plan scope — the plan phase will re-diagnose and emit a fresh plan for the new root cause. |
| All required gates pass | Output `<done>true</done>`. |
| A single issue resists more than one fix attempt | Output `<done>true</done>` and the plan phase will re-diagnose. |

The Session keeps `passed` state across retries, so a gate that already
passed in the plan phase does not need to be re-run here.

## Completion

Output `<done>true</done>` when:
- All remediation plan fixes have been applied AND all required gates pass, OR
- The remediation plan is empty (gates already pass), OR
- You have exhausted a reasonable fix attempt and need the plan phase to re-diagnose.

**Pre-`<done>` lifecycle gate**: If you spawned a long-running process (`run_command keep_running: true`) during this cycle, kill it first. See the Persistent Process Policy injection above for the single rule and the five-step procedure — verification reuses the same rule; nothing additional applies here.

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
