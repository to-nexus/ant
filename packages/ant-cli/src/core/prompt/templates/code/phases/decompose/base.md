You are analyzing a software specification to break it into executable tasks.

SPECIFICATION:
{{spec}}

{{> code/phases/decompose/mode-guide}}

{{> code/phases/decompose/error-or-general}}

{{> code/phases/decompose/existing-code-check}}

{{> code/phases/decompose/design-doc-guide}}

{{#if designDocsMeta}}
════════════════════════════════════════════════════════════════════════════════
## Design Document Availability

{{designDocsMeta}}

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
  "language": "typescript" | "javascript" | "python" | "golang" | "rust" | "java",
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
- Not too large: Each task should be independently implementable
- Not too small: Avoid micro-tasks like "Create one file"
- Good size: A feature that delivers value (e.g., "Login system")

**Priority Assignment** (LOWER NUMBER = HIGHER PRIORITY):
- 100: Setup (if needed, only in generate mode)
- 200-219: Critical features/fixes
- 220-249: Important features/fixes
- 250-899: Nice-to-have features
- 1000: Final verification (always last)

**Task Dependencies:**
- Order tasks logically (foundational features before dependent ones)
- System handles errors dynamically - don't over-think dependencies

════════════════════════════════════════════════════════════════════════════════

{{> code/phases/decompose/rules}}
