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

{{#if hasDirectoryTree}}
## Current Codebase Structure

```
{{directoryTree}}
```

Use this to identify specific files this task needs to read or modify.
{{/if}}

{{#if hasReferences}}
## Reference Projects Available

{{referenceProjects}}

**IMPORTANT:** You may ONLY generate keywords for these reference projects listed above.

{{else}}
## Reference Projects

**NONE available.** Do NOT generate reference keywords.

{{/if}}

## Output Format

{{#if hasDirectoryTree}}
```json
{
  "requiredFiles": ["path/to/file1", "path/to/file2"],
  "keywords": ["keyword1", "keyword2", ...],
  "errorFiles": [],
{{#if hasReferences}}
  "references": {
    "project1": ["ref-keyword1", "ref-keyword2", ...],
    "project2": [...]
  }
{{else}}
  "references": {}
{{/if}}
}
```

- `requiredFiles`: Files from the codebase structure above that this task MUST read or modify. Use exact paths shown in the tree. **Priority: loaded first, always included.**
- `keywords`: Semantic search keywords for finding additional relevant files. **Can be empty `[]` if `requiredFiles` and/or `errorFiles` already cover all files this task needs.**
- `errorFiles`: Files extracted from error stack traces (empty if no errors).
{{#if hasReferences}}
**Note:** Only include reference project in `references` if you actually need it for this task. Empty object `{}` is acceptable.
{{else}}
**CRITICAL:** `references` MUST be empty object `{}` since no reference projects are available.
{{/if}}
{{else}}
```json
{
  "requiredFiles": [],
  "keywords": ["keyword1", "keyword2", ...],
  "errorFiles": [],
{{#if hasReferences}}
  "references": {
    "project1": ["ref-keyword1", "ref-keyword2", ...],
    "project2": [...]
  }
{{else}}
  "references": {}
{{/if}}
}
```

- `requiredFiles`: Empty (no codebase structure available to select from).
- `keywords`: Semantic search keywords for finding relevant files. **Can be empty `[]` if `errorFiles` already cover all files this task needs.**
- `errorFiles`: Files extracted from error stack traces (empty if no errors).
{{#if hasReferences}}
**Note:** Only include reference project in `references` if you actually need it for this task. Empty object `{}` is acceptable.
{{else}}
**CRITICAL:** `references` MUST be empty object `{}` since no reference projects are available.
{{/if}}
{{/if}}

{{> code/phases/plan/rules-keyword}}
