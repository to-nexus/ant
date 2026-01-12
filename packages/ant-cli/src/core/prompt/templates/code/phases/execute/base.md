# Code Execution Phase

You are implementing a specific task. Follow the instructions for your task type.

## 📁 PATH CONVENTION (PROJECT ROOT)

**All paths are relative to PROJECT ROOT.**
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
- Build errors? → Check tsconfig.json, package.json first
- Module errors? → Check moduleResolution, paths, aliases
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

{{> code/base/injections/design-document-guide}}

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
- `package.json` - Dependencies and scripts
- `tsconfig.json` (if TypeScript) - Compiler configuration
- Build tool config (framework-specific)
- `.gitignore` - Version control exclusions
- `.env.example` - Environment variable template
- Entry file (framework-specific, e.g., index.html for SPA)

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

**Actions:** Write files → Run install command (check package manager) → Output `<done>true</done>`

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.type "feature")}}
{{#unless (eq currentTask.priority 1000)}}
## 💻 FEATURE TASK: Source Code Implementation

Implement the feature. Source code only.

**DON'T create:** Documentation files, test files

**🚫 DO NOT in Feature Tasks:**
- ❌ DO NOT run build commands
- ❌ DO NOT run development servers
- ❌ DO NOT verify runtime behavior (reserved for FINAL VERIFICATION)

**✅ DO in Feature Tasks:**
- Write/edit source code files
- Ensure imports and syntax are correct

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

**Actions:** Write/edit code → Execute Plan's MODIFY → Verify integration → Output `<done>true</done>`

{{/unless}}
{{/if}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
{{#if (eq currentTask.priority 1000)}}
## ✅ FINAL VERIFICATION: Build & Startup Check

{{#if designDoc}}
────────────────────────────────────────────────────────────────────────────────
## 📋 DESIGN SPECIFICATION

{{designDoc}}

────────────────────────────────────────────────────────────────────────────────
{{/if}}

**🎯 Purpose:** Verify the application builds and starts successfully.

**🔍 Step 1: Discover build/dev commands from project config**

Do NOT assume commands. Read the project's configuration:
- `package.json` → Look for `scripts.build`, `scripts.dev`, `scripts.start`
- `Makefile` → Look for `build`, `dev`, `run` targets
- `Cargo.toml` → `cargo build`, `cargo run`
- `go.mod` → `go build`, `go run`

**The project defines how to build itself. Read it, don't guess.**

**📋 Step 2: Execute verification**

| Phase | Action | Success Criteria |
|-------|--------|------------------|
| **Build** | Run project's build script | Must pass - PRIMARY verification |
| **Dev Server** | Run project's dev/start script | Server outputs ready message |

**⚠️ CRITICAL: Dev Server is a Long-Running Process**

Dev servers do NOT terminate naturally. This is expected.
- Success = Server outputs startup/ready message
- Do NOT wait for process to exit
- Do NOT retry indefinitely

**⚠️ EARLY-EXIT RULE: If Build Passes but Dev Server Has Issues**

```
✅ Build → SUCCESS
❌ Dev Server → Has issues (compilation, hot-reload, etc.)
```

**When this happens:**
1. **DO NOT retry dev server more than ONCE** after build success
2. Build is the deployment artifact - it's the primary indicator
3. Complete the task:
   ```
   ✅ Build verification passed.
   ⚠️ Dev server has framework-specific issues - not blocking.
   ```
4. Output `<done>true</done>`

**Completion Criteria:**
- ✅ Build succeeds (REQUIRED)
- ⚠️ Dev server succeeds OR issues acknowledged (ACCEPTABLE)

**Actions:** Discover commands → Run build → Run dev once → Output `<done>true</done>`

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

Use `search_reference_code` tool ONLY for projects listed above. Read-only access.

════════════════════════════════════════════════════════════════════════════════
{{else}}
## 📚 REFERENCE PROJECTS

NONE available. Do NOT use `search_reference_code` tool.

════════════════════════════════════════════════════════════════════════════════
{{/if}}

**For XML tag syntax and output format details, see execute/rules.md**
