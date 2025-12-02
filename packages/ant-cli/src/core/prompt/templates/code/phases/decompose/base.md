You are analyzing a software specification to break it into executable tasks.

SPECIFICATION:
{{spec}}

{{#if mode}}
════════════════════════════════════════════════════════════════════════════════
🎯 WORK MODE: {{mode}} {{#if modeConfidence}}(Confidence: {{modeConfidence}}){{/if}}
════════════════════════════════════════════════════════════════════════════════

{{#if (eq mode "refactor")}}
**REFACTOR MODE - Fix/Improve Existing Code**

🚨 **CRITICAL: You are FIXING existing code, NOT building from scratch!**

**CORE PRINCIPLES:**
1. **Minimal Changes**: Make ONLY the changes needed to fix the stated problem
2. **Preserve Working Code**: DO NOT recreate components that already work
3. **Focused Tasks**: Create tasks ONLY for the specific issues mentioned
4. **No Feature Creep**: DO NOT add features not mentioned in the directive

**TASK CREATION RULES:**
1. **Identify the EXACT problem**:
   - Which specific file/component is broken?
   - What is the EXACT error or issue?
   - What needs to change (be specific: file, function, line)?

2. **Create ONE task per distinct issue**:
   - ✅ GOOD: "Fix WebSocket URL in websocket.service.ts line 39"
   - ❌ BAD: "Implement WebSocket system and fix URL"
   
3. **Use focused action verbs**:
   - ✅ Use: "Fix", "Update", "Modify", "Correct", "Adjust", "Change"
   - ❌ Avoid: "Implement", "Create", "Build", "Develop", "Design"

4. **Reference existing files explicitly**:
   - ✅ GOOD: "Fix getWebSocketURL() in websocket.service.ts"
   - ❌ BAD: "Implement WebSocket connection logic"

**WHAT TO AVOID:**
- ❌ DO NOT bundle multiple fixes into one task
- ❌ DO NOT add "improvements" not mentioned in directive
- ❌ DO NOT recreate working infrastructure
- ❌ DO NOT redesign the architecture
- ❌ DO NOT add features "while we're at it"

**EXPECTED TASK COUNT:**
- Single error/bug: 1-2 tasks
- Multiple related issues: 2-4 tasks
- Complex refactoring: 3-6 tasks
- ⚠️ If you're creating >5 tasks in refactor mode, you're probably over-engineering!

════════════════════════════════════════════════════════════════════════════════

{{else}}{{#if (eq mode "explain")}}
**EXPLAIN MODE - Minimal Bug Fix**

🚨 **CRITICAL: This is a BUG FIX, not a feature implementation!**

**CORE PRINCIPLES:**
1. **Root Cause**: Identify the EXACT cause of the issue
2. **Minimal Fix**: Change ONLY what's necessary
3. **Preserve Behavior**: Keep everything else unchanged

**TASK CREATION RULES:**
1. **Focus on the bug**:
   - What is broken?
   - Why is it broken?
   - What's the minimal fix?

2. **One bug = One task**:
   - ✅ GOOD: "Fix null pointer in validateInput() function"
   - ❌ BAD: "Refactor validation system and fix null pointer"

**EXPECTED TASK COUNT:**
- Single bug: 1 task
- Related bugs: 2-3 tasks
- ⚠️ If you're creating >3 tasks in explain mode, you're over-engineering!

════════════════════════════════════════════════════════════════════════════════

{{else}}{{#if (eq mode "generate")}}
**GENERATE MODE - New Implementation**

**CREATION MODE: Build from scratch**

You are implementing new features based on the specification.
Follow the guidelines below for creating tasks.

════════════════════════════════════════════════════════════════════════════════

{{/if}}{{/if}}{{/if}}
{{/if}}

{{#if hasErrorInDirective}}
════════════════════════════════════════════════════════════════════════════════
🚨 ERROR DETECTED IN DIRECTIVE
════════════════════════════════════════════════════════════════════════════════

**ERROR FIX MODE ACTIVATED**

**CRITICAL INSTRUCTIONS:**

1. **Analyze the error message**:
   - What EXACTLY is failing?
   - Which file/line is the error from?
   - What is the error message saying?

2. **Identify the minimal fix**:
   - What is the ONE thing that needs to change?
   - Can this be fixed by changing a single value/config/line?
   - Is this a typo, wrong URL, missing import, or similar simple fix?

3. **Create a FOCUSED task**:
   - Task name: State the EXACT fix in 5-10 words
   - Task description: Specify the exact file, line, and change needed
   - DO NOT add "and also..." or "plus..." in the description
   - ONE task = ONE fix

4. **DO NOT over-engineer**:
   - ❌ Wrong: "Error: URL incorrect" → "Rebuild networking infrastructure"
   - ✅ Right: "Error: URL incorrect" → "Fix URL constant in config.ts"
   - ❌ Wrong: "Import missing" → "Restructure module system"
   - ✅ Right: "Import missing" → "Add missing import statement"

**EXAMPLES OF GOOD ERROR FIX TASKS:**

Example 1 - URL Error:
```
Task: "Fix WebSocket Connection URL"
Description: "Update websocket.service.ts line 39: Change URL from 'ws://localhost:5173/game' to 'ws://localhost:3000/ws' to match backend server port and endpoint."
```

Example 2 - Import Error:
```
Task: "Add Missing React Import"
Description: "Add 'import React from \"react\"' at the top of Button.tsx to fix 'React is not defined' error."
```

Example 3 - Config Error:
```
Task: "Fix API Base URL in Config"
Description: "Update API_BASE_URL in config/api.ts from 'http://localhost:8080' to 'http://localhost:3000' to match actual server port."
```

════════════════════════════════════════════════════════════════════════════════

{{/if}}

{{#if hasExistingCode}}
════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: EXISTING CODEBASE DETECTED 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

**MODIFICATION MODE: The code ALREADY EXISTS!**

**YOU MUST:**
- ✅ Create tasks to MODIFY/FIX/COMPLETE existing code
- ✅ Assume infrastructure (package.json, tsconfig.json) already exists
- ✅ Build upon existing files shown below
- ✅ Use verbs: "Fix", "Complete", "Extend", "Modify", "Add to existing"
- ❌ DO NOT create "Setup Task (priority 100)"
- ❌ DO NOT create tasks to "initialize" or "bootstrap" the project
- ❌ DO NOT recreate existing infrastructure
- ❌ DO NOT use verbs: "Create entire", "Implement from scratch", "Build complete"

**If you see errors like "entry point missing" or "module not found":**
- These are BUG FIX tasks (priority 200+), NOT setup tasks
- Create ONE focused task to fix the specific missing file
- DO NOT recreate the entire project infrastructure
- Example: "Fix: Add missing main.ts entry point" (NOT "Create NestJS entry point and bootstrap")

**Task Description Guidelines for Existing Code:**
- ✅ GOOD: "Fix missing main.ts - add NestJS bootstrap using existing FileStorage"
- ✅ GOOD: "Complete AuthModule - implement login using existing storage layer"
- ✅ GOOD: "Extend FileStorage to support User and Balance entities"
- ❌ BAD: "Implement AuthModule for CROSS wallet authentication" (sounds like from scratch)
- ❌ BAD: "Create repositories using existing FileStorage" (too broad, sounds like full implementation)
- ❌ BAD: "Implement AppModule to wire all modules together" (sounds like new project)

**Remember: The code exists. You're FIXING/COMPLETING it, not building from scratch!**

{{#if fileList}}
Existing files:
```
{{fileList}}
```
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{else}}
════════════════════════════════════════════════════════════════════════════════
🆕 NEW PROJECT (no existing codebase)
════════════════════════════════════════════════════════════════════════════════

**CREATION MODE: Build from scratch**

- ✅ Create "Setup Task (priority 100)" if needed
- ✅ Create infrastructure and configuration files

════════════════════════════════════════════════════════════════════════════════

{{/if}}

{{#if designDoc}}
════════════════════════════════════════════════════════════════════════════════
📐 DESIGN DOCUMENT (REFERENCE ONLY)
════════════════════════════════════════════════════════════════════════════════

**⚠️ CRITICAL: Design document is for REFERENCE, not a TODO list!**

{{#if (or (eq mode "refactor") (eq mode "explain"))}}
**IN REFACTOR/FIX MODE:**

The design document describes the INTENDED architecture. Your task is to:
- ✅ Fix specific issues mentioned in the directive
- ✅ Use design doc to understand context and architecture
- ❌ DO NOT create tasks for every component in design doc
- ❌ DO NOT use design doc as a checklist of things to implement

**CRITICAL DISTINCTION:**
```
Design Doc:        "System has 10 components (A, B, C, D, E, F, G, H, I, J)"
User Directive:    "Fix error in component A"

✅ CORRECT TASKS:
   - Fix error in component A (1 task)
   - Final verification (1 task)
   Total: 2 tasks

❌ WRONG TASKS:
   - Implement component A (rebuilding)
   - Implement component B (not mentioned!)
   - Implement component C (not mentioned!)
   ...
   - Implement component J (not mentioned!)
   - Fix error in component A (finally!)
   Total: 11 tasks (9 unnecessary!)
```

**HOW TO USE DESIGN DOC:**
1. Read it to understand the system architecture
2. Use it to understand how components should interact
3. Reference it when making fixes to ensure consistency
4. **DO NOT use it as a task list!**

{{else}}
**IN GENERATE MODE:**

The design document is your implementation guide:
- ✅ Create tasks to implement components described in design
- ✅ Follow the architecture and structure outlined
- ✅ Use it as a blueprint for what to build

**DOCUMENT STRUCTURE GUIDE:**

The design document may contain multiple sections for different parts:
- **API Contract**: Binding specification for FE/BE integration (exact field names, types, endpoints)
- **Frontend System Design**: How frontend consumes APIs (components, state, routing, UI)
- **Backend System Design**: How backend implements APIs (controllers, services, database)

**When creating tasks:**
- ✅ Frontend tasks should focus on components, state management, API consumption
- ✅ Backend tasks should focus on endpoints, business logic, data persistence
- ✅ Both should reference the API contract for exact field names and types
- ❌ DO NOT mix frontend and backend concerns in a single task
- ❌ DO NOT duplicate API contract definitions (they're already defined)

{{/if}}

{{designDoc}}

════════════════════════════════════════════════════════════════════════════════

{{/if}}

YOUR TASK:
Break this specification into a prioritized list of implementation tasks.

⚠️  CRITICAL: READ THE SPECIFICATION CAREFULLY

**ARCHITECTURE DECISIONS ARE IN THE SPEC - DO NOT INVENT YOUR OWN!**

If the spec says:
- "Repository Pattern with FileSystemRepository" → DO NOT create API/WebSocket server
- "File watcher using chokidar" → DO NOT create HTTP polling
- "Single-machine deployment" → DO NOT create network-based architecture
- "Direct file system access" → DO NOT create REST API layer

**Your job is to IMPLEMENT THE SPEC, not redesign it!**

════════════════════════════════════════════════════════════════════════════════
📚 REFERENCE REPOSITORY DETECTION
════════════════════════════════════════════════════════════════════════════════

**If the directive mentions external repositories to reference** (e.g., backend, API server, other projects):

1. **Identify which repositories to reference**
2. **Extract project name and branch** (if mentioned)
3. **Output in structured format**

**Examples of reference mentions:**
- "ant-pong-be를 참조해서 프론트엔드를 수정"
- "백엔드(ant-pong-be) API 응답 형식 확인"
- "ant-pong-be/feature/skeleton 브랜치를 보고 통합"
- "서버 프로젝트의 엔드포인트를 확인"

**If references detected, output after tasks:**
```xml
<references>
[
  { "project": "ant-pong-be", "branch": "feature/skeleton" },
  { "project": "other-service" }
]
</references>
```

**Rules:**
- Include ONLY if directive explicitly mentions external projects
- Use exact project names from directive
- Include branch if mentioned, otherwise omit
- Empty array if no references: `<references>[]</references>`

════════════════════════════════════════════════════════════════════════════════

GUIDELINES:

## 📋 Task Type Guidelines

**1. Setup Task (priority 100)** - OPTIONAL, create only if needed:
   - **⚠️ CRITICAL: If existing code detected above → SKIP THIS ENTIRELY!**
   - **⚠️ CRITICAL: If mode is "refactor" or "explain" → SKIP THIS ENTIRELY!**
   - **When to create:**
     - ✅ ONLY for new projects with NO existing code AND mode is "generate"
     - ✅ Adding new infrastructure explicitly mentioned in spec (e.g., "add Vite", "add TailwindCSS")
   - **When NOT to create (ABSOLUTE RULES):**
     - ❌ If "EXISTING CODEBASE DETECTED" message shown above
     - ❌ If mode is "refactor" or "explain"
     - ❌ If fileList shows ANY files (even one file means infrastructure exists)
     - ❌ Feature additions with existing infrastructure
     - ❌ Bug fixes or refactoring
     - ❌ Fixing "entry point missing" or similar errors (create feature task instead)
   - **What it does (for NEW projects only):**
     - Generates ONLY config files (package.json, tsconfig.json, build tool configs)
     - **Include ALL known dependencies** for initial project setup
     - Folder structure will be created automatically by feature tasks - don't pre-create empty folders
     - **Note on dependencies:** Setup task should include all dependencies you can anticipate from the spec, but feature tasks CAN add dependencies if absolutely necessary (e.g., new library required for a specific feature)
     - **CRITICAL - Framework-specific requirements:**
       - React + Vite → MUST include `@vitejs/plugin-react` in devDependencies
       - Vue + Vite → MUST include `@vitejs/plugin-vue`
       - Svelte + Vite → MUST include `@vitejs/plugin-svelte`
       - Next.js → React already included, no extra plugin needed
     - **CRITICAL - Dev server ports:**
       - ❌ DO NOT hardcode port numbers in config files
       - ❌ BAD: `server: { port: 3000 }` in vite.config.ts
       - ✅ GOOD: Let CLI options control the port (--port flag)
       - ✅ GOOD: Use environment variable if needed: `port: process.env.PORT || 5173`
   - **CRITICAL - Testing:**
     - ❌ DO NOT mention "testing libraries" or "test setup" in setup task description
     - ❌ DO NOT request creation of jest.config.js, vitest.config.ts, or test setup files
     - Testing infrastructure is explicitly excluded from setup
     - If spec mentions testing: Acknowledge in analysis but don't include in setup task

**2. Feature Tasks (priority 200-899):**
   - Extract features from the specification
   - Each task implements a specific, meaningful feature
   - Focus on WHAT to build (implementation), NOT HOW to verify/test/ensure (validation is automatic)
   
   - **📦 Dependency Management:**
     - **Preferred:** Dependencies are managed in Setup Task (priority 100)
     - **BUT:** Feature tasks CAN modify package.json if absolutely necessary
     - **When to add dependencies in feature tasks:**
       - ✅ New library required for specific feature (e.g., adding `date-fns` for date formatting)
       - ✅ Framework plugin needed for new feature (e.g., adding `@vitejs/plugin-react` if missing)
       - ✅ Missing dependencies causing runtime/compile errors
     - **Keep it minimal:** Only add what's strictly needed for that feature
   
   - **⚠️ IF EXISTING CODE (shown above) OR mode is "refactor"/"explain":**
     - **Task naming convention:**
       - ✅ Use: "Fix", "Complete", "Extend", "Add", "Update", "Modify", "Correct", "Adjust"
       - ❌ Avoid: "Create", "Implement", "Build" (sounds like from scratch)
     - **Reference existing files:**
       - ✅ GOOD: "Fix main.ts - add NestJS bootstrap using existing FileStorage.ts"
       - ✅ GOOD: "Complete AuthService - add login method to existing service"
       - ✅ GOOD: "Extend User entity with balance field"
       - ✅ GOOD: "Update WebSocket URL in websocket.service.ts"
       - ❌ BAD: "Implement AuthModule for authentication" (too broad, sounds new)
       - ❌ BAD: "Create UserService with all CRUD operations" (ignoring existing code)
       - ❌ BAD: "Build complete authentication system" (sounds like from scratch)
     - **One fix per task:**
       - If error is "missing main.ts" → ONE task: "Fix: Add missing main.ts entry point"
       - Don't bundle: "Create entry point AND wire modules AND add auth" → Too much!
     - **Be specific about the fix:**
       - ✅ GOOD: "Fix WebSocket URL: Change from ws://localhost:5173/game to ws://localhost:3000/ws in websocket.service.ts line 39"
       - ❌ BAD: "Fix WebSocket connection issues"
   
   - **IF NEW PROJECT (no code shown) AND mode is "generate":**
     - ✅ Use: "Create", "Implement", "Build"
     - Example: "Create Button component with variants (primary, secondary, outline) and sizes (sm, md, lg)"
   
   - **CRITICAL - Do NOT add unstated requirements:**
     - ❌ DO NOT include features/requirements NOT in the spec (accessibility, testing, analytics, i18n, etc.)
     - ❌ If spec doesn't mention it, don't add it to task descriptions
     - ❌ "Best practices" are NOT requirements unless explicitly stated
     - **Golden Rule**: Only describe what the spec EXPLICITLY asks for
   - Let LLM figure out architecture details - just describe the feature goal

**3. Final Verification Task (priority 1000)** - ALWAYS INCLUDE:
   - **Always add as the last task with priority 1000**
   - Installs dependencies and builds the project to verify everything compiles
   - See `rules.md` for the exact JSON structure
   - All other feature tasks: Focus on implementation only - validation happens here

## 🎯 General Guidelines

**Task Granularity:**
- Not too large: Each task should be independently implementable
- Not too small: Avoid micro-tasks like "Create one file"
- Good size: A feature that delivers value (e.g., "Login system")

**Priority Assignment** (LOWER NUMBER = HIGHER PRIORITY):
- 100: Setup (if needed, only in generate mode)
- 200-219: Critical features/fixes
- 220-249: Important features/fixes
- 250-899: Nice-to-have features
- 1000: Final verification (always last)

**Task Dependencies:**
- Order tasks logically (foundational features before dependent ones)
- System handles errors dynamically - don't over-think dependencies


