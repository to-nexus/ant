You are analyzing a software specification to break it into executable tasks.

DIRECTIVE:
{{{directive}}}
{{#if uiHint}}
{{{uiHint}}}
{{/if}}
{{#if assetsHint}}
{{{assetsHint}}}
{{/if}}

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

If any spec doc is relevant to the directive, select it as the primary specification.
Output the selected filename in a `<selectedSpec>` tag:
`<selectedSpec>spec-social-login.md</selectedSpec>`

If no spec doc is relevant, output:
`<selectedSpec>null</selectedSpec>`

════════════════════════════════════════════════════════════════════════════════
{{/if}}

YOUR TASK:

**Step 1: Determine Project Profile**

Before breaking tasks, you MUST determine the project profile from the available context.

Observe the following in order:
1. **Design Document Availability** (above) — document name prefixes indicate tier scope
2. **Design Document Content** (in specification) — technology stack is stated in the documents
3. **Directive and PRD** — only when design documents are absent

Output the profile in `<profile>` tags before `<tasks>`:

<profile>
{
  "environment": "frontend" | "backend" | "fullstack" | "unknown",
  "environmentReasoning": "Why this environment? (1 sentence)",
  "language": "typescript" | "javascript" | "python" | "go" | "rust" | "java",
  "framework": "react" | "vue" | "next" | "express" | "fastapi" | "gin" | ... (or null)
}
</profile>

{{> code/phases/decompose/profile-rules}}

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
- 190–199: design-system (token infrastructure — only when ui-docs exist)
- 200–299: feature or design-system (shared foundation / design-system wiring)
- 300–649: feature (300=critical, 350=important, 400=normal, 500=nice-to-have)
- 600: feature, exclusive (integration — wire parallel outputs into shared entry points)
- 650–699: ui (visual implementation pass)
- 700: test-code (after all features)
- 800: doc (after all features and tests)
- 900–980: error (fixes)
- 1000: verification (always last)

**Task Dependencies:**
- Order tasks logically (foundational features before dependent ones)
- System handles errors dynamically - don't over-think dependencies

════════════════════════════════════════════════════════════════════════════════
