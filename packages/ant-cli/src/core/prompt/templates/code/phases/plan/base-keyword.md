# Generate Task-Specific Search Keywords

You are analyzing a task to generate semantic search keywords.

**IMPORTANT**: Task description is a hypothesis. Use original directive as ground truth.

## Task (Hypothesis)

**{{taskName}}**

{{taskDescription}}

**Note**: This task was created based on initial analysis. It may not capture the full picture.

## Original Directive (Ground Truth)

```
{{directive}}
```

**Use this for objective facts**: error codes, stack traces, file paths, error messages.

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

{{> code/phases/plan/rules-keyword}}
