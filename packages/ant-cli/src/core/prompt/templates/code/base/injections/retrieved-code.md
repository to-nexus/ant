# 📦 Retrieved Codebase Context

{{#if files.length}}
## ⚠️ CRITICAL: These Files ALREADY EXIST in the Codebase!

The following {{files.length}} files were retrieved from the **actual codebase** using semantic search.
**These are REAL files that EXIST on disk right now.**

🚨 **BEFORE creating ANY new file:**
1. Check if the file you need is listed below
2. If it exists here → use `<edit>` tags to MODIFY it (see Output Format Rules)
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

1. **These files EXIST** - Do NOT recreate them with `<file>` tags
2. **To modify**: Use `<edit>` tags with `<search>` and `<replace>` blocks (see Output Format Rules)
3. **To add new code**: Use `<edit>` or `<append>` tags on the existing files above
4. **To create NEW files**: Only if the file is NOT listed above - use `<file>` tags

## ❌ Common Mistakes to Avoid

- ❌ Creating `EventHandler.ts` when it already exists above
- ❌ Using `<file>` tag to create a file that's shown in this list
- ❌ Ignoring the existing code and starting from scratch

## ✅ Correct Approach

```xml
<!-- ✅ CORRECT: Modifying existing file -->
<edit path="src/EventHandler.ts">
<search>exact code from above</search>
<replace>modified code</replace>
</edit>

<!-- ❌ WRONG: Creating file that already exists -->
<file path="src/EventHandler.ts">
new code
</file>
```

{{else}}
No code files were retrieved for this task. You may need to create new files.
{{/if}}
