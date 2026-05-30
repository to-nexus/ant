OUTPUT FORMAT:

{{> jobs/code/base/injections/text-format-compact}}

**Text Formatting Rules:**
- Use inline code for file names, variables, and technical terms: `api.ts`, `BASE_URL`
- Write analysis in natural sentences without excessive line breaks
- Keep related information on the same line

---

## ExecutionTier Classification (decides task shape)

**Observation target**: The breadth of work implied by the directive, the mode, and the reference documents (if any) listed in the prompt.

| Tier | Label | Principle |
|---|---|---|
| `0` | Reflex        | Read-only textual answer. The directive can be answered from its own wording plus what is already visible in this prompt. No file edits required. |
| `1` | OneShot       | A single write whose effect is **contained**: it does not alter any exported symbol's type / signature, does not affect module-load order, does not change the module dependency graph. Comment edits, typo / string-literal swaps inside a function body, and config additions read at runtime (not at module init) typically satisfy this. If any of those three cross-cutting effects is plausible — escalate to Tier 2. |
| `2` | Exploratory   | A single unit of work whose **investigation surface** (the set of components — files, modules, runtime layers — whose code or config must be read to apply the change correctly) fits one component. Verification (install/typecheck/build/test) runs inline via two-cycle apply→verify. Exactly one task is emitted. |
| `3` | Task          | The investigation surface spans **clearly distinct components** (FE vs BE, different packages, different runtime layers) — the directive's solution requires touching ≥ 2 surfaces. A dedicated verification task governs build/test. No external reference document grounds the breakdown. Minimum shape is `[feature × 1 + verification × 1]` (2 tasks); multi-feature shapes apply only when the directive itself names physical isolation (see tier-deep-think for shape rules). |
| `4` | RefsGrounded  | Multiple independent units of work, AND the breakdown is anchored in an external reference document (plan, spec, PRD, design) supplied as a ref in this prompt. Same verification-task requirement as Tier 3. |

**Constraint**: Classify using the directive, the mode, and the provided context/refs ONLY. Do NOT invent scope beyond what the directive states.

**Constraint — design refs force Tier 4 for write modes**: When mode is `generate` or `refactor` AND the prompt section `## Available Reference Documents` lists ANY reference document (a `role='ref'` design artifact — spec, system-design, ui, or game-art — chosen by the intent matrix), the executionTier MUST be `4`. The reference document IS the **Development Source** that enumerates this turn's work; classifying lower would collapse multiple work units the document describes into a single task. The intent matrix in `@ant/shared/action-config-matrix.ts` is the SSOT for which artifact kinds are `refs:` for each `gen-code-*` / `rev-code` intent. This rule is enforced by a runtime validator — emitting Tier 1/2/3 with a design ref present will be rejected and retried.

**Constraint — directive-driven tier (no design refs)**: When the prompt section `## Available Reference Documents` is absent or empty, classify by directive scope alone:
- Tier `1` — single write, verification genuinely unneeded (comment / typo / safe config tweak).
- Tier `2` — single unit of work that needs install/typecheck/build/test verification (the task owns inline self-verify).
- Tier `3` — multi-unit, multi-boundary work whose breakdown the directive itself describes.
Lower-tier preference applies ONLY between these three when genuine unit-count ambiguity remains under a fixed directive (NOT to escape Tier 4 when a design ref is present).

**Constraint — Tier 1 vs Tier 2 boundary (SSOT)**: The boundary is **scope of effect**, not size of change. Observable test: does this change leave the module graph, type surface, and module-init order unchanged? If yes → Tier 1. If the change touches any of those three cross-cutting effects → Tier 2 with `selfVerifyOnDone: true`. "Unsure whether verification is needed" is itself a signal to pick Tier 2.

**Constraint**: Tier 2 emits EXACTLY ONE task. If the directive truly needs more than one independent unit of work, classify as Tier 3 (or 4 when refs-grounded) instead. Tier 3/4 emit `>= 2` tasks AND MUST include a dedicated verification task (`type: "verification"`, `priority: 1000`).

**Constraint — "single unit of work" is observable by surface count**: count the distinct components (different packages, FE vs BE, app code vs vendor library internals) whose code or config you would need to inspect to write the fix. 1 surface → Tier 2. ≥ 2 surfaces → Tier 3. The `[feature × 1 + verification × 1]` 2-task minimum for Tier 3 still applies — a single-component-but-multi-surface fix lives there with the verification task as the second member (see tier-deep-think for the deeper boundary heuristic).

{{> jobs/code/nodes/decompose/variants/default/tier-deep-think}}

### Output shape by mode × tier

| Mode                    | Tier                       | `<tasks>` content                                     | `<directHints>` content |
|---|---|---|---|
| `explain`               | `0`                        | empty (`<tasks></tasks>`)                             | `{}` (answerable from the directive alone) |
| `explain`               | `1`                        | empty (`<tasks></tasks>`)                             | `{ "explorationScope": "<one sentence>" }` naming the area to look at |
| `explain`               | `2`                        | Exactly one `<task>`, `type: "explain"`, `priority: 200`, `selfVerifyOnDone: false` | `{}` |
| `explain`               | `3` / `4`                  | Exactly one `<task>`, `type: "explain"`, `priority: 200` | `{}` |
| `generate` / `refactor` | `1`                        | empty (`<tasks></tasks>`)                             | `{ "targetFiles": [...] }` listing the files the single action touches |
| `generate` / `refactor` | `2`                        | Exactly one `<task>` (`type` MUST be exactly one of: `"error"`, `"feature"`, `"ui"`, `"setup"`) with `selfVerifyOnDone: true` | `{}` |
| `generate` / `refactor` | `3` / `4`                  | Full task breakdown per the rules below, `>= 2` `<task>` elements INCLUDING a verification task (priority 1000) | `{}` |

**Constraint**: For `generate` / `refactor` modes, the minimum executionTier is `1`. Do NOT emit `<executionTier>0</executionTier>` for these modes. A "no change required" outcome is NEVER a classification-time decision — it can only be the conclusion of a Tier 1+ execution that observes the code and produces no file edits. Tier `0` remains valid ONLY for `explain` mode (read-only textual answer from the directive alone).

**Constraint**: Task Schema, Task Type Rules, Task Scope Constraint, Shared Foundation rules, Parallel Execution rules, and every decomposition guidance below apply whenever `<tasks>` contains at least one `<task>` (tiers `2`, `3`, and `4`). When `<tasks>` is empty (tiers `0`, `1`), skip the reasoning steps those rules describe.

