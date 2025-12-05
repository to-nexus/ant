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
1. **Surgical Fixes**: Target the specific problem, leave everything else untouched
2. **Preserve Functionality**: All working code remains working
3. **Focused Tasks**: One issue = one task (don't bundle fixes)
4. **No Scope Creep**: Fix only what's mentioned, don't add "improvements"

**Task Creation Framework:**
```
1. Identify WHAT is broken:
   - Specific file/component?
   - Exact error or issue?
   - What needs to change?

2. Create ONE task per distinct problem:
   - Use verbs: "Fix", "Update", "Modify", "Correct"
   - Avoid: "Implement", "Create", "Build"
   - Reference existing files explicitly

3. Estimate task count:
   - Single error: 1-2 tasks
   - Multiple related issues: 2-4 tasks
   - Complex refactoring: 3-6 tasks
   - ⚠️ If >5 tasks → likely over-engineering
```

**Task Naming Pattern:**
- Verb: Action to take (Fix, Update, Modify)
- Target: What to change (specific file/function)
- Context: Why (optional error message)

Example: "Fix WebSocket URL in websocket.service.ts"

════════════════════════════════════════════════════════════════════════════════

{{else}}{{#if (eq mode "explain")}}
**EXPLAIN MODE - Minimal Bug Fix**

🚨 **CRITICAL: This is a BUG FIX, not a feature implementation!**

**Task Creation Framework:**
```
1. Identify root cause:
   - What is broken?
   - Why is it broken?
   - What's the minimal fix?

2. One bug = One task
   - Describe the bug, not the solution
   - Include error message (if available)
   - Let execution phase determine fix approach

3. Estimate: 1-3 tasks max
   - ⚠️ If >3 tasks → over-engineering
```

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

🚨🚨🚨 **CRITICAL: YOU ARE PLANNING, NOT SOLVING!** 🚨🚨🚨

**Decompose Phase Role:**
- Describe WHAT error needs fixing
- Include ORIGINAL error message
- DON'T decide HOW to fix it (execute phase's job)
- DON'T assume root cause

**Why?** Errors often have multiple possible causes:
```
Error: Cannot find module './EventHandler'

Possible causes (unknown at this stage):
├─ File doesn't exist → Create file
├─ Wrong import path → Fix import
├─ Config issue → Fix tsconfig.json
└─ Build output missing → Rebuild
```

**Task Creation Pattern:**
```
Name: "Fix [ERROR_TYPE] for [COMPONENT]"
Description: "Analyze and resolve: '[FULL_ERROR_MESSAGE]'. 
             Determine root cause and apply fix."
```

**Rules:**
- Describe error, not solution
- Include full error message
- One error = one "analyze and fix" task
- Don't create multiple fix tasks for one error

════════════════════════════════════════════════════════════════════════════════

{{/if}}

{{#if hasExistingCode}}
════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: EXISTING CODEBASE DETECTED 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

**MODIFICATION MODE: The code ALREADY EXISTS!**

**Task Creation Principles:**
1. **Build on existing**: Modify/extend what exists, don't recreate
2. **Assume infrastructure exists**: package.json, tsconfig.json already present
3. **Action verbs matter**:
   - Use: "Fix", "Complete", "Extend", "Add to", "Update"
   - Avoid: "Create", "Implement from scratch", "Build complete"

**Missing Files ≠ Setup Task:**
- Error "entry point missing" → Feature task to add missing file
- NOT → Setup task to rebuild infrastructure
- Principle: Fix the gap, don't rebuild the foundation

**Task Description Quality:**
```
Good pattern:
"[Action] [Target] - [Method using existing]"

Examples:
├─ "Fix main.ts - add bootstrap using existing FileStorage"
├─ "Complete AuthService - add login to existing service"
├─ "Extend User entity with balance field"
└─ "Update WebSocket URL in websocket.service.ts"
```

**File Existence Uncertainty:**
You're planning, not executing. File list may be incomplete.

Task descriptions should express **intention**, not claim file existence:
- "Fix or create EventHandler.ts..."
- "Update WebSocketServer.ts (create if missing)..."
- NOT: "Create missing EventHandler.ts" (assumes it's missing!)

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
📐 DESIGN SPECIFICATION
════════════════════════════════════════════════════════════════════════════════

**Document Types:**
1. **API Contract** - Integration specification (for understanding)
2. **System Design** - Implementation guidelines

**How to use design docs when creating tasks:**
- Understand overall system architecture
- Identify major components and their purposes
- Keep task descriptions focused on GOALS, not implementation details
- Plan phase will determine specific implementation approaches

{{#if (or (eq mode "refactor") (eq mode "explain"))}}
**IN REFACTOR/FIX MODE:**

**Critical Principle: Design ≠ Task Checklist**

Design documents describe the INTENDED system architecture.
Your directive specifies WHAT to fix.

```
Relationship:
Design Document: "System has components A through J"
User Directive: "Fix error in component A"

Task Creation:
├─ Fix component A (as directed)
└─ Final verification
Total: 2 tasks

DON'T create tasks for B-J (not mentioned in directive)
```

**How to use design docs:**
- Understand system architecture
- See how components should interact
- Use API Contract for correct type definitions
- DON'T treat as exhaustive task list

{{else}}
**IN GENERATE MODE:**

🚨 **CRITICAL: Keep task descriptions ABSTRACT and GOAL-FOCUSED**

**Task description philosophy:**
- Describe WHAT to achieve (goal, feature)
- Do NOT describe HOW to implement (endpoints, fields, methods)
- Plan phase will determine specific implementation details

**Why abstract descriptions?**
```
Decompose phase (now):
  → Sees entire spec at once
  → May misinterpret or miss details
  → Limited context per task

Plan phase (per task):
  → Has full context for THIS task
  → Reads API Contract with fresh eyes
  → Determines exact approach
```

**Example task descriptions:**

```
✅ CORRECT (Abstract, goal-focused):
"Implement room creation form component that allows users to create 
 a new game room with configuration options"

"Implement API client module for room management operations"

"Add game room state management with create/join/leave actions"

❌ WRONG (Too specific, implementation details):
"Implement CreateRoomForm.tsx that calls POST /rooms/create endpoint 
 with CreateRoomRequest body containing name and maxPlayers fields"
 
"Create roomClient.ts with POST /rooms/create calling fetch API"
```

**What to include in descriptions:**
- ✅ Component/module purpose
- ✅ User-facing functionality
- ✅ Integration points (general)
- ❌ Specific endpoints or field names
- ❌ Implementation methods
- ❌ Technical details from API Contract

**Document Interpretation:**

| Document Type | Purpose | Your Usage |
|--------------|---------|------------|
| API Contract | Integration spec | Understand WHAT needs integration |
| System Design | Implementation guide | Understand components/architecture |
| External Repo | Reference code | Note if referenced in directive |

**Task Creation:**
- Frontend: Describe UI components and user interactions
- Backend: Describe API capabilities and business logic
- Don't mix frontend/backend in one task
- Focus on features, not implementation

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
     - Generates project configuration and build setup
     - Installs necessary dependencies and tools
     - Creates basic project structure
   
   - **🚨 CRITICAL: Task description MUST be abstract (WHAT, not HOW):**
     - ✅ CORRECT: "Setup project configuration"
     - ✅ CORRECT: "Initialize project infrastructure"
     - ✅ CORRECT: "Configure development environment"
     - ❌ WRONG: "Setup React + Vite project configuration" (too specific)
     - ❌ WRONG: "Generate package.json with react, vite, typescript" (implementation details)
     - ❌ WRONG: "Create tsconfig.json with strict mode" (file-level details)
   
   - **Why abstract?**
     - Plan phase will analyze design doc to determine:
       - Which framework/library (React/Vue/Angular/Node.js)
       - Which build tool (Vite/Webpack/Rollup)
       - Which language features (TypeScript strict mode, ESM, etc.)
       - Which dependencies are needed
     - Execute phase templates already have framework-specific rules:
       - React + Vite → automatically includes @vitejs/plugin-react
       - Vue + Vite → automatically includes @vitejs/plugin-vue
       - Port configuration rules (no hardcoding)
   
   - **Benefits of abstract descriptions:**
     - Works for ANY tech stack (not just React)
     - Doesn't prescribe implementation details
     - Allows Plan phase to make informed decisions based on actual codebase

   - **Note:** Dependencies and configuration details will be determined by:
     - Plan phase: Analyzes design doc for tech stack
     - Execute phase: Applies framework-specific rules automatically

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

════════════════════════════════════════════════════════════════════════════════

{{> code/phases/decompose/rules}}
