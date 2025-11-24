OUTPUT FORMAT:

{{> code/base/injections/text-response-format}}

First, analyze step by step (think through):
- Is this a new project or existing project?
  - ⚠️ If "EXISTING CODEBASE DETECTED" was shown → EXISTING PROJECT
  - ⚠️ If existing project → DO NOT create setup task (priority 100)
- Does it need setup/configuration tasks?
  - ⚠️ ONLY for NEW projects without any code
  - ⚠️ If ANY files exist → setup already done, skip setup task
- What are the main features to implement?
- What is the optimal task breakdown?

Then output the task list wrapped in <tasks> tags with valid JSON:

**Example 1: NEW PROJECT (no existing code)**
<tasks>
{
  "tasks": [
    {
      "id": "setup-project-config",
      "name": "Setup Project Configuration",
      "type": "setup",
      "priority": 100,
      "description": "Generate package.json with all dependencies (React, TypeScript, Vite, TailwindCSS, etc.), tsconfig.json, vite.config.ts, tailwind.config.ts, and .gitignore"
    },
    {
      "id": "auth-impl",
      "name": "Implement User Authentication System",
      "type": "feature",
      "priority": 200,
      "description": "Create login, signup, JWT token handling, protected routes"
    },
    {
      "id": "final-verification",
      "name": "Final Integration & Verification",
      "type": "feature",
      "priority": 1000,
      "description": "Install all dependencies and build the project to verify compilation."
    }
  ]
}
</tasks>

**Example 2: EXISTING PROJECT (code already exists - FileStorage.ts, etc.)**
<tasks>
{
  "tasks": [
    {
      "id": "fix-entry-point",
      "name": "Fix Missing Entry Point",
      "type": "feature",
      "priority": 200,
      "description": "Add missing main.ts with NestJS bootstrap - use existing FileStorage.ts for storage"
    },
    {
      "id": "complete-auth",
      "name": "Complete Authentication Module",
      "type": "feature",
      "priority": 220,
      "description": "Add login and session methods to existing AuthService using FileStorage"
    },
    {
      "id": "extend-user-entity",
      "name": "Extend User Entity",
      "type": "feature",
      "priority": 240,
      "description": "Add balance field to existing User entity in entities/User.ts"
    },
    {
      "id": "final-verification",
      "name": "Final Integration & Verification",
      "type": "feature",
      "priority": 1000,
      "description": "Build the project to verify all fixes work correctly."
    }
  ]
}
</tasks>

**⚠️ Note the differences:**
- NEW PROJECT: "Create", "Implement", "Generate" + Setup task included
- EXISTING PROJECT: "Fix", "Complete", "Extend", "Add to" + NO setup task, reference existing files

**📦 Dependencies Management:**
- **Preferred:** Include all known dependencies in Setup Task (priority 100)
- **Allowed:** Feature tasks CAN add dependencies if absolutely necessary
- **Example:** If a feature needs `date-fns` library, the feature task description can mention: "Add date formatting using date-fns (install if missing)"

CRITICAL: 
- The JSON inside <tasks> tags MUST be valid JSON (no trailing commas, proper quotes)
- Use <tasks> wrapper so the JSON can be reliably extracted

IMPORTANT:
- **Setup Task Decision (CRITICAL):**
  - ✅ Create setup task ONLY if "NEW PROJECT (no existing codebase)" was shown above
  - ❌ DO NOT create setup task if "EXISTING CODEBASE DETECTED" was shown above
  - ❌ DO NOT create setup task if codePreview showed ANY files (even 1 file = setup done)
  - ❌ DO NOT create setup task to "fix" missing entry points (that's a bug fix = feature task)
  - If EXISTING PROJECT with errors → create feature tasks to fix bugs, NOT setup
- If NEW PROJECT: Setup task is typically needed (but verify no code exists!)
- If the spec only mentions "build a React app" with no specific features → return setup task + empty array for features
- Focus on USER-FACING features, not infrastructure (infrastructure = setup task)
- Each task must have unique id (kebab-case)
- **ALWAYS include the final verification task as the last task**

