# Project Code Context

{{#if files.length}}
{{files.length}} files from the current codebase.

{{#each files}}
{{#if this.content}}
### `{{this.path}}` (loaded)

```
{{this.content}}
```

---
{{else}}
- `{{this.path}}` (path only)
{{/if}}
{{/each}}

**Constraint**: Files marked `(loaded)` have their full content above — do NOT `read_file` on them.
Files marked `(path only)` — use `read_file` only when you need to modify them.

{{else}}
No code files were retrieved.
{{/if}}
