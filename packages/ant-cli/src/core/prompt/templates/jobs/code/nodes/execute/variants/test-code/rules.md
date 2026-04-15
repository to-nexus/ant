# Test Generation Rules

{{> agents/architect/rules}}

{{> jobs/code/base/injections/text-format-compact}}

{{> jobs/code/base/injections/tool-calling-rules-compact}}

{{> jobs/code/base/injections/batch-execution}}

## MANDATORY: Observe Before Writing

**Constraint**: Your FIRST actions MUST be observing the codebase structure and source code.
Do NOT write any test file before understanding the actual code's coupling and abstraction boundaries.

- Config and source files are pre-loaded in your context — observe them for test targets.
- Directory structure is pre-loaded in your context — do NOT use `list_files` for exploration.
- `read_file` is permitted for source files that need deeper inspection to determine test strategy.

### Test Generation Constraints

| Constraint | Rule |
|-----------|------|
| **No source modification** | Write test files ONLY. Do NOT modify application source code. |
| **No test execution** | Do NOT run tests. Verification handles that. |
| **Minimum coverage** | Generate only what verifies the system functions. Do NOT aim for exhaustive coverage. |
| **Observe coupling** | Determine test level (unit vs integration) by observing the code's actual dependency patterns, not by assuming ideal architecture. |
| **Existing infrastructure** | Use existing test config if present. Create minimal config only if none exists. |
| **Exact match required** | `old_str` must match current content. If `edit_file` fails, `read_file` the target file to refresh. |

---

## Mock Strategy

**Principle**: Mock strategy follows from observed abstraction boundaries, not from preference.

| Observation | Strategy |
|-------------|----------|
| **Interface/trait/protocol exists** | Create test doubles that satisfy the contract |
| **Constructor accepts dependencies** | Pass test doubles via constructor/factory |
| **No abstraction boundary** | Write integration-level tests against real or in-memory implementations |

**Constraint**: Do NOT create wrapper interfaces solely to enable mocking. If the code under test directly instantiates its dependencies, test at a higher level.

⚠️ **Blind spot**: Database and cache clients are commonly instantiated directly. Check whether the repository/store layer accepts them as constructor parameters before deciding on mock strategy.

---

## Test File Placement

**Principle**: Follow the project's existing test file conventions. If no convention exists, use the ecosystem standard for the detected language and test runner (see language hints).

| Observation | Placement |
|-------------|-----------|
| **Existing test files observed** | Follow the same directory and naming convention exactly |
| **No existing test files** | Use the ecosystem standard defined in the language hints for the detected runner |

**Constraint**: Do NOT mix placement patterns within a single task. Apply one convention consistently across all test files written.
