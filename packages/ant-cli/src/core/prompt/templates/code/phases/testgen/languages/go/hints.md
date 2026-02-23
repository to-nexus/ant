## Go Test Generation Hints

### Test Framework

**Principle**: Go uses the built-in `testing` package. Observe whether the project uses additional frameworks (testify, gomock, etc.) before introducing new dependencies.

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Existing test deps** | Does `go.mod` include `testify`, `gomock`, or other test libraries? Use what exists. |
| **No test deps** | Use standard `testing` package only. Do NOT add external test frameworks. |

**Constraint**: `go test ./...` is the standard runner. For workspace projects, run `go test ./...` per module directory.

---

### Mock Patterns

**Principle**: Go's interface-based design enables test doubles without frameworks.

| Observation | Pattern |
|-------------|---------|
| **Interface defined** | Create a struct implementing the interface with controllable behavior |
| **`*pgxpool.Pool` or similar concrete type as parameter** | Use the project's mock library if available (pgxmock, miniredis). If none, test at integration level. |
| **No interface, direct instantiation** | Do NOT create wrapper interfaces. Write integration tests instead. |

⚠️ **Blind spot**: Go workspace projects require `replace` directives in `go.mod` for cross-module test dependencies. If a test imports a sibling module, verify the `replace` directive exists.

---

### File Naming

| Convention | Rule |
|-----------|------|
| **Test file** | `*_test.go` in the same package as the source |
| **Test function** | `func TestXxx(t *testing.T)` — must start with `Test` and uppercase letter |
| **Package** | Same package for white-box tests; `_test` suffix package for black-box tests |

**Constraint**: Observe which pattern existing tests use. If none exist, prefer same-package tests for access to unexported symbols.
