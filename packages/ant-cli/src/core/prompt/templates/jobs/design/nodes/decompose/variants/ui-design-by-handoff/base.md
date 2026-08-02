# UI Handoff Bundle Task Decomposition

You are decomposing UI design work into file-authoring tasks for a **handoff bundle** — a structured design package under `visual/ui/handoff/`.

**Source mode**: Description-driven — the directive plus PRD / source documents drive the design; there is no external visual source.

**Job Mode**: {{detectedMode}}

---

## 📥 INPUT CONTEXT

### Requirements ({{documentName}})

{{> jobs/design/nodes/decompose/shared/input-context}}

---

{{#if (eq detectedMode "refactor")}}
{{> jobs/shared/injections/handoff-bundle-revision}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REVISE MODE — Modify the Existing Bundle In Place
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Principle**: Create the MINIMUM set of tasks that realizes the requested change — usually one task per affected file.

- The existing bundle files appear above as a **manifest** (path + size per entry), not as inline content. Call `read_file(path)` on the entries the request touches — using the FULL manifest path as shown — to observe their content before deciding which files change.
- **`targetFile` is a manifest path from above with the `visual/ui/handoff/` prefix stripped — bundle-relative** (e.g. manifest `visual/ui/handoff/project/tokens/palette.css` → targetFile `project/tokens/palette.css`). Do NOT re-derive a canonical bundle layout; do NOT invent parallel directories beside the existing structure. Observe where the bundle keeps each concern and edit it there.
- Create exactly one task per affected file; do NOT create tasks for files the request does not touch.
- ⚠️ Do NOT create guide / entry-stylesheet / token-file tasks unless the request changes those files' content.
- A task may introduce a file the bundle does not have ONLY when the request genuinely adds one: set `"newFile": true` on that task and place the file inside a directory the bundle already has (or at the bundle root). When a file is added, also emit (or extend) the task updating the bundle's ENTRY DOC (see above) to register it.
- When the change merges or removes files, the task that owns the SURVIVING file carries `"removeFiles": ["<bundle-relative path>", ...]` — manifest paths with the prefix stripped, exactly like `targetFile`. Do NOT emit delete-only tasks; do NOT list a removed path in `<targetFiles>`. When a removed path is referenced by the entry doc, also emit (or extend) the entry-doc task to drop the reference.
- A value change that lives in the bundle's token layer (whichever file the manifest shows owns it) is fixed there — never patched locally in a screen.
- When a change alters what a file IS (purpose, not content detail), also emit a task updating the bundle's ENTRY DOC.

{{else}}
{{> jobs/shared/injections/handoff-package-format}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE — Author a New Bundle
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Derive the file set from the PRD** using the directory family above — instantiate only what this product needs (the family is vocabulary, not a checklist).

- **Screens**: identify the distinct pages/views from the PRD's Information Architecture and Screen Composition sections — `SC-XXX` identifiers, when present, are the SSOT for the screen list. One task per screen file. Cap at 8 screen tasks — merge minor screens into their parent flow's file.
- **Components**: derive the shared class layer per CRITICAL RULE 5 (class-ownership closure) — one `.css` task at stage 2 plus its specimen `.html` task at stage 3.
- **Tokens**: split `tokens/` by concern only as far as the design warrants (a small product may need a single `tokens/tokens.css`).
- **Assets**: emit an `assets/` task only when the design needs shared vector assets that screens/components reference. Per-content normal-state imagery (a listing's screenshot, a record's photo) is NOT a shared asset — the consuming page authors it inline, or it becomes a dedicated per-content asset file when multiple pages show the same content.

### Available Resources

| Resource | Count |
|----------|-------|
| Asset files (`assets/`) | {{assetCount}} |

⚠️ **Blind spot**: real asset files already placed in the workspace are referenced by their existing path; missing imagery is authored INSIDE the bundle — never as a dangling path, never in a workspace directory outside the bundle root. Shared marks and state illustrations go to `assets/`; per-content normal-state imagery is authored by its consuming page. An empty-state illustration planned as "the" image asset will end up in every normal slot — plan imagery per state, not per "needs an image".
{{/if}}

---

{{> jobs/design/nodes/decompose/variants/ui-design-by-handoff/rules}}
