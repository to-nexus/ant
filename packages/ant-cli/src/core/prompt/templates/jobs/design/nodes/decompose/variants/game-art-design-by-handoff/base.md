# Game-Art Handoff Bundle Task Decomposition

You are decomposing game-art design work into file-authoring tasks for a **handoff bundle** — a structured design package under `visual/game-art/handoff/`.

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

- Observe the existing bundle files (they are provided as documents) before deciding which files change.
- A value change that lives in `tokens/` is fixed in `tokens/` — never patched locally in a screen or entity demo.
- When a change alters what a file IS (purpose, not content detail), also emit a task updating the DESIGN.md Artifacts manifest.

{{else}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE — Author a New Bundle
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Derive the file set from the PRD** (aesthetic, entities, scenes, HUD) using the directory family above — instantiate only what this game needs.

- **Entities** (`entities/`): engine-rendered visual units — playable characters, enemies, props, particles, projectile looks — as specimen demos grouped by family (one file per coherent group). Derived from the PRD's entity/mechanic sections.
- **Components** (`components/`): web-rendered game UI — menus, HUD widgets, dialogs, overlays. Shared across 2+ screens → own task; single-screen → inside that screen's task.
- **Screens** (`screens/`): title / menu / in-game HUD state / results — one task per screen file. Cap at 8; merge minor states.
- **Tokens**: palette / silhouette / lighting / motion-tone + HUD tokens as CSS custom properties, split by concern only as far as the design warrants.
- In-canvas motion vocabulary (sprite movement feel, particle behavior, projectile arcs) belongs to entity demos and DESIGN.md — NOT to web UI interaction rules.

### Available Resources

| Resource | Count |
|----------|-------|
| Asset files (`assets/`) | {{assetCount}} |

⚠️ **Blind spot**: real asset files already placed in the workspace are referenced by their existing path; missing imagery is authored as svg INSIDE the bundle's `assets/` — never as a dangling path. Production-quality sprites/audio remain user placement — bundle demos stay at vector/primitive fidelity.
{{/if}}

---

{{> jobs/design/nodes/decompose/variants/game-art-design-by-handoff/rules}}
