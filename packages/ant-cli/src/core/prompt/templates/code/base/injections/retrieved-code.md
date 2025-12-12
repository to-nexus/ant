# 📦 Retrieved Codebase Context

{{#if files.length}}
## ⚠️ CRITICAL: These Files ALREADY EXIST!

The following {{files.length}} files were retrieved from the **actual codebase**.

🚨 **Before creating any file, check if it exists below!**

---

**Existing Files:**

{{#each files}}
{{#if this.content}}
### 📄 `{{this.path}}`

```
{{this.content}}
```

---
{{else}}
- 📄 `{{this.path}}` ← Call `read_file("{{this.path}}")` to see content
{{/if}}
{{/each}}

{{else}}
No code files were retrieved. You may create new files as needed.
{{/if}}
