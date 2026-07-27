{{> jobs/shared/injections/handoff-package-format}}

---

## OUTPUT FORMAT

Generate mode: emit the complete file inside ONE `<file>` block whose `path` is the pinned target path — nothing else writes to disk.

```
<file path="{{targetPath}}">
...complete file content...
</file>
```

- ❌ NO other `<file>` blocks, NO `<append>`, NO markdown fences around the block
- ❌ NEVER write to a path other than the pinned target
- Revise mode uses `read_file` + `edit_file` instead (see task section)

---

## PER-FILE CONTRACTS

Apply the contract matching the target file's kind.

### `DESIGN.md`
- The nine system sections in order, each carrying value + reasoning (why the rule exists), grounded in the PRD and the visual policy for this run.
- Final **Artifacts** section: a table of every bundle file (exact relative paths from the task plan) with one-line purpose and the reading order (DESIGN.md → tokens → components/assets → screens).
- State token names (e.g. `--color-primary`) when referencing values that `tokens/` will own — the css file is the value source, DESIGN.md is the reasoning source.

### `tokens/<concern>.css`
- CSS custom properties under `:root` only — no selectors beyond `:root`, no component rules.
- Base values first, then semantic aliases referencing them (`--text-body: var(--fg-1)`).
- Cover the concern completely (a screen must never need a value this concern owns but doesn't declare).

### `styles.css`
- `@import` lines ONLY — tokens first, then component css, in the exact file set the task description enumerates. No rules of its own.

### `components/<name>.css` / `components/<name>.html`
- `.css`: the component's classes and states, built ONLY on token variables — a literal value that a token owns is a defect.
- `.html`: a specimen page rendering every meaningful state/variant of the component; links `../styles.css`.

### `screens/<name>.html`
- Links `../styles.css` (single stylesheet entry). Composes component classes; references `assets/` by relative path.
- A `<style>` block may hold ONLY screen-local layout (grid/placement unique to this screen). Restating a token value or duplicating a component rule is a defect.
- Realistic content per the PRD — no lorem-ipsum when the PRD names real concepts.

### `assets/<name>.svg`
- Self-contained vector (no external refs); colors via the palette values the tokens define.

---

## CONSTRAINTS

- Every value decision must be traceable to DESIGN.md/tokens or the PRD — do NOT invent values downstream of stage 1.
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
1. GENERATE (target file does not exist): emit it right after the single `<file>` block.
2. REVISE (target file exists): emit it in the turn AFTER the tool results confirm your `edit_file` changes landed — never in the same turn as a tool call.
3. ⚠️ Do NOT keep re-reading the file to verify — a successful `edit_file` result IS the confirmation.

**⚠️ Without `<done>true</done>` the task never completes; the system will keep asking you to continue.**
