OUTPUT FORMAT:

{{> code/base/injections/text-format-compact}}

**Text Formatting Rules:**
- Use inline code for file names, variables, and technical terms: `api.ts`, `VITE_BACKEND_URL`
- Write analysis in natural sentences without excessive line breaks
- Keep related information on the same line
- Example: "`api.ts` uses `VITE_BACKEND_URL` and `VITE_BACKEND_WSURL`"
- NOT: "api.ts\n는\nVITE_BACKEND_URL\n과..." (excessive line breaks)

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
[
  {
    "id": "project-setup",
    "name": "Setup Project",
    "type": "setup",
    "priority": 100,
    "description": "Create project structure, configuration files, and install dependencies based on detected language and framework"
  },
  {
    "id": "feature-impl",
    "name": "Implement Feature",
    "type": "feature",
    "priority": 200,
    "description": "..."
  },
  {
    "id": "final-verification",
    "name": "Final Build Verification",
    "type": "feature",
    "priority": 1000,
    "description": "Verify build succeeds and all critical files exist"
  }
]
</tasks>

**Example 2: EXISTING PROJECT with feature request**
<tasks>
[
  {
    "id": "add-user-balance",
    "name": "Add Balance Field to User",
    "type": "feature",
    "priority": 200,
    "description": "Extend User entity with balance field and update related services"
  },
  {
    "id": "final-verification",
    "name": "Final Build Verification",
    "type": "feature",
    "priority": 1000,
    "description": "Check for critical missing files. Create if build-blocking."
  }
]
</tasks>

**Example 3: ERROR FIX (error message in directive)**
<tasks>
[
  {
    "id": "fix-module-error",
    "name": "Fix ERR_MODULE_NOT_FOUND for EventHandler",
    "type": "error",
    "priority": 200,
    "description": "Analyze and resolve: 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module ./EventHandler'. Determine root cause (missing file, wrong path, or config issue) and apply fix."
  },
  {
    "id": "final-verification",
    "name": "Verify Error Resolution",
    "type": "feature",
    "priority": 1000,
    "description": "Confirm error fix is complete. Address any remaining issues."
  }
]
</tasks>

**⚠️ Key differences:**
- NEW PROJECT: "Create", "Implement" + Setup task + type: "setup"/"feature"
- EXISTING PROJECT: "Add", "Extend" + NO setup task + type: "feature"
- ERROR FIX: **Broken behavior that needs fixing** + **type: "error"** (CRITICAL!)

**🚨 CRITICAL: Error vs Feature Distinction**

**Type: "error"** - Existing functionality is BROKEN or FAILING:
- Core principle: Something that **worked before** is now **not working**
- Indicators: Crashes, exceptions, incorrect behavior, missing output
- Action focus: **Restore** working state

**Type: "feature"** - NEW functionality or IMPROVEMENT to existing:
- Core principle: Adding capability that **didn't exist** or **enhancing** what works
- Indicators: New requirements, performance optimization, UX enhancement
- Action focus: **Extend** or **improve** capabilities

**Decision framework:**
1. Does the problem describe something that should work but doesn't? → **error**
2. Does the request add new capability or improve existing working code? → **feature**
3. Ambiguous "fix" without clear broken state? → Default to **feature** (likely improvement)

**📦 Dependencies Management:**
- **Preferred:** Include all known dependencies in Setup Task (priority 100)
- **Allowed:** Feature tasks CAN add dependencies if absolutely necessary
- **Example:** If a feature needs `date-fns` library, the feature task description can mention: "Add date formatting using date-fns (install if missing)"

CRITICAL: 
- The JSON inside <tasks> tags MUST be valid JSON (no trailing commas, proper quotes)
- Use <tasks> wrapper so the JSON can be reliably extracted

IMPORTANT:
- **Setup Task Decision (CRITICAL):**
  - ✅ Create setup task(s) ONLY if "NEW PROJECT (no existing codebase)" was shown above
  - ❌ DO NOT create setup task if "EXISTING CODEBASE DETECTED" was shown above
  - ❌ DO NOT create setup task if fileList shows ANY files
  - ❌ DO NOT create setup task to "fix" missing entry points (that's a feature task)
- **Repository Structure & Setup Tasks:**
  - FIRST: Decide monorepo vs monolithic based on project characteristics (see above)
  - Monorepo → Multiple setup tasks (root + each package/app)
  - Monolithic → Single setup task
  - Language-agnostic: Don't mention specific files
  - Assign sequential priorities (100, 101, 102, ...)
- **Task Granularity:**
  - Setup = infrastructure/configuration
  - Features = user-facing functionality
  - Each task must have unique id (kebab-case)
- **Final Verification:**
  - ✅ Include if there are feature tasks
  - ❌ Skip if ALL tasks are error tasks

**Output Format:**

1. Output tasks as JSON array in <tasks> tags (NO markdown code blocks!):

<tasks>
[
  {
    "id": "task-1",
    "name": "Task name",
    "description": "Task description",
    "type": "setup|feature|error",
    "priority": 100
  }
]
</tasks>

2. **ALWAYS output <references> tags after <tasks> (REQUIRED, even if empty!):**

<references>
[
  { "project": "ant-pong-be", "branch": "feature/skeleton" }
]
</references>

**CRITICAL:**
- ⚠️ **ALWAYS output <references> tag, even if empty array**
- If no references → output `<references>[]</references>`
- Use XML tags directly, NOT inside markdown code blocks
- NO ```xml or ``` markers
- Just raw XML tags with JSON content inside

**Reference extraction rules:**
- If directive mentions: "ant-pong-be skeleton" → `{ "project": "ant-pong-be", "branch": "feature/skeleton" }`
- If directive mentions: "ant-pong-be main" → `{ "project": "ant-pong-be", "branch": "main" }`
- If directive mentions: "ant-pong-be" (no feature) → `{ "project": "ant-pong-be" }` (omit branch = use default)
- Feature names automatically become `feature/{name}` branches
- Common patterns:
  - "참고: ant-pong-be/skeleton" → project: ant-pong-be, branch: feature/skeleton
  - "@ref ant-pong-be skeleton" → project: ant-pong-be, branch: feature/skeleton
  - "백엔드(ant-pong-be)의 skeleton 피처" → project: ant-pong-be, branch: feature/skeleton

**Example output:**
```
<tasks>[...]</tasks>

<references>
[
  { "project": "ant-pong-be", "branch": "feature/skeleton" }
]
</references>
```


