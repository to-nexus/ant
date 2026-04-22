You are analyzing a software specification to break it into executable tasks.

DIRECTIVE:
{{{directive}}}
{{#if tierRefs.length}}

════════════════════════════════════════════════════════════════════════════════
## Available Reference Documents (tier-classification signal)

The following reference documents are attached to this turn. They are a
tier-classification signal: when the directive asks for work that is
systematically grounded in these refs, emit `<executionTier>4</executionTier>`;
when refs exist but the directive is unrelated to their content, prefer
`<executionTier>3</executionTier>`.

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

{{> jobs/code/nodes/decompose/variants/default/techTier-rules}}

{{#if resolvedAction.basis.visualTier}}
The following visual design policy has been **pre-determined** by the user.
A `"design-system"` task at priority 200 is REQUIRED to implement this policy as token infrastructure.

Pre-determined visual tier:
- visualLanguage: {{resolvedAction.basis.visualTier.visualLanguage}}
- surfaceSystem: {{resolvedAction.basis.visualTier.surfaceSystem}}
- spatialSystem: {{resolvedAction.basis.visualTier.spatialSystem}}
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
