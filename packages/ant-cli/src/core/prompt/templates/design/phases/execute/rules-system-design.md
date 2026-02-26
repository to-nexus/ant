## 📚 REFERENCE PROJECT USAGE RULES

### Principle

Use `search_reference_code` tool to **observe** existing contracts and interfaces. Extract architectural knowledge, not implementation details.

### Constraints

| Constraint | Rule |
|------------|------|
| **Extract contracts only** | Observe API endpoints, DTOs, interfaces. Do NOT copy implementation logic. |
| **Read-only** | Reference code cannot be modified. Observe and document. |
| **Compatibility** | If observed contracts exist, your design MUST be compatible. |
| **Abstraction** | Apply same "Implementation Detail Filter" rules to reference code. Extract architectural intent, not literals. |

### ⚠️ Blind Spot Reminder

When designing API contracts, you MUST search reference projects first to ensure compatibility. Do NOT assume endpoint structures.

---

## OUTPUT FORMAT

{{> common/rules}}

════════════════════════════════════════════════════════════════════════════════

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

<!-- SECTION_PATTERN: top-level -->
<!-- LAST_SECTION: 1 -->
</file>
```

{{#if isLastTaskForDocument}}
**⚠️ THIS IS THE LAST TASK FOR THIS DOCUMENT.**
**YOU MUST STILL GENERATE CONTENT** using `<file>` or `<append>` tags!
Only skip the metadata comments at the end.
{{else}}
**Required Metadata (first task only):**
- `SECTION_PATTERN`: `top-level` or `nested`
- `LAST_SECTION`: Your last section number
{{/if}}

**Filename determination:**
- Check `task.targetFile` field (HIGHEST PRIORITY)
- If `task.targetFile` exists → use exactly that filename
- Fallback pattern matching:
  - "api-contract-main.md" mentioned → use `api-contract-main.md`
  - "fe-system-design-main.md" mentioned → use `fe-system-design-main.md`
  - "be-system-design-main.md" mentioned → use `be-system-design-main.md`
  - "be-system-design-{service}.md" pattern → use exact filename (MSA)
  - No mention → use `be-system-design-main.md`

**⚠️ MSA Note**: For `msa-contract-first`, the filename includes service name (e.g., `be-system-design-auth.md`). Use the exact `task.targetFile` value.

### Scenario 2: Appending Content (Continuation Task)

{{#if lastSectionNumber}}
**⚠️ You are in this scenario right now! Last section was: {{lastSectionNumber}}**
{{/if}}

**⚠️ CRITICAL: If document exists, you MUST use <append>, NOT <file>!**

Use `<append>` tag:

```xml
<append path="outputs/design/[FILENAME]">
## N. [Topic]    <!-- N = lastSectionNumber + 1 -->

...

