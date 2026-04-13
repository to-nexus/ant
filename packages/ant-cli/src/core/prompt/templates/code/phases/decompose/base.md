{{#if hasJobHistory}}
{{> code/base/injections/job-history}}
{{/if}}

You are analyzing a software specification to break it into executable tasks.

DIRECTIVE:
{{{directive}}}
{{#if uiHint}}
{{{uiHint}}}
{{/if}}
{{#if assetsHint}}
{{{assetsHint}}}
{{/if}}

{{> code/phases/decompose/scope-rules}}

{{> code/phases/decompose/mode-guide}}

{{> code/phases/decompose/error-or-general}}

{{> code/phases/decompose/existing-code-check}}

{{> code/phases/decompose/design-doc-guide}}

{{#if specDoc}}
════════════════════════════════════════════════════════════════════════════════
## Feature Specification

{{{specDoc}}}

{{#if specApiContract}}

────────────────────────────────────────

## API Contract (Reference)

{{{specApiContract}}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}

{{#if designDocsMeta}}
════════════════════════════════════════════════════════════════════════════════
## Design Document Availability

{{designDocsMeta}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}

{{#if hasSpecDocs}}
════════════════════════════════════════════════════════════════════════════════
## Spec Documents Available

The following feature-scoped specification documents exist:
{{specDocsMeta}}

**You MUST output a `<selectedSpec>` tag.** Select the spec relevant to the directive, or null if none applies.

`<selectedSpec>spec-social-login.md</selectedSpec>`

If no spec doc is relevant: `<selectedSpec>null</selectedSpec>`

════════════════════════════════════════════════════════════════════════════════
{{/if}}

YOUR TASK:

**Step 1: Determine TechTier**

Before breaking tasks, you MUST determine the technology tier from the available context.

Observe the following in order:
1. **Design Document Availability** (above) — document name prefixes indicate tier scope
2. **Design Document Content** (in specification) — technology stack is stated in the documents
3. **Directive and PRD** — only when design documents are absent

Output the tech tier in `<techTier>` tags before `<tasks>`:

<techTier>
{
  "stack": "frontend" | "backend" | "fullstack" | "unknown",
  "stackReasoning": "Why this stack? (1 sentence)",
  "language": "typescript" | "javascript" | "python" | "go" | "rust" | "java",
  "framework": "react" | "vue" | "nextjs" | "express" | "fastapi" | "gin" | ... (or null),
  "packageTiers": {
    "fe-main": { "language": "typescript", "framework": "nextjs", "stack": "frontend" },
    "be-api": { "language": "go", "framework": "gin", "stack": "backend" }
  }
}
</techTier>

- `packageTiers` is REQUIRED when `stack` is `"fullstack"` and packages use different languages/frameworks.
- `packageTiers` is OPTIONAL otherwise (omit when all packages share the same stack).
- Each key is a package tag (e.g. `fe-main`, `be-auth`, `be-order`).

{{> code/phases/decompose/techTier-rules}}

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
- 200–299: feature or design-system (shared foundation / design-system token infra + wiring)
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
