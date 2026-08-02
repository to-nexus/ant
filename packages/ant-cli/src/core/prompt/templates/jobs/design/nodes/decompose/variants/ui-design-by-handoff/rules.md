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

Refactor mode: the path is not invented — it is one of the manifest paths from the input context with the `visual/ui/handoff/` prefix stripped (bundle-relative), or a `"newFile": true` addition inside a directory the bundle already has. `read_file`, by contrast, takes the full manifest path as shown.

### 2. Task IDs

- Every task id starts with `ui-handoff-` (e.g. `ui-handoff-design-md`, `ui-handoff-tokens-colors`, `ui-handoff-screen-home`).
- ❌ NEVER use ids starting with `ui-assets-` or `game-art-assets-` — those prefixes belong to a different pipeline.

### 3. Ordering by dependency stage (priority windows)

Tasks run in three sequential stages; within a stage they run in parallel. Assign `priority` by the file's dependency depth (in refactor mode, map each existing file to the stage its ROLE plays — authority/guide/token files are stage 1, shared css/asset layers stage 2, page-level consumers (screens AND specimen/demo pages) stage 3):

| Stage | Files | Priority |
|---|---|---|
| 1 — authority | guide/manifest, token files, entry stylesheet | 100–149 |
| 2 — shared layers | shared component css / asset files | 200–249 |
| 3 — consumers | screen files, component specimen pages | 300–349 |

A specimen page composes the class names its `components/<name>.css` declares, so it is a CONSUMER of that file, not its peer — it never shares a stage with it. Two tasks in the same stage run at the same instant and cannot read each other's output.

Generate mode: `styles.css` is stage 1 — it is an import-only list, and the FULL file set is already decided in this decomposition — its task description must enumerate every css file to import (tokens first, then components).

### 4. Upstream reference contract

- Generate mode: the `DESIGN.md` task's description covers the nine system sections AND the Artifacts manifest listing every file this decomposition emits (use the exact `targetFile` paths).
- Every later task's description references the design decision it realizes ("realize the palette from the guide's palette section", "compose components per the guide's component section") — values flow from stage 1, they are not re-invented downstream.
- Every stage-2/3 task description names the exact bundle-relative files it must read before authoring: its token concern files; for a screen, the component css it composes; for a specimen, its own `components/<name>.css`. A consumer that is not told what to read invents names.

### 5. Class-ownership closure

Every class name more than one bundle file will compose has exactly one owning stage-2 css task. Coverage is settled HERE: `styles.css` is authored at stage 1 from this decomposition's file list, so a css file absent from this plan can never be added later.

- A named product widget → its own `components/<name>` pair: `.css` at stage 2, specimen `.html` at stage 3.
- Element-level roles no single widget owns (text and heading roles, buttons, links, form controls, page/layout shells, loading placeholders) → ONE dedicated stage-2 css task.
- A class exactly one file composes → no task; that file declares it locally.

⚠️ **Blind spot**: reading "component" as "product domain widget" leaves the entire element-level layer ownerless — the widgets bind and the pages around them do not.

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

Example (generate-mode file set shown — refactor mode uses the existing manifest paths, bundle-relative):

```
<executionTier>4</executionTier>
<targetFiles>["DESIGN.md", "tokens/colors.css", "styles.css", "components/button.css", "screens/home.html"]</targetFiles>
<tasks>
  <task>{"id":"ui-handoff-design-md","name":"Design System Guide","targetFile":"DESIGN.md"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Nine system sections + Artifacts manifest listing every bundle file with purpose and reading order.","priority":100,"parallelGroup":"ui-handoff-design-md"}</task>
  <task>{"id":"ui-handoff-component-primitives-css","name":"Primitives: element-level roles","targetFile":"components/primitives.css"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Own the element-level classes every page composes (text/heading roles, buttons, links, page shell, loading placeholders); read tokens/<concern>.css first and build only on its variables.","priority":200,"parallelGroup":"ui-handoff-component-primitives-css"}</task>
  <task>{"id":"ui-handoff-component-button-html","name":"Specimen: Button","targetFile":"components/button.html"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Specimen page for every button state; read components/button.css first and compose only the classes it declares; demo-page scaffolding stays in a local <style>.","priority":300,"parallelGroup":"ui-handoff-component-button-html"}</task>
  <task>{"id":"ui-handoff-screen-home","name":"Screen: Home","targetFile":"screens/home.html"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Realize the home screen per DESIGN.md and PRD; link ../styles.css; read the component css it composes; screen-local layout only.","priority":300,"parallelGroup":"ui-handoff-screen-home"}</task>
</tasks>
```

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique, `ui-handoff-*` |
| name | Descriptive |
| targetFile | Bundle-relative path; MUST be in `<targetFiles>` |
| description | The file's design scope + which guide/token decisions it realizes |
| priority | Stage window (100–149 / 200–249 / 300–349) |
| parallelGroup | Use the task id (every file has a single writer) |
| newFile | Refactor mode only, optional — `true` when the task adds a file the bundle does not have |
| removeFiles | Refactor mode only, optional — bundle-relative paths this task deletes after merging their surviving content into `targetFile`; each must be an existing manifest path and never the task's own `targetFile` |

---

## ✅ VALIDATION CHECKLIST

- ✅ `<executionTier>` emitted FIRST
- ✅ Generate mode includes a `DESIGN.md` task at stage 1
- ✅ Refactor mode: every `targetFile` matches an existing bundle path (bundle-relative, prefix stripped) or carries `"newFile": true`
- ✅ Refactor mode: every `removeFiles` entry is an existing bundle path and is NOT the task's own `targetFile`; the bundle keeps exactly one entry doc after the revision
- ✅ Every task id starts with `ui-handoff-`
- ✅ Every `targetFile` is bundle-relative and unique across tasks
- ✅ Priorities respect the stage table (tokens/guide < component css/assets < screens and specimens)
- ✅ Every `components/*.html` specimen task sits at stage 3, after its `components/*.css`
- ✅ Every class name any file will compose has one owning stage-2 css task (element-level roles included)
- ✅ `styles.css` task description enumerates every css file emitted by this decomposition

---

## 🎨 VISUAL DESIGN POLICY DETECTION

After the main JSON output, output a `<visualTier>` tag with auto-detected visual design policy.

{{> jobs/shared/injections/visual-tier-detection}}
