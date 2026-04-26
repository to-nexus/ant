# Game-Art Design Task Decomposition (Directive only)

You are decomposing **game-art documentation work** into executable tasks.

**Surface scope (D17/D18)**: This intent produces `game-art-tokens.json` /
`game-art-assets.json` / `game-art-spec.json` only. UI surface decisions
are NOT in scope here.

**Source mode**: Directive only — no reference images, no Figma,
no external sprite assets are required as input. The PRD / source
documents (if present) plus the user directive drive the breakdown.

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

{{#if directiveContext}}
### Directive

{{{directiveContext}}}
{{/if}}

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
| `game-art-tokens` | 100 | Palette, silhouette, lighting, motion-tone tokens — derived from `gameArtTier.concept`. |

---

### game-art-assets.json (category-parallel tasks)

**One task per asset category present in the game concept.**

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

---

### game-art-spec.json (category-parallel tasks)

**One task per spec category** — derived from the directive's described
behavior.

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
