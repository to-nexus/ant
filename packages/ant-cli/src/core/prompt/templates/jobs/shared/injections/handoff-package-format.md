# HANDOFF PACKAGE FORMAT (produce ↔ consume SSOT)

A handoff bundle is a structured design package rooted at `DESIGN.md`. Producer tasks author it; consumer jobs read it. Both sides trust this shape — do not invent a parallel convention on either side.

## Directory family (three rings)

**Ring 1 — common core** (every generated bundle, both service and game):

| Path | Role |
|---|---|
| `DESIGN.md` | Root guide. The nine system sections (below) + a final **Artifacts** section: a manifest listing every file in the bundle with a one-line purpose and the intended reading order. There is no separate README — DESIGN.md IS the guide. |
| `styles.css` | Entry stylesheet — an import-only list (`@import` of every css file in the bundle, tokens first). Screens link ONLY this file. |
| `tokens/<concern>.css` | Design tokens as CSS custom properties under `:root`, split by concern (e.g. colors, typography, spacing). Declare base values AND semantic aliases. The single value source — no other file restates a token value. It also owns the token **identifiers**: the names every other file binds to. |
| `components/<name>.css` + `components/<name>.html` | Reusable primitives. The `.css` defines the component's classes built ONLY on token variables (no literal values a token owns) — those class names are the component's public API. The `.html` is a specimen page that **consumes** the `.css`: it composes the class names that file declares and contributes nothing to the shared layer. |
| `screens/<name>.html` | Full-screen prototypes composing the components. Only screen-local layout rules live here — never restated tokens, never duplicated component styles. |
| `assets/<name>.svg` | Shared vector assets (brand marks, icons, state illustrations), referenced by relative path. A needed asset no user-placed file provides is authored HERE, inside the bundle — never in a workspace directory outside the bundle root. |

**Ring 2 — domain-biased** (present when the domain needs it):

| Path | Role |
|---|---|
| `entities/<name>.css` + `entities/<name>.html` | Game only — engine-rendered visual units (sprites, props, particles, projectile looks) as specimen demos. Web-rendered game UI (menus / HUD / overlays) stays in `components/`. |

**Ring 3 — extension**: any additional directory is legitimate when the work requires it, PROVIDED it is registered in the DESIGN.md Artifacts manifest. An unregistered file is invisible to consumers.

## DESIGN.md system sections (in order)

1. Visual Theme & Atmosphere · 2. Color Palette & Roles · 3. Typography Rules · 4. Component Stylings · 5. Layout Principles · 6. Depth & Elevation · 7. Do's and Don'ts · 8. Responsive Behavior · 9. Agent Prompt Guide — then the **Artifacts** manifest section.

Each section carries the decision AND the reasoning (why the rule exists), so a consumer stays on-system when it hits a case the file never covered. Where a section quotes a value `tokens/` owns, `tokens/` is authoritative on conflict; DESIGN.md never introduces an identifier other files must match.

## Dependency direction (strict)

`DESIGN.md` + `tokens/` → `components/<name>.css` / `entities/<name>.css` / `assets/` → `screens/<name>.html` + `components/<name>.html` / `entities/<name>.html`.

Consumers of a shared layer REFERENCE it (css variable, class, relative path); they never restate a value the shared layer owns.

**Name ownership**: every css custom property and every class name is DECLARED in exactly one file. A file that references a name it does not declare is a consumer of the declaring file and runs after it.

**Ownership closure**: a name referenced by two or more files has an owning file in the shared layer. A name referenced by exactly ONE file is that file's own scaffolding and stays local to it.

## Reading order (consumers)

`DESIGN.md` first — its Artifacts manifest is the authoritative index. Then tokens, then the shared layers the current task needs, then individual screens on demand.

## Imagery state semantic

**An asset carries ONE state semantic.** Before filling a media slot, observe which state the surrounding markup expresses — the imagery must depict THAT state.

- An empty/unavailable-state illustration appears ONLY where the design shows that state. Placing it in a normal-state slot is a defect, not a shortcut.
- A normal-state media slot renders imagery depicting its content: an inline `<svg>` mock in the consuming page (single-referencer scaffolding under Ownership closure), or a dedicated `assets/<name>.svg` when two or more pages show the same content.
- ⚠️ One empty-state asset tends to become the default for every slot that needs an image — each additional consumer feels cheaper than authoring a content mock. Resist it: the cost asymmetry is the trap, not a license.

## Medium constraints

- Every page opens directly in a browser: plain HTML + CSS + SVG, relative paths only, no external network dependencies, no build step.
- These files are design references, NOT production code. Implementation follows the consuming codebase's own conventions — the bundle dictates visual decisions, not technology choices.
