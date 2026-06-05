# Test Generation Rules

{{> agents/architect/rules}}

{{> jobs/code/base/injections/text-format-compact}}

{{> jobs/code/base/injections/tool-calling-rules-compact}}

{{> jobs/code/base/injections/batch-execution}}

{{> jobs/code/base/injections/symbol-grounding}}

## MANDATORY: Observe Before Writing

**Constraint**: Your FIRST actions MUST be observing the codebase structure and source code.
Do NOT write any test file before understanding the actual code's coupling and abstraction boundaries.

- The `Existing Codebase Files` section (below) lists every file under `codebase/` at task start — use it as your project structure reference instead of `list_files`.
- The `Modify Targets — Current Content` section (below) carries current content of every `plan.modify` target.
- `read_file` is required for source files whose content is NOT in `Modify Targets`; batch these reads upfront rather than discovering incrementally.

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

## Render-Smoke Discipline

**Principle**: A render-smoke test mounts a rendered surface with its data dependencies satisfied by the project's virtualized / in-memory adapter (the mock toggle the codebase already exposes) and asserts the surface is *alive* — not merely that it compiles. This is the only test level that catches a surface rendering dead because a shared value was hand-constructed empty at the consumption site while the build stayed green.

**What to assert** (observe the surface's purpose first):

| Observed surface purpose | Assertion |
|--------------------------|-----------|
| **Lists / displays seeded domain data** on the happy path | The primary data region renders **non-empty** for the seeded happy-path actor (at least one row / item / record appears). An always-empty render is a failure. |
| **Legitimately empty** by design (empty-state view, zero-item surface) | The **empty-state renders without crashing** — assert the empty-state marker is present, NOT that data appears. |
| **Any surface** | No unfinished-work markers (placeholder / "not implemented" / TODO text) are present in the rendered output. |

**Constraints**:
- These are **behavioral assertions about the product**, not scaffolding. They are meant to FAIL when a surface is wired to an empty/placeholder shared value — that failure is the signal that drives the fix. Do NOT write a vacuous assertion (rendering without throwing, asserting nothing about content) and do NOT lean on `--passWithNoTests`. Each rendered surface gets at least one content assertion from the table above.
- Drive data through the project's existing virtualization toggle (the mock env/adapter the codebase already defines). Do NOT invent a parallel mock layer.

⚠️ **Infrastructure graceful-degrade**: A render-smoke test requires a DOM-capable test environment and a component-render helper for the detected stack. If the stack genuinely cannot host one (no DOM environment available, non-UI runtime), fall back to an **integration-level data-path test** that asserts the surface's data source returns non-empty for the seeded actor — do NOT hard-fail the suite over a missing render harness, and do NOT install a heavy harness the ecosystem does not support. When you do render, the harness deps follow the Self-Contained Dependency Principle (declare + install within this task).

---

## Test File Placement

**Principle**: Follow the project's existing test file conventions. If no convention exists, use the ecosystem standard for the detected language and test runner (see language hints).

| Observation | Placement |
|-------------|-----------|
| **Existing test files observed** | Follow the same directory and naming convention exactly |
| **No existing test files** | Use the ecosystem standard defined in the language hints for the detected runner |

**Constraint**: Do NOT mix placement patterns within a single task. Apply one convention consistently across all test files written.
