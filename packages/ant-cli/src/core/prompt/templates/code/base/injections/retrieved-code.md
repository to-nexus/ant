# 📦 Retrieved Codebase Context

The following code files were retrieved using **semantic search keywords** generated from your current task. These files are **highly relevant** to your work.

{{#if files.length}}
**Retrieved Files** ({{files.length}} files, ~{{stats.estimatedTokens}} tokens):

{{#each files}}
## File: `{{this.path}}`

```
{{this.content}}
```

{{/each}}

## 📋 How to Use This Code

1. **Read Carefully**: These files were selected because they're relevant to your task
2. **Understand Context**: See how existing patterns and structures work
3. **Reuse Patterns**: Follow the coding style and architecture you see here
4. **Modify as Needed**: Update or extend this code to complete your task
5. **Maintain Consistency**: Keep the same code quality and patterns

## ⚠️ Important Notes

- These files represent the **current state** of the codebase
- Some files may need modification for your task
- Look for TODO comments or areas needing improvement
- Test your changes thoroughly after modification

{{else}}
No code files were retrieved for this task.
{{/if}}

