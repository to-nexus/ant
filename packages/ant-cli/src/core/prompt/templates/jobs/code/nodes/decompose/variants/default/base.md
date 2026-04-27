You are analyzing a software specification to break it into executable tasks.

DIRECTIVE:
{{{directive}}}

{{#if tierRefs.length}}

════════════════════════════════════════════════════════════════════════════════
## Available Reference Documents (Development Source)

The following reference documents are attached to this turn as
`role='ref'` design artifacts (chosen by the intent matrix in
`@ant/shared/action-config-matrix.ts`). They are the **Development
Source** that grounds this turn's work — every enumerated unit inside
these documents (numbered tasks, sections, requirements, acceptance
criteria) MUST be reflected as a distinct task in `<tasks>`.

For `generate` / `refactor` modes the executionTier is structurally
fixed: emit `<executionTier>4</executionTier>`. Lower tiers collapse
the document's enumerated work and are rejected by the runtime
validator.

{{#each tierRefs}}
- {{this.label}} ({{this.path}})
{{/each}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}
{{#if hasGenericArtifacts}}

════════════════════════════════════════════════════════════════════════════════
## Provided Documents

{{> jobs/shared/injections/role-guide}}

{{#if refArtifacts.length}}
{{#each refArtifacts}}
### [ref] {{this.path}}

{{{this.content}}}

{{#unless @last}}────────────────────────────────────────{{/unless}}
{{/each}}
{{/if}}
{{#if contextArtifacts.length}}
{{#each contextArtifacts}}
### [context] {{this.path}}

{{{this.content}}}

{{#unless @last}}────────────────────────────────────────{{/unless}}
{{/each}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}
{{#if assetsHint}}
{{{assetsHint}}}
{{/if}}

{{#if uiArtifactPaths.length}}
## UI Document Sections (available for `uiSections` task assignment)

Use these IDs when populating `uiSections` on `"ui"` and `"design-system"` tasks.

{{#each uiArtifactPaths}}
- `{{this.id}}` ({{this.role}})
{{/each}}

{{/if}}
{{> jobs/code/nodes/decompose/variants/default/scope-rules}}

{{> jobs/code/nodes/decompose/variants/default/mode-guide}}

{{> jobs/code/nodes/decompose/variants/default/error-or-general}}

{{> jobs/code/nodes/decompose/variants/default/existing-code-check}}

{{> jobs/code/nodes/decompose/variants/default/design-doc-guide}}

YOUR TASK:

**Step 1: Determine TechTier**

{{#if techTier}}
The following technology tier has been **pre-determined** by the user.
Use these values as-is. Do NOT override pre-determined fields.
Only fill in fields that are not specified (null/missing).

Pre-determined:
{{#if techTier.language}}- language: {{techTier.language}}{{/if}}
{{#if techTier.framework}}- framework: {{techTier.framework}}{{/if}}
{{#if techTier.stack}}- stack: {{techTier.stack}}{{/if}}

Output the final `<techTier>` with pre-determined fields preserved
and any missing fields inferred from context.
{{else}}
Before breaking tasks, you MUST determine the technology tier from the available context.

Observe the following in order:
1. **Design Document Availability** (above) — document name prefixes indicate tier scope
2. **Design Document Content** (in specification) — technology stack is stated in the documents
3. **Directive and PRD** — only when design documents are absent
{{/if}}

Explicit values from `resolvedAction.basis.techTier` are authoritative — preserve them as-is in your `<techTier>` output and in any per-package `packageTiers` entries that target the same stack. Infer only the slots that are not pinned by the explicit basis.

Output the tech tier in `<techTier>` tags before `<tasks>`:

<techTier>
{
  "stack": "frontend" | "backend" | "fullstack" | "unknown",
  "stackReasoning": "Why this stack? (1 sentence)",
  "language": "typescript" | "javascript" | "python" | "go" | "rust" | "java",
  "framework": "react" | "vue" | "nextjs" | "express" | "fastapi" | "gin" | ... (or null){{#if gameEngineCandidates}},
  "gameEngine": {{{gameEngineCandidates}}}{{/if}},
  "packageTiers": {
    "fe-main": { "language": "typescript", "framework": "nextjs", "stack": "frontend" },
    "be-api": { "language": "go", "framework": "gin", "stack": "backend" }
  }
}
</techTier>

- `packageTiers` is REQUIRED when `stack` is `"fullstack"` and packages use different languages/frameworks.
- `packageTiers` is OPTIONAL otherwise (omit when all packages share the same stack).
- Each key is a package tag (e.g. `fe-main`, `be-auth`, `be-order`).
{{#if gameEngineCandidates}}
- `gameEngine` is the game-domain 5th slot. Pick exactly one of the candidates above. The engine layers on top of the framework — `react+phaser` is the canonical Phase 2 combination (React hosts the page, Phaser owns the canvas).
{{/if}}

{{> jobs/code/nodes/decompose/variants/default/techTier-rules}}

{{#if visualTierActive}}
A `"design-system"` task at priority 200 is REQUIRED to implement the visual policy as token infrastructure. The visual tier layers are resolved via the `<visualTier>` tag (see visual-tier-detection section) — explicit values from `resolvedAction.basis.visualTier` are authoritative, missing layers are inferred from the work content.
{{/if}}

{{#if gameArtTierActive}}
**Step 1.5: Determine GameArtTier (game-domain art policy — 7 axes, Phase 4 emit complete)**

GameArtTier ships 7 axes. Each axis has a registry-backed candidate set; the LLM emits a comma-separated `axis=value` list:

- `concept` — overall art tone / silhouette palette. Candidates: {{{gameArtConceptCandidates}}}.
- `perspective` — camera / depth model. Candidates: `2d` (3D deferred to Phase 5+).
- `entityCatalog` — character / object catalog policy. Candidates: `minimal`, `standard`, `rich`.
- `motionPattern` — sprite tween / animation policy. Candidates: `static`, `subtle`, `expressive`.
- `particleProfile` — particle density on feedback events. Candidates: `none`, `light`, `heavy`.
- `projectilePolicy` — projectile mechanics policy. Candidates: `none`, `simple`, `complex` (css-only scope recommends `none` / `simple`).
- `audioProfile` — audio source policy. Candidates: `procedural`, `fileBased`, `hybrid`.

Explicit values from `resolvedAction.basis.gameArtTier` are authoritative — preserve them as-is. Infer missing axes from the directive and any provided refs (e.g. "match-3 puzzle, soft pastel tone" → `concept=softPastel,perspective=2d,entityCatalog=minimal,motionPattern=subtle,particleProfile=light,projectilePolicy=none,audioProfile=procedural`).

Output the game-art tier in `<gameArtTier>` tags after `<techTier>` (before `<tasks>`):

<gameArtTier>concept=flatMinimal,perspective=2d,entityCatalog=minimal,motionPattern=subtle,particleProfile=light,projectilePolicy=none,audioProfile=procedural</gameArtTier>

- The body is a comma-separated `axis=value` list — emit all 7 axes.
- Unknown axes are silently dropped; unknown values for known axes are dropped at parse time and the slot falls back to the default-on-retry value.
{{/if}}

{{#if gameContentTierActive}}
**Step 1.6: Determine GameContentTier (game-domain content policy)**

Two axes:
- `genre` — game genre identity (sub-genre, css-only inline production scope). Candidates: {{{gameGenreCandidates}}}.
- `coreLoop` — player loop pattern (matrix-narrowed by the resolved genre). Candidates: {{{gameCoreLoopCandidates}}}.

Explicit values from `resolvedAction.basis.gameContentTier` are authoritative — preserve them as-is. Infer missing axes from the directive (e.g. "match-3 with cascading drops" → `genre=match3`, `coreLoop=solve`; "Snake clone with food and walls" → `genre=arcadeSnake`, `coreLoop=survive`).

Output the game content tier in `<gameContentTier>` tags after `<gameArtTier>` (before `<tasks>`):

<gameContentTier>genre=match3,coreLoop=solve</gameContentTier>
{{/if}}

**Step 2: Break into Tasks**

Break this specification into a prioritized list of implementation tasks.

⚠️  CRITICAL: READ THE SPECIFICATION CAREFULLY

**ARCHITECTURE DECISIONS ARE IN THE SPEC - DO NOT INVENT YOUR OWN!**

════════════════════════════════════════════════════════════════════════════════

**Task Granularity:**
- Not too large: Each task should have ONE independent persistence boundary
- Not too small: Each task should be independently verifiable (build + run)
- Description = scope boundary + design doc section reference (NOT implementation detail)
- See rules for detailed scope constraints

**Priority Assignment** (LOWER NUMBER = HIGHER PRIORITY):
- 100–189: setup (project initialization)
- 200–299: feature or design-system (shared foundation / design-system token infra from ui-docs or visualTier policy)
- 300–599: feature (300=critical, 350=important, 400=normal, 500=nice-to-have)
- 600–649: feature (integration — wire parallel outputs into shared entry points)
- 650–699: ui (visual implementation pass)
- 700: test-code (after all features)
- 800: doc (after all features and tests)
- 900–980: error (fixes)
- 1000: verification (always last)

**Task Dependencies:**
- Order tasks logically (foundational features before dependent ones)
- System handles errors dynamically - don't over-think dependencies

════════════════════════════════════════════════════════════════════════════════