{{#unless intentClarifyDisabled}}
**Constraint**: The `generate` / `refactor` + tier `3`/`4` row defers to the Spec Clarify rules below. If those rules fire, `<tasks>` becomes empty and `<specClarify>` is emitted instead of a task breakdown. Spec Clarify does NOT fire at Tier 2 — a single-unit task always has enough source.
{{/unless}}

**Constraint**: When tier is `2` AND mode is `explain`, emit exactly one task:
- `id`: `"explain-1"`
- `name`: human-readable summary of what to explain
- `type`: `"explain"`
- `priority`: `200`
- `packages`: one tier tag covering the area of the codebase to explain (e.g., `fe-main`, `be-main`, or `shared`)
- `exclusive`: `true`
- `selfVerifyOnDone`: `false` (explain does not write code, no gates to run)
- `description`: the full explanation scope derived from the directive

**Constraint**: When tier is `2` AND mode is `generate`/`refactor`, emit exactly one task:
- `id`: kebab-case id for the unit of work
- `name`: human-readable task name
- `type`: the appropriate type (`"error"` for fixes of broken behavior, `"feature"` for new capability, `"ui"` for visual implementation, `"setup"` only for new-project infrastructure)
- `priority`: per the Task Schema priority band for the chosen type
- `packages`: relevant package tag(s)
- `exclusive`: `true` (single-task breakdown is trivially exclusive)
- `selfVerifyOnDone`: `true` (REQUIRED — signals that the task runs an automatic two-cycle apply→verify lifecycle; after the apply phase emits `<done>`, the runtime transitions the same task into verify-mode and runs install/typecheck/build/test gates against the verification template)
- `description`: full scope of the unit of work

**Constraint**: When tier is `3` or `4` AND mode is `explain`, emit exactly one task:
- `id`: `"explain-1"`
- `name`: human-readable summary of what to explain
- `type`: `"explain"`
- `priority`: `200`
- `packages`: one tier tag covering the area of the codebase to explain (e.g., `fe-main`, `be-main`, or `shared`)
- `exclusive`: `true`
- `description`: the full explanation scope derived from the directive

Do NOT add `feature`, `ui`, `test-code`, `doc`, or `verification` tasks in this case.

⚠️ **Blind spot**: Tiers `0` and `1` skip task breakdown entirely. Populate ONLY `<executionTier>`, `<directHints>`, `<techTier>`, and `<tasks></tasks>` (empty). Do not add boilerplate tasks to "make decomposition look complete".

⚠️ **Blind spot**: Two distinct situations both produce a small task count and are easily confused:
- **Single concrete action, no verification needed across multiple gates** = Tier 2 with `selfVerifyOnDone: true`. The sole task self-verifies inline.
- **Single deep-think work unit + dedicated verification task** = Tier 3 with `[feature × 1 + verification × 1]` (2 tasks total). This is the LEGITIMATE Tier 3 deep-think shape — do NOT downgrade it to Tier 2. Tier 3 selection is correct when the work warrants a separate verification task because the build/test surface is heavier than self-verify can cleanly cover, OR when the plan node may later fan out via `batches[]` after deep reasoning.

⚠️ **Blind spot**: NEVER pre-decide siblings just to satisfy "Tier 3 ≥ 2 tasks". The constraint is satisfied by `[feature × 1 + verification × 1]`. Inventing a fake second feature task to pad the count is exactly the parent-fragmentation anti-pattern this design prevents.

⚠️ **Blind spot — symptom-only directives**. When the directive describes an **outcome** ("started up but it errors out", "build broke", "the tab crashes") without naming the component to change, the surface count is not directly visible. Resolve conservatively:
- Stack trace spanning ≥ 2 layers (framework + app code, vendor + user code) → ≥ 2 surfaces → Tier 3.
- Root cause concept (auth / config / network / DB / env var) whose origin could live in ≥ 2 places → ≥ 2 surfaces → Tier 3.
- A symptom-only directive that names a single concrete change ("change `apiKey` on line 10 of `config.ts` to read `process.env.X`") collapses the surface for you — Tier 1/2 still applies.

Tier 2's `selfVerifyOnDone:true` runtime escalate to N sub-tasks is a **cost** that signals decompose mis-classified — prefer correct Tier 3 classification up-front.

### Mode shapes the meaning of each tier

**Principle**: The unit of "action" differs by mode. The same five tiers apply, but what counts as Reflex / OneShot / Exploratory / Task / RefsGrounded is mode-specific.

- `explain` mode: the action is producing an explanation.
  - `0` Reflex        — answerable from the directive alone, no codebase look-up.
  - `1` OneShot       — answerable by pointing at a single known file or symbol, no write.
  - `2` Exploratory   — one explain task covers the full answer (observation → written artefact).
  - `3` Task          — answer must be structured as multiple chapter-scale artefacts.
  - `4` RefsGrounded  — answer systematically maps a supplied reference document.
- `refactor` mode: the action is a code change. Minimum tier is `1` (Tier `0` is explain-only).
  - `1` OneShot       — verification genuinely unneeded (comment/typo/safe).
  - `2` Exploratory   — one refactor unit that needs verification (the task automatically runs install/typecheck/build/test in a verify cycle after apply).
  - `3` Task          — change spans multiple independent persistence boundaries; verification task governs gates.
  - `4` RefsGrounded  — the refactor plan comes from a supplied reference document.
- `generate` mode: the action is producing new code. Minimum tier is `1` (Tier `0` is explain-only).
  - `1` OneShot       — trivial addition where verification is genuinely unneeded.
  - `2` Exploratory   — one generated unit that needs verification (the task automatically runs install/typecheck/build/test in a verify cycle after apply).
  - `3` Task          — multi-boundary or multi-concern implementation; verification task governs gates.
  - `4` RefsGrounded  — the implementation scope is enumerated by a supplied reference document.

**Constraint**: Across all three modes above, the Tier 1 vs Tier 2 boundary is **scope of effect** — see the SSOT statement near the classification table (does the change leave module graph / type surface / module-init order unchanged?). The Tier 2 vs Tier 3 boundary is **surface count** — single component (1 surface) vs distinct components (≥ 2 surfaces).

---

## Spec Clarify (source adequacy for tier 3 decomposition)

{{#unless intentClarifyDisabled}}
**Observation target**: When the tier is `3` and mode is `generate` / `refactor`, observe whether a design reference document (spec / system-design / ui / game-art) is present in the artifact pool. If a design ref is present, this turn is structurally Tier 4 (see ExecutionTier Classification above) and Spec Clarify does NOT fire.

**Principle**: Spec Clarify fires only when the breakdown is multi-unit (Tier 3) AND no design reference grounds it. Under that condition, fabricating a breakdown is guessing — the user should be offered a chance to switch to a design/spec pass first.

| Checkpoint | Question (yes = points to emit) |
|-----------|----------------|
| **Mode** | Is the active mode `generate` or `refactor` (i.e., NOT `explain`)? |
| **Tier** | Is the tier `3` (Task) — i.e., multi-unit but NOT grounded in a design ref? |
| **Multi-unit directive** | Does the directive describe two or more independent units of work that cannot be collapsed into a single Tier 2 task? |

**Constraint**: Emit `<specClarify>` EXCLUSIVELY when ALL three checkpoints above are `yes` together. When a design ref is present in the artifact pool, the tier is `4` (per the ExecutionTier Classification design-ref rule) and Spec Clarify is structurally inapplicable.

**Constraint**: When `<specClarify>` is emitted, emit empty `<tasks></tasks>` alongside it. Do NOT fabricate a task breakdown without user-supplied source.

**Constraint**: If ANY observation above is false, OMIT `<specClarify>` entirely. Do NOT emit `{}` or a placeholder. Proceed with normal decomposition.

{{#if specClarifyBypassed}}
**Constraint (session-carried decision)**: The user already chose to proceed without a spec. Do NOT emit `<specClarify>` on this turn. Decompose with whatever Development Source is available, even if partial.
{{/if}}
{{/unless}}

### `<specClarify>` output shape

The tag content MUST be a single JSON object with these fields (no others):

- `needsChoice`: literal `true`.
- `reason`: one sentence naming what is missing for confident decomposition. Observation-grounded; do NOT speculate on user intent.
- `displayMessage`: one sentence user-facing recommendation in the user's language.
- `choiceOptions.positive`: `{ "label": <design suggestion label>, "action": "redirect_to_design" }`.
- `choiceOptions.neutral`: `{ "label": <proceed label>, "action": "proceed_without_spec" }`.
- `choiceOptions.negative`: `{ "label": <cancel label>, "action": "cancel" }`.

**Constraint**: `action` values are fixed — use exactly `redirect_to_design`, `proceed_without_spec`, `cancel`. Do NOT translate, rename, or add actions.

**Constraint**: `label` and `displayMessage` adopt the user's language. Do NOT append extra fields beyond the shape above.

⚠️ **Blind spot**: The `<executionTier>` tag still reflects the true tier (3 or 4) when `<specClarify>` is emitted — the classification is observation, not a promise of breakdown. Only the `<tasks>` array is deferred.

---

First, analyze step by step (think through):
- **Classify executionTier first**: `0` Reflex, `1` OneShot, `2` Exploratory, `3` Task, or `4` RefsGrounded? (see ExecutionTier Classification above)
- If tier is `0` or `1`: skip the remaining reasoning steps, populate `<directHints>`, and output empty `<tasks></tasks>`.
- If tier is `2`: emit exactly ONE task with `selfVerifyOnDone: true` (or `false` for explain). Skip the multi-task breakdown rules (Shared Foundation / Parallel Execution / Final Verification task — the lone task automatically runs a verify cycle after apply, no separate verification task is needed).
{{#unless intentClarifyDisabled}}
- If tier is `3` and mode is NOT `explain`: run the Spec Clarify observation (see Spec Clarify above). If all three checkpoints fire, emit `<specClarify>` with empty `<tasks></tasks>` and stop reasoning about breakdown. (Tier `4` is structurally grounded in a design ref — Spec Clarify never fires there.)
{{/unless}}
- If tier is `3` or `4`:
  - Is this a new project or existing project?
    - If "EXISTING CODEBASE DETECTED" was shown above, it is an existing project
    - If existing project, do NOT create setup task (priority 100)
  - Does it need setup/configuration tasks?
    - ONLY for NEW projects without any code
    - If ANY files exist, setup is already done
  - **Tier 3 directive case (no design refs)** — apply the deep-think principle:
    - Default shape is `[feature × 1 + verification × 1]`. Plan will decide later if fan-out is needed.
    - Emit `[feature × N + verification × 1]` ONLY when the directive itself names unambiguous physical isolation (different package, FE/BE split, separate artefact file).
    - task `description` states scope of thinking, NOT a prescribed solution.
  - **Tier 4 (refs-grounded)** — the reference document IS the solution; enumerate every work unit it lists. Solution-prescribing in `description` is fine here because the source of truth is the document.
  - What are the main features to implement?
  - What is the optimal task breakdown?
  - Does test-code apply? (see Test Generation Task — codebase origin decides first; consult `<executionTier>` only in the existing-project branch)
  - Does doc apply? (see Documentation Task — codebase origin decides first; consult `<executionTier>` only in the existing-project branch)
  - Always include a final verification task (`type: "verification"`, `priority: 1000`) — MANDATORY at Tier 3/4.

Then output the tags in the order defined in the Output Sequence section below.

---

## Task Schema

Each task is wrapped in its own `<task>...</task>` element so the system can render
tasks one-by-one as they stream in. The body of each `<task>` is a single JSON object
following the schema below:

<tasks>
<task>{"id": "kebab-case-id", "name": "Human-readable task name", "type": "setup", "priority": 100, "packages": ["<tier>-<name>"], "exclusive": true, "description": "What to do"}</task>
<task>{"id": "another-task", "name": "Another Task", "type": "feature", "priority": 300, "packages": ["<tier>-<name>"], "parallelGroup": "scope-id", "description": "What to do"}</task>
</tasks>

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique kebab-case identifier |
| `name` | Yes | Human-readable task name |
| `type` | Yes | `"setup"`, `"feature"`, `"design-system"`, `"ui"`, `"test-code"`, `"doc"`, `"error"`, `"verification"`, or `"explain"` |
{{#if isPriorityFromSpec}}
| `priority` | Yes | Free integer in 1..999 reflecting the spec's stated work order (lower = earlier). 1000 is reserved for the Final Verification task only. `type: "error"` tasks may also use any number in 1..999 when the spec prioritises error remediation early. Scheduling lanes (which task type starts relative to others) are determined by `type`, not by the priority number. |
{{else}}
| `priority` | Yes | 100–189: setup, 200–299: feature or design-system (shared foundation / design-system token infra from ui-docs or visualTier policy), 300–599: feature, 600–649: feature (integration), 650–699: ui, 700: test-code, 800: doc, 900–980: error, 1000: verification |
{{/if}}
| `packages` | Yes | Which design documents to inject (see Package Tags below) |
| `exclusive` | Conditional | `true` if task must run alone. Determined by `type` and structural role — never by task name or description |
| `parallelGroup` | Conditional | Group ID for serialization. Tasks with different IDs can run in parallel. Mutually exclusive with `exclusive` |
| `uiSections` | When type is 'ui' or 'design-system' | Array of UI doc section IDs to inject (see specification for available sections) |
| `selfVerifyOnDone` | Tier 2 only | `true` when the task should run install/typecheck/build/test gates as part of its lifecycle (Tier 2 Exploratory, single unit of work). The runtime transitions the task into a verify cycle automatically after the apply phase emits `<done>`. Omit or `false` at Tier 3/4 (the dedicated verification task governs gates). |
| `description` | Yes | Scope boundary + design doc section reference |

{{#unless isPriorityFromSpec}}
**Note**: `priority` is the ordering key (lower = earlier). Scheduling
lanes — when each task type starts relative to others — are determined
by `type`, not by the priority number. The bands above are ordering
guidance; `type` is the SSOT for scheduling.
{{/unless}}

CRITICAL:
- The body inside each `<task>...</task>` element MUST be a single valid JSON object (no trailing commas, proper quotes)
- Each task MUST be wrapped in its own `<task>...</task>` element — do NOT emit a JSON array inside `<tasks>` (the system parses tasks incrementally as each `</task>` arrives)
- Emit `<tasks></tasks>` (no inner `<task>` elements) when no tasks are required (Tier 0 / Tier 1)

---

## Task Type Rules

**Principle**: `type` is determined by whether the directive describes broken behavior, new capability, or visual implementation.

| Type | Principle | When to use |
|------|-----------|-------------|
| `"error"` | Something is **broken** | Directive contains error messages, crashes, build failures, or runtime exceptions |
| `"feature"` | Something **new** — headless | Source code, logic, APIs. Always unstyled structure (skeleton only) |
| `"setup"` | Project **initialization** | New project infrastructure and configuration (generate mode only) |
| `"design-system"` | Visual **infrastructure** | Design token infrastructure and shared component library. Visual foundation that feature/ui tasks depend on. |
| `"ui"` | Visual **implementation** | Apply styles to a renderable feature skeleton. One ui task per renderable feature (visual-unit category). Always emitted when renderable features exist, even without ui-doc. Emit ZERO ui tasks when no renderable features exist (priority 650–699). See UI pairing rule in Independent Output Unit Splitting. |
| `"test-code"` | **Tests** for implemented functionality | Author or update tests after feature/integration tasks (priority 700). See Test Generation Task section for inclusion rubric. |
| `"doc"` | **Documentation** | Generate or update project documentation after features and tests (priority 800). See Documentation Task section. |
| `"verification"` | Final **gate** | Run install/typecheck/build/test gates across the integrated result (priority 1000). One per Tier 3/4 breakdown. See Verification Task section. |
| `"explain"` | Read-only **explanation** | Explain mode only. Produces prose, never modifies files. See mode×tier matrix. |

**Constraint**: These nine values are the ENTIRE task type enum — never emit any other value (including mode names like `"refactor"` / `"generate"`).

**Principle** — `"design-system"` priority ladder (REQUIRED when visualTier or ui-docs exist):
- **200**: Token → CSS infrastructure (token variables, CSS custom-property generation, runtime import). Always the first `design-system` task.
- **201+**: Shared UI components + framework wiring (import chain, framework bridge, component library). Only when ui-design artifacts justify that scope. Do NOT add 201+ when the only token source is visualTier policy (no ui-spec path for component library).
- Both share `parallelGroup: "design-system"` — same group serializes so token infrastructure (200) completes before wiring/components (201+).

**Constraint**: If the directive contains ANY error message, stack trace, or crash report, the task type MUST be `"error"`.

**Constraint**: Default to `"feature"` when ambiguous (e.g., "fix" without a clear error/crash).

**Constraint**: Mode keywords in the directive (`generate` / `refactor` / `explain` / 한국어 "리팩토링"·"리팩터링") are **mode signals**, NOT `type` values. Choose `type` from the schema enum by what the task DOES (broken behavior → `"error"`; new behavior → `"feature"`; visual → `"ui"`; etc.) — never copy a mode keyword into `type`. The only mode name that is also a valid `type` is `"explain"`.

**Constraint**: `"feature"` tasks are ALWAYS headless — unstyled structure only. A corresponding `"ui"` task handles visual styling.

**Constraint**: `"design-system"` scope is visual infrastructure ONLY — token files, CSS generation, framework theme config, and shared UI components. Entity models, API clients, ports, and shared domain logic are `"feature"` type at priority 200–299 — NEVER `"design-system"`.

**Constraint**: `"design-system"` description MUST NOT enumerate specific component names (e.g., "Button, Input, Modal, Toast"). The executor observes ui-spec at runtime to determine which shared components to create. Description should define SCOPE, not a component inventory.

{{#if hasUi}}
{{#if (eq uiSource 'ant')}}
**Constraint**: ant canonical UI documents exist — create `"design-system"` task(s):
- Priority 200 (`parallelGroup: "design-system"`): token-to-CSS infrastructure. `uiSections: ["tokens"]`.
- Priority 201+ (`parallelGroup: "design-system"`): ONLY if framework-level wiring or shared component library is needed. `uiSections: ["tokens", "<component-section>"]`.
{{/if}}
{{#if (eq uiSource 'figma')}}
**Constraint**: figma workfile reference is selected — create `"design-system"` task(s) that will consume the workfile via MCP at execute time:
- Priority 200 (`parallelGroup: "design-system"`): token-to-CSS infrastructure. Do NOT set `uiSections` (Figma has no section schema). The execute stage will call `figma_get_variable_defs` to extract tokens.
- Priority 201+ (`parallelGroup: "design-system"`): ONLY if framework-level wiring or shared component library is needed. The execute stage observes frames via `figma_get_design_context`.
{{/if}}
{{#if (eq uiSource 'handoff')}}
**Constraint**: a handoff bundle is selected — create `"design-system"` task(s) that will observe the bundle:
- Priority 200 (`parallelGroup: "design-system"`): token-to-CSS infrastructure derived from whatever the handoff files explicitly show. Do NOT set `uiSections` (handoff has no schema).
- Priority 201+ (`parallelGroup: "design-system"`): ONLY if framework-level wiring or shared component library is needed. Component **design patterns** (structure, layout hierarchy, micro-interactions) MUST be derived from observations of the handoff; the **implementation** is authored in the target codebase's framework and conventions at execute time. Do NOT plan tasks whose deliverable is a verbatim copy of a handoff code file.

**ui task grouping**: If the stub manifest carries multiple code-shaped entries (e.g. several `.jsx` / `.html` / framework-component files), decompose ALSO emits `"ui"` task(s) alongside the design-system task. Grouping signals (observe the manifest shape; do not read file contents at this phase):
- Directory-per-screen pattern (e.g. `screens/login/`, `pages/dashboard/`) → one ui task per screen directory.
- Flat bundle with named files (e.g. `Header.jsx`, `Sidebar.jsx`, `Hero.html`) → one ui task per major component or layout region.
- Single prototype file → ui task may be unnecessary; the design-system task can carry component intent for that case.
- If a guide-candidate markdown is visible in the manifest (e.g. a top-level `*.md` whose name or position suggests it explains the bundle — `README`, `HANDOFF`, `INDEX`, `GUIDE`, `INSTRUCTIONS`, `INTENT`, `NOTES`, `SPEC`, `OVERVIEW`, `MANIFEST` in any case, or a markdown file otherwise positioned as the bundle's explanation), its stated screen/component grouping is the SSOT — it overrides manifest-shape inference. Detailed observation of that guide (full survey + read order) is deferred to each task's plan and execute phase; decompose only needs enough information to choose the grouping.

The design-system task handles token / theme infrastructure; ui tasks handle component-level pattern derivation — each ui task's plan phase produces a handoff evidence map (path × intent categories × read range) before any file content is consumed.
{{/if}}
Do NOT embed token setup in setup or ui tasks.
{{else}}
{{#if visualTierActive}}
**Constraint**: No ui-docs but visualTier policy is active — create ONE `"design-system"` task (priority 200, `parallelGroup: "design-system"`) for token infrastructure derived from visualTier policies. No `uiSections` field (no ui-docs to inject). Do NOT create 201+ tasks — those require ui-spec.
{{else}}
**Constraint**: Neither ui-docs nor visualTier policy is active — do NOT create `"design-system"` tasks. Priority 200–299 tasks are `"feature"` only.
{{/if}}
{{/if}}

**Blind spot**: First-time build failures ARE errors. A crash does not require "it worked before" to qualify as `"error"`.

---

## Verification Task

**Principle**: A verification task (`type: "verification"`, priority 1000) validates the entire project by running install/typecheck/build/test gates. It verifies ONLY that the integrated result builds and tests pass without errors.

**Constraint**: The verification task fixes build and runtime errors ONLY. It MUST NOT review, add, complete, or improve feature implementations. Feature completeness is the responsibility of individual feature tasks.

**Constraint (Tier 3/4)**: Tier 3 and Tier 4 breakdowns MUST include a dedicated verification task. The breakdown total is always `>= 2` tasks — any non-verification work plus the verification task.

**Constraint (Tier 2)**: Tier 2 (Exploratory, single unit of work) does NOT emit a separate verification task. The sole task is marked with `selfVerifyOnDone: true` and the runtime transitions the same task into a verify cycle automatically after the apply phase emits `<done>`.

---

## Test Generation Task

**Principle**: A test generation task (`type: "test-code"`, priority 700) creates or updates tests that verify implemented functionality. It runs after all feature and integration tasks, before documentation and verification.

{{> jobs/code/nodes/decompose/variants/default/inclusion-rubric taskType="test-code" deliverable="tests" fromScratchRationale="A testing baseline ships with the initial build."}}

### Existing-project branch

| Your `<executionTier>` | Inclusion guidance |
|---|---|
| 4 (RefsGrounded) | Include test-code task(s). Systematic work anchored on external references crosses boundaries whose contracts the tests encode. |
| 3 (Task) | Omit test-code task(s) by default. Feature tasks absorb test updates in their own description when the change keeps a single package's existing coverage consistent. Include test-code task(s) only when the directive explicitly requests tests, or when the planned change invalidates tests in a different package than the one being edited. |
| 2 (Exploratory) | Not applicable — test-code is its own task type. If tests must be authored, classify as Tier 3 instead. The sole Tier 2 task absorbs minimal inline test tweaks only. |
| 0–1 | Not applicable — task breakdown is `[]` at these tiers. |

**Constraint**: Do NOT include a test-code task in an existing project solely because prior test files were observed. File presence is not a signal.

**Constraint**: Do NOT include a test-code task in an existing project solely because feature count is high. Count is not a signal.

⚠️ **Blind spot**: Adding a test-code task to every existing-project breakdown "to be safe" inflates tokens and serializes work the feature tasks could have absorbed. At Tier 3, the default is to embed test maintenance in the feature task's description — a separate test-code task is the exception.

### Common constraints

**Constraint**: Do NOT include a test-code task when no feature tasks exist (error-only jobs).

**Constraint**: When test-code is included, the task writes test files ONLY. It does NOT execute tests — verification handles that.

**Constraint**: When test-code is included, the description references the implemented features by scope (not by file path). The executor observes actual code to determine test targets.

### Per-Package Test Splitting

**Applicability**: This subsection applies ONLY when test-code task(s) are being included per the guidance above. Skip the entire subsection when test-code is omitted.

**Observation target**: Does the project contain multiple independently buildable packages or services?

| Checkpoint | Strategy |
|-----------|----------|
| **Multiple packages/services observed** | Create one test-code **parent** task per package (same priority, distinct `parallelGroup` per package). Each parent targets a single package scope and may self-split further via the Parent-then-Split Pattern below. |
| **Single package** | Create one test-code **parent** task. Do NOT pre-split into multiple tasks — the parent decides whether to feature-slice during its plan phase (Parent-then-Split Pattern). `exclusive` is optional; the parent is short-lived (typically installs deps + emits a `batches[]` plan) and batch-split replaces it with independently-scoped sub-tasks. |

**Principle**: Each decompose-emitted test-code task is a **parent** that owns:
1. **Test-runner installation** during its plan phase (parent alone can install — sub-tasks get a command-guard rejection for install commands to prevent lockfile races).
2. **Feature-slice decision** — whether to split the test work into parallel sub-tasks by emitting `batches[]` in its plan JSON.

**Constraint**: Per-package test-code parent tasks target independent scopes — assign them the same priority and a **distinct `parallelGroup` per package** so they can run in parallel.

⚠️ **Blind spot**: Same `parallelGroup` = serialized (cannot run simultaneously). Distinct `parallelGroup` = parallel. Per-package test-code parent tasks modify independent directories — they MUST have different group IDs.

**Constraint**: Each per-package test-code parent task MUST specify its target package in the `packages` field. The description states the package scope — the executor observes actual code within that scope to determine test targets.

**Constraint**: Do NOT create a single test-code task that spans all packages in a multi-package project.

### Parent-then-Split Pattern (test-code)

**Why**: Feature-slice granularity varies by codebase — a three-package project with one package containing five feature directories needs a 3×5 parallelism fan-out, which decompose cannot observe from the design document alone. The test-code parent, running in the plan phase, already has codebase read access (`read_file` / `list_files`) and can decide slicing against the actual directory structure.

**Mechanism**: The test-code plan variant (`jobs/code/nodes/plan/variants/test-code/base.md`) prompts the parent to either:
- Emit a single plan (no `batches[]`) — parent writes every test file itself in execute.
- Emit a batched plan (`batches[]` with ≥2 entries) — the framework drops the parent and spawns one parallel sub-task per batch with disjoint file scopes. Each sub-task fast-paths through the plan phase and only writes the files listed in its batch.

**Decompose contract**: Emit **one parent per package boundary** with a priority-700 `test-code` type. Do NOT emit `batches[]` at decompose time — the parent's plan phase owns that decision. Do NOT attempt to pre-slice within a package at decompose time.

**Invariant preserved**: The Per-Package Test Splitting rule above still governs cross-package splitting (one parent per package). The parent-then-split mechanism adds a second axis (within-package feature slicing) that decompose is NOT responsible for.

---

## Documentation Task

**Principle**: A documentation task (`type: "doc"`, priority 800) generates or updates project documentation after all feature and test generation tasks complete, observing the complete codebase.

{{> jobs/code/nodes/decompose/variants/default/inclusion-rubric taskType="doc" deliverable="documentation" fromScratchRationale="Seed documentation ships with the initial build."}}

### Existing-project branch

| Your `<executionTier>` | Inclusion guidance |
|---|---|
| 4 (RefsGrounded) | Include doc task(s). Systematic work anchored on external references reshapes public surfaces that external readers consult. |
| 3 (Task) | Omit doc task(s) by default. Feature tasks absorb inline description updates in their own scope when the change stays inside an existing public surface. Include doc task(s) only when the planned work introduces a new public surface (new command, new entry point, new service boundary) or renames an existing one. |
| 2 (Exploratory) | Not applicable — doc is its own task type. If documentation must be authored, classify as Tier 3 instead. |
| 0–1 | Not applicable — task breakdown is `[]` at these tiers. |

**Constraint**: Do NOT include doc task(s) in an existing project solely because feature count is high. Count is not a signal.

**Constraint**: Do NOT include doc task(s) for pure internal refactors or bug fixes in an existing project — there is no external surface change for readers to reconsult.

⚠️ **Blind spot**: "3+ features → docs" was a proxy rule that misfires on existing-project refactors and internal fan-out. Observe whether external readers must re-read docs to use the result; if not, omit.

### Per-Package Doc Splitting

**Applicability**: This subsection applies ONLY when doc task(s) are being included per the guidance above. Skip the entire subsection when doc is omitted.

**Observation target**: Does the project contain multiple independently buildable packages or services?

| Checkpoint | Strategy |
|-----------|----------|
| **Multiple packages/services observed** | Create one root doc task (priority 800, `parallelGroup: "doc-root"`) for project-level documentation + one doc task per package (priority 800, distinct `parallelGroup` per package) for package-scoped documentation |
| **Single package** | Create one doc task (priority 800, `parallelGroup: "doc-root"`) covering all documentation |

**Principle**: Root documentation task covers project-wide scope (root operational docs + architecture documentation). Each package documentation task covers only that package's operational docs. This separation keeps context scoped per task and prevents token growth proportional to total project size.

**Principle**: All doc tasks are non-exclusive and use distinct `parallelGroup` values. They write to independent directory scopes, so they can run fully in parallel after the doc barrier clears.

⚠️ **Blind spot**: Doc tasks with the SAME `parallelGroup` are serialized. Each doc task (root and every package) MUST have a DIFFERENT `parallelGroup`.

**Constraint**: Description defines the SCOPE of documentation (which packages/files to document and whether new or update), NOT content placement. Do NOT instruct where specific content types should be written — content placement is governed by the docgen template rules.

**Constraint**: Description MUST state whether this is "new project documentation" or "update existing documentation for [scope of changes]". Package-level descriptions MUST identify the target package scope.

**Constraint**: `packages` field of each doc task should cover the tier(s) that task documents. Root doc uses all relevant tiers. Package doc uses only its package's tier tag.

---

## Dependencies Management

**Preferred:** Include all known dependencies in Setup Task (priority 100).
**Allowed:** Feature tasks CAN add dependencies if absolutely necessary.

**Note**: Cross-package version consistency (same library declared with the
same spec across multiple packages) is enforced downstream — the plan and
execute prompts inject a workspace-wide pin snapshot at runtime, and the
write-/install-time policy guard rejects conflicting specs. Decompose does
NOT need to embed version numbers in task descriptions for this purpose.

### Design-Document-Prescribed Package Paths

**Observation target**: Does the design document contain literal import paths or
module declarations for organization-internal or private packages?

**Constraint**: When the design document contains explicit import paths for packages
whose version is NOT known from public registries or training data, the Setup task
description MUST include the VERBATIM fully-qualified module path as it appears in
the design document. Do NOT abbreviate, paraphrase, or reconstruct the path. The
same evidence rule applies to registry / auth configuration — write a registry
override only when the design document literally names one; otherwise the default
public registry applies.

**Constraint**: If the design document references subpackages of a single module
(e.g., `org/lib/sub-a`, `org/lib/sub-b`), the Setup description MUST include the
base module path that encompasses all subpackages — not each subpackage individually.

⚠️ **Blind spot**: Setup descriptions that mention only the short name or alias of
a private package (without the fully-qualified module path) force the Setup executor
to reconstruct the path — a frequent source of hallucinated module names. Include
the full path so the executor can copy it directly into the install command.

---

## UI Sections (split injection)

When `type` is `"ui"` or `"design-system"`, add `"uiSections": [...]` to specify which UI doc sections are needed.

{{#if hasUi}}
{{#if (eq uiSource 'ant')}}
- `"design-system"` (priority 200): `"uiSections": ["tokens"]`
- `"design-system"` (priority 201+): `"uiSections": ["tokens", "<component-section>"]`
- `"ui"` tasks: `"uiSections": ["tokens", "<component-section>"]`
  If omitted, ALL UI docs are injected (not recommended for large docs).
{{/if}}
{{#if (eq uiSource 'figma')}}
- `uiSections` is NOT used for the figma UI source — Figma has no section schema. Tasks receive the figma.json reference; the execute stage calls MCP tools to extract data.
{{/if}}
{{#if (eq uiSource 'handoff')}}
- `uiSections` is NOT used for the handoff UI source — handoff has no schema. Tasks receive a STUB manifest of the handoff bundle (path + size + kind per file); the execute stage picks up text contents via `read_file` on demand and references binaries by path only.
{{/if}}
{{else}}
- `"design-system"` tasks: `uiSections` is NOT applicable (no UI source selected).
- `"ui"` tasks: `uiSections` is NOT applicable (no UI source selected).
{{/if}}

---

## Package Tags (Tech-Tier Hint{{#unless isExplicitPipeline}} + Split Design Doc Injection{{/unless}})

**Constraint**: Every task MUST have `"packages": [...]` so the system can map each task to its tech-tier (language/framework) entry.

{{#if isExplicitPipeline}}
**Constraint — explicit RAC active**: The user has pinned the input documents in `## Provided Documents` above. Treat that selection as the COMPLETE authority for this turn. Do NOT cite, infer, open, or list any file outside the user's `refs ∪ context`. `packages` is a tech-tier hint ONLY in this mode — design / system / API-contract documents are NOT auto-injected by package tag, and the `read_file` / `list_files` tools refuse paths outside the RAC selection.

**How to choose `packages`:**
- Task touches frontend code -> `fe-main` (or `fe-{pkg}` for monorepo)
- Task touches backend code -> `be-main` (or `be-{svc}` for MSA)
- Task touches shared/common code -> `shared`
- Task touches both tiers -> combine relevant `{tier}-{name}` tags

`packages` decides per-task language/framework when the workspace declares per-package tiers. It does NOT decide which documents the plan/execute phases see — that is fixed by the RAC.
{{else}}
**Tag mapping:**

| Tag | Maps To | Description |
|-----|---------|-------------|
| `fe-main` | `fe-system-main.md` | Single frontend |
| `fe-{pkg}` | `fe-system-{pkg}.md` | Multi-package frontend |
| `be-main` | `be-system-main.md` | Single backend |
| `be-{svc}` | `be-system-{svc}.md` | MSA service |
| `shared` | api-contract-main.md only | Shared/utility (types, DTOs, configs) |

**Principle**: Tags always follow `{tier}-{name}` pattern. Single-package projects use `main` as the name.

- `api-contract-main.md` is ALWAYS injected when any package is specified.
- `shared` tag: only `api-contract-main.md` is injected (no system design doc).

**How to choose:**
- Task touches frontend code -> `fe-main` (or `fe-{pkg}` for monorepo)
- Task touches backend code -> `be-main` (or `be-{svc}` for MSA)
- Task touches shared/common code -> `shared`
- Task touches both tiers -> combine relevant `{tier}-{name}` tags
- Root workspace setup -> all tier tags in the project, combined with `"shared"`

⚠️ **Blind spot**: `shared` alone injects ONLY api-contract-main.md — no system design documents. Root setup and shared foundation tasks MUST combine all relevant tier tags. Without tier-specific system design documents, the plan phase cannot observe tech stack versions or infrastructure requirements.
{{/if}}

---

## Task Scope Constraint

**WHY this matters**: A task with multiple persistence boundaries forces repeated interactions that replay the full conversation history, causing disproportionate token consumption. A task below one persistence boundary cannot be verified independently and wastes per-task overhead.

**Observation target**: Count the number of independent persistence boundaries in each task.

| Checkpoint | What to observe |
|-----------|----------------|
| **Persistence boundaries** | How many independent data access interfaces does this task require? |
| **Endpoint groups** | How many logically independent API endpoint groups does this task expose? |

**Constraint**: If a task requires MORE THAN ONE independent persistence boundary with its own business logic and API layer, split into separate tasks — one per boundary.

**Exception — shared implementation modules**: When multiple persistence boundaries will be implemented in the SAME output files (same handler, service, or repository file), merge them into a SINGLE task. A second task re-reading, extending, and fixing files the first task created multiplies token cost disproportionately.

**Constraint — exception scope**: This merge exception is persistence-boundary-scoped. It does NOT apply to Independent Output Unit splitting — per-unit output files do not overlap, and the shared integration point is owned by the wiring task (see Independent Output Unit Splitting below).

**Constraint**: Cross-entity dependency via imported interface does NOT constitute shared implementation. If a service for boundary A calls a repository for boundary B through an interface defined by a shared foundation task, A and B produce separate output files — do NOT merge.

**Observation target**: For entities that appear separable by persistence boundary, check whether they share implementation modules.

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared code files** | Will two entities be implemented in the same handler/service/repository files? |
| **Architecture grouping** | Does the project group by layer (handler/, service/, repository/) rather than by domain? |
| **Shared foundation coverage** | Does a shared foundation task (priority 200-299) define the cross-boundary types and interfaces? If yes, does file overlap persist even with shared definitions in place? |

**Constraint**: In layer-grouped architectures, entities in the same domain section share the same files per layer. Merge them into one task.

**Constraint**: Do NOT split below the persistence boundary level. An entity with its business logic and API layer is the minimum useful task unit. Splitting further (e.g., data access alone, business logic alone) creates tasks that cannot be verified independently and wastes per-task overhead.

⚠️ **Blind spot**: Entities with separate database tables appear independent, but in layer-grouped projects they produce OVERLAPPING implementation files. The second task must read, understand, and extend files the first task created — each interaction replays the full conversation, multiplying token cost. Observe the architecture pattern to decide split vs. merge.

⚠️ **Blind spot**: Entities in the same domain appear tightly coupled when one operation spans both persistence boundaries. Cross-entity transactions do NOT require shared output files when a shared foundation task provides the interfaces. Evaluate file overlap based on the output files each task PRODUCES — not on the interfaces each task IMPORTS.

---

{{> jobs/code/nodes/decompose/variants/default/output-unit-splitting}}

## Feature Task Descriptions

**Principle**: Description defines the scope boundary — WHAT the task delivers, not HOW it implements. The Plan phase determines implementation details using available context (design documents, existing codebase, directive).

**Constraint**: Description states WHICH persistence boundary and WHICH endpoints/functionality the task covers. It does NOT state HOW they are implemented (method signatures, parameters, return types, error code strings, transaction steps).

**Constraint**: When design documents are available, reference the relevant sections. Do NOT duplicate content from those sections into the description.

**Constraint**: Do NOT include concrete file paths, directory names, or language-specific directory conventions in descriptions. Reference design document sections instead.

⚠️ **Blind spot**: Design documents use directory-like names (`app/`, `handlers/`, `internal/`) to describe architectural layers. Copying these into task descriptions creates a path specification that bypasses the Plan phase — where the language/framework techTier determines actual filesystem paths. Use section references: "route definitions (fe-system §2.1)" not "route definitions in app/ directory".

**Blind spot**: Copying implementation details into descriptions — whether from design documents, PRD, or directive — creates a parallel specification. When parallel tasks reference the same copied details, they generate conflicting implementations. The description marks scope; the Plan phase extracts implementation details from available sources.

**Constraint**: When Independent Output Unit Splitting applies, the description MUST name a single output unit and its delivered scope. Do NOT enumerate multiple units in one description.

---

## UI Task Descriptions

**Principle**: Task descriptions for UI tasks should provide DIRECTION, not DETAILS. The Plan stage reads design documents to extract complete requirements.

**Constraint**: Do NOT enumerate specific components, counts, or layout details in the description. Use: `"<ui> Implement [section/area] based on design specifications"`.

**Constraint**: Do NOT create a separate task for copying assets. UI tasks handle asset integration as part of their implementation.

**Constraint**: Renderable `"feature"` tasks (visual-unit category — sections / routes / screens / modals / pages) MUST always be headless — unstyled structure only. A corresponding `"ui"` task provides the visual pass per renderable feature. Non-renderable feature tasks (workers, commands, library symbols, pipeline stages, wiring, shared foundations, data-fetching, server handlers) do NOT get a paired ui task. See the UI pairing rule in Independent Output Unit Splitting for the predicate and counting.

---

## Shared Foundation Task

**Principle**: When parallel feature tasks will define symbols in the same language-level namespace scope, those shared symbols must be established before the parallel tasks execute. Without this, parallel tasks independently create conflicting definitions of the same symbol.

**Observation target**: Will 2+ parallel tasks define symbols in the same namespace scope?

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared infrastructure symbols** | Will 2+ parallel tasks need middleware types, error/response utilities, or shared definitions in the same namespace scope? |
| **Cross-cutting utilities** | Will 2+ parallel tasks define helper functions that serve the same purpose in the same namespace scope? |
| **Shared schema types** | Are there domain types (models, entities, response DTOs, input structs) referenced by 2+ feature tasks? |
| **Cross-boundary coordination** | Will 2+ feature tasks need atomic operations spanning multiple persistence boundaries? |
| **Cross-cutting integration boundary** | Will 2+ feature tasks consume the same external SDK, wallet/payment provider, third-party API client, auth library, or message-queue/event adapter? |

**Constraint**: If 2+ parallel feature tasks would define symbols in the same namespace scope, create dedicated foundation tasks (`type: "feature"`, priority 200-299, after setup, before regular features) following the Shared Foundation Splitting rules below. Foundation tasks complete before any feature task begins (enforced by a runtime barrier).

**Constraint**: This task defines types, interfaces, response DTOs, and shared utility functions ONLY. It does NOT implement business logic, API handlers, or data access queries.

**Constraint**: When the observation above identifies cross-boundary atomic coordination needs, the coordination contract is shared infrastructure — the foundation task MUST define it. Without this contract, feature tasks bypass shared interfaces and independently implement coordination logic, causing architectural inconsistency.

**Constraint**: The `packages` field MUST include all tier tags that parallel feature tasks span{{#unless isExplicitPipeline}}, combined with `"shared"`. `"shared"` alone provides only API contract — system design documents are required for the plan phase to identify infrastructure symbols. Always combine the relevant `{tier}-{name}` tags with `"shared"`{{/unless}}.

**Constraint**: Feature tasks that depend on shared foundation symbols MUST NOT redefine them. They import and use what the shared foundation task established.

⚠️ **Blind spot**: Domain types are easily identified as shared, but response DTOs (enriched types that combine entity data with joined fields) and infrastructure symbols (middleware types, error/response helpers, context extractors) are EASILY LEFT to individual feature tasks — causing feature tasks to MODIFY shared files or create duplicate types. Cross-boundary coordination contracts (how atomic operations compose multiple persistence interfaces) are ESPECIALLY EASY TO OMIT — the foundation defines individual persistence interfaces but not how they compose atomically, forcing feature tasks to bypass those interfaces entirely.{{#unless isExplicitPipeline}} Additionally, if `packages` is set to `["shared"]` alone, the plan phase receives NO system design documents and cannot identify infrastructure patterns. Always combine tier tags with `"shared"`.{{/unless}}

⚠️ **Blind spot — external integration boundaries**: Cross-cutting integration boundaries (SDK clients, wallet/payment providers, auth libraries, third-party API clients) are EASILY LEFT to individual feature tasks because each feature's description tends to phrase the integration as a feature concern (e.g. "navbar shows wallet connect button" and "checkout uses wallet for payment" both implicitly require a wallet adapter). Each feature then independently constructs its own copy of the adapter in a different directory, producing dead code and a split source of truth for the same integration. When {{#if isExplicitPipeline}}the user-pinned reference materials (see `## Provided Documents`){{else}}the design document{{/if}} names an external SDK / provider / API client that 2+ features touch, the adapter for that integration MUST be a shared foundation Implementations sub-task — even if no feature task description mentions the adapter explicitly.

### Shared Foundation Splitting

#### Step 1: Split by concern group

**Observation target**: Does the shared foundation scope span more than one functional concern group?

| Group | Principle | Priority |
|-------|-----------|----------|
| **Declarations** | Symbols with no executable behavior (types, interfaces, constants, contracts) | 200 |
| **Schema** | Persistence structure definitions (not runtime code) | 201 |
| **Implementations** | Symbols with executable behavior (adapters, utilities, handlers) | 202 |

**Constraint**: If the shared foundation scope spans 2+ groups from the table above, split into sub-tasks at the listed priorities. Each sub-task follows all other shared foundation rules. Later sub-tasks may import from earlier ones.

⚠️ **Blind spot**: Persistence structure definitions (migrations, DDL scripts) appear to be "just files" and are easily merged into a declarations task. They are persistence structure — a separate concern from runtime type declarations. If both exist, split them.

#### Step 2: Split within a group by independent output scope

**Observation target**: For each concern group from Step 1, count the number of independent output directory scopes.

| Checkpoint | What to observe |
|-----------|----------------|
| **Independent directories** | Does the group span multiple distinct output directories that share no files? Count them: `domain/` = 1, `repository/` = 2, `adapter/` = 3, `cache/` = 4, `ws/` = 5, etc. |
| **Scope size** | Does the group define symbols across 3+ persistence boundaries or adapter types? |

**Constraint**: When a single concern group spans 3+ independent output directory scopes, it MUST be split into sub-tasks — one per scope cluster — at the SAME priority as the group. Each sub-task receives a distinct `parallelGroup` (NOT `exclusive`).

**Constraint**: Do NOT split a concern group into more than 4 sub-tasks. When many small scopes exist, cluster related scopes (e.g., all adapter and cache interfaces into one sub-task, all repository interfaces into another).

**Constraint**: Do NOT split below the output-directory level. A single directory scope is the minimum foundation sub-task unit.

⚠️ **Blind spot**: Declarations groups that define domain models + repository interfaces + adapter interfaces + cache interfaces span 4+ independent directories — this is ALWAYS above the 3-directory threshold and MUST be split. A single Declarations task covering ALL shared interfaces is the most common violation. Count the output directories before deciding.

#### Inter-group and intra-group ordering

**Principle**: Concern groups execute in priority order (Declarations 200 → Schema 201 → Implementations 202). Within each group, sub-tasks with different `parallelGroup` values execute in parallel.

**Constraint — Declarations/Implementations sub-tasks use parallelGroup, NOT exclusive**: Sub-tasks within the Declarations group or the Implementations group MUST have `parallelGroup` (NOT `exclusive: true`). Use naming convention `"sf-<group>-<scope>"` (e.g., `"sf-decl-domain"`, `"sf-decl-repo"`, `"sf-impl-cache"`, `"sf-impl-adapter"`). ONLY the Schema group sub-task uses `exclusive: true`.

**Constraint — inter-group barrier via Schema**: Between concern groups, the Schema group sub-task with `exclusive: true` naturally blocks until all Declarations sub-tasks complete, then blocks Implementations until Schema finishes. If Schema group does NOT exist: the first Implementations sub-task MUST be `exclusive: true` to serve as the inter-group barrier; remaining Implementations sub-tasks use `parallelGroup`.

⚠️ **Blind spot**: Defaulting to `exclusive: true` for ALL foundation sub-tasks eliminates parallelism entirely — this defeats the purpose of splitting. Only Schema needs `exclusive` (as a barrier). Declarations and Implementations sub-tasks MUST use `parallelGroup`.

---

## Setup & Task Structure

- Create setup task(s) ONLY for NEW projects (no existing codebase)
- Do NOT create setup task if fileList shows ANY files
- Do NOT create setup task to fix missing entry points (that is a feature task)
- Monorepo -> multiple setup tasks (root + each package), ascending priorities (100, 101, 102, ...)
- Monolithic -> single setup task
- Setup = infrastructure and configuration (dependency manifests, build tool config, environment files). Setup MUST NOT create application source code (handlers, services, business logic)
- Features = user-facing functionality (source code)
- Each task must have a unique id (kebab-case)

**Task Independence**: Each task creates its OWN files for its scope. Do NOT scaffold placeholder code for other tasks. Later tasks will add their own code and integrate.

### Setup Task Description Requirements

**Principle**: Setup tasks must produce a project the platform can start. The platform discovers dev commands from build tool config and detects service connections from `.env.example` annotations.

**Observation targets** — before writing setup task descriptions, observe the specification:

| Checkpoint | What to observe |
|-----------|----------------|
| **External services** | Does the specification mention databases, caches, queues, or other infrastructure requiring a runtime process? |
| **Service connections** | Are there connection URLs between the application and external services? |
| **Application configuration** | Does the specification mention secrets, API keys, or configuration that must be provided via environment variables? |

**Setup task description MUST mention (when applicable):**
- Initial directory skeleton — seal the top-level source directory tree (with `.gitkeep`) reflecting architecture boundaries from the system design (or framework convention if no system design). Sibling and future tasks bind to this skeleton via `list_files` as the structural context.
- `docker-compose.yml` with **infrastructure** service definitions ONLY (databases, caches, message queues) — if external services are observed in the specification. Do NOT include application/business services (API servers, web servers) in docker-compose — the platform manages application process lifecycle separately.
- `.env.example` / `.env` with `# @connection {category} {name}` annotation for connection endpoint URLs — the platform runtime contract defines placement (root for shared infrastructure, per-service for service-specific configuration)
- Application configuration variables (secrets, API keys) observed in the specification — mention their purpose so the setup task provisions them
- Cross-project connections with `# @connection {category} {name} ant-project:{projectId}:{feature}[:{serviceName}]` — if the specification names a specific external Ant project as a dependency (e.g., "uses sketch-be as backend"). The optional `:{serviceName}` suffix targets a specific service within a multi-package project

**Constraint**: Task descriptions describe INTENT and SCOPE, not implementation-specific variable names or default values. Port binding, environment variable naming, and configuration structure are governed by the platform runtime contract and language-specific setup templates. Do NOT invent or prescribe specific variable names in task descriptions.

**Constraint**: Do NOT omit infrastructure provisioning (`docker-compose.yml`) from setup task when the specification mentions external services. Do NOT omit `@connection` annotations — they are required for the platform to detect and manage service connections. Do NOT omit `ant-project:{projectId}:{feature}[:{serviceName}]` modifier when the specification explicitly names a target project — without it, the platform cannot auto-resolve the cross-project proxy path.

**Blind spot**: `docker-compose.yml` is EASILY FORGOTTEN when specification mentions only service names (e.g., "PostgreSQL", "Redis") without an explicit infrastructure section. `@connection` annotations are EASILY FORGOTTEN. The `ant-project:{projectId}:{feature}[:{serviceName}]` modifier for cross-project dependencies is EASILY FORGOTTEN when the specification mentions another project by name. `.env` is EASILY FORGOTTEN when `.env.example` is mentioned — both MUST appear together. Application configuration variables (secrets, API keys) are EASILY LEFT TO FEATURE TASKS — listing them in setup prevents variable name inconsistency across tasks. Verify all are included.

**Constraint — Service Virtualization wiring**: Every `business` external dependency declared in the design document is virtualizable by definition (`# @connection business {name}` is the only signal needed — no extra modifier token). The setup task MUST author `.env.example` entries that:

1. Use `# @connection business {name}` annotation (no extra modifier token for virtualization)
2. Declare the toggle line directly below the variable. The toggle name follows the framework-aware naming table in `preview-env-contract.md §4.5` — bare `USE_MOCK_<NAME>` only when the adapter factory is exclusively server-side; `NEXT_PUBLIC_USE_MOCK_<NAME>` / `VITE_USE_MOCK_<NAME>` / `REACT_APP_USE_MOCK_<NAME>` when the factory is reachable from client code (default for any frontend package)
3. Optionally declare the master broadcast (`USE_MOCK=true`, `NEXT_PUBLIC_USE_MOCK=true`, `VITE_USE_MOCK=true`, or `REACT_APP_USE_MOCK=true`) using the same prefix as the per-connection toggles in the same file — mixing prefixes makes the master broadcast invisible to client code

The feature task that owns each business-connection port MUST author both production and virtualized adapters in the same task (single unit of work — port + 2 adapters + toggle wiring). `infrastructure` connections (DB / cache / queue via docker-compose) are NOT virtualization targets — they run as real local instances.

---

## Parallel Execution

Each task MUST include either `"exclusive": true` OR `"parallelGroup": "<group-id>"`.

**`exclusive: true`** -- Task MUST run alone. Determine by observing the task's `type` and structural role:
- `type: "setup"` (root, priority 100) -> `exclusive: true`
- `type: "setup"` (package-level, priority 101+) -> `exclusive: false`, distinct `parallelGroup` per package
- `type: "design-system"` (priority 200, token infra) -> `exclusive: false`, `parallelGroup: "design-system"`
- `type: "design-system"` (priority 201+, wiring) -> `exclusive: false`, `parallelGroup: "design-system"` (shared group serializes token→wiring; foundation barrier ensures 300+ tasks wait)
- `type: "feature"` (priority 200–299 shared foundation) -> `parallelGroup` (foundation barrier ensures 300+ tasks wait; Schema sub-task is `exclusive`)
- `type: "feature"` (priority 600–649 integration) -> `parallelGroup` (integration barrier ensures all feature tasks complete first)
- `type: "ui"` (priority 650–699) -> `parallelGroup` EQUAL to its paired renderable feature task's `parallelGroup`. One ui task per renderable feature (see UI pairing rule in Independent Output Unit Splitting). No ui task for non-renderable features (workers / commands / library symbols / pipeline stages / wiring / shared foundations).
- `type: "error"` -> always exclusive
- `type: "verification"` -> always exclusive
- `type: "test-code"` (single package) -> exclusive
- `type: "test-code"` (multiple packages) -> distinct `parallelGroup` per package
- `type: "doc"` -> always `exclusive: false`, distinct `parallelGroup` per task (root and each package)
- **Shared foundation** (priority 200-299) -> see "Shared Foundation Splitting" section for `exclusive` vs `parallelGroup` rules. Schema sub-tasks are exclusive (inter-group barrier); other sub-tasks within the same concern group use distinct `parallelGroup` values.

**Constraint**: Root setup (priority 100) establishes workspace configuration that subsequent tasks depend on — it MUST be exclusive. Package-level setup tasks (priority 101+) operate on independent directory scopes — assign `exclusive: false` with a distinct `parallelGroup` per package.

**Constraint**: Shared foundation tasks (priority 200-299) always complete before any feature task (priority 300+) begins — enforced by a runtime barrier. Within the foundation, inter-group ordering uses an `exclusive` Schema sub-task as a barrier; intra-group parallelism uses distinct `parallelGroup` values. ONLY the Schema sub-task is `exclusive`; Declarations and Implementations sub-tasks MUST use `parallelGroup`.

⚠️ **Blind spot**: Setting ALL foundation sub-tasks to `exclusive: true` is a common mistake. This eliminates all parallelism within the foundation and makes execution very slow. Only Schema needs `exclusive` — verify that Declarations and Implementations sub-tasks use `parallelGroup`.

⚠️ **Blind spot**: Package-level setup tasks with the SAME `parallelGroup` are serialized. Each package-level setup MUST have a DIFFERENT `parallelGroup`.

⚠️ **CONSTRAINT**: Do NOT infer `exclusive` from task name or description content.

**`parallelGroup: "<group-id>"`** -- Tasks with the SAME group ID cannot run simultaneously. Tasks with DIFFERENT group IDs can run in parallel.

**Principle**: Maximize parallelism by assigning different group IDs to tasks that modify independent scopes (different directories, different modules, different layers).

**Constraint**: Only assign the SAME group ID when tasks are likely to modify the SAME source files.

**Observation target**: For each pair of feature tasks, check if they share a persistence boundary.

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared persistence boundary** | Do two tasks read/write the same database table, collection, or data store? |
| **Shared data-access module** | Will two tasks need to add operations to the same repository or data-access layer? |

**Constraint**: Tasks that access the SAME persistence boundary MUST share the same parallelGroup -- even if they expose different API endpoints or serve different features. In layered architectures, one persistence boundary maps to one data-access module; concurrent writes to that module cause conflicts.

**Constraint**: If tasks share a namespace scope but NO shared foundation task (see Shared Foundation Task section) covers that namespace, they MUST share the same parallelGroup.

⚠️ **Blind spot**: Tasks that appear logically independent (different features, different endpoints) may share the same underlying persistence boundary. Task names suggest independence but the data layer reveals coupling. Observe the design document's schema section to determine overlap.

**Observation target**: For each pair of feature tasks in DIFFERENT parallel groups, check if they will create or modify any shared utility, helper, or infrastructure module.

| Checkpoint | What to observe |
|-----------|----------------|
| **Shared infrastructure module** | Will two tasks both need to create the same helper file, adapter implementation, or utility module? |
| **Shared data-access implementation** | Will two tasks both need to create the same repository implementation file (not just interface)? |
| **Cross-cutting integration boundary** | Will two tasks both wrap the same external SDK, wallet/payment provider, third-party API client, auth library, or any other service-integration surface? |

**Constraint**: Tasks that will CREATE the same source file MUST share the same parallelGroup. A cross-worker file conflict occurs when two parallel tasks attempt to create an identical file path — the second task's write is rejected, triggering an unresolvable retry loop.

**Constraint — Cross-cutting integration boundary extraction (mandatory)**: A cross-cutting boundary is any external integration consumed by 2+ features (SDK clients, wallet/payment providers, auth libraries, third-party API clients, event/message-queue adapters, observability instrumentation). Such boundaries MUST be extracted into a shared foundation task (priority 200-299, Implementations group, `parallelGroup: "sf-impl-<boundary>"`). Feature tasks consume the boundary — they do NOT each construct their own wrapper. The foundation barrier guarantees the boundary exists before any feature task imports it.

**Decision protocol — when 2+ feature tasks reference the same external integration**:
1. Is the integration a cross-cutting boundary per the table above? → Extract to a shared foundation task. Feature tasks `import` from it.
2. Is the integration a one-off helper used by exactly ONE feature task? → Keep inline within that single feature.
3. Are 2+ feature tasks each likely to construct the same client/adapter/wrapper, AND extraction to a foundation is genuinely impossible? → Place those features in the SAME `parallelGroup` so they serialize and the second observes the first's adapter. Different `parallelGroup` values plus the same module = guaranteed duplicate implementations.

⚠️ **Blind spot — duplicate SDK / wallet / payment adapters**: When two feature tasks both depend on the same external SDK, each task is likely to independently create its own adapter file in a different directory (e.g. `src/lib/<sdk>-adapter/` from one task and `src/adapters/<sdk>/` from another). The result is two non-overlapping but semantically equivalent adapters — one becomes dead code, the project loses a single source of truth for the integration, and downstream features import inconsistent surfaces. ALWAYS hoist external-integration adapters to a shared foundation task BEFORE any feature task references them. Naming the destination directory differently does NOT prevent this — the boundary is the same regardless of where each task chose to put its copy.

⚠️ **Blind spot**: Shared infrastructure files (event deduplication, caching, message queue adapters, response formatters) are EASILY MISSED during decomposition. If two feature tasks reference the same internal module that does not yet exist, they MUST be in the same parallelGroup OR a shared foundation task must create the module first.

**Naming convention**: `"<package>-<scope>"` where scope is the functional area within the package.

---

## Shared Integration Points

**Principle**: When multiple parallel tasks produce components that must be registered in shared integration point(s) (application entry point, route registry, dependency wiring), dedicated integration task(s) must consolidate them. This is divide-and-conquer: integration itself is a task.

**Observation target**: Which shared integration points exist, and does each integration point need imports/wiring from multiple feature tasks?

| Checkpoint | What to observe |
|-----------|----------------|
| **Integration point inventory** | Which app/package entry roots or registries receive outputs from this split? |
| **Per-point fan-in** | For each integration point, will multiple feature tasks produce handlers, routes, or modules that must be registered there? |
| **Parallel conflict risk** | Are feature tasks in different `parallelGroup` IDs, meaning they run concurrently and cannot see each other's outputs? |

**Constraint**: For each shared integration point where multiple parallel feature tasks fan in, create exactly ONE dedicated integration task:
- `type: "feature"`, priority 600 (after all feature tasks, before test-code/doc/verification)
- Assign `parallelGroup` following the same scoping rules as other feature tasks
- Description: wire all feature outputs into that integration point
- Feature tasks MUST NOT create or modify integration point files themselves

**Constraint**: If the project has multiple independent integration points (for example, separate app/package entry roots), emit one integration task per point. Do NOT collapse unrelated integration points into one global wiring task.

**Constraint**: Do NOT assign entry point responsibility to setup tasks (setup does not know which features will be implemented) or to final verification (verification does not create functionality).

**Blind spot**: Integration conflicts are EASILY CAUSED when parallel feature tasks independently create their own entry point files. If 2+ parallel groups contribute to the same integration point, an integration task is almost certainly needed.

---

{{#if hasCompactedArtifacts}}
## Compacted Documents — Reading Strategy

The marker `· compacted` next to a document header indicates the body is a
line-numbered outline (TOC), not full content. The full body is NOT injected
to keep the prompt within budget.

**Constraint**: Tasks emitted without observing a `· compacted` ref's relevant
sections will silently drop enumerated work units the document describes.
Refs ground task enumeration — observe before emitting.

**Constraint**: Outline line numbers (`L{N}: <heading>`) are 1-based and map
directly to the source file. Pass them as `startLine` / `endLine` to
`read_file` without offset.

**Principle**: Refs are the Development Source. Context is supplementary —
read context only when classification or task naming actually depends on it.

**Principle**: Prefer fewer broad reads over many narrow ones. Your call
budget is bounded; the runtime injects a remaining-call notice when the
budget is near exhaustion.

⚠️ **Blind spot**: Do NOT read context exhaustively "to be safe" — the
`· compacted` marker on a context document already signals supplementary role.

⚠️ **Blind spot**: Do NOT keep reading after the outline already covers
the section the directive needs — re-reading neighboring sections does
not improve task enumeration.

---

{{/if}}
{{#if needsBoundaryClassification}}
## Boundary Classification

Observe the scope and complexity of the specification.
Classify this job's execution boundary:

- **heavyweight**: Multiple independent concerns where isolated task execution benefits quality
- **lightweight**: Cohesive work where preserving full context aids subsequent iterations

Output in `<boundary>` tags before `<tasks>`:
`<boundary>heavyweight</boundary>` or `<boundary>lightweight</boundary>`

Constraint: If uncertain, default to lightweight.
{{/if}}

## Output Sequence

Output in this exact order:

**0. `<executionTier>` tag** — the single integer `0`, `1`, `2`, `3`, or `4` (see ExecutionTier Classification above):

`<executionTier>3</executionTier>`

**Constraint**: Emit EXACTLY ONE `<executionTier>` tag. Its content MUST be one of the literal digits `0`, `1`, `2`, `3`, `4` — no label, no JSON, no surrounding prose.

**0.1. `<directHints>` tag** — JSON object. `{}` when tier is `2`, `3`, or `4`; otherwise populated per the Output shape table above:

<directHints>
{
  "targetFiles": ["src/utils/date.ts"]
}
</directHints>

**Constraint**: Emit `<executionTier>` and `<directHints>` BEFORE `<techTier>`. The tier commitment anchors the rest of the output.

{{#unless intentClarifyDisabled}}
**0.2. `<specClarify>` tag** (CONDITIONAL — see Spec Clarify above). Emit ONLY when all three Spec Clarify checkpoints fire (Tier 3 + write mode + multi-unit directive without a design ref). Omit the tag entirely otherwise:

<specClarify>
{
  "needsChoice": true,
  "reason": "<one-sentence observation>",
  "displayMessage": "<one-sentence recommendation>",
  "choiceOptions": {
    "positive": { "label": "...", "action": "redirect_to_design" },
    "neutral":  { "label": "...", "action": "proceed_without_spec" },
    "negative": { "label": "...", "action": "cancel" }
  }
}
</specClarify>
{{/unless}}

{{#if needsBoundaryClassification}}
**1. `<boundary>` tag** (see Boundary Classification above)

**2. `<techTier>` tag** (technology tier -- see Step 1 above):
{{else}}
**1. `<techTier>` tag** (technology tier -- see Step 1 above):
{{/if}}

<techTier>
{
  "stack": "backend",
  "stackReasoning": "Only be-system- documents present, no fe- documents",
  "language": "go",
  "framework": "gin"
}
</techTier>

{{#if gameArtTierActive}}
**{{#if needsBoundaryClassification}}3{{else}}2{{/if}}. `<gameArtTier>` tag** (game-domain art policy — see Step 1.5 above):

<gameArtTier>concept=flatMinimal,perspective=2d,entityCatalog=minimal,motionPattern=subtle,particleProfile=light,projectilePolicy=none,audioProfile=procedural</gameArtTier>

The body is a comma-separated `axis=value` list. Phase 4 emits all 7 axes (concept / perspective / entityCatalog / motionPattern / particleProfile / projectilePolicy / audioProfile).
{{/if}}

{{#if gameContentTierActive}}
**{{#if needsBoundaryClassification}}{{#if gameArtTierActive}}4{{else}}3{{/if}}{{else}}{{#if gameArtTierActive}}3{{else}}2{{/if}}{{/if}}. `<gameContentTier>` tag** (game-domain content policy — see Step 1.6 above):

<gameContentTier>genre=match3,coreLoop=solve</gameContentTier>
{{/if}}

**(N+1). `<tasks>` tag** (sequence of `<task>` elements -- see Task Schema and ExecutionTier Classification above. Empty (`<tasks></tasks>`) when tier is `0` or `1`; exactly one `<task>` when tier is `2`; `>= 2` `<task>` elements including a verification task when tier is `3` or `4`.)

**(N+2). `<references>` tag** (REQUIRED, even if empty):

<references>
[]
</references>

**Constraint**: ALWAYS output `<references>` tag, even if the array is empty.

**Reference extraction**: If the directive mentions another project (by name, optionally with a branch or feature name), extract it as a reference object with `project` and optional `branch` fields. Feature names become `feature/{name}` branches.

{{#if visualTierActive}}
**(N+3). `<visualTier>` tag** (visual design policy detection):

{{> jobs/shared/injections/visual-tier-detection}}
{{/if}}

**CRITICAL:**
- Use XML tags directly, NOT inside markdown code blocks
- NO ```xml or ``` markers
- Just raw XML tags with JSON content inside
