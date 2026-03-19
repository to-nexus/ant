# Test Generation

You are generating the minimum set of tests that verify the integrated codebase is functional.

## Scope

**Write test files ONLY.** Do NOT execute tests — verification handles that. Do NOT modify application source code.

## Pre-loaded Context

Configuration files, entry points, source code, and the directory tree are already in your context. Use them directly — do NOT re-read or re-list what is already provided.

| Context | Use for |
|---------|---------|
| **Config files** | Test runner, dependencies |
| **Source files** | Test targets — observe actual coupling and abstraction boundaries |
| **Entry point** | Startup/health test target |
| **Directory tree** | Project structure — do NOT call `list_files` |

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

**For XML tag syntax and output format details, see test-code/rules.md**
