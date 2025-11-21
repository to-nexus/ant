⚙️  VALIDATION STRATEGY - SYSTEM HANDLES THIS AUTOMATICALLY

**CRITICAL: You do NOT need to create "verify" or "validate" tasks!**

The system automatically validates based on task priority and type:
- **Priority 1000 (Final task):** Full runtime validation (build + type-check + lint)
- **Setup tasks:** Static validation (config syntax check)
- **Feature tasks:** Static validation (deferred to Final task)
- **Error tasks:** Runtime validation (verify fix works)

---

## Task Properties (Optional):

You CAN include these properties, but the system will override them based on task type:

**validationRequired** (boolean):
- `true`: Run validation after this task (default for most tasks)
- `false`: Skip validation (use ONLY for trivial tasks like adding comments)

**validationRationale** (string):
- Brief explanation for skipping validation (only if validationRequired: false)

---

## ❌ DO NOT CREATE THESE TASKS:

**WRONG - Intermediate "verify" tasks:**
```json
{
  "id": "verify-ui-components",  ❌ DON'T CREATE THIS!
  "name": "Validate All UI Components",
  "type": "feature"
}
```

**WHY THIS IS WRONG:**
- System validates automatically - no need for explicit "verify" tasks
- Creates confusion - LLM thinks it should run npm run build
- Wastes a task slot that could be used for actual features

---

## ✅ CORRECT TASK BREAKDOWN:

**For a UI component library:**

```json
{
  "tasks": [
    {
      "id": "setup-config",
      "name": "Setup Project Configuration",
      "type": "setup",
      "priority": 100,
      "description": "Generate package.json, tsconfig.json, vite.config.ts"
    },
    {
      "id": "button-component",
      "name": "Create Button Component",
      "type": "feature",
      "priority": 200,
      "description": "Implement reusable Button with variants and sizes"
    },
    {
      "id": "card-component",
      "name": "Create Card Component",
      "type": "feature",
      "priority": 210,
      "description": "Implement reusable Card component"
    },
    {
      "id": "input-component",
      "name": "Create Input Component",
      "type": "feature",
      "priority": 220,
      "description": "Implement reusable Input with validation"
    },
    {
      "id": "final-verification",
      "name": "Final Integration & Build Verification",
      "type": "feature",
      "priority": 1000,
      "description": "Install all dependencies and build entire project to verify compilation"
    }
  ]
}
```

**Note:**
- NO intermediate "verify" tasks
- Just feature implementations + ONE Final task (Priority 1000)
- System handles validation automatically at each step
- Final task does comprehensive build validation

---

## When to Skip Validation:

**Use `validationRequired: false` ONLY for:**
- Adding code comments
- Updating README text
- Trivial formatting changes

**Example:**
```json
{
  "id": "add-comments",
  "name": "Add JSDoc Comments",
  "type": "feature",
  "priority": 250,
  "description": "Add documentation comments to functions",
  "validationRequired": false,
  "validationRationale": "Only adding comments, no code changes"
}
```

---

## Summary:

✅ **DO:** Create feature tasks for actual implementations
✅ **DO:** Create ONE Final task with Priority 1000
❌ **DON'T:** Create intermediate "verify" or "validate" tasks
❌ **DON'T:** Try to control validation type (system decides automatically)

**Trust the system to handle validation intelligently!**
