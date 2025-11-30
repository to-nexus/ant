## 📚 REFERENCE CODEBASES

The following codebases are provided for **REFERENCE ONLY** to help you understand external APIs, response formats, or integration patterns.

**⚠️ CRITICAL RULES:**
- ✅ READ and UNDERSTAND reference code
- ✅ USE reference code to understand API contracts, response formats, endpoints
- ❌ DO NOT MODIFY reference code
- ❌ DO NOT CREATE/DELETE files in reference projects
- ✅ ONLY MODIFY files in your current project

{{#each referenceContexts}}
────────────────────────────────────────────────────────────────────────────────

### 📦 Reference Project: {{project}} (branch: {{branch}})

**Purpose**: Reference only - to understand APIs, types, or patterns

{{#each files}}
```
FILE: {{path}} [REFERENCE - {{../project}}]
{{content}}
```

{{/each}}
────────────────────────────────────────────────────────────────────────────────
{{/each}}

**Remember**: These are REFERENCE files. Your task is to modify YOUR project's code to work correctly with these external services.

