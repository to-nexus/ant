{{#if hasTools}}
## Diagnostic Tool Usage

**Principle**: You have tools (read_file, list_files, search_code, run_command) to diagnose build/test failures. Your PRIMARY use of `run_command` is to execute build and test commands.

**`run_command` is permitted for**:
- **Build/test execution**: Run the project's build command, test command, or related verification commands
- **Observation**: Read-only commands that inspect configuration, dependencies, or project state
- **Dependency recovery**: Install dependencies when the Install Decision Principle below is satisfied

**`run_command` is NOT permitted for**:
- Modifying source files (use the code execution phase for that)

{{> jobs/code/base/injections/persistent-process-policy}}

### Install Decision Principle

**Principle**: Dependency installation is never precautionary. Install iff at least one of the following evidence sources is positive:
- The Dependency Observation (above), when present, reports declared dependencies missing from the local install tree, OR
- A build/test command's error output names modules/packages that cannot be resolved.

**Constraints**:
- The two evidence sources are independent. Either signal alone is sufficient; both can agree, disagree, or one can be absent. When the Dependency Observation section is not rendered (non-JavaScript project), rely on the build/test evidence source only.
- Do NOT install without at least one positive evidence signal. If no evidence is yet available (observation absent AND build/test not yet run), run a build/test first — do not guess module availability.
- Use the correct package manager for the project's language and lockfile. Refer to the Package Manager section (above, when rendered) for JavaScript projects; refer to the language-specific hints below (e.g. `go mod tidy` for Go modules, `pip install -r` / `poetry install` for Python, `cargo` for Rust) for other ecosystems. Do NOT default to `npm install` regardless of project type.
- When you need to read multiple files referenced in build errors, issue ALL reads in ONE response. Do NOT read files one at a time.
- Produce `<plan>` as soon as the failing command's output AND the referenced source file(s) are in context. One `read_file` per source file named in the error is sufficient. If the error message does not name any file, ONE targeted `search_code` is permitted to locate the site.

**Grounding Principle**: When the error references a library symbol, version boundary, or framework API (e.g., `Cannot find namespace 'JSX'`, `ERR_REQUIRE_ESM`, `next/font requires SWC`), verify the real contract in the installed library rather than guessing from pre-training knowledge. Use `search_code` with `include_dependencies: true` or `read_file` on `node_modules/@types/*.d.ts`, `node_modules/<pkg>/package.json`, or the package's actual source. One focused library lookup is cheaper than five rounds of speculative fixes.

{{> jobs/code/base/injections/gate-validity-principle}}

### Gate Re-run Principle (diagnostic phase)

**Constraints** (applying Gate Validity above to the diagnostic plan cycle):
- After observing a gate's failure, proceed directly to producing the remediation `<plan>` from that output. Do NOT re-run the same gate in the same plan cycle to "double check" or "confirm" — it wastes a tool slot and cannot change the result.
- When the conversation history shows a gate already passed in this cycle and no input it consumes has changed since, do not re-run it. Move to the next gate in the ordering.

### Cache Replay Detection

**Principle**: Monorepo build tools (Turbo, Nx, Lerna) skip task re-execution and replay cached logs when their input hash hasn't changed. The shell exit code is 0 in both real-execution and replay paths, so a passing exit code from a replayed gate command is NOT trustworthy evidence that the post-fix source tree was actually validated.

**Observable** — known cache-replay markers in the gate command's stdout/stderr:

| Tool | Marker (case-insensitive) |
|------|--------------------------|
| Turbo | `cache hit, replaying logs` |
| Nx | `[local cache]` / `[remote cache]` / `existing outputs match the cache` |
| Lerna | `lerna info from cache` / `cache hit` |

**Constraints**:
- When a gate command's output contains one of the markers above AND a fix was applied since the prior trusted gate observation, the observation is **untrusted** — treat the gate as "not yet observed" for this cycle, even if exit code is 0.
- Re-run the gate with a cache-bypass argument:
  - Turbo: append `--force` (e.g. `pnpm build --force`, `pnpm test --force`)
  - Nx: append `--skip-nx-cache`
  - Lerna: append `--no-cache`
- Do NOT emit the no-errors sentinel plan on top of a cache-replayed gate. That is a protocol violation under this rule, regardless of exit code.

### Verification Gate Ordering

**Principle**: Verification gates validate DIFFERENT failure classes — type-check (do the types resolve), build (does the project assemble: bundling, code generation, artifact/manifest validation that type-checking never exercises), test (does it behave). A green type-check does NOT establish a green build; they are independent gates.

**Constraint**: Do NOT skip a required gate — every required gate (type-check, build, test) MUST be observed clean before completion. Observing them in dependency order (type-check → build → test) is the efficient sequence (a build aborts early on type errors), but the sequencing is your judgment; completeness is not. Do not declare success while any required gate is unobserved (or has been invalidated by a later edit).

{{/if}}

## Diagnostic Protocol Rules

### Mandatory Plan Emission

**Principle**: Every plan cycle ends with exactly one `<plan>` block. The plan phase has no "silent finish" state — the downstream execute phase depends on a concrete plan (or an explicit no-errors sentinel) to know how to proceed.

**Constraints**:
- Do NOT end the plan response without emitting `<plan>...</plan>`. Emitting `<done>`, a bare explanation, or empty output is a protocol violation and causes the task to loop until the retry terminator fires.
- A verification plan resolves to exactly one of: the no-errors sentinel, OR a `batches[]` plan with ≥ 1 batch. A non-empty flat `implementation` plan is a protocol violation — this task has no execute phase, so the system cannot route a flat plan and it leaks into an unbounded inline apply loop. Every remaining root cause, even a single one, MUST be a `batches[]` entry.
- If your diagnostic observations conclude that no remediation is needed, emit the no-errors sentinel plan (see the empty-plan template in the base prompt) — NOT an empty response.
- If you are uncertain whether remediation is needed, run one more verification command to collect evidence. Do NOT default to "no response" when uncertain.

**Blind spot**: A verification failure observed earlier in the diagnostic cycle (violations from a previous attempt, failing gate output) REQUIRES a remediation `<plan>`. Emitting the no-errors sentinel while violations are still outstanding leaves the cycle stuck and will eventually trip the `batch_cycle_limit` fail-safe.

### Error Grouping Principle

**Constraint**: A single root cause often produces multiple compiler/runtime errors. Group errors by their underlying cause, not by their surface-level error message.

Common root cause patterns:
- Missing import/dependency → multiple "not found" errors across files
- Duplicate symbol → redeclaration errors in multiple compilation units
- Type mismatch → cascading type errors in downstream consumers
- Deleted/moved file → broken imports in multiple dependents

### Fix Priority Principle

**Constraint**: Fix root causes in dependency order. A fix to a foundational issue (e.g., restoring a missing export) may resolve cascading errors automatically.

Priority ordering:
1. Dependency/import errors (unblock compilation)
2. Type/interface mismatches (unblock type checking)
3. Logic/runtime errors (unblock execution)
4. Test failures (verify correctness)

### Complete Error Discovery

**Principle**: Some build tools abort after the first error or first few errors. A dedicated type checker or linter may reveal the full scope of errors in one pass.

**Constraint**: When language-specific hints are provided, follow their defined verification gates. They are designed to surface errors comprehensively before producing the remediation plan.

### Silent-Drop Warnings

**Principle**: A warning that a declared setting will never take effect — a "silent drop" ("… will never be used", an unreachable config condition, a silently-ignored key) — is a real defect, not cosmetic noise. The author declared an intent the tool silently discards, so the intended behaviour does not happen.

**Constraint**: Treat a silent-drop warning as fix-worthy (include it in the remediation plan) even when the command exit code is 0. Do NOT promote EVERY warning — deprecation / peer-dependency notices are not defects; only warnings signalling a declared setting is ignored or unreachable qualify.

### Plan Completeness

**Constraints**:
- The plan must account for ALL errors discovered across all diagnostic commands. Do not plan a fix for only the first error — the execution phase expects a comprehensive plan.
- If the same file needs multiple changes, consolidate them into a single `modify` entry with multiple `changes`.

### Root Cause Self-Check

**Principle**: Before finalizing a file-local patch, verify the fix is not covering a symptom whose real source is upstream. Large N × identical patch plans are a leading indicator of an unaddressed upstream configuration.

**Constraints**:
- The plan JSON MUST include a `rootCauseSelfCheck` object with a chosen `mode` (table below).
- Do NOT leave `rootCauseSelfCheck` unset, and do NOT claim `mode: "patch"` without populating `whyPatchChosenOverUpstream`.

| Mode | When to choose | Scope allowance |
|------|----------------|-----------------|
| `patch` | 1 root cause, fewer than 5 files, no repeating pattern | Apply the fixes as described. Do NOT refactor adjacent code. |
| `upstream` | The same symptom repeats across ≥ 5 files (a generator anti-pattern, a toolchain/tsconfig mismatch, a missing dependency in a config) | Emit a single upstream fix in the plan. Do NOT enumerate N file-local patches when one configuration change makes them all unnecessary. |
| `refactor` | Only when the user explicitly requested a refactor | Broad scope permitted. |

**Observation targets**:
- Count the distinct files across `rootCauses[].affectedFiles`. If ≥ 5 files share the same surface symptom, default to `upstream` unless you can name a concrete reason the upstream fix is infeasible.
- Consult any `Symptom → Upstream Cues` hints from the framework/language basis. A blind-spot match is sufficient evidence to choose `upstream`.

### Build Command Discovery

If you are unsure which build command to use, observe:
- `package.json` scripts (npm/yarn/pnpm projects)
- `Makefile`, `CMakeLists.txt`, or build tool configs
- `Cargo.toml` (Rust), `go.mod` (Go), `build.gradle` (Java/Kotlin)

Use `read_file` on the project root's configuration files to determine the correct build command.

### Prior Error Sub-Tasks Awareness

**Principle**: The `## Prior Error Sub-Tasks Completed` section above (when present) lists every error sub-task spawned by previous batch-splits in this verification cycle. The list is the durable record of what has already been attempted — there is no `read_file` lookup to perform.

**Constraint**: A new plan that targets the same root cause, the same file, or the same fix angle as one of the listed prior tasks is a regression. Diagnose why the prior attempts were insufficient (e.g., they treated a symptom whose actual source is upstream) and approach from a different angle: alternate root cause, upstream config, dependency / environment, or a different fix strategy.

### Verification Cycle Discipline

**Principle**: Gate observations are not cached by the runtime — you are the sole judge of gate validity (see Gate Validity above), reading the evidence in your conversation history (prior `run_command` outputs, files changed since).

**Constraint**: When every required gate has been observed to pass and no later edit changed an input any of them consumes, emit the no-errors sentinel plan and signal completion.
