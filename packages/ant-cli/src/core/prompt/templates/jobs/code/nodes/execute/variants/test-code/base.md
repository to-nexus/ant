# Test Generation

You are generating the minimum set of tests that verify the integrated codebase is functional.

{{> jobs/code/base/injections/antrules}}

{{> jobs/code/base/injections/dep-self-contained}}

{{#if prePlanText}}
## Slice Scope (batch-split sub-task)

This task was spawned from a parent test-code task's `batches[]`. The parent has **already**:

- Installed the test-runner and its type packages (`vitest` / `jest` / `pytest` / ...).
- Verified the runner is invocable.
- Set up any shared test config the project needs.

Your job is narrow: **write the test files listed in the slice plan below, and nothing else.**

**Strict constraints for this slice**:

- Do NOT run `npm/pnpm/yarn install`, `pip install`, `poetry add`, `go get`, or any dependency-install command. The command guard rejects install verbs in sub-tasks to prevent lockfile races with sibling slices.
- Do NOT modify `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `pyproject.toml`, `poetry.lock`, `go.mod`, `go.sum`, or any other dependency manifest.
- Do NOT modify shared test config (`vitest.config.*`, `jest.config.*`, `pytest.ini`, `tsconfig.json`). Those belong to the parent plan phase.
- Do NOT touch application source files. Tests observe source; they do not change it.
- Do NOT import files outside the slice boundary declared in the plan — a slice's tests must be self-contained to keep the parallel split meaningful.
- Write ONLY the files listed in the slice plan's `create` / `modify`. Do not add extra helper / fixture files beyond what the plan names.

After writing every file listed in the slice plan, output `<done>true</done>`. The Final Verification task runs the test suite; do not run it here.

{{else}}
## Scope

**In scope**:
- Test files (and minimal test configuration if the project lacks one).
- Test-runner dependencies. The Self-Contained Dependency Principle above governs HOW to close the loop — typed runners require both the runtime package and its `@types/{runner}` / `runner/globals` augmentation, and every `*.config.*` key MUST be verified against the runner's published schema. Do NOT defer dependency or config-key closure to verification.

**Not in scope**:
- Executing tests — the verification phase runs them.
- Modifying application source code — test files observe the source, they do not change it.
{{/if}}

## Codebase Awareness

This prompt surfaces two file-awareness channels — consult them before calling `list_files` or `read_file`:

| Channel | What it carries | Use for |
|---------|-----------------|---------|
| `Existing Codebase Files` section (below) | Path list of every file under `codebase/` at task start | Identify test targets and existing config files without `list_files` |
| `Modify Targets — Current Content` section (below) | Current on-disk content of every `plan.modify` target | Build exact `edit_file` `old_str` without a prior `read_file` |

Fall back to `read_file` only when you need the full body of a source file that is NOT already surfaced by the Modify Targets section. Since test files observe source files, expect most source content to require a `read_file` call — the modify-targets section carries content for files you will write to, not read from.

## Observation Targets

Observe the actual codebase (config files, entry points, source code) to determine what to test:

| Checkpoint | What to observe |
|-----------|----------------|
| **Startup** | Does the application have a main entry point or server? Create a startup/health test. |
| **Endpoints** | Does the application expose API routes or handlers? Create smoke tests for critical ones. |
| **Core logic** | Are there business logic modules? Observe how dependencies are accessed (see Test Level Selection below). |
| **Test script** | Does the project config have a test run script? If not, add one (see Test Script below). |

## Test Script

**Principle**: The project must have a way to run tests from a single command.

**Observation target**: Does the project's build/dependency config file already contain a test execution script or target?

| Observation | Action |
|-------------|--------|
| **Config file exists but no test script/target** | Add a test execution entry that runs the detected test framework |
| **Language/ecosystem has a built-in test command** | No action needed |
| **Test script/target already exists** | No action needed |

**Constraint**: Only add the test script to the project's existing build config file. Do NOT create new config files solely for test execution.

## Test Level Selection

**Principle**: The test level is determined by the code's actual coupling, not by an ideal architecture.

| Observation | Test level |
|-------------|-----------|
| **Dependencies are injectable** (accepted as parameters or interfaces) | Unit tests with test doubles |
| **Dependencies are directly instantiated** (tightly coupled) | Integration-level tests — do NOT force mock-based unit tests |

**Constraint**: Do NOT generate exhaustive test coverage. Only verify that the integrated system functions.

**Constraint**: Use the project's existing test infrastructure if detected (observe config files). If none exists, create minimal test config.

⚠️ **Blind spot**: When no abstraction boundary exists, attempting to unit-test a module leads to either modifying source code (violates constraint) or writing brittle tests coupled to implementation. Choose the test level based on the code's actual coupling.

## Completion

After writing all test files, output `<done>true</done>`.

## PATH CONVENTION

All paths are relative to the feature root.
- Code files: `codebase/...` (e.g., `codebase/src/...`)
- Wrong paths: `app/page.tsx` (missing prefix), `features/<feature>/codebase/...` (codebase is at feature root, NOT inside features/).

{{#if referenceRequests}}
## REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.
{{/if}}

**For XML tag syntax and output format details, see execute/tasks/test-code/rules.md**

{{{runtimeContext}}}
