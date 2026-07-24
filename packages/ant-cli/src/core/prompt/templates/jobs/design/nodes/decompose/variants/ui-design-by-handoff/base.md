# UI Handoff Bundle Task Decomposition

You are decomposing UI design work into file-authoring tasks for a **handoff bundle** — a structured design package under `visual/ui/handoff/`.

**Source mode**: Description-driven — the directive plus PRD / source documents drive the design; there is no external visual source.

**Job Mode**: {{detectedMode}}

{{> jobs/shared/injections/handoff-package-format}}

---

## 📥 INPUT CONTEXT

### Requirements ({{documentName}})

{{> jobs/design/nodes/decompose/shared/input-context}}

---

{{#if (eq detectedMode "refactor")}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REVISE MODE — Modify the Existing Bundle In Place
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Principle**: The bundle on disk is the authority. Create the MINIMUM set of tasks that realizes the requested change — usually one task per affected file.

- The existing bundle files appear above as a **manifest** (path + size per entry), not as inline content. Call `read_file(path)` on the entries the request touches to observe their content before deciding which files change.
- Create exactly one task per affected file; do NOT create tasks for files the request does not touch.
- A value change that lives in `tokens/` is fixed in `tokens/` — never patched locally in a screen.
- When a change alters what a file IS (purpose, not content detail), also emit a task updating the DESIGN.md Artifacts manifest.

{{else}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE — Author a New Bundle
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Derive the file set from the PRD** using the directory family above — instantiate only what this product needs (the family is vocabulary, not a checklist).

- **Screens**: identify the distinct pages/views from the PRD's Information Architecture and Screen Composition sections — `SC-XXX` identifiers, when present, are the SSOT for the screen list. One task per screen file. Cap at 8 screen tasks — merge minor screens into their parent flow's file.
- **Components**: components used by 2+ screens get their own `components/<name>` task; a component used by exactly one screen is authored inside that screen's task.
- **Tokens**: split `tokens/` by concern only as far as the design warrants (a small product may need a single `tokens/tokens.css`).
- **Assets**: emit an `assets/` task only when the design needs shared vector assets that screens/components reference.

### Available Resources

| Resource | Count |
|----------|-------|
| Asset files (`assets/`) | {{assetCount}} |

⚠️ **Blind spot**: real asset files already placed in the workspace are referenced by their existing path; missing imagery is authored as svg INSIDE the bundle's `assets/` — never as a dangling path.
{{/if}}

---

{{> jobs/design/nodes/decompose/variants/ui-design-by-handoff/rules}}
