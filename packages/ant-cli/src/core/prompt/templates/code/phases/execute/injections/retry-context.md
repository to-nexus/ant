````markdown
## 🔄 RETRY CONTEXT

{{#if retryContext}}
**Retry attempt {{retryContext.attemptNumber}}/3** - Fix the error while preserving your original approach.

────────────────────────────────────────────────────────────────────────────────

### 🎯 ORIGINAL DIRECTIVE
```
{{retryContext.originalDirective}}
```

### 📋 YOUR PLAN (attempt 1)
{{#if retryContext.originalPlan}}
```
{{retryContext.originalPlan}}
```
{{else}}
(Refer to directive above)
{{/if}}

### 🔑 KEY DECISIONS
{{#each retryContext.keyDecisions}}
{{@index}}. **{{this}}**
{{/each}}

────────────────────────────────────────────────────────────────────────────────

### ⚠️ CURRENT ERROR
```
{{retryContext.currentError}}
```

### 📝 PREVIOUS ATTEMPTS
{{#each retryContext.previousAttempts}}
**Attempt {{this.attemptNumber}}:** {{this.approach}} → {{#if this.wasCloseToSuccess}}✅ Almost worked{{else}}❌ Failed{{/if}}
Error: `{{this.error}}`
{{/each}}

────────────────────────────────────────────────────────────────────────────────

### ✅ FIX PRINCIPLES
1. **Preserve core approach** - Keep key decisions intact: {{#each retryContext.keyDecisions}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
2. **Fix error only** - Change what error message specifies, nothing more
3. **Stay aligned** - Solution must match original directive

❌ Do NOT revert to old code or abandon your strategy.

{{/if}}

````
