## OUTPUT FORMAT

**CRITICAL: You MUST use XML tags for ALL file operations!**

════════════════════════════════════════════════════════════════════════════════
## XML Tag Reference
════════════════════════════════════════════════════════════════════════════════

### Scenario 1: Creating New Document (First Task)

{{#unless lastSectionNumber}}
**You are in this scenario right now.**
{{/unless}}

Use `<file>` tag:

```xml
<file path="outputs/design/[FILENAME]">
# [Document Type] Document: [Project Name]

## 1. Overview
...

<!-- LAST_SECTION: 1 -->
</file>
```

**Filename determination:**
- Check your task description for file name mention
- "api-contract.md" mentioned → use `api-contract.md`
- "fe-system-design.md" mentioned → use `fe-system-design.md`
- "be-system-design.md" mentioned → use `be-system-design.md`
- No mention → use `system-design.md`

### Scenario 2: Appending Content (Continuation Task)

{{#if lastSectionNumber}}
**⚠️ You are in this scenario right now! Last section was: {{lastSectionNumber}}**
{{/if}}

**⚠️ CRITICAL: If document exists, you MUST use <append>, NOT <file>!**

Use `<append>` tag:

```xml
<append path="outputs/design/[FILENAME]">
## N. [Topic]    <!-- ⚠️ N = lastSectionNumber + 1 -->

...

<!-- LAST_SECTION: N -->
</append>
```

{{#if lastSectionNumber}}
**For this task:**
- Your first section number: {{add lastSectionNumber 1}}
- Your ending metadata: `<!-- LAST_SECTION: [YOUR_LAST_NUMBER] -->`
{{/if}}

**❌ FATAL ERROR - Using <file> on existing document:**
```xml
<file path="outputs/design/system-design.md">  ← WRONG! Will OVERWRITE!
## N. [Topic]
...
</file>
```

**✅ CORRECT - Using <append> for continuation:**
```xml
<append path="outputs/design/system-design.md">  ← CORRECT! Adds at end
## N. [Topic]
...
</append>
```

### Scenario 3: Modifying Existing Sections (Rare)

Use `<edit>` tag with `<search>` and `<replace>`:

```xml
<edit path="outputs/design/system-design.md">
<search>
## 2. Architecture

### 2.1 System Overview
...existing content...
</search>
<replace>
## 2. Architecture

### 2.1 System Overview
...updated content...
</replace>
</edit>
```

════════════════════════════════════════════════════════════════════════════════
## Path Requirements
════════════════════════════════════════════════════════════════════════════════

**CRITICAL: All paths must be in `outputs/design/` directory!**

**API Contract Document:**
- Path: `outputs/design/api-contract.md`
- Usage: Contract-First projects (dual design)
- Timing: Written BEFORE fe-system-design.md and be-system-design.md

**Frontend Design Document:**
- Path: `outputs/design/fe-system-design.md`
- Usage: Contract-First projects (dual design)
- Timing: Written AFTER api-contract.md

**Backend Design Document:**
- Path: `outputs/design/be-system-design.md`
- Usage: Contract-First projects (dual design)
- Timing: Written AFTER api-contract.md

**Unified Design Document:**
- Path: `outputs/design/system-design.md`
- Usage: Single-tier projects (frontend-only, backend-only, or tightly coupled)

════════════════════════════════════════════════════════════════════════════════
## Tag Selection Decision Tree
════════════════════════════════════════════════════════════════════════════════

```
Is lastSectionNumber provided in context?
├─ NO  → Use <file> (creating new document)
└─ YES → Use <append> (continuing existing document)
           ⚠️ Using <file> will cause FATAL ERROR!
```

**Summary:**
- ✅ `<file>` → First task only (new document)
- ✅ `<append>` → Continuation tasks (existing document)
- ✅ `<edit>` → Modifying existing content (rare)
- ❌ NEVER use `<file>` when lastSectionNumber exists

════════════════════════════════════════════════════════════════════════════════
## Content Formatting Rules
════════════════════════════════════════════════════════════════════════════════

### Inside XML Tags

**✅ DO:**
- Write markdown content directly inside tags
- Use proper markdown formatting (headers, lists, code blocks)
- Include the `<!-- LAST_SECTION: N -->` metadata comment at end

**❌ DON'T:**
- Add markdown code fences inside XML tags
- Output text outside XML tags
- Forget the LAST_SECTION metadata comment

### Multiple Operations

If you need multiple file operations, use multiple XML tags:

```xml
<append path="outputs/design/system-design.md">
## 4. Technology Stack
...
</append>

<append path="outputs/design/system-design.md">
## 5. Non-Functional Requirements
...
</append>
```

════════════════════════════════════════════════════════════════════════════════
## Common Mistakes to Avoid
════════════════════════════════════════════════════════════════════════════════

### Critical Rules:
1. **lastSectionNumber exists?** → Use `<append>`, NOT `<file>`
2. **ALL output must be inside XML tags** (no text before/after)
3. **NO markdown fences inside XML** (just write markdown directly)
4. **Path MUST start with** `outputs/design/`
5. **ALWAYS add** `<!-- LAST_SECTION: N -->` at end

════════════════════════════════════════════════════════════════════════════════
## Pre-Output Checklist
════════════════════════════════════════════════════════════════════════════════

Before generating output, verify:

**XML Tag Selection:**
- ✅ Used `<file>` only if this is first task (no lastSectionNumber)?
- ✅ Used `<append>` if continuing document (lastSectionNumber exists)?
- ✅ NO text outside XML tags?

**Path Correctness:**
- ✅ Path starts with `outputs/design/`?
- ✅ Filename matches document type from task description?
  - API Contract → `api-contract.md`
  - Frontend → `fe-system-design.md`
  - Backend → `be-system-design.md`
  - Unified → `system-design.md`

**Content Format:**
- ✅ Valid markdown inside XML tags?
- ✅ NO markdown code fences wrapping the content?
- ✅ Section numbering correct?
{{#if lastSectionNumber}}
  - First section: ## {{add lastSectionNumber 1}}
  - Last section: ## [YOUR_LAST_NUMBER]
{{else}}
  - First section: ## 1
{{/if}}

**Metadata:**
- ✅ Added `<!-- LAST_SECTION: N -->` at end?
{{#if lastSectionNumber}}
- ✅ Removed old metadata line (was `<!-- LAST_SECTION: {{lastSectionNumber}} -->`)?
{{/if}}

**If YES to all → Output. If NO → Fix first!**

════════════════════════════════════════════════════════════════════════════════
## 🚨 WRITING QUALITY RULES
════════════════════════════════════════════════════════════════════════════════

**System Design is about STRUCTURE, not STEPS**

### Write This Way:
✅ "AuthService handles user authentication and token generation"
✅ "Renderer converts application state to visual output using the chosen UI framework"
✅ "Chose an appropriate architecture style (e.g., layered, hexagonal, ECS) and defined clear boundaries"
✅ "Components communicate through props or input parameters; state flows unidirectionally"

### Never Write This Way:
❌ Algorithm steps: "Loop through array, calculate distance, find minimum"
❌ Formulas: "velocity = v - 2(v·n)n where n is normal vector"
❌ Specific values: "timeout: 3000ms", "angle: 45 degrees", "padding: 16px"
❌ Library/framework syntax: specific API calls (e.g., storage access functions, UI framework hooks, low-level rendering APIs)
❌ Implementation details: "hash with bcrypt rounds=10", "JWT HS256 algorithm"
❌ Language-specific type/contract syntax: `interface GameEngine { ... }`, `type GameState = { ... }`
❌ Local/internal helper state schemas that never cross a boundary (these belong in implementation, not design)

### Test Your Writing:
**Question: "Could a developer implement this 10 different ways?"**
- YES → Good architectural level (structure, not steps)
- NO → Too detailed (you're writing implementation)

### Domain Guardrail (Game / Physics / Rendering)
- Treat the engine as a black-box module: Input → Engine (Domain) → State → Renderer (Presentation)
- Describe responsibilities and interfaces only; DO NOT describe physics behavior
- No formulas, numeric parameters, timing values, or rendering commands (CSS/Canvas/WebGL)
- Do NOT list fields of internal game-specific state objects (engine/internal state, field layouts, etc.); describe concepts, roles, and ownership instead

### Responsibility & Boundary Guardrail (Architecture-Style Agnostic)
- Regardless of architecture pattern (Layered, Hexagonal, ECS, Event-Driven, etc.), you MUST:
  - Separate **UI-facing concerns** (rendering, user interaction wiring) from **core rules / domain model**
  - Separate **orchestration / coordination** (who calls whom, in what order) from **pure domain logic**
  - Isolate **technical capabilities** (storage, network, timers, input devices, rendering backends) behind clear interfaces/ports
- **Single Source of Truth** for important domain state MUST be explicit:
  - State is owned in ONE boundary (domain model, aggregate, system, or runtime manager), never “also” in random UI widgets
  - System Design MUST state which boundary owns authoritative state and which boundaries read/derive from it
- DO NOT mix framework/DOM details with architecture:
  - ❌ Avoid naming specific hooks/APIs like `useState`, `useEffect`, `requestAnimationFrame`, DOM tags (`<div>`), CSS properties (`transform`) in System Design
  - ✅ Instead, use framework-neutral phrases like "UI framework state", "rendering loop", "view components", "rendering surface"
- For real-time or game-like systems (whatever style you choose: layered, ECS, actor, etc.):
  - One clearly identified **runtime/orchestrator** owns the main loop / tick scheduling
  - One or more **domain engines/models** expose pure operations for "advance one tick" or "apply inputs" without depending on timers or UI
  - UI/presentation observes the current state and maps it to visuals and controls only
