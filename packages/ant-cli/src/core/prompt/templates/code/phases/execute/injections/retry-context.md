## 🔄 RETRY CONTEXT - PRESERVE YOUR ORIGINAL PLAN

{{#if retryContext}}
This is retry attempt **{{retryContext.attemptNumber}}/3**.

⚠️  **CRITICAL: DO NOT FORGET YOUR ORIGINAL GOAL**

### 🎯 YOUR ORIGINAL DIRECTIVE
```
{{retryContext.originalDirective}}
```

### 📋 YOUR ORIGINAL PLAN (from first attempt)
{{#if retryContext.originalPlan}}
```
{{retryContext.originalPlan}}
```
{{else}}
(Plan was not captured - refer to directive above)
{{/if}}

### 🔑 KEY DECISIONS YOU MADE
These were the CORE strategies in your original plan:

{{#each retryContext.keyDecisions}}
{{@index}}. **{{this}}**
{{/each}}

### ⚠️ CURRENT ERROR TO FIX
```
{{retryContext.currentError}}
```

---

## 🚨 CRITICAL INSTRUCTIONS FOR RETRY

### ✅ WHAT YOU MUST DO:
1. **PRESERVE YOUR CORE APPROACH** - Keep using the functions/methods from your original plan
2. **FIX ONLY THE SPECIFIC ERROR** - Do not rewrite everything
3. **KEEP KEY DECISIONS INTACT** - The functions and approaches listed above must remain

### ❌ WHAT YOU MUST NOT DO:
1. **DO NOT REVERT TO OLD CODE** - Your plan was made to IMPROVE the implementation
2. **DO NOT ABANDON YOUR STRATEGY** - Stick with the approach you planned
3. **DO NOT CHANGE CORE LOGIC** - Only fix what the error message says is wrong

---

## 📝 PREVIOUS ATTEMPTS

{{#each retryContext.previousAttempts}}
### Attempt {{this.attemptNumber}}
**Approach:** {{this.approach}}
**Result:** {{#if this.wasCloseToSuccess}}✅ Almost worked!{{else}}❌ Failed{{/if}}
**Error:** {{this.error}}

{{#if this.wasCloseToSuccess}}
⚠️  **NOTE:** This attempt was VERY CLOSE to success. Review what worked and preserve it!
{{/if}}

{{/each}}

---

## 🎯 YOUR TASK NOW

**Fix the current error while KEEPING your original solution approach intact.**

### Self-Check (answer before writing code):
- [ ] Am I still using the key functions from my original plan? (**{{#each retryContext.keyDecisions}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}**)
- [ ] Am I only changing what the error message specifically mentions?
- [ ] Does my solution still align with the original directive above?

**If you answered NO to any question above, STOP and revise your approach.**

{{/if}}


