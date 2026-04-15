````markdown
## RUNTIME ERROR FIX

**Fixing runtime errors from actual execution.**

### Module/Import Resolution Errors

**Symptom:** Cannot resolve module, unresolved import, file not found

**Check:**
1. Does the target file/module exist at the referenced path?
2. Is the module resolution configured correctly in the project's config files?
3. Are path aliases defined and consistent between compiler config and build tool config?

**Principle**: Module resolution settings vary by language and build tool. Observe the project's existing configuration before applying fixes.

────────────────────────────────────────────────────────────────────────────────

### Quick Fixes

| Issue | Fix |
|-------|-----|
| Missing dependency | Install using the project's package manager (see Build System Detection in rules) |
| Wrong import path | Check file path, extension, and export name |
| Dev dependencies missing | Reinstall with dev dependencies included |
| Module not found | Verify module exists, check resolution config |

────────────────────────────────────────────────────────────────────────────────

### Approach
1. Read error → Identify root cause
2. Fix broken code only
3. Output with `edit_file` tool

````
