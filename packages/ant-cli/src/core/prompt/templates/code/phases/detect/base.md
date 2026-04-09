# Job Mode Inference, RAG Strategy & Development Source

You are analyzing a development directive to determine:

1. **Job Mode** (generate/refactor/explain)
2. **RAG Requirement** (does decompose need codebase context?)
3. **Search Keywords** (if RAG needed)
4. **Primary Sources** (which documents/directories are the development source?)

Your analysis will determine the workflow routing strategy.

## Directive

{{directive}}

{{#if prdSpec}}
## Requirements (PRD)

{{prdSpec}}
{{/if}}

{{#if artifactAvailability}}
## Available Artifacts

{{{artifactAvailability}}}
{{/if}}

## Output Format

Wrap your JSON response in <detect> tags (NO markdown code blocks):

<detect>
{
  "jobMode": "generate" | "refactor" | "explain",
  "jobModeReasoning": "Why this mode? (1 sentence)",
  "requireRag": true | false,
  "primarySources": ["outputs/design/spec/spec-auth.md"],
  "primarySourcesReasoning": "Why these sources? (1 sentence)",
  "decomposeKeywords": {
    "errorFiles": ["file1.tsx", "file2.tsx"],
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
