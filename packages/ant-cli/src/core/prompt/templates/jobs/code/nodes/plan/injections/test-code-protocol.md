────────────────────────────────────────────────────────────────────────────────
## 🧪 TEST-CODE PROTOCOL
────────────────────────────────────────────────────────────────────────────────

{{#if hasPrePlanText}}
You are a **test-code batch-split sub-task**. The parent test-code task has
already installed the runner, wired the test-run entry, and declared your
slice boundary (`goal` / `rationale` / optional `requiredFiles`) in the
Parent Sub-Task Pre-Plan above.

- **Author your own `implementation`** for this slice — the parent declared the
  boundary, not the file-by-file plan. Observe the slice's source surface and
  emit the `create[]` (and `modify[]` if needed) entries for the test files
  this slice requires.
- Do NOT propose installing the runner / companion type packages, and do NOT
  edit any dependency manifest or shared test config — the parent owns those
  and the command guard rejects install verbs from sub-tasks (lockfile-race
  defence).
- Stay within your declared slice; do NOT widen into a sibling's surface even
  when adjacent work is observable.
{{else}}
You are the **parent test-code task**. Your plan-phase responsibilities, in
order:

### Step 1 — Map slice boundaries (shallow observation)

Observe **only what you need to choose slice boundaries and the runner**: the
top-level feature / module directory layout and any existing test-runner
config. Candidate slices are natural module groupings (domain / api / ui /
infra; feature-A / feature-B; service-a / service-b).

⚠️ **Blind spot — budget**: Reading every test target's full source before
deciding the split is the failure mode this step prevents. The split decision
needs the *boundary map*, not the contents. When you fan out, each child
re-investigates its own slice with a fresh budget — push the deep per-target
reads there, not here.

### Step 2 — Install the test runner (if missing)

The runner and the manifest's test-run entry belong to the parent, never to a
sub-task (sub-tasks run in parallel and would race on the lockfile and shared
manifest writes).

- If the project already declares a runner, verify its packages are installed
  and **skip install**.
- If none is declared, pick the ecosystem default and install it together with
  its matching types / globals package:

  ```
  {{#if hasPackageManager}}{{packageManager}}{{else}}npm{{/if}} add -D <runner> <runner-types>
  ```

- Verify the runner is invocable (its `--version`). Do NOT run the test suite —
  that is the verification task's job.
- If render-smoke targets exist (rendered surfaces among the test targets),
  also install the DOM test environment + component-render helper the detected
  stack needs, following the Self-Contained Dependency Principle. If the stack
  cannot host a render harness, the execute phase falls back to data-path
  tests — do NOT force-install an unsupported harness.

### Step 2.5 — Wire the test-run entry (if missing)

The verification phase invokes a single project-level test command. If the
dependency manifest does not expose one, wire it now with a single `edit_file`
to the **existing** manifest (not via `run_command`, not by creating a new
config file solely to host the command). If the ecosystem invokes its runner
directly from the toolchain root and the manifest is conventionally bare, no
action is needed.

⚠️ **Blind spot**: Installing the runner is not sufficient — verification
invokes the *entry point*, not the runner binary. Re-open the manifest after
install and confirm the entry exists.

### Step 3 — Recognize already-sufficient coverage

If your shallow observation shows every test target your task claims already
has a co-located test covering the same surface, your task is resolved: emit an
empty plan (no `batches[]`, empty `implementation`) and stop. Do NOT run the
test suite to "confirm" — the verification task owns that gate, and a
verification-only entry with no test file to create is a slice violation.
{{/if}}

### Test slices

A test slice is a cohesive scope whose test files do NOT overlap with any other
slice's test files (no two slices write the same file). Slices typically map to
a domain module, a layer, or a feature directory. When you fan out (see the
fan-out rules below), each `batches[]` entry is one such slice; keep the slices'
test-file surfaces disjoint so siblings can run in parallel without serializing.
`implementation.create[]` entries are the test files the slice (or single task)
will author.

**Constraint**: Never place a dependency manifest or shared test config
(`package.json` / lockfiles / `vitest.config.*` / `jest.config.*` / `tsconfig.json`
/ `pyproject.toml` / `go.mod` / ...) into a slice. Those are parent-owned and
must already be in place before any sub-task starts.

{{#if hasLanguageHints}}
### Language-specific hints

{{{languageHints}}}
{{/if}}
