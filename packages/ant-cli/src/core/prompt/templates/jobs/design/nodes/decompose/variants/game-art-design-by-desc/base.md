# Game-Art Design Task Decomposition (Directive only)

You are decomposing **game-art documentation work** into executable tasks.

**Surface scope (D17/D18)**: This intent produces `game-art-tokens.json` /
`game-art-assets.json` / `game-art-spec.json` only. UI surface decisions
are NOT in scope here.

**Source mode**: Directive only — no reference images, no Figma,
no external sprite assets are required as input. The GDD / source
documents (if present) plus the user directive drive the breakdown.

**SSOT precedence**: When a GDD is available in source documents, it is
the **single source of truth** for the breakdown:

- **GDD §8 Content Scope** (`EN-XXX`, `LV-XXX`) — the entity / level
  catalog that drives `game-art-assets` category structure
- **GDD §4 MDA Aesthetic** + **§6 Reward & Feedback** (`RW-XXX`) — the
  vocabulary that drives `game-art-tokens` (palette / silhouette /
  lighting / motion-tone)
- **GDD §4 MDA Mechanics** (`MC-XXX`) + **§6** (`RW-XXX`) — the verb /
  feedback list that drives `game-art-spec` category structure
- **GDD §9 Input & Perspective** — the orientation / viewport policy
  that the visual treatment must respect

The directive **supplements** the GDD; it does NOT override it. When
the GDD is genuinely absent, fall back to directive-only extraction
and flag the gap in the task description.

**Job Mode**: {{detectedMode}}

