You are analyzing a software specification to break it into executable tasks.

SPECIFICATION:
{{spec}}

{{#if hasExistingCode}}
════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: EXISTING CODEBASE DETECTED 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

**MODIFICATION MODE: The code ALREADY EXISTS!**

**YOU MUST:**
- ✅ Create tasks to MODIFY/FIX/COMPLETE existing code
- ✅ Assume infrastructure (package.json, tsconfig.json) already exists
- ✅ Build upon existing files shown below (FileStorage.ts, etc.)
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

Current code structure:
{{codePreview}}

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

GUIDELINES:

## 📋 Task Type Guidelines

**1. Setup Task (priority 100)** - OPTIONAL, create only if needed:
   - **⚠️ CRITICAL: If existing code detected above → SKIP THIS ENTIRELY!**
   - **When to create:**
     - ✅ ONLY for new projects with NO existing code
     - ✅ Adding new infrastructure explicitly mentioned in spec (e.g., "add Vite", "add TailwindCSS")
   - **When NOT to create (ABSOLUTE RULES):**
     - ❌ If "EXISTING CODEBASE DETECTED" message shown above
     - ❌ If codePreview shows ANY files (even one file means infrastructure exists)
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
   
   - **⚠️ IF EXISTING CODE (shown above):**
     - **Task naming convention:**
       - ✅ Use: "Fix", "Complete", "Extend", "Add", "Update", "Modify"
       - ❌ Avoid: "Create", "Implement", "Build" (sounds like from scratch)
     - **Reference existing files:**
       - ✅ GOOD: "Fix main.ts - add NestJS bootstrap using existing FileStorage.ts"
       - ✅ GOOD: "Complete AuthService - add login method to existing service"
       - ✅ GOOD: "Extend User entity with balance field"
       - ❌ BAD: "Implement AuthModule for authentication" (too broad, sounds new)
       - ❌ BAD: "Create UserService with all CRUD operations" (ignoring existing code)
       - ❌ BAD: "Build complete authentication system" (sounds like from scratch)
     - **One fix per task:**
       - If error is "missing main.ts" → ONE task: "Fix: Add missing main.ts entry point"
       - Don't bundle: "Create entry point AND wire modules AND add auth" → Too much!
   
   - **IF NEW PROJECT (no code shown):**
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
- 100: Setup (if needed)
- 200-219: Critical features
- 220-249: Important features
- 250-899: Nice-to-have features
- 1000: Final verification (always last)

**Task Dependencies:**
- Order tasks logically (foundational features before dependent ones)
- System handles errors dynamically - don't over-think dependencies


