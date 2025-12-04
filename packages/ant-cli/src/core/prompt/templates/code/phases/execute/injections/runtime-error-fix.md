````markdown
## 🔧 RUNTIME ERROR FIX

**Fixing runtime errors from actual execution.**

### Path Alias Errors

**Symptom:** `Can't resolve '@/components/X'` or import errors

**Check:**
1. File exists at target path?
2. Path alias configured in `tsconfig.json`?

**Fix tsconfig.json:**
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

────────────────────────────────────────────────────────────────────────────────

### Quick Fixes

| Issue | Fix |
|-------|-----|
| Missing dependency | `npm install <package>` |
| Wrong import path | Check file path, extension (.ts vs .tsx), export name |
| DevDeps missing | `npm install --include=dev` |

────────────────────────────────────────────────────────────────────────────────

### Approach
1. Read error → Identify root cause
2. Fix broken code only
3. Output with `<edit>` tags

````
