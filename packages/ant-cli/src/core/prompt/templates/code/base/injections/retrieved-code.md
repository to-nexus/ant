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

---

## 🔧 Working with These Files

### To Modify:
1. **Always call `read_file("path")` first**
2. Use `<edit>` with EXACT search block from read result
3. Never edit without reading - content may have changed!

### To Create New Files:
- Only if NOT listed above
- Use `<file>` tags

---

## ✅ Correct Pattern

```xml
<!-- Step 1: Read current content -->
Tool: read_file
Args: { "path": "src/Example.ts" }

<!-- Step 2: Edit with exact search block -->
<edit path="src/Example.ts">
<search>exact code from read_file</search>
<replace>new code</replace>
</edit>
```

## ❌ Wrong Pattern

```xml
<!-- DON'T: Edit without reading -->
<edit path="src/Example.ts">
<search>assumed code</search>
<replace>new code</replace>
</edit>
```

{{else}}
No code files were retrieved. You may create new files as needed.
{{/if}}
