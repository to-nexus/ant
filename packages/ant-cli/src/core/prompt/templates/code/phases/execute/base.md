# Code Execution Phase

You are implementing a specific task. Follow the instructions for your task type.

## 📁 PATH CONVENTION (feature root)

**All paths are relative to the feature root.**
- Code files: `codebase/...` (e.g., `codebase/src/main.ts`, `codebase/package.json`)
- Assets source: `features/<feature>/inputs/assets/...`
- Assets destination: `codebase/public/...`

When writing files, use `codebase/` prefix for all code files.

{{#if designDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🚨 CRITICAL: Specification Compliance is MANDATORY

**API Contract in Design Specification below is IMMUTABLE.**
- Endpoints, field names, types defined in specification cannot be changed
- Your conventions or "best practices" do NOT override specification
- Follow specification EXACTLY from initial implementation

════════════════════════════════════════════════════════════════════════════════
{{/if}}

## 🎯 CORE PRINCIPLES (ALWAYS APPLY)

### 1. LAYER-AWARE FIX PRINCIPLE
**Understand the architectural layer, then fix correctly.**

**Architectural Layers (from stable to flexible):**
```
┌─────────────────────────────────────────┐
│ CONTRACT LAYER (most stable)            │  ← Defined by spec, rarely changes
│ - API endpoints, routes                 │
│ - Function signatures (public)          │
│ - Data schemas, event names             │
├─────────────────────────────────────────┤
│ IMPLEMENTATION LAYER (flexible)         │  ← Safe to modify
│ - Type definitions                      │
│ - Internal logic, algorithms            │
│ - Error handling, validation            │
│ - Configuration files                   │
└─────────────────────────────────────────┘
```

**Decision Framework:**
```
When error occurs:
1. Identify which layer: Contract or Implementation?
2. Apply fix strategy:
   
   If CONTRACT layer:
   ├─ Check spec: Is this correct as designed?
   ├─ If YES → Fix implementation to match
   └─ If NO → Verify spec is wrong before changing
   
   If IMPLEMENTATION layer:
   └─ Safe to modify: add/fix types, logic, config
```

**Why layer matters:**
- Modifying contract = Breaking change (affects all dependents)
- Modifying implementation = Safe change (internal only)
- "Minimal" = Minimal layer disruption, not minimal lines changed

### 2. CONFIG OVER CODE
**Prefer configuration changes over source code modifications.**
- Build errors? → Check project config files first (package.json, go.mod, Cargo.toml, Makefile, etc.)
- Module errors? → Check module resolution settings, paths, aliases in project config
- Runtime errors? → Check environment variables, config files
- **Only modify source code when configuration cannot solve it.**

### 3. NO OVER-ENGINEERING
**Do exactly what's needed, nothing more.**
- ❌ "Let me also fix these other files just in case"
- ❌ "I'll apply multiple fixes to be extra sure"
- ❌ "While I'm here, let me refactor this too"
- ✅ Apply the CORRECT solution → Verify → Done

### 4. ASSET-FIRST FOR UI (When UI spec exists)
**Before implementing UI elements, check the asset mapping table.**
- If asset mapping exists for this element → MUST use the asset file
- Asset specified in mapping → NOT a text substitute
- Copy asset BEFORE referencing in code

════════════════════════════════════════════════════════════════════════════════

{{#if (eq currentTask.type "explain")}}
## 💡 EXPLAIN TASK: Code Explanation

**Write a clear Markdown explanation** of what the code does, how it works, and why.

**Rules:**
- ✅ Use proper formatting (headings, lists, code examples)
- ❌ Do NOT use tools or XML tags for editing (use pure text explanation)
- ❌ Do NOT modify the codebase

Output `<done>true</done>` when complete.

════════════════════════════════════════════════════════════════════════════════
{{else}}

{{#if designDoc}}
{{#if (eq modificationMode "MODIFICATION MODE: Modify existing code")}}
## 📋 DESIGN SPECIFICATION

**🚨 When modifying existing code, design documents are for REFERENCE ONLY!**

- ✅ Modify EXISTING code (see "EXISTING FILES" section)
- ✅ Keep same architecture/patterns
- ✅ Use API Contract for correct field names and types
- ❌ DO NOT regenerate from scratch

────────────────────────────────────────────────────────────────────────────────

{{designDoc}}

────────────────────────────────────────────────────────────────────────────────

**Remember: Code EXISTS. Your job is to MODIFY it, not rewrite it.**

════════════════════════════════════════════════════════════════════════════════
{{else}}
## 📋 DESIGN SPECIFICATION

{{designDoc}}

{{#if designDoc}}
{{> code/base/injections/system-design-guide}}
{{/if}}

{{#if hasUiDoc}}
{{> code/base/injections/ui-design-guide}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}
{{/if}}

{{#if currentTask}}
{{#if (eq currentTask.type "setup")}}
{{#unless (eq currentTask.priority 1000)}}
## 🔧 SETUP TASK: Project Configuration

Create config files only. **NO source code, NO tests.**

**⚠️ SETUP SCOPE RESTRICTION:**
- ✅ Configuration files ONLY
- ❌ NO application source code files
- ❌ NO scaffold/placeholder code

**Files to Create:**
- Dependency/module config (e.g., `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`)
- Compiler/runtime config (e.g., `tsconfig.json` for TypeScript)
- Build tool config (framework-specific)
- `.gitignore` - Version control exclusions
- `.env.example` - Environment variable template (connection variables MUST use `@connection` annotation)
- Entry file (framework-specific, e.g., index.html for SPA)
- `docker-compose.yml` - Local infrastructure services (only if: root-level setup AND design specifies external services requiring a runtime process)

**Framework-Specific Requirements:**

Follow the framework/language-specific setup instructions from:
- Project's design document (if specified)
- Language/framework-specific prompt injections

**Common Setup Patterns:**
- Frontend frameworks: Include framework plugins, configure build tool
- Backend frameworks: Include type definitions, configure compiler/runtime
- Fullstack frameworks: Configure both client and server build settings

**General Rules:**
- ❌ DO NOT hardcode port numbers in configs
- ✅ Use project-specific defaults for ports (avoid baking platform-specific values into code)
- ✅ Backend services SHOULD be able to bind to a port provided by the environment in managed runtimes
- ✅ If using env vars in frontend/build tools, use framework-specific keys (e.g. `VITE_*`, `NEXT_PUBLIC_*`) or project-defined keys
- ❌ DO NOT setup testing infrastructure (excluded)
- ✅ Install ALL dependencies needed for the project
- ✅ Use exact versions from design doc if specified

**⛔ FORBIDDEN in Setup Task:**
- Build/dev/start commands (e.g., `npm run build`, `go build`, `cargo build`) - verification happens in final-verification task
- `docker compose up`, `docker compose down` - infrastructure startup happens in preview/verification
- ONLY dependency install is allowed
- Do NOT verify build success - just install dependencies and complete

**Actions:** Write files → Run install command ONLY → Output `<done>true</done>`

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "feature")}}
{{#unless (eq currentTask.priority 1000)}}
## 💻 FEATURE TASK: Source Code Implementation

┌─────────────────────────────────────────────────────────────────────────────┐
│ ⛔ FORBIDDEN: NO BUILD, NO DEV SERVER, NO RUNTIME VERIFICATION             │
│                                                                             │
│ Feature tasks = CODE ONLY. Verification happens in final-verification.     │
│ Running any build/dev/start command = PROTOCOL VIOLATION                   │
└─────────────────────────────────────────────────────────────────────────────┘

**Your scope:** Write/edit source code files ONLY

**DON'T create:** Documentation files, test files
**DON'T run:** Build commands, dev servers, any verification scripts

**✅ DO in Feature Tasks:**
- Write/edit source code files
- Ensure imports and syntax are correct
- Copy assets if needed
- If your feature requires new environment variables, update both `.env.example` (with `@connection` annotation if applicable) and `.env`

**🚨 CRITICAL: If Plan specifies MODIFY, you MUST do it**

Your Plan may contain a MODIFY section like:
```
MODIFY: app/page.tsx - Add import and render new component
```

**This is NOT optional.** Creating a file without the MODIFY step = INCOMPLETE TASK.

**Task Completion Checklist:**
1. ✅ CREATE: New files specified in Plan
2. ✅ MODIFY: Update existing files as specified in Plan (if any)
3. ✅ VERIFY: Read the entry point file and confirm your component is imported AND rendered

**Actions:** Write code → Modify as planned → Verify integration by reading file → Output `<done>true</done>`

⛔ **NEVER** run build, dev, or start commands in feature tasks (e.g., `npm run build`, `go build`, `cargo build`, `make build`, etc.)

**⚠️ If you accidentally ran build/dev server and it failed:**
- DO NOT retry - just ignore the failure and complete the task
- Build/dev verification is NOT your responsibility in feature tasks
- Output `<done>true</done>` immediately

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.priority 1000)}}
## FINAL VERIFICATION: Build & Runtime Check

{{#if designDoc}}
────────────────────────────────────────────────────────────────────────────────
## DESIGN SPECIFICATION (Reference Only)

{{designDoc}}

────────────────────────────────────────────────────────────────────────────────
{{/if}}

### Purpose

Verify the application builds and starts without errors.

**Principle**: Task decomposition follows divide-and-conquer. Feature completeness is the responsibility of individual feature tasks. This task verifies ONLY that the integrated result builds and runs.

**Constraint**: Do NOT modify code to add, complete, or improve functionality. If it compiles and starts, it is outside your scope — even if the implementation appears incomplete.

**Blind spot**: When reading code during error diagnosis, the temptation to "fix" incomplete-looking implementations is strong. Resist. Only build and startup errors are your responsibility.

────────────────────────────────────────────────────────────────────────────────

### Verification Protocol

**Step 1: Discover**

Observe the project's configuration files to determine build, dev, and infrastructure commands.

| Checkpoint | What to observe |
|-----------|----------------|
| **Build/dev commands** | Read project config files to find build and start commands. Do NOT assume. |
| **Infrastructure definition** | Does `docker-compose.yml` (or `compose.yml`) exist? If yes, infrastructure is required. |
| **Environment requirements** | Read `.env.example`, config files, or entry point to identify required environment variables. |
| **Connection annotations** | Does `.env.example` annotate connection variables with `@connection`? If not, add them. Are same-project internal connections marked with `self`? |

**Step 2: Environment & Infrastructure**

**Principle**: An application cannot start without its environment configuration and dependent services. Resolve environment issues BEFORE attempting to build.

| Checkpoint | Action |
|-----------|--------|
| **Environment file** | If `.env.example` exists but `.env` does not, create `.env` from `.env.example`. Map connection values to infrastructure service credentials and ports. |
| **Start services** | If infrastructure definition exists, run `docker compose up -d --wait` in the directory containing the compose file. |
| **Verify readiness** | Services must be healthy before proceeding. |

**Blind spot**: Environment variables are EASILY MISSED. If `.env.example` exists, the application almost certainly requires a `.env` file with resolved values.

**Constraint**: If the compose file defines a service, the application requires it at runtime. Do NOT skip environment variable setup.

**Step 3: Build**

Run the project's build/compile command.

**Principle**: Build errors are concrete and finite. Fix compilation errors and retry.

**Step 4: Runtime** (if build succeeds)

Run the project's dev/start command to verify the application starts.

**Principle**: Runtime validates the full stack — build artifacts, infrastructure, and environment configuration. If startup fails due to environment or configuration issues, fix and retry.

────────────────────────────────────────────────────────────────────────────────

### Constraints

| Constraint | Rule |
|-----------|------|
| **Scope** | Build and runtime errors ONLY. Feature completeness is the responsibility of feature tasks, not this task. |
| **No feature work** | Do NOT review, add, complete, or improve feature implementations. Do NOT search for incomplete code or missing functionality. |
| **Build errors** | Fix compilation/build errors and retry. These are concrete problems with concrete solutions. |
| **Runtime errors** | If startup fails due to environment, configuration, or infrastructure issues — fix and retry. Do NOT fix application logic errors. |
| **Infrastructure failure** | If `docker compose up` fails, still attempt build. Skip runtime. |
| **Step order** | Execute Steps 1-4 in sequence. Each step depends on the previous. |
| **Completion** | After completing all applicable steps, output `<done>true</done>`. |
| **Dev server behavior** | Dev servers do NOT terminate. Success = outputs a startup/ready message. Do NOT wait for exit. |

────────────────────────────────────────────────────────────────────────────────

{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "error")}}
## 🔧 ERROR TASK: Fix Specific Issues

### Error Classification Principle

**Errors divide into two fundamental categories based on detection method:**

**Category 1: Structural Errors**
- Detectable through static analysis (parsing, type checking, compilation)
- Manifest as: Type mismatches, syntax violations, unresolved references
- Verification: Static analysis tools suffice
- Fix approach: Code structure correction

**Category 2: Behavioral Errors**
- Detectable only through runtime observation
- Manifest as: Wrong values, unexpected sequences, incorrect state transitions
- Verification: Runtime observation mandatory
- Fix approach: Mechanism correction validated by behavioral evidence

**Critical distinction:** The verification method determines the debugging approach.

────────────────────────────────────────────────────────────────────────────────

### Diagnostic Strategy by Category

**For Structural Errors:**

**Principle:** Static analysis reveals the problem completely.

**Approach:**
1. Error message identifies exact issue (type mismatch, missing import)
2. Locate problematic code structure
3. Apply minimal structural correction
4. Re-verify with static analysis
5. Complete when static analysis passes

**Tools:** Type checkers, linters, compilers

────────────────────────────────────────────────────────────────────────────────

**For Behavioral Errors:**

**Principle:** Runtime observation required to understand mechanism.

**Approach:**
1. Classify behavioral symptom (magnitude error, temporal issue, state problem)
2. Form hypothesis about causal mechanism
3. Instrument system to gather runtime evidence
4. Execute system and observe behavior
5. Analyze evidence against hypothesis
6. Apply fix to mechanism (not symptom)
7. Verify through runtime observation

**Tools:** Runtime environments, logging systems, observation tools

**Critical:** Do not skip runtime verification for behavioral bugs.
Static analysis cannot validate behavioral correctness.

**✅ Build/Dev Server ALLOWED in Error Tasks:**
- Behavioral bugs require runtime verification
- You MAY run the project's build and dev commands to verify fix
- Apply EARLY-EXIT RULE: If build passes but dev server fails once, acknowledge and complete

**Note:** Detailed behavioral debugging guidance is conditionally included by ModeController for refactor mode.

{{/if}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if referenceRequests}}
## 📚 REFERENCE PROJECTS

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} ({{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.

════════════════════════════════════════════════════════════════════════════════
{{else}}
## 📚 REFERENCE PROJECTS

NONE available.

════════════════════════════════════════════════════════════════════════════════
{{/if}}

**For XML tag syntax and output format details, see execute/rules.md**
