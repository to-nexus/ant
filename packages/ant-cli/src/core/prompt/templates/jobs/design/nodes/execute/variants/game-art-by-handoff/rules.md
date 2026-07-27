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
- The nine system sections in order, each carrying value + reasoning, grounded in the PRD's aesthetic sections and the game-art policy for this run (palette / silhouette / lighting / motion-tone + HUD tokens).
- In-canvas motion vocabulary (sprite movement feel, particle behavior, projectile arcs) is described here and demonstrated in `entities/` — never framed as web UI interaction rules.
- Final **Artifacts** section: a table of every bundle file (exact relative paths from the task plan) with one-line purpose and the reading order (DESIGN.md → tokens → components/entities/assets → screens).

### `tokens/<concern>.css`
- CSS custom properties under `:root` only. Base values first, then semantic aliases. Palette / silhouette-scale / lighting / motion-tone constants plus HUD tokens — the single value source for both entity demos and web-rendered UI.

### `styles.css`
- `@import` lines ONLY — tokens first, then component/entity css, in the exact file set the task description enumerates. No rules of its own.

### `components/<name>.css` / `components/<name>.html`
- Web-rendered game UI (menus, HUD widgets, dialogs, overlays). Classes built ONLY on token variables; specimen `.html` renders every meaningful state and links `../styles.css`.

### `entities/<name>.css` / `entities/<name>.html`
- Engine-rendered visual units (characters, enemies, props, particles, projectile looks) as specimen demos — vector/primitive fidelity (svg shapes, css-driven motion) that demonstrates silhouette, palette, and motion-tone.
- Production-quality sprites/audio are NOT authored here — when real asset files exist in the workspace, reference them by exact path; otherwise the demo itself is the reference.

### `screens/<name>.html`
- Title / menu / in-game HUD state / results compositions. Links `../styles.css`; composes component classes; screen-local layout only; realistic content per the PRD.

### `assets/<name>.svg`
- Self-contained vector; colors via the palette values the tokens define.

---

## CONSTRAINTS

- Every value decision must be traceable to DESIGN.md/tokens or the PRD — do NOT invent values downstream of stage 1.
- Every page opens directly in a browser: relative paths only, no external network dependencies, no build step, no engine runtime (demos approximate engine rendering with svg/css primitives).
- These files are design references, NOT production code — the game codebase realizes them with its own engine idioms.

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
