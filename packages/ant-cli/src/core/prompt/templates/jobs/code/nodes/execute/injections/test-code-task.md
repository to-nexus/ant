## 🧪 TEST-CODE TASK: Test Generation

You are generating the minimum set of tests that verify the integrated codebase is functional.

{{#if prePlanText}}
### Slice Scope (batch-split sub-task)

This task was spawned from a parent test-code task's `batches[]`. The parent has **already** installed the test-runner and its type packages, verified the runner is invocable, and set up any shared test config the project needs.

Your job is narrow: **author and write the test files for the slice declared in the plan, and nothing else.**

- Do NOT run `npm/pnpm/yarn install`, `pip install`, `poetry add`, `go get`, or any dependency-install command. The command guard rejects install verbs in sub-tasks to prevent lockfile races with sibling slices.
- Do NOT modify any dependency manifest (`package.json`, lockfiles, `pyproject.toml`, `go.mod`, ...) or shared test config (`vitest.config.*`, `jest.config.*`, `tsconfig.json`). Those belong to the parent.
- Do NOT touch application source files. Tests observe source; they do not change it.
- Do NOT import files outside the slice boundary — a slice's tests must be self-contained to keep the parallel split meaningful.
{{else}}
### Scope

**In scope**: test files (and minimal test configuration if the project lacks one); test-runner dependencies. The Self-Contained Dependency Principle governs HOW to close the loop — typed runners require both the runtime package and its types / globals augmentation, and every config key MUST be verified against the runner's published schema. Do NOT defer dependency or config-key closure to verification.

**Not in scope**: executing tests (the verification phase runs them); modifying application source code (test files observe the source, they do not change it).
{{/if}}

### Observation Targets

Observe the actual codebase (config files, entry points, source code) to determine what to test:

| Checkpoint | What to observe |
|-----------|----------------|
| **Startup** | Does the application have a main entry point or server? Create a startup/health test. |
| **Endpoints** | Does the application expose API routes or handlers? Create smoke tests for critical ones. |
| **Core logic** | Are there business logic modules? Observe how dependencies are accessed (see Test Level Selection below). |
| **Rendered surfaces** | Does the application render UI surfaces (screens / pages / views) backed by data that a virtualized / in-memory adapter supplies? Create **render-smoke** tests — see Render-Smoke Discipline in the rules. This catches the "compiles but renders dead" class that type/build checks cannot. |

### Test Level Selection

**Principle**: The test level is determined by the code's actual coupling, not by an ideal architecture.

| Observation | Test level |
|-------------|-----------|
| **Dependencies are injectable** (accepted as parameters or interfaces) | Unit tests with test doubles |
| **Dependencies are directly instantiated** (tightly coupled) | Integration-level tests — do NOT force mock-based unit tests |

**Constraint**: Do NOT generate exhaustive coverage. Only verify that the integrated system functions.

⚠️ **Blind spot**: When no abstraction boundary exists, attempting to unit-test a module leads to either modifying source code (violates constraint) or writing brittle tests coupled to implementation. Choose the test level based on the code's actual coupling.
