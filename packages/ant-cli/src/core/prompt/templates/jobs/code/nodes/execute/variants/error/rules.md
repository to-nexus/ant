# Error Fix Rules

{{> agents/architect/rules}}

{{> jobs/code/base/injections/text-format-compact}}

{{> jobs/code/base/injections/tool-calling-rules-compact}}

{{> jobs/code/base/injections/persistent-process-policy}}

{{> jobs/code/base/injections/batch-execution}}

{{> jobs/code/base/injections/batch-gather}}

{{> jobs/code/base/injections/symbol-grounding}}

**Error apply phase specific**: Emit every `edit_file` for the remediation plan as separate tool_use blocks within ONE response. Sequential per-file fixing across multiple turns is the failure mode — the orchestrator runs all edits as one batch in a single turn.

---

## MANDATORY: Follow Remediation Plan

**Constraint**: Your actions are determined by the remediation plan (planText).

- If planText contains a remediation plan: apply ALL specified fixes, then run build to verify
- If planText is empty or indicates no errors: output `<done>true</done>` immediately
- `read_file` is permitted for files referenced in the remediation plan

### Error-Specific Constraints

Scope is determined by the remediation mode carried through the plan's `rootCauseSelfCheck.mode` field (defaults to `patch` when absent).

{{#if remediationModeUpstream}}
**Active mode: `upstream`** — the plan identified that ≥ 5 files share the same symptom and the fix belongs at a higher layer (config, generator, toolchain). The narrow "minimal changes" rule is suspended for this batch.

| Constraint | Rule |
|-----------|------|
| **Fix the source** | Apply the single upstream change the plan specifies (e.g., `tsconfig.json` compiler option, `package.json` dependency, generator template). Do NOT also patch the N files the upstream change renders correct. |
| **Verify scope erasure** | Re-run the build/test command after the upstream change. If the N surface errors disappear without further edits, the change is correct. |
| **Do NOT pre-apply file patches** | Downgrade to a file-local fix only if the upstream change demonstrably fails to resolve the reported errors. |
{{else if remediationModeRefactor}}
**Active mode: `refactor`** — the user explicitly requested broader code reshaping. Scope constraints are relaxed but purpose must remain traceable.

| Constraint | Rule |
|-----------|------|
| **Stay within the plan** | Broader scope is permitted ONLY for the modules the plan lists. Do NOT expand into modules the plan does not reference. |
| **Preserve existing contracts** | Public API of refactored modules MUST remain compatible unless the plan explicitly says otherwise. |
| **Exact match required** | `old_str` must match current content. If `edit_file` fails, `read_file` the target file to refresh. |
{{else}}
**Active mode: `patch`** (default) — single root cause, small scope.

| Constraint | Rule |
|-----------|------|
| **Root cause first** | Fix root causes before cascading issues. A single root cause fix may resolve multiple reported errors. |
| **Minimal changes** | Fix ONLY what the plan specifies. Do NOT refactor or "improve" adjacent code. |
| **Config over code** | Prefer configuration fixes (go.mod, package.json, tsconfig.json) when the plan allows it. |
| **Exact match required** | `old_str` must match current content. If `edit_file` fails, `read_file` the target file to refresh. |
{{/if}}

---

## Test Integrity

**Constraint**: A failing **behavioral** test (a render-smoke or data-path assertion that the product shows real content for the seeded happy-path actor) signals that PRODUCT code is missing or wrong — most often a shared value consumed empty because its producer was never built. Fix the product code so the assertion passes. Do NOT delete, skip, weaken, or invert such an assertion to turn the suite green — that converts a real defect into a silent false-green. Only adjust a test itself when the plan identifies the test as genuinely incorrect (asserting behavior the spec does not require), and say so explicitly in the fix.

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
| `delete_file` | Delete single file |
| `run_command` | Shell commands (build verification after fixes, dependency install) |
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

**When all fixes are applied (or no fixes needed), output:**

```xml
<done>true</done>
```

**Rules (apply phase — verification is handled separately):**
1. Apply ALL remediation plan fixes.
2. Do NOT run `build` / `test` / `typecheck` from this task — the verification cycle owns those gates. The command guard blocks those commands for you; running them wastes a diagnostic cycle. (Tier 3/4: a dedicated verification task follows; Tier 2 self-verify: this task automatically transitions into verify-mode after `<done>` and the runtime re-runs the diagnostic in a follow-up plan/execute cycle.)
3. Installing dependencies (npm/pnpm/pip/go mod) is still allowed when the remediation plan requires it.
4. Emit `<done>true</done>` once every remediation fix in the plan is applied.
5. If planText is empty, emit `<done>true</done>` immediately (the error was already resolved upstream).
6. Do NOT emit `<done>true</done>` while a tool call is still pending a result.
7. **Process lifecycle**: If you spawned a long-running process during this task (`run_command keep_running: true`), kill it before `<done>`. Same single rule as the Persistent Process Policy injection above — apply phase reuses it; nothing additional applies here.

**Follow these rules for successful error fixing.**
