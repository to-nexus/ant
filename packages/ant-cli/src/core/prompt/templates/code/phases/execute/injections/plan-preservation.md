## 📌 PLAN PRESERVATION - CONTRACT WITH YOUR PLAN

{{#if planContract}}

You made a PLAN in Phase 1. This is your CONTRACT with that plan.

### 🎯 YOUR COMMITTED APPROACH
From your planning phase, you decided to:

```
{{planContract.summary}}
```

### 🔒 REQUIRED ELEMENTS (from your plan)

You MUST use these as committed in your plan:

{{#each planContract.requiredElements}}
#### {{@index}}. {{this.type | uppercase}}: `{{this.name}}`
{{#if this.location}}From: `{{this.location}}`{{/if}}
**Purpose:** {{this.purpose}}
**Status:** {{#if this.implemented}}✅ Currently in code{{else}}⚠️  MUST IMPLEMENT{{/if}}

{{/each}}

---

## ⚠️ CONTRACT ENFORCEMENT

Before you write ANY code, verify:

### Self-Check Questions:
{{#each planContract.requiredElements}}
- [ ] Am I using `{{this.name}}` as planned?
{{/each}}
- [ ] Does my implementation match the approach in "YOUR COMMITTED APPROACH" above?
- [ ] Have I imported all required functions/modules?

### 🚨 IF YOU ANSWERED "NO" TO ANY QUESTION:

**STOP!** You are deviating from your plan without good reason.

**Valid reasons to deviate:**
- ✅ The planned function doesn't exist (check carefully first!)
- ✅ The planned approach causes a compile error
- ✅ You discovered a better alternative that solves the core problem

**Invalid reasons to deviate:**
- ❌ "I forgot what I planned"
- ❌ "It's easier to do it differently"
- ❌ "I'm fixing a minor error"

**If you have a valid reason to deviate:**
1. State it explicitly in your RESPONSE section
2. Explain why the original plan won't work
3. Propose the alternative clearly

---

## ✅ VERIFICATION BEFORE OUTPUT

Before you output your code, run this final check:

```
PLAN says to use: {{#each planContract.requiredElements}}{{this.name}}{{#unless @last}}, {{/unless}}{{/each}}

MY CODE uses: [list what you actually used]

MATCH? [ ] YES  [ ] NO

If NO → Go back and use what the plan specified!
```

{{/if}}


