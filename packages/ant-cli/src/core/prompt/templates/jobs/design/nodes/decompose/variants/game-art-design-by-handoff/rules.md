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

Every task authors exactly ONE file. `targetFile` is the file's path RELATIVE to the bundle root (e.g. `DESIGN.md`, `tokens/palette.css`, `entities/enemies.html`, `screens/hud.html`). Never a bare directory, never multiple files.

Refactor mode: the path is not invented — it is one of the manifest paths from the input context, copied verbatim (or a `"newFile": true` addition inside a directory the bundle already has).

### 2. Task IDs

- Every task id starts with `game-art-handoff-` (e.g. `game-art-handoff-design-md`, `game-art-handoff-entities-enemies`).
- ❌ NEVER use ids starting with `ui-assets-` or `game-art-assets-` — those prefixes belong to a different pipeline.

### 3. Ordering by dependency stage (priority windows)

Tasks run in three sequential stages; within a stage they run in parallel. Assign `priority` by the file's dependency depth (in refactor mode, map each existing file to the stage its ROLE plays — authority/guide/token files are stage 1, shared layers stage 2, screen-level consumers stage 3):

| Stage | Files | Priority |
|---|---|---|
| 1 — authority | guide/manifest, token files, entry stylesheet | 100–149 |
| 2 — shared layers | shared component / entity / asset files | 200–249 |
| 3 — consumers | screen files | 300–349 |

Generate mode: `styles.css` is stage 1 — it is an import-only list, and the FULL file set is already decided in this decomposition — its task description must enumerate every css file to import (tokens first, then components/entities).

### 4. Guide task contract

- Generate mode: the `DESIGN.md` task's description covers the nine system sections AND the Artifacts manifest listing every file this decomposition emits (use the exact `targetFile` paths).
- Every later task's description references the design decision it realizes ("realize the palette from the guide's palette section", "entity silhouettes per the guide's theme section") — values flow from stage 1, they are not re-invented downstream.

### 5. Surface split

- `entities/` = engine-rendered (in-canvas) units; `components/` = web-rendered game UI (menus/HUD widgets). Do not mix the two vocabularies in one file.

### 6. Source File Assignment

{{#if sourceFileNames}}
Each task MUST include `sourceFiles` — an array of source filenames that the task needs to reference.
{{/if}}

---

## 🚫 FORBIDDEN TASKS

- ❌ "Final verification" / "review" tasks
- ❌ Deployment / operations / infrastructure tasks
- ❌ ant-canonical JSON files (`game-art-tokens.json` / `game-art-assets.json` / `game-art-spec.json`) — this pipeline authors the handoff bundle, not the JSON trio
- ❌ Multiple tasks appending to the same file

---

## 📤 OUTPUT FORMAT

Emit the meta tags first, then a `<tasks>` block with one `<task>{json}</task>` element per task. Each `<task>` body is a single JSON object. NO markdown fences anywhere. NO `<decompose>` wrapper.

Example (generate-mode file set shown — refactor mode uses the existing manifest paths verbatim):

```
<executionTier>4</executionTier>
<targetFiles>["DESIGN.md", "tokens/palette.css", "styles.css", "entities/player.html", "screens/hud.html"]</targetFiles>
<tasks>
  <task>{"id":"game-art-handoff-design-md","name":"Game-Art System Guide","targetFile":"DESIGN.md"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Nine system sections + Artifacts manifest listing every bundle file with purpose and reading order.","priority":100,"parallelGroup":"game-art-handoff-design-md"}</task>
  <task>{"id":"game-art-handoff-screen-hud","name":"Screen: In-Game HUD","targetFile":"screens/hud.html"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"Realize the HUD per DESIGN.md and PRD; link ../styles.css; compose shared components; screen-local layout only.","priority":300,"parallelGroup":"game-art-handoff-screen-hud"}</task>
</tasks>
```

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique, `game-art-handoff-*` |
| name | Descriptive |
| targetFile | Bundle-relative path; MUST be in `<targetFiles>` |
| description | The file's design scope + which guide/token decisions it realizes |
| priority | Stage window (100–149 / 200–249 / 300–349) |
| parallelGroup | Use the task id (every file has a single writer) |
| newFile | Refactor mode only, optional — `true` when the task adds a file the bundle does not have |

---

## ✅ VALIDATION CHECKLIST

- ✅ `<executionTier>` emitted FIRST
- ✅ Generate mode includes a `DESIGN.md` task at stage 1
- ✅ Refactor mode: every `targetFile` matches an existing bundle path verbatim (or carries `"newFile": true`)
- ✅ Every task id starts with `game-art-handoff-`
- ✅ Every `targetFile` is bundle-relative and unique across tasks
- ✅ Priorities respect the stage table
- ✅ `styles.css` task description enumerates every css file emitted by this decomposition

---

## 🎮 GAME-ART TIER DETECTION

After the main JSON output, output a `<gameArtTier>` tag with the detected game-art-tier axis values.

{{> jobs/shared/injections/game-art-tier-detection}}