{{#if (eq detectedMode "refactor")}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REFACTOR MODE - Modify Existing Game-Art Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Principle**: Create ONE focused task for the specific modification requested.

### Constraints

- ❌ Multiple category-based tasks
- ❌ Full document regeneration
- ✅ Single task targeting specific category or token group
- ✅ Task ID format: `refactor-{document}-{category}`
- ✅ Task name format: `Refactor: {brief description}`

{{else}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE - Create New Game-Art Documents (Directive)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are creating NEW game-art design documents from a directive only.**

**Philosophy**: One token document; multiple parallel category tasks for
assets and spec. Without external references, **prefer `kind: 'inline'`
for asset entries** — the LLM authors simple-shape primitives that match
the directive's described concept (D21). External sprites are only valid
if the user has explicitly placed files under `inputs/assets/game/...`
(see "Available Resources" below).
{{/if}}

---

## 📥 INPUT CONTEXT

### Requirements ({{documentName}})

{{> jobs/design/nodes/decompose/shared/input-context}}

---

{{#unless (eq detectedMode "refactor")}}
## 🎯 SELECTIVE DOCUMENT GENERATION

**Check the Directive above for explicit document requests.**

| If directive mentions...                                    | Generate ONLY...        |
|-------------------------------------------------------------|-------------------------|
| "only game-art-spec" / "regenerate game-art-spec"           | game-art-spec.json tasks  |
| "only game-art-tokens" / "regenerate game-art-tokens"       | game-art-tokens.json tasks|
| "only game-art-assets" / "regenerate game-art-assets"       | game-art-assets.json tasks|
| No specific document request                                | ALL 3 documents         |

### Available Resources

| Resource | Count |
|----------|-------|
| External assets (`inputs/assets/game/`) | {{assetCount}} |

⚠️ **Blind spot**: When `assetCount` is `0`, every asset entry MUST be
`kind: 'inline'` — there is nothing to point `external` `src` paths to.

---

## 📊 CATEGORY-BASED TASK BREAKDOWN

**Game-art docs use categories, not chapters.** Choose categories that
match the game concept observed in the directive.

**Token Safety**: Each task output ≤ 600 lines (~7,200 tokens, with margin
under the 8K cap).

---

### game-art-tokens.json (single task)

| Task ID | Priority | Topic |
|---------|----------|-------|
| `game-art-tokens` | 100 | Palette, silhouette, lighting, motion-tone tokens — derived from **GDD §4 MDA Aesthetic** and **GDD §6 Reward & Feedback** when GDD is present; fall back to `gameArtTier.concept` only when GDD is absent. Description MUST cite `GDD §4 / §6` and the aesthetic vocabulary words it picks up (e.g., `Implements GDD §4 Aesthetic (palette: warm-low-saturation, silhouette: chunky, motion-tone: heavy)`). |

---

### game-art-assets.json (category-parallel tasks)

**Category derivation**:

- **When GDD §8 Content Scope is present**: one task per `EN-XXX` (or
  `LV-XXX`) cluster. Category task ID prefers GDD entity ID alignment
  (e.g., `game-art-assets-entities-hero` for `EN-Hero`,
  `game-art-assets-stages-forest` for `LV-Forest`). Group small entities
  into categories when natural (e.g., `EN-Coin` + `EN-Gem` + `EN-Star` →
  `game-art-assets-collectibles`). Each task description MUST cite the
  `EN-` / `LV-` IDs it covers (e.g., `Implements GDD §8 (EN-Hero,
  EN-Hero-Wounded)`).
- **When GDD is absent**: fall back to extracting categories from the
  directive only, and flag the gap (`GDD absent — categories extracted
  from directive`) in each task description.

| Task ID format | Priority | Topic |
|----------------|----------|-------|
| `game-art-assets-{category}` | 200..249 | Asset entries scoped to one category. Without references, prefer `kind: 'inline'` with css-only primitives (D21). |

**Directive-only inline-first policy (D21)**:

- Without reference images, the LLM cannot author production-grade
  sprites — `inline` entries with simple SVG / CSS / oscillator are the
  default
- A single `kind: 'external'` entry is allowed only if the directive
  references a specific user-placed file (e.g. "use the hero.svg I put
  in inputs/assets/game/entities/")
- **GDD asset citation override**: When GDD §8 cites a concept art /
  reference path for a specific `EN-XXX` (e.g.,
  `EN-Hero — concept: inputs/assets/game/concept/hero.png`), the asset
  task for that entity uses the cited path as `kind: 'external'`
  `src` for that entity **only**. Other entities in the same category
  without a citation keep the inline-first default.

---

### game-art-spec.json (category-parallel tasks)

**Category derivation**:

- **When GDD is present**: one task per `MC-XXX` from §4 MDA Mechanics
  or `RW-XXX` from §6 Reward & Feedback. Spec task description MUST
  cite the GDD ID (e.g., `Implements GDD §4 / MC-Combat →
  game-art-spec-mechanics-combat`, `Implements GDD §6 / RW-Score →
  game-art-spec-feedback-score`). Group closely-related mechanics
  (e.g., `MC-MoveLeft` + `MC-MoveRight` → `game-art-spec-movement`)
  when natural.
- **When GDD is absent**: derive spec categories from the directive's
  described behavior, and flag the gap (`GDD absent — spec categories
  extracted from directive`) in each task description.

| Task ID format | Priority | Topic |
|----------------|----------|-------|
| `game-art-spec-{category}` | 300..349 | Spec entries for one category, referencing asset ids defined above. |

---

## 📏 CATEGORY COUNT GUIDELINES

| Directive scope                          | game-art-tokens | game-art-assets | game-art-spec |
|------------------------------------------|-----------------|-----------------|---------------|
| Single mechanic prototype                | 1 task | 2 categories | 1-2 categories |
| Multi-mechanic minimum game              | 1 task | 3-4 categories | 3 categories |
| Full directive describing many entities  | 1 task | 4-5 categories | 4-5 categories |

**Your resources**: Directive only + external assets={{assetCount}}

**Principle**: Without references, keep categories small and focused.
Better to ship a tight 2-category prototype than a 6-category mega
catalog of inline approximations.

{{/unless}}

---

{{! Execute-phase injection guides: static partial refs for manifest/matrix audits; branch never renders. }}
{{#if false}}
{{> jobs/design/nodes/execute/injections/game-art-tokens-guide-by-desc}}
{{> jobs/design/nodes/execute/injections/game-art-assets-guide-by-desc}}
{{> jobs/design/nodes/execute/injections/game-art-spec-guide-by-desc}}
{{/if}}

{{> jobs/design/nodes/decompose/variants/game-art-design-by-desc/rules}}
