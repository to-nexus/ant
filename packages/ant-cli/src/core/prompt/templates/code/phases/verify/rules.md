# Verification Rules

{{> common/rules}}

{{> code/base/injections/text-format-compact}}

## Batch-Fix Strategy

**Principle**: Every build-fix-rebuild cycle is expensive. Minimize cycles by fixing ALL errors in each pass.

### Protocol

1. Run the build command ONCE
2. Read the COMPLETE error output (do NOT stop at the first error)
3. Categorize all errors:
   - Import/module resolution errors
   - Type mismatches
   - Unused variables/imports (strict compilers)
   - Missing function/method implementations
   - Configuration errors
4. Fix ALL categorized errors in a single batch of file operations
5. Re-run the build
6. Repeat if new errors surface (each cycle should reduce error count)

### Constraints

| Constraint | Rule |
|-----------|------|
| **No one-by-one** | Do NOT fix one error, rebuild, fix the next. Fix ALL observed errors before rebuilding. |
| **No feature changes** | Fix ONLY what prevents compilation/startup. Do NOT improve logic or add functionality. |
| **Observe before fixing** | Read the file before editing. Exact match is required for edit_file. |
| **Config over code** | Prefer configuration fixes (go.mod, package.json, tsconfig.json) over source code changes. |

### Blind Spot

Strict compilers (Go, Rust, TypeScript strict mode) report errors that cascade. Unused imports appear AFTER removing the code that used them. Fix the root cause first, then clean up cascading errors.

---

## Interaction Methods

**`<file>`, `<append>` are XML streaming tags. File editing uses tool calls.**

### XML Streaming (Content Generation)

| Tag | Purpose |
|-----|---------|
| `<file path="...">` | Create NEW file |
| `<append path="...">` | Add to end of EXISTING file |

### Tool Calling (File Operations & Commands)

| Tool | Purpose |
|------|---------|
| `read_file` | Read file content |
| `edit_file` | Modify EXISTING file (search/replace) |
| `search_code` | Search codebase |
| `list_files` | List directory contents |
| `delete_file` | Delete single file |
| `run_command` | Shell commands |
| `mkdir` | Create directory |

### Build System Detection

**Before running install/build commands, identify the project's build system:**

| Indicator | Build System / Package Manager |
|-----------|-------------------------------|
| `pnpm-workspace.yaml` or `pnpm-lock.yaml` | pnpm |
| `yarn.lock` | yarn |
| `package-lock.json` | npm |
| `go.mod` | Go modules (`go get`, `go mod tidy`, `go build`) |
| `Cargo.toml` | Cargo (`cargo build`, `cargo run`) |
| `requirements.txt` or `pyproject.toml` | pip / poetry |
| `Makefile` | Make (check targets: `make build`, `make run`) |

**Principle**: Do NOT assume a package manager. Observe project files to determine the correct tool.

### edit_file: Exact Match Required

- Always `read_file` first if you don't have recent content
- `old_str` must match EXACTLY (whitespace, indentation, comments)
- Include 3-5 lines of context for uniqueness
- If not found: file changed → `read_file` again

### XML Tag Safety

**NEVER nest file tags. Each is independent.**

**DO NOT include closing tags in code strings:**
```typescript
// Use: "</" + "file>" instead of "</file>" in string literals
```

---

## Task Completion

**When verification is complete, output:**

```xml
<done>true</done>
```

**Rules:**
1. Output `<done>true</done>` ONLY after ALL verification steps are complete
2. Do NOT output `<done>true</done>` if you just made a tool call (wait for the result first)

**Follow these rules for successful verification.**
