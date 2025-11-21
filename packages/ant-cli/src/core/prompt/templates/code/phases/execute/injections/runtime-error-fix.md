## 🔧 RUNTIME ERROR FIX

**You are fixing runtime errors from actual execution.**

### Critical: Path Alias Errors

**If you see:** `Can't resolve '@/components/X'` or similar import errors

**Check BOTH:**
1. Does the file exist at the target path?
2. Is the path alias configured in `tsconfig.json`?

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

**For Next.js/React projects using `@/` alias, this is REQUIRED!**

---

### Common Issues:

**Missing dependencies:**
```bash
npm install <missing-package>
```

**Incorrect imports:**
- Check file path matches import
- Check file extension (.ts vs .tsx)
- Check export name matches import

**Environment issues:**
- Check NODE_ENV value
- Run: `npm install --include=dev` if devDependencies missing

---

### Fix Approach:

1. Read error message → Identify root cause
2. Fix ONLY the broken code
3. Verify fix will resolve the error
4. Output fixed files with `<edit>` or `<file>` tags
