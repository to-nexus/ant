# Seam Closure Rules

{{> agents/architect/rules}}

{{> jobs/code/base/injections/text-format-compact}}

{{> jobs/code/base/injections/tool-calling-rules-compact}}

{{> jobs/code/base/injections/persistent-process-policy}}

{{> jobs/code/base/injections/batch-execution}}

{{> jobs/code/base/injections/batch-gather}}

{{> jobs/code/base/injections/symbol-grounding}}

**Seam apply phase specific**: Emit every `edit_file` / `delete_file` for the closure plan as separate tool_use blocks within ONE response. The orchestrator runs all edits as one batch in a single turn.

---

{{> jobs/code/base/injections/seam-connectivity-closure}}

---

## MANDATORY: Follow Closure Plan

**Constraint**: Your actions are determined by the closure plan (planText).

- If planText contains a closure plan: apply ALL specified resolve/remove actions.
- If planText is empty or indicates no open seams: output `<done>true</done>` immediately.
- `read_file` is permitted for files referenced in the closure plan and for other modules' surfaces/contracts (read-only).

### Seam-Specific Constraints

| Constraint | Rule |
|-----------|------|
| **Resolve or remove** | Every reference/affordance either reaches a real destination (wire/conform/create) or is removed (no legitimate destination). Never leave a dead control. |
| **One authority** | A destination shared by multiple parts derives from ONE producer; conform, do not fork. |
| **Stay in-module** | Write only THIS module's files; read other modules' contracts read-only. Do NOT author new features or restyle. |
| **Exact match required** | `old_str` must match current content. If `edit_file` fails, `read_file` the target to refresh. |

---

## Interaction Methods

**`<file>`, `<append>` are XML streaming tags. File editing uses tool calls.**

### XML Streaming (Content Generation)

| Tag | Purpose |
|-----|---------|
| `<file path="...">` | Create NEW file (first chunk of a chunked emission, too) |
| `<append path="...">` | Add to end of EXISTING file — OR continue a `<file>` you opened earlier |

{{> jobs/code/nodes/execute/injections/chunked-emission}}

### Tool Calling (File Operations)

| Tool | Purpose |
|------|---------|
| `read_file` | Read file content |
| `edit_file` | Modify EXISTING file (search/replace) |
| `search_code` | Search codebase |
| `list_files` | List directory contents |
| `delete_file` | Delete single file (remove a dead control / orphaned module) |
| `mkdir` | Create directory |

### edit_file: Exact Match Principle

`old_str` must match current file content character-by-character.

- Include 3-5 lines of context for uniqueness
- If `edit_file` fails: `read_file` the target file, then retry

### XML Tag Safety

**NEVER nest file tags. Each is independent.**

**DO NOT include closing tags in code strings:**
```typescript
// Use: "</" + "file>" instead of "</file>" in string literals
```

---

## Task Completion

**When all closure actions are applied (or none needed), output:**

```xml
<done>true</done>
```

**Rules (apply phase — verification is handled separately):**
1. Apply ALL closure-plan actions (resolve + remove).
2. Do NOT run `build` / `test` / `typecheck` from this task — the verification cycle owns those gates. The command guard blocks those commands for you.
3. Installing dependencies is allowed only if the closure plan requires it to resolve a reference.
4. Emit `<done>true</done>` once every closure action in the plan is applied.
5. If planText is empty, emit `<done>true</done>` immediately.
6. Do NOT emit `<done>true</done>` while a tool call is still pending a result.
7. **Process lifecycle**: kill any long-running process you spawned before `<done>` (per the Persistent Process Policy above).

**Follow these rules for successful seam closure.**
