# Generate Task-Specific Search Keywords

You are analyzing a task to generate semantic search keywords.

## Task

**{{taskName}}**

{{taskDescription}}

## Project Context

- Language: {{language}}
- Framework: {{framework}}
- Mode: {{mode}}

{{#if hasReferences}}
## Reference Projects Available

{{referenceProjects}}
{{/if}}

## Guidelines

Generate semantic search keywords for:

1. **Main Codebase**: Keywords for searching THIS project's code
2. **Reference Projects** (if needed): Keywords per reference project

## Output Format

```json
{
  "codebase": ["keyword1", "keyword2", ...],
  "references": {
    "project1": ["ref-keyword1", "ref-keyword2", ...],
    "project2": [...]
  }
}
```

## Examples

**Task: "Add auth middleware using backend patterns"**
- Codebase: ["middleware", "auth", "authentication", "request handler", "express"]
- References: { "backend": ["middleware pattern", "auth guard", "jwt verify"] }

**Task: "Style login form like dashboard"**
- Codebase: ["login form", "form styles", "input fields"]
- References: { "dashboard": ["form component", "styling patterns", "theme"] }

Output ONLY JSON.

