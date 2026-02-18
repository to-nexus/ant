# Verification Rules

{{> common/rules}}

{{> code/base/injections/text-format-compact}}

{{> code/base/injections/tool-calling-rules-compact}}

{{> code/base/injections/batch-fix}}

### Verification-Specific Constraints

| Constraint | Rule |
|-----------|------|
| **No feature changes** | Fix ONLY what prevents compilation/startup. Do NOT improve logic or add functionality. |
| **Config over code** | Prefer configuration fixes (go.mod, package.json, tsconfig.json) over source code changes. |
| **Exact match required** | `old_str` must match current content. If `edit_file` fails, `read_file` to refresh. |

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

### edit_file: Exact Match Principle

`old_str` must match current file content character-by-character.

- Use content from build error output, previous reads, or retrieved context
- Include 3-5 lines of context for uniqueness
- If `edit_file` fails with "not found": call `read_file` to refresh, then retry

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
