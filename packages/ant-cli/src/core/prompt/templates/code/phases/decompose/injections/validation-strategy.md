⚙️  VALIDATION STRATEGY (CRITICAL - MUST DECIDE FOR EACH TASK):

**For each task, you MUST decide the validation strategy to optimize performance:**

**validationRequired** (boolean):
- true: Task requires validation after completion
- false: Skip validation for this task (use for batch/intermediate tasks)

**validationType** (string):
- "none": Skip all validation checks (fastest, use for low-risk intermediate tasks)
- "static": Only syntax/config validation (fast, use for config files like JSON, YAML)
- "runtime": Full validation including TypeScript compile + build + lint (slow, use for critical tasks)

**validationRationale** (string):
- Brief explanation for your decision (helps debugging and learning)

**GUIDELINES FOR VALIDATION DECISIONS:**

1. **Setup Tasks (config files)**:
   - validationRequired: true
   - validationType: "static" (JSON syntax check is enough)
   - Rationale: "Config files need syntax validation before code generation"

2. **Batch Component/Feature Creation**:
   - Intermediate tasks (1st, 2nd, 3rd...):
     - validationRequired: false
     - validationType: "none"
     - Rationale: "Batch creation, will validate after all components complete"
   - Last task in batch:
     - validationRequired: true
     - validationType: "runtime"
     - Rationale: "Final validation after batch component creation"

3. **Error Fix Tasks**:
   - validationRequired: true
   - validationType: "runtime" (must verify fix works!)
   - Rationale: "Critical error fix requires immediate validation"

4. **Critical Features** (auth, payment, core functionality):
   - validationRequired: true
   - validationType: "runtime"
   - Rationale: "Critical feature requires full validation"

5. **Minor Features** (styling, UI tweaks):
   - validationRequired: false OR true with "static"
   - validationType: "none" OR "static"
   - Rationale: "Minor changes, batch validate later" OR "Quick syntax check"

6. **Final Verification Task**:
   - validationRequired: true
   - validationType: "runtime" (ALWAYS!)
   - Rationale: "Final comprehensive validation of entire application"

**EXAMPLE - BATCH COMPONENT CREATION:**

{
  "tasks": [
    {
      "id": "setup-config",
      "name": "Setup Project Configuration",
      "type": "setup",
      "priority": 100,
      "description": "Generate package.json, tsconfig.json, vite.config.ts",
      "validationRequired": true,
      "validationType": "static",
      "validationRationale": "Config files need syntax validation"
    },
    {
      "id": "ui-button",
      "name": "Create Button Component",
      "type": "feature",
      "priority": 200,
      "description": "Create reusable Button component",
      "validationRequired": false,
      "validationType": "none",
      "validationRationale": "Batch component creation, validate after all UI components"
    },
    {
      "id": "ui-card",
      "name": "Create Card Component",
      "type": "feature",
      "priority": 201,
      "description": "Create reusable Card component",
      "validationRequired": false,
      "validationType": "none",
      "validationRationale": "Batch component creation, validate after all UI components"
    },
    {
      "id": "ui-input",
      "name": "Create Input Component",
      "type": "feature",
      "priority": 202,
      "description": "Create reusable Input component",
      "validationRequired": false,
      "validationType": "none",
      "validationRationale": "Batch component creation, validate after all UI components"
    },
    {
      "id": "verify-ui-components",
      "name": "Validate All UI Components",
      "type": "feature",
      "priority": 299,
      "description": "Comprehensive validation of all UI components created in batch",
      "validationRequired": true,
      "validationType": "runtime",
      "validationRationale": "Final validation after batch UI component creation"
    },
    {
      "id": "final-verification",
      "name": "Final Integration & Verification",
      "type": "feature",
      "priority": 999,
      "description": "Verify all requirements are met",
      "validationRequired": true,
      "validationType": "runtime",
      "validationRationale": "Final comprehensive validation of entire application"
    }
  ]
}

