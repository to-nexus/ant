# 📦 Retrieved Codebase Context

{{#if files.length}}
## ⚠️ CRITICAL: These Files ALREADY EXIST in the Codebase!

The following {{files.length}} files were retrieved from the **actual codebase** using semantic search.
**These are REAL files that EXIST on disk right now.**

🚨 **BEFORE creating ANY new file:**
1. Check if the file you need is listed below
2. If it exists here → use `apply_patch` or `read_file` + `write_file` to MODIFY it
3. NEVER create a new file if it already exists below!

---

**Existing Files** ({{files.length}} files, ~{{stats.estimatedTokens}} tokens):

{{#each files}}
### 📄 `{{this.path}}` ← THIS FILE EXISTS!

```
{{this.content}}
```

---
{{/each}}

## 📋 How to Work With These Files

1. **These files EXIST** - Do NOT recreate them with `write_file`
2. **To modify**: Use `apply_patch` for targeted changes, or `read_file` + `write_file` for full rewrites
3. **To add new code**: Extend the existing files shown above
4. **To create NEW files**: Only if the file is NOT listed above

## ❌ Common Mistakes to Avoid

- ❌ Creating `EventHandler.ts` when it already exists above
- ❌ Using `write_file` to create a file that's shown in this list
- ❌ Ignoring the existing code and starting from scratch

{{else}}
No code files were retrieved for this task. You may need to create new files.
{{/if}}

