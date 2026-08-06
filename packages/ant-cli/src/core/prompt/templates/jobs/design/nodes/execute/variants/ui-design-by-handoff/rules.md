{{#if (eq detectedMode "refactor")}}
{{> jobs/shared/injections/handoff-bundle-revision}}
{{else}}
{{> jobs/shared/injections/handoff-package-format}}
{{/if}}

---

{{> jobs/shared/injections/handoff-name-binding}}

---

## OUTPUT FORMAT

Generate mode: write the complete file via ONE `create_file` tool call whose `path` is the pinned target path — nothing else writes to disk. The content streams to the user live as the call's arguments generate.

```
create_file(path="{{targetPath}}", content="...complete file content...")
```

- ❌ NO other `create_file` calls, NO `append_file`
- ❌ NEVER write to a path other than the pinned target
- Revise mode uses `read_file` + `edit_file` instead; structural removals listed in the task use `delete_file` (see task section)

---

## PER-FILE CONTRACTS

Apply the contract matching the target file's kind.

### `DESIGN.md`
- The nine system sections in order, each carrying value + reasoning (why the rule exists), grounded in the PRD and the visual policy for this run.
- Final **Artifacts** section: a table of every bundle file (exact relative paths from the task plan) with one-line purpose and the reading order (DESIGN.md → tokens → components/assets → screens).
- Name the ROLE a value plays (page canvas, muted body text, subtle divider) alongside the value and its reasoning. Do NOT coin `--variable` or class identifiers: `tokens/` and `components/` are authored concurrently with this file and cannot be bound to a name coined here.

### `tokens/<concern>.css`
- CSS custom properties under `:root` only — no selectors beyond `:root`, no component rules.
- Base values first, then semantic aliases referencing them (`--text-body: var(--fg-1)`).
- Cover the concern completely (a screen must never need a value this concern owns but doesn't declare).
- The property names declared here ARE the bundle's token API; every later file binds to them by reading this file.

### `styles.css`
- `@import` lines ONLY — tokens first, then component css, in the exact file set the task description enumerates. No rules of its own.

### `components/<name>.css`
- The component's classes and states, built ONLY on token variables — a literal value that a token owns is a defect.
- The class names declared here are the component's public API. Every state/variant a specimen or screen will need must exist here — a consumer cannot add one.

### `components/<name>.html`
- A specimen page rendering every meaningful state/variant, composed from the class names `components/<name>.css` declares — `read_file` it first; links `../styles.css`.
- A `<style>` block may hold ONLY this demo page's own scaffolding (page frame, section headings, state labels, swatch framing). A rule for the component under demonstration, or for any class another bundle file also composes, is a defect.
- State variants keep their state's imagery: an empty-state asset appears only in the variant demonstrating that state.

### `screens/<name>.html`
- Links `../styles.css` (single stylesheet entry). Composes component classes; references `assets/` by relative path.
- A `<style>` block may hold ONLY screen-local layout (grid/placement unique to this screen). Restating a token value or duplicating a component rule is a defect.
- Realistic content per the PRD — no lorem-ipsum when the PRD names real concepts.
- Realism covers imagery: a normal-state media slot renders imagery depicting its content (inline `<svg>` mock, or a dedicated content asset when shared). An empty-state illustration in a normal slot is a defect — it belongs only where the screen demonstrates that state.

### `assets/<name>.svg`
- Self-contained vector (no external refs); colors via the palette values the tokens define.
- One state semantic per asset — an asset drawn as "unavailable / empty" never doubles as normal content.

---

## CONSTRAINTS

- Every value decision must be traceable to DESIGN.md/tokens or the PRD, and every cross-file NAME must trace to the file that declares it. Inventing either downstream of its owner is a defect.
- Every page opens directly in a browser: relative paths only, no external network dependencies, no build step, no framework runtime.
- These files are design references, NOT production code — do not add application logic beyond what demonstrating the design requires.

⚠️ **Blind spot**: the file you author is read later by a code-generation job that trusts the DESIGN.md manifest and the token layer. An unregistered file, a hardcoded value, or an absolute path silently breaks that consumer.

---

## 🚨 TASK COMPLETION SIGNAL (CRITICAL)

**When the target file is complete, you MUST output:**

```xml
<done>true</done>
```

**Rules:**
1. GENERATE (target file does not exist): emit it in the turn AFTER the tool result confirms your single `create_file` call landed.
2. REVISE (target file exists): emit it in the turn AFTER the tool results confirm your `edit_file` changes landed — never in the same turn as a tool call.
3. ⚠️ Do NOT keep re-reading the file to verify — a successful `edit_file` result IS the confirmation.

**⚠️ Without `<done>true</done>` the task never completes; the system will keep asking you to continue.**
