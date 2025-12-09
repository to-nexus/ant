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

### UI / Rendering Detail Guardrail
- System Design MUST NOT describe UI at the level of implementation details:
  - ❌ Do NOT list concrete component trees, overlay compositions, or DOM element hierarchies
  - ❌ Do NOT describe specific CSS properties, layout techniques, animation timelines, or styling libraries
  - ❌ Do NOT narrate step-by-step UI flows ("user clicks X, then Y happens, then Z...") beyond what is needed to explain core architecture
- Instead, describe:
  - ✅ Roles of screens/boundaries (e.g., "Game screen renders the current GameState and forwards user commands")
  - ✅ How state/view-model flows between boundaries (who owns state, who reads it, who sends commands)
  - ✅ Any architectural constraints on UI (e.g., "declarative rendering; view is a pure function of state")

### Test Your Writing:
**Question: "Could a developer implement this 10 different ways?"**
- YES → Good architectural level (structure, not steps)
- NO → Too detailed (you're writing implementation)

════════════════════════════════════════════════════════════════════════════════
## 🧹 IMPLEMENTATION DETAIL FILTER (Especially for Service / Dashboard / CRUD)
════════════════════════════════════════════════════════════════════════════════

**Even if the PRD includes these values explicitly, System Design MUST NOT repeat them as low-level implementation details.**

### DO NOT Write (belongs to PRD or implementation docs):
- ❌ Concrete storage keys or internal persistence shapes:
  - e.g., `"bookmarks"`, `"recentSearches"`, `"statsData"` and exact JSON layouts.
- ❌ Concrete URL paths and query formats:
  - e.g., `"/ai"`, `"/blockchain"`, `"/search?q=keyword"`.
- ❌ UI component trees, props contracts, or handler names:
  - e.g., `NewsCardProps`, `onBookmarkToggle(articleId)`, `CategoryFilter`, `SourceFilter` component hierarchies.
- ❌ State management implementation details:
  - Store/slice names, selector names, hook usage patterns (e.g., `useNewsStore`, `statsSlice`, `useBookmarkStore`).
- ❌ Concrete retry/backoff or caching algorithms:
  - e.g., "exponential backoff with 3 retries", "retry after 100/200/400 ms".
- ❌ Detailed loading/error UI patterns:
  - Specific spinners, skeleton layouts, banner text, button placement, toasts, etc.

### INSTEAD, Write at Architecture / Policy Level:
- ✅ Describe **policies and ownership**, not keys or paths:
  - "Bookmark collection is persisted via a client-side StorageAdapter; key names and encoding format are implementation details."
  - "Search terms are kept as a bounded queue in client storage; maximum length and eviction policy are owned by Application/Domain policy."
- ✅ Describe **navigation and screens** conceptually:
  - "AI News view", "Search view", "Bookmarks view" and how they map to use cases, without hard-coding routes.
- ✅ Describe **state responsibilities**:
  - "Application layer owns SearchState, BookmarkState, StatisticsState and exposes them as read models to Presentation."
- ✅ Describe **error/retry policies** at a high level:
  - "Infrastructure wraps external API failures into domain-level error results; Application decides when to retry vs surface an error state."

**Rule of thumb**: If a detail looks like a hard-coded literal or a framework-level symbol (key, path, prop name, slice name, hook), it almost always belongs in PRD or implementation, NOT in System Design.

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

### Routing & Navigation Guardrail
- Application/Runtime and Domain boundaries MUST NOT directly depend on concrete routing/navigation APIs (e.g., router instances, URL manipulation)
- System Design should express navigation intent via:
  - State transitions (e.g., "matchPhase = finished") or
  - High-level events (e.g., "MatchFinished" event emitted by Runtime)
- Presentation/Router boundary:
  - Owns actual route/screen changes based on observed state or events
  - Implements navigation using the chosen framework/router (outside of Domain/Application concerns)

### Layer Consistency Guardrail
- When you define boundaries and ownership in the **Responsibilities & Boundaries** chapter:
  - Treat that description as the **single source of truth** for what each boundary owns (state, loop, input, rules)
  - All later sections (UI, Domain, Flows, etc.) MUST stay consistent with that definition (no reassigning ownership to a different boundary)
- For layered/frontend-only game designs (common pattern):
  - **UI/View boundaries**: rendering + input events → abstract commands; NO authoritative domain state, NO loop ownership
  - **Application/Runtime/Orchestration boundary**: owns long-lived game/session state and loop scheduling; coordinates calls into domain engines
  - **Domain boundary**: provides pure operations on state (e.g., `applyCommands`, `advanceTick`); it does NOT internally manage persistent session state visible to UI
- If your design intentionally deviates from this pattern, you MUST:
  - Explicitly state the alternative ownership model once (in Responsibilities & Boundaries), and
  - Keep all later sections strictly aligned with that chosen model (no mixed models in different chapters)

### Contract Section Guardrail
- Unified `system-design.md` documents MUST contain a dedicated **Core Interfaces & Contracts** chapter:
  - List EVERY cross-boundary contract here (services, engines, ports, providers, repositories, systems)
  - For each contract, follow the language-neutral pattern: **Name / Role / Operations / Rules**
- Other sections MUST:
  - Reference these contracts by name (e.g., "uses `GameEngine` from §3. Core Interfaces & Contracts")
  - NOT redefine or partially restate method shapes in prose (avoid drifting, duplication, or conflicting descriptions)

### Input Flow Guardrail (Single Canonical Path)
- System Design MUST define exactly ONE canonical input flow across boundaries; all variants are implementations of this flow, not separate flows:
  - Typical game/interaction pattern:
    - UI/View captures raw input events (e.g., keyboard, pointer)
    - An **InputAdapter/InputProvider** converts raw events into abstract Commands
    - The **Runtime/Orchestrator** collects Commands for the current tick/frame
    - Domain engines/models consume Commands + state to produce next state
- Forbidden ambiguity:
  - Do NOT describe multiple, conflicting flows (e.g., UI sometimes sends Commands directly to Engine, sometimes via Runtime)
  - If you introduce InputProvider or StateProvider abstractions, they MUST appear in the Core Interfaces & Contracts chapter with clear roles and operations
- Write other sections to reference this canonical flow:
  - UI section: "captures events and passes Commands to InputProvider/Runtime as per §Core Interfaces & Contracts"
  - Flow section: "per tick: collect Commands via InputProvider → call Runtime/Engine → propagate new state"

### Redundancy & Focus Guardrail
- Do NOT restate the same architecture decision, flow, or technology constraint in multiple chapters:
  - Define each major decision/flow ONCE in the most appropriate chapter
  - In later sections, reference it briefly (e.g., "see §3. Core Interfaces & Contracts") instead of re-explaining
- For unified `system-design.md`:
  - Keep **Execution Flows** to 2–3 essential flows (no step-by-step gameplay narratives)
  - Keep technology/platform constraints (framework, DOM vs Canvas, etc.) in the **Technology Stack & Platform Constraints** chapter; avoid repeating them in UI/Domain sections
