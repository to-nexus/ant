# Error Fix Rules

{{> agents/architect/rules}}

{{> jobs/code/base/injections/text-format-compact}}

{{> jobs/code/base/injections/tool-calling-rules-compact}}

## Tool Call Batching

**Principle**: The system processes ALL tool calls from a single response as one batch.

**Constraint**: When you have identified multiple independent actions (reads, edits), issue ALL in ONE response.

**Constraint**: NEVER issue a single tool call when you can already identify additional needed tool calls from prior results.

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

## Interaction Methods

**`<file>`, `<append>` are XML streaming tags. File editing uses tool calls.**

### XML Streaming (Content Generation)

| Tag | Purpose |
|-----|---------|
| `<file path="...">` | Create NEW file |
| `<append path="...">` | Add to end of EXISTING file |

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
- If a previous `read_file` result shows `[read_file result: ... — content omitted]`, call `read_file` again before `edit_file`
- If `edit_file` fails: `read_file` the target file, then retry

### XML Tag Safety

**NEVER nest file tags. Each is independent.**

**DO NOT include closing tags in code strings:**
```typescript
// Use: "</" + "file>" instead of "</file>" in string literals
```

{{#if currentTask.selfVerifyOnDone}}
{{> jobs/code/nodes/execute/injections/self-verify-inline}}
{{/if}}

---

## Task Completion

**When all fixes are applied (or no fixes needed), output:**

```xml
<done>true</done>
```

{{#if currentTask.selfVerifyOnDone}}
**Rules (Tier 2 — this task owns verification inline):**
1. Apply ALL remediation plan fixes.
2. Run the verification gate chain per the **Self-Verify Before Done** section above (install if deps changed → typecheck → build → test).
3. Emit `<done>true</done>` ONLY after every applicable gate passes.
4. If a gate fails, iterate WITHIN this loop (read error, minimal fix, re-run gate) until it passes or the scope clearly exceeds this task.
5. If the scope exceeds this task, emit `<needsEscalation>true</needsEscalation>` instead of `<done>true</done>`.
6. If planText is empty, emit `<done>true</done>` immediately (nothing to fix or verify).
7. Do NOT emit `<done>true</done>` while a tool call is still pending a result.
{{else}}
**Rules (Tier 3+ — a dedicated verification task follows this one):**
1. Apply ALL remediation plan fixes.
2. Do NOT run `build` / `test` / `typecheck` from this task — the next verification task owns those gates. The command guard blocks those commands for you; running them wastes a diagnostic cycle.
3. Installing dependencies (npm/pnpm/pip/go mod) is still allowed when the remediation plan requires it.
4. Emit `<done>true</done>` once every remediation fix in the plan is applied.
5. If planText is empty, emit `<done>true</done>` immediately (the error was already resolved upstream).
6. Do NOT emit `<done>true</done>` while a tool call is still pending a result.
{{/if}}

**Follow these rules for successful error fixing.**
