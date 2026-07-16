## ExecutionTier Classification

**Authoring target**: The breadth of handoff-bundle work implied by the directive, the mode, and the source documents supplied in this prompt.

| Tier | Label | Principle |
|---|---|---|
| `0` | Reflex        | Read-only explanation; no bundle file produced. |
| `1` | OneShot       | Single concrete edit to one existing bundle file. |
| `2` | Exploratory   | Must consult sources before choosing what to change; still a single cohesive edit. |
| `3` | Task          | Multiple bundle files driven by the directive alone. |
| `4` | RefsGrounded  | A full bundle systematically grounded in PRD / source documents supplied in this prompt. |

**Constraint**: Emit exactly one `<executionTier>N</executionTier>` tag BEFORE the JSON output. `N` is a single digit `0`–`4`.

---

## 📋 CRITICAL RULES

### 1. One task = one file

Every task authors exactly ONE file. `targetFile` is the file's path RELATIVE to the bundle root (e.g. `DESIGN.md`, `tokens/colors.css`, `components/button.css`, `screens/home.html`). Never a bare directory, never multiple files.

### 2. Task IDs

- Every task id starts with `ui-handoff-` (e.g. `ui-handoff-design-md`, `ui-handoff-tokens-colors`, `ui-handoff-screen-home`).
- ❌ NEVER use ids starting with `ui-assets-` or `game-art-assets-` — those prefixes belong to a different pipeline.

### 3. Ordering by dependency stage (priority windows)

Tasks run in three sequential stages; within a stage they run in parallel. Assign `priority` by the file's dependency depth:

| Stage | Files | Priority |
|---|---|---|
| 1 — authority | `DESIGN.md`, `tokens/*.css`, `styles.css` | 100–149 |
| 2 — shared layers | `components/*`, `assets/*` | 200–249 |
| 3 — consumers | `screens/*.html` | 300–349 |

`styles.css` is stage 1: it is an import-only list, and the FULL file set is already decided in this decomposition — its task description must enumerate every css file to import (tokens first, then components).

### 4. DESIGN.md task contract

- Its description covers the nine system sections AND the Artifacts manifest listing every file this decomposition emits (use the exact `targetFile` paths).
- Every later task's description references the design decision it realizes ("realize the palette from DESIGN.md §2", "compose components per DESIGN.md §4") — values flow from stage 1, they are not re-invented downstream.

### 5. Component/screen split

- 2+ screens use it → own `components/<name>` task (stage 2).
- Exactly one screen uses it → author it inside that screen's task (stage 3).

### 6. Source File Assignment

{{#if sourceFileNames}}
Each task MUST include `sourceFiles` — an array of source filenames that the task needs to reference.
{{/if}}

---

## 🚫 FORBIDDEN TASKS

- ❌ "Final verification" / "review" tasks
- ❌ Deployment / operations / infrastructure tasks
- ❌ ant-canonical JSON files (`ui-tokens.json` / `ui-assets.json` / `ui-spec.json`) — this pipeline authors the handoff bundle, not the JSON trio
- ❌ Multiple tasks appending to the same file

---

## 📤 OUTPUT FORMAT

Emit the meta tags first, then a `<tasks>` block with one `<task>{json}</task>` element per task. Each `<task>` body is a single JSON object. NO markdown fences anywhere. NO `<decompose>` wrapper.

Example:

```
<executionTier>4</executionTier>
<targetFiles>["DESIGN.md", "tokens/colors.css", "styles.css", "components/button.css", "screens/home.html"]</targetFiles>
<tasks>
  <task>{"id":"ui-handoff-design-md","name":"Design System Guide","targetFile":"DESIGN.md"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Nine system sections + Artifacts manifest listing every bundle file with purpose and reading order.","priority":100,"parallelGroup":"ui-handoff-design-md"}</task>
  <task>{"id":"ui-handoff-screen-home","name":"Screen: Home","targetFile":"screens/home.html"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Realize the home screen per DESIGN.md and PRD; link ../styles.css; compose shared components; screen-local layout only.","priority":300,"parallelGroup":"ui-handoff-screen-home"}</task>
</tasks>
```

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique, `ui-handoff-*` |
| name | Descriptive |
| targetFile | Bundle-relative path; MUST be in `<targetFiles>` |
| description | The file's design scope + which DESIGN.md/token decisions it realizes |
| priority | Stage window (100–149 / 200–249 / 300–349) |
| parallelGroup | Use the task id (every file has a single writer) |

---

## ✅ VALIDATION CHECKLIST

- ✅ `<executionTier>` emitted FIRST
- ✅ Generate mode includes a `DESIGN.md` task at stage 1
- ✅ Every task id starts with `ui-handoff-`
- ✅ Every `targetFile` is bundle-relative and unique across tasks
- ✅ Priorities respect the stage table (tokens/guide < components/assets < screens)
- ✅ `styles.css` task description enumerates every css file emitted by this decomposition

---

## 🎨 VISUAL DESIGN POLICY DETECTION

After the main JSON output, output a `<visualTier>` tag with auto-detected visual design policy.

{{> jobs/shared/injections/visual-tier-detection}}
