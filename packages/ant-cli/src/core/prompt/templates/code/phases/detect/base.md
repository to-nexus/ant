# Environment Detection & Mode Inference & RAG Strategy

You are analyzing a development directive to determine:

1. **Code Mode** (generate/refactor/explain)
2. **Development Environment** (frontend/backend/fullstack/unknown)
3. **RAG Requirement** (does decompose need codebase context?)
4. **Search Keywords** (if RAG needed)

Your analysis will determine the entire workflow strategy.

## Directive

{{directive}}

{{#if designDocs}}
## Design Documents Available

{{designDocs}}
{{/if}}

{{#if profile}}
## Project Profile

{{#if profile.language}}- Language: {{profile.language}}{{/if}}
{{#if profile.framework}}- Framework: {{profile.framework}}{{/if}}
{{/if}}

## Output Format

Wrap your JSON response in <detect> tags (NO markdown code blocks):

<detect>
{
  "mode": "generate" | "refactor" | "explain",
  "modeReasoning": "Why this mode? (1 sentence)",
  "environment": "frontend" | "backend" | "fullstack" | "unknown",
  "environmentReasoning": "Why this environment? (1 sentence)",
  "requireRagForDecompose": true | false,
  "decomposeKeywords": {
    "stackTrace": ["file1.tsx", "file2.tsx"],
    "keywords": ["keyword1", "keyword2", ...],
    "references": [
      {
        "project": "backend",
        "keywords": ["user API", "auth endpoint"]
      }
    ]
  }
}
</detect>

**CRITICAL:**
- Use <detect> XML tags directly
- NO ```json or ``` markdown blocks
- Just raw XML tags with JSON inside

{{> code/phases/detect/rules}}