<!-- LAST_SECTION: N -->
</append>
```

{{#if lastSectionNumber}}
**Your first section: ## {{add lastSectionNumber 1}}**
{{/if}}
{{#if isLastTaskForDocument}}
**⚠️ EXCEPTION: Since this is the LAST task, OMIT `<!-- LAST_SECTION -->` line!**
{{else}}
**Include `<!-- LAST_SECTION: N -->` at the end.**
{{/if}}

**❌ FATAL ERROR - Using <file> on existing document:**
```xml
<file path="outputs/design/be-system-design-main.md">  ← WRONG! Will OVERWRITE!
## N. [Topic]
...
</file>
```

**✅ CORRECT - Using <append> for continuation:**
```xml
<append path="outputs/design/be-system-design-main.md">  ← CORRECT! Adds at end
## N. [Topic]
...
</append>
```

### Scenario 3: Modifying Existing Sections (Rare)

Use `edit_file` tool to modify existing sections:

```python
edit_file(
  path="outputs/design/be-system-design-main.md",
  old_str="""## 2. Architecture

### 2.1 System Overview
...existing content...""",
  new_str="""## 2. Architecture

### 2.1 System Overview
...updated content..."""
)
```

**CRITICAL**: Call `read_file` first to get the exact current content!

════════════════════════════════════════════════════════════════════════════════
## Path Requirements
════════════════════════════════════════════════════════════════════════════════

**CRITICAL: All paths must be in `outputs/design/` directory!**

**API Contract Document:**
- Path: `outputs/design/api-contract-main.md`
- Usage: Any project that exposes external API (fullstack, backend-only, MSA)
- Timing: Written FIRST (before implementation design documents)

**Frontend Design Document:**
- Path: `outputs/design/fe-system-design-main.md`
- Usage: Frontend-only projects, fullstack, and MSA projects
- Timing: Written AFTER api-contract-main.md (if api-contract exists), otherwise first

**Backend Design Document (single backend):**
- Path: `outputs/design/be-system-design-main.md`
- Usage: Fullstack and backend-only contract-first projects (implements api-contract-main.md)
- Timing: Written AFTER api-contract-main.md

**Backend Design Document (MSA - per service):**
- Path: `outputs/design/be-system-design-{service}.md`
- Usage: MSA-Contract-First projects (multiple services)
- Timing: Written AFTER api-contract-main.md
- **⚠️ `{service}` MUST match decompose output's `services` array**

**Unified Design Document:**
- Path: `outputs/design/be-system-design-main.md`
- Usage: Rare fallback only (CLI tools, libraries, or projects where environment is unknown)

### Path Pattern Reference

| documentType | targetFile Pattern | Valid Path Pattern |
|--------------|------------|------------|
| `unified` (frontend) | `fe-system-design-main.md` | `outputs/design/fe-system-design-main.md` |
| `unified` (fallback) | `be-system-design-main.md` | `outputs/design/be-system-design-main.md` |
| `contract-first` | `be-system-design-main.md` | `outputs/design/be-system-design-main.md` |
| `msa-contract-first` | `be-system-design-{service}.md` | `outputs/design/be-system-design-{service}.md` |

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
- ✅ `edit_file` tool → Modifying existing content (rare)
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
<append path="outputs/design/be-system-design-main.md">
## 4. Technology Stack
...
</append>

<append path="outputs/design/be-system-design-main.md">
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
{{#if isLastTaskForDocument}}
5. **OMIT** `<!-- LAST_SECTION: N -->` (this is the LAST task)
{{else}}
5. **ALWAYS add** `<!-- LAST_SECTION: N -->` at end
{{/if}}

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
  - API Contract → `api-contract-main.md`
  - Frontend → `fe-system-design-main.md`
  - Backend → `be-system-design-main.md`
  - Unified → `be-system-design-main.md`

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
{{#if isLastTaskForDocument}}
- ✅ **OMIT** `<!-- LAST_SECTION: N -->` (this is the LAST task - no metadata needed)
{{else}}
- ✅ Added `<!-- LAST_SECTION: N -->` at end of YOUR new content?
- ℹ️ Old metadata from previous content is automatically removed by the system
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

**CRITICAL DISTINCTION: Who specified this detail?**

### The Deciding Question: "Did PRD specify this, or did I choose it?"

**If PRD specified it → Document it (architectural constraint)**
**If YOU chose it → Omit it (implementation detail)**

### DO NOT Write (LLM-chosen implementation details):
- ❌ **STRICTLY FORBIDDEN - Internal identifiers YOU invent**:
  - Storage keys: `"bookmarks"`, `"recentSearches"`, `"statsData"`
  - Route paths: `"/ai"`, `"/blockchain"`, `"/search?q=keyword"` (unless PRD defines them)
  - **Component names**: `NewsCard`, `CategoryFilter`, `BookmarkButton`, `LoginPage`, `UserProfile`, `DashboardHeader`
  - **Function/method names**: `onBookmarkToggle`, `handleSearch`, `fetchArticles`, `authAPI.login()`, `userService.getProfile()`
  - **Props/parameters**: `onSuccess`, `userId`, `items`, `errorMessage`, `isLoading`
  - **Store/state names**: `useNewsStore`, `statsSlice`, `bookmarkStore`, `authState`
  - **Service/class names YOU invented**: `AuthService`, `NewsAPIClient`, `BookmarkManager` (describe architectural roles instead)
  
- ❌ **Component hierarchies and relationships**:
  - "LoginPage contains LoginForm and ErrorDisplay" (unless describing layer boundaries)
  - "NewsCard receives props from NewsList" (props are implementation)
  - "Parent component passes callback to child" (wiring details)
  
- ❌ **Framework-specific APIs**:
  - React hooks: `useState`, `useEffect`, `useCallback`, `useMemo`
  - Lifecycle: `componentDidMount`, `onMounted`, `ngOnInit`
  - Router APIs: `useNavigate`, `useParams`, `router.push`
  
- ❌ Algorithms/patterns YOU choose:
  - "Exponential backoff with 3 retries" (unless PRD specifies)
  - "Cache for 5 minutes" (unless PRD specifies)
  - "Debounce search by 300ms" (unless PRD specifies)
  
- ❌ UI implementation YOU design:
  - **Component hierarchies**: "LoginPage > LoginForm > InputField"
  - **Props/interfaces**: `interface LoginPageProps { onSuccess: () => void; redirectTo?: string; }`
  - **Framework hooks or events**: `onClick`, `onChange`, `useEffect`, `componentDidMount`
  - Loading spinner types, modal implementations, toast notification details
  - Error message templates, validation rules (unless domain invariants)

### ALWAYS Write (PRD-specified constraints):
- ✅ **Platform constraints**: Client-side only, No backend, Serverless, Browser-based
- ✅ **External services**: Exact service names from PRD (not LLM examples)
- ✅ **Architecture patterns**: Exact patterns from PRD
- ✅ **Technology prohibitions**: What PRD forbids

### ABSTRACT these (even if PRD specifies concrete tech):
- 🔄 **Storage**: "LocalStorage", "Redis", "IndexedDB" → "Persistence adapter", "Cache layer"
- 🔄 **Database**: "PostgreSQL", "MongoDB" → "Database", "Data store"
- 🔄 **State management**: "Zustand", "Redux" → "Global state management"
- 🔄 **Why**: System Design describes WHAT, not specific HOW implementation

### INSTEAD, Write at Architecture / Policy Level:
- ✅ **Boundary responsibilities** (without naming): "Authentication boundary captures credentials and delegates to Application layer"
- ✅ **Ownership & data flow**: "Application layer owns search state; Presentation observes state and emits search commands"
- ✅ **Policies & strategies**: "Failed API calls are retried based on error type; transient errors use exponential backoff strategy"
- ✅ **Layer interactions**: "User action → Presentation emits command → Application coordinates use case → Domain applies rules → Presentation observes state"
- ✅ **Conceptual screens**: "News Feed view", "Search Results view" (no hardcoded routes unless PRD defines them)
- ✅ **Abstract flows**: "User initiates search → Application queries services → Presentation displays results"

**Rule of thumb**: 
- Concrete literal YOU chose → Omit
- Constraint PRD gave you → Document
- Policy/pattern YOU designed at architecture level → Document abstractly

### Responsibility & Boundary Guardrail (Architecture-Style Agnostic)
- Regardless of architecture pattern (Layered, Hexagonal, ECS, Event-Driven, etc.), you MUST:
  - Separate **UI-facing concerns** (rendering, user interaction wiring) from **core rules / domain model**
  - Separate **orchestration / coordination** (who calls whom, in what order) from **pure domain logic**
  - Isolate **technical capabilities** (storage, network, timers, input devices, rendering backends) behind clear interfaces/ports
- **Single Source of Truth** for important domain state MUST be explicit:
  - State is owned in ONE boundary (domain model, aggregate, system, or runtime manager), never “also” in random UI widgets
  - System Design MUST state which boundary owns authoritative state and which boundaries read/derive from it
- DO NOT mix framework/DOM details with architecture:
  - ❌ Avoid naming specific framework hooks/APIs, DOM element names, or CSS property names in System Design
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
- Unified `be-system-design-main.md` documents MUST contain a dedicated **Core Interfaces & Contracts** chapter:
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
- For unified `be-system-design-main.md`:
  - Keep **Execution Flows** to 2–3 essential flows (no step-by-step gameplay narratives)
  - Keep technology/platform constraints (framework, DOM vs Canvas, etc.) in the **Technology Stack & Platform Constraints** chapter; avoid repeating them in UI/Domain sections

════════════════════════════════════════════════════════════════════════════════
## 🚨 FINAL SELF-VALIDATION CHECKLIST
════════════════════════════════════════════════════════════════════════════════

**Before submitting your output, verify:**

### Abstraction Level Check (Self-Reasoning)
- [ ] **For EVERY sentence I wrote, I verified:**
  - "Could this be implemented 10+ different ways?" (YES = good)
  - "Am I describing WHAT/WHO or HOW?" (WHAT/WHO = good)
  - "Is this a library/framework/tool name?" (YES = abstract to role)
  - "Is this a platform-specific API/feature?" (YES = abstract to interface)
  - "Did I extract INTENT from PRD, not copy wording?" (YES = good)

### Task Description vs Prompt Rules
- [ ] **Task description provides TOPICS (WHAT to cover)**
- [ ] **Prompt rules dictate ABSTRACTION LEVEL (HOW to write)**
- [ ] **When conflict: Prompt rules win, task description loses**
- [ ] **If task says "Design LocalStorage integration":**
  - I wrote: "Design client-side persistence strategy" ✅
  - NOT: "Design LocalStorage integration" ❌

### PRD Alignment
- [ ] **External services listed exactly as in PRD** (with § references)
- [ ] **Exclusions respected** (if PRD says "X is excluded", X is NOT mentioned anywhere)
- [ ] **Platform constraints documented verbatim** ("client-side only", "no backend")

### Document Quality
- [ ] **Architecture pattern selected and clearly defined** with explicit boundary responsibilities
- [ ] **Responsibilities non-overlapping** (each boundary owns distinct concerns)
- [ ] **Domain rules explicit** (normalization, validation, business policies)
- [ ] **Extension points clear** (adapters, ports, strategies)

**If ANY checklist item fails → REWRITE that section before submitting!**

════════════════════════════════════════════════════════════════════════════════

## 🚨 TASK COMPLETION SIGNAL (CRITICAL)

**When you have completed all work for this task, you MUST output:**

```xml
<done>true</done>
```

**Rules:**
1. Output `<done>true</done>` ONLY after document content has been generated with `<file>` or `<append>` tag
2. **Do NOT output `<done>true</done>` if you just made a tool call (wait for the result first)
3. **Typical flow:**
   ```
   Turn 1: read_file(...) → Wait (if needed)
   Turn 2: <file>...</file> or <append>...</append> + <done>true</done>
   ```

**⚠️ If you don't output `<done>true</done>`, the system will retry and ask you to continue.**
