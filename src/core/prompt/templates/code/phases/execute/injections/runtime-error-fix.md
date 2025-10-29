## 🔧 RUNTIME ERROR FIX MODE

The directive contains **runtime error messages** or **execution feedback** from the user.

### Context
The code was generated and executed, but encountered errors during runtime. The user has provided:
- Terminal output / error messages
- Stack traces
- Console logs
- Test failures
- Linter warnings from actual execution

### Your Task
1. **Analyze the error messages** in the directive carefully
2. **Identify the root cause** (common issues: missing dependencies, incorrect imports, type mismatches, logic errors)
3. **Fix ONLY the problematic files** - don't regenerate everything
4. **Test your fix mentally** - ensure the error won't recur

### Error Analysis Pattern
```
ERROR MESSAGE → ROOT CAUSE → FIX STRATEGY
```

Examples:
- `Module not found: 'zustand'` → Missing dependency → Update package.json
- `Can't resolve '@/components/X'` → Missing file OR path alias config → Create file AND check tsconfig.json paths
- `TypeError: Cannot read property 'map' of undefined` → Missing null check → Add conditional
- `TS2304: Cannot find name 'Crypto'` → Missing type definition → Add interface
- `ELIFECYCLE Command failed` → Script error → Fix npm script

### Special Case: Path Alias Errors

When you see `Can't resolve '@/...'` or similar path alias errors:

**Check BOTH:**
1. Does the file exist at the target path?
2. Is the path alias configured in `tsconfig.json`?

For Next.js/React projects using `@/` alias:
```json
// tsconfig.json must have:
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**Always update tsconfig.json when fixing path alias errors!**

### Response Format
Start with a brief explanation:
```
=== RESPONSE ===
I see the issue. [Explain the root cause in 1-2 sentences]
[Describe your fix approach]
=== END RESPONSE ===
```

Then output the fixed files:
```
=== FILE: [path/to/problematic/file.ts] ===
[Complete fixed file content]
=== END FILE ===
```

### Critical Rules
✅ Address the EXACT error mentioned in the directive
✅ Include relevant context from error stack traces
✅ Fix dependencies/imports if needed (update package.json)
✅ Write complete files (no ellipsis)
❌ Don't regenerate unrelated files
❌ Don't ignore the error message
❌ Don't add unnecessary features

