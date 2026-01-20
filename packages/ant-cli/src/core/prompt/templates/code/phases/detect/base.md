# Environment Detection & Job Mode Inference & RAG Strategy

You are analyzing a development directive to determine:

1. **Job Mode** (generate/refactor/explain)
2. **Development Environment** (frontend/backend/fullstack/unknown)
3. **RAG Requirement** (does decompose need codebase context?)
4. **Search Keywords** (if RAG needed)

Your analysis will determine the entire workflow strategy.

## Directive

{{directive}}

{{#if prdSpec}}
## Requirements (PRD)

{{prdSpec}}
{{/if}}

{{#if designDocs}}
## Design Documents

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
  "jobMode": "generate" | "refactor" | "explain",
  "jobModeReasoning": "Why this mode? (1 sentence)",
  "environment": "frontend" | "backend" | "fullstack" | "unknown",
  "environmentReasoning": "Why this environment? (1 sentence)",
  "requireRag": true | false,
  "decomposeKeywords": {
    "errorFiles": ["file1.tsx", "file2.tsx"],
    "keywords": ["keyword1", "keyword2", ...],
    "references": [
      {
        "project": "backend",
        "keywords": ["user API", "auth endpoint"]
      }
    ]
  },
  "profile": {
    "language": "typescript" | "javascript" | "python" | "golang" | "rust" | "java",
    "framework": "react" | "vue" | "next" | "express" | "fastapi" | ... (or null)
  }
}
</detect>

**⚠️ IMPORTANT: Profile Language Default**

If you cannot clearly determine the language from the directive or design document:
- **ALWAYS use `"typescript"` as the default**
- TypeScript is the correct default for modern web applications
- Only use other languages if explicitly mentioned (Python/FastAPI, Go, Rust, Java)

**CRITICAL:**
- Use <detect> XML tags directly
- NO ```json or ``` markdown blocks
- Just raw XML tags with JSON inside

{{> code/phases/detect/rules}}

