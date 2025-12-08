You are analyzing a software specification to break it into executable tasks.

SPECIFICATION:
{{spec}}

{{> code/phases/decompose/mode-guide}}

{{> code/phases/decompose/error-or-general}}

{{> code/phases/decompose/existing-code-check}}

{{> code/phases/decompose/design-doc-guide}}

YOUR TASK:
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
