# HANDOFF PACKAGE FORMAT (produce ↔ consume SSOT)

A handoff bundle is a structured design package rooted at `DESIGN.md`. Producer tasks author it; consumer jobs read it. Both sides trust this shape — do not invent a parallel convention on either side.

## Directory family (three rings)

**Ring 1 — common core** (every generated bundle, both service and game):

| Path | Role |
|---|---|
| `DESIGN.md` | Root guide. The nine system sections (below) + a final **Artifacts** section: a manifest listing every file in the bundle with a one-line purpose and the intended reading order. There is no separate README — DESIGN.md IS the guide. |
| `styles.css` | Entry stylesheet — an import-only list (`@import` of every css file in the bundle, tokens first). Screens link ONLY this file. |
| `tokens/<concern>.css` | Design tokens as CSS custom properties under `:root`, split by concern (e.g. colors, typography, spacing). Declare base values AND semantic aliases. The single value source — no other file restates a token value. |
| `components/<name>.css` + `components/<name>.html` | Reusable primitives. The `.css` defines the component's classes built ONLY on token variables (no literal values a token owns); the `.html` is a specimen page rendering the component's states. |
| `screens/<name>.html` | Full-screen prototypes composing the components. Only screen-local layout rules live here — never restated tokens, never duplicated component styles. |
| `assets/<name>.svg` | Shared vector assets, referenced by relative path. |

**Ring 2 — domain-biased** (present when the domain needs it):

| Path | Role |
|---|---|
| `entities/<name>.css` + `entities/<name>.html` | Game only — engine-rendered visual units (sprites, props, particles, projectile looks) as specimen demos. Web-rendered game UI (menus / HUD / overlays) stays in `components/`. |

**Ring 3 — extension**: any additional directory is legitimate when the work requires it, PROVIDED it is registered in the DESIGN.md Artifacts manifest. An unregistered file is invisible to consumers.

## DESIGN.md system sections (in order)

1. Visual Theme & Atmosphere · 2. Color Palette & Roles · 3. Typography Rules · 4. Component Stylings · 5. Layout Principles · 6. Depth & Elevation · 7. Do's and Don'ts · 8. Responsive Behavior · 9. Agent Prompt Guide — then the **Artifacts** manifest section.

Each section carries the value AND the reasoning (why the rule exists), so a consumer stays on-system when it hits a case the file never covered.

## Dependency direction (strict)

`DESIGN.md` + `tokens/` → `components/` / `entities/` / `assets/` → `screens/`.

Consumers of a shared layer REFERENCE it (css variable, class, relative path); they never restate a value the shared layer owns.

## Reading order (consumers)

`DESIGN.md` first — its Artifacts manifest is the authoritative index. Then tokens, then the shared layers the current task needs, then individual screens on demand.

## Medium constraints

- Every page opens directly in a browser: plain HTML + CSS + SVG, relative paths only, no external network dependencies, no build step.
- These files are design references, NOT production code. Implementation follows the consuming codebase's own conventions — the bundle dictates visual decisions, not technology choices.
