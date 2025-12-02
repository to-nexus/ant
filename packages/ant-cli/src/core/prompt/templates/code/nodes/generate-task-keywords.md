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
## 📚 Reference Projects Available

{{referenceProjects}}

**IMPORTANT:** You may ONLY generate keywords for these reference projects listed above.

{{else}}
## 📚 Reference Projects

**NONE available.** Do NOT generate reference keywords.

{{/if}}

## Guidelines

Generate semantic search keywords for:

1. **Main Codebase**: Keywords for searching THIS project's code
{{#if hasReferences}}
2. **Reference Projects**: Keywords for each reference project listed above (ONLY if needed for this task)
{{/if}}

## Output Format

{{#if hasReferences}}
```json
{
  "codebase": ["keyword1", "keyword2", ...],
  "references": {
    "project1": ["ref-keyword1", "ref-keyword2", ...],
    "project2": [...]
  }
}
```

**Note:** Only include reference project in `references` if you actually need it for this task. Empty object `{}` is acceptable.
{{else}}
```json
{
  "codebase": ["keyword1", "keyword2", ...],
  "references": {}
}
```

**CRITICAL:** `references` MUST be empty object `{}` since no reference projects are available.
{{/if}}

## Examples

**Task: "Add auth middleware using backend patterns"**
- Codebase: ["middleware", "auth", "authentication", "request handler", "express"]
- References: { "backend": ["middleware pattern", "auth guard", "jwt verify"] }

**Task: "Style login form like dashboard"**
- Codebase: ["login form", "form styles", "input fields"]
- References: { "dashboard": ["form component", "styling patterns", "theme"] }

Output ONLY JSON.

