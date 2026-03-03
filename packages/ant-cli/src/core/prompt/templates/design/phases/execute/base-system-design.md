════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: READ THIS FIRST 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
YOUR LINE BUDGET: Look for "MAX [N] lines" in task description below.

**IMPORTANT: Document Type Detection**
- **API Contract** (api-contract-main.md): typically 120-350 lines (binding specification)
- **Frontend** (fe-system-main.md): typically 150-450 lines (consumer architecture)
- **Backend** (be-system-main.md): typically 150-450 lines (provider architecture)
- **Unified** (be-system-main.md): typically 150-450 lines (single doc)

**Absolute rule**: The task description line budget ("MAX [N] lines") is the real cap; the ranges above are guidance.

{{#if (includes currentTask.targetFile "api-contract")}}
API Contract structure rules (ignore generic "chapter limits"):
- Use the required sections from the injected `api-contract-main.md` guide
- Prefer endpoint-by-endpoint specification, grouped by resource/use case
- Be precise; this document is a binding spec, not an architecture essay
{{else}}
CHAPTER LIMIT based on budget:
- Budget ≤ 60 lines → Create EXACTLY 1 chapter
- Budget 61-120 lines → Create 1-2 chapters MAX
- Budget 121-200 lines → Create 2-3 chapters MAX
- Budget 201-300 lines → Create 3-4 chapters MAX
- Budget 301+ lines → Create 4-6 chapters MAX

STRUCTURE PER CHAPTER:
- Maximum 5-6 subsections (###) for complex chapters
- Each subsection: 3-8 bullet points
- Each bullet: 1-2 sentences MAX (keep ultra-concise!)
{{/if}}

**CODE BLOCK LIMITS (CRITICAL)**:
{{#if (includes currentTask.targetFile "api-contract")}}
- Code blocks are allowed for DTO/schema clarity
- Keep them short and consistent (avoid nested code fences)
- Prefer one canonical definition per shared type (define once, reference elsewhere)
{{else}}
- **Maximum 3 code blocks in ENTIRE document**
- **Each code block ≤8 lines**
- Use ONLY for critical interfaces/types that cross boundaries
- Prefer prose descriptions over code
{{/if}}

⚠️ Focus on ARCHITECTURE and COMPONENT INTERACTION, not implementation details!
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{#if lastSectionNumber}}
🚨 CONTINUING EXISTING DOCUMENT 🚨
════════════════════════════════════════════════════════════════════════════════

**Last section in document: ## {{lastSectionNumber}}**
**Your first section MUST be: ## {{add lastSectionNumber 1}}**

{{#if currentTask.targetFile}}
**Target file: `{{currentTask.targetFile}}`** (defined by decompose, DO NOT change!)
{{else}}
**Target file: `be-system-main.md`** (default)
{{/if}}

⚠️ You MUST append to existing document (see rules.md for HOW)

{{else}}
🆕 NEW DOCUMENT - START FROM ## 1.
════════════════════════════════════════════════════════════════════════════════

**This is the first task for this document.**

{{#if currentTask.targetFile}}
**Target file: `{{currentTask.targetFile}}`** (defined by decompose, DO NOT change!)
{{else}}
**Target file: `be-system-main.md`** (default)
{{/if}}

{{/if}}
════════════════════════════════════════════════════════════════════════════════
🎯 CURRENT TASK
════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
**Task**: {{currentTask.name}}
**Description**: {{currentTask.description}}

🚨 **CRITICAL: Task Description is a HINT, not absolute instruction** 🚨

**Task description suggests topic areas to cover — it is NOT a binding plan.**
**The document-type guide's Section Catalog (CLOSED LIST) defines which sections are allowed.**
**Abstraction level and terminology follow the PROMPTS BELOW, not the description!**

**Priority hierarchy:**
1. **Guide Section Catalog** → scope ceiling (what sections CAN exist)
2. **Prompt rules below** → abstraction level (HOW to write)
3. **Task description** → topic hint (approximate coverage area)

**If task description mentions a topic NOT in the guide's Section Catalog → SKIP it.**
**If task description uses concrete terms → ABSTRACT them per prompt rules.**

**Examples:**
- "LocalStorage" → "client-side persistence adapter"
- "React Router" → "routing mechanism"
- "Component architecture" → Skip if guide Scope Ceiling forbids it

🚨 STRUCTURAL CONSTRAINTS 🚨
**Chapter limit based on your line budget:**
- If budget ≤ 60 lines → Create 1 chapter
- If budget 61-120 lines → Create 1-2 chapters
- If budget 121-200 lines → Create 2-3 chapters
- If budget 201-300 lines → Create 3-4 chapters
- If budget 301+ lines → Create 4-6 chapters

**For each chapter:**
- **Maximum 5-6 subsections (###)**
- **Each subsection: 3-8 bullet points**
- **Each bullet: 1 sentence**
- **Code blocks: Max 3 total, each ≤8 lines** (CRITICAL: use sparingly!)

**Focus**: Architecture decisions, component boundaries, interaction patterns. NOT implementation formulas.
{{/if}}

════════════════════════════════════════════════════════════════════════════════
## 📋 REQUIREMENTS (SOURCE OF TRUTH)
════════════════════════════════════════════════════════════════════════════════

{{#if prdSpec}}
## PRD (ABSOLUTE TRUTH)
{{prdSpec}}
{{else}}
## Requirements (Fallback)
{{spec}}
{{/if}}

**⚠️ PRD = ABSOLUTE TRUTH (But Extract Intent, Not Wording)**

**Critical: PRD often uses implementation terms. Your job is to extract the INTENT.**

**Examples of Intent Extraction:**
```
PRD says: "Use browser storage"
Intent: Client-side persistence required
System Design: "Persistence adapter for client-side storage"

PRD says: "Save bookmarks to LocalStorage"
Intent: Bookmarks must persist locally
System Design: "Bookmark collection persisted via client-side adapter"

PRD says: "Call API directly from browser"
Intent: No backend proxy, client-direct integration
System Design: "Direct integration with external services (no backend intermediary)"

PRD says: "Assume static hosting"
Intent: Stateless deployment, no server-side logic
System Design: "Frontend-only architecture with stateless deployment"

PRD says: "Exclude CryptoPanic due to CORS restrictions"
Intent: CryptoPanic service unavailable due to access restrictions
System Design: [Omit CryptoPanic entirely from design]
```

**Golden Rule:**
- PRD constraints = WHAT must be true
- Your design = HOW architecture achieves it (abstractly)
- PRD: "Use X technology" → You: "Capability that X provides"

**Skip sections not applicable:**
- No backend → Skip API/Database sections
- State: "Not Applicable - Frontend-only per PRD §X"

**🚨 CRITICAL: System Design Abstraction Level**

## Core Principle: WHAT vs HOW

**System Design describes WHAT the system does and WHO is responsible.**
**System Design does NOT describe HOW implementation is done.**

**Golden Test for Every Sentence:**
```
❓ "Could this be implemented in 10+ different ways?"
   ✅ YES → Good (architectural concern - keep it)
   ❌ NO  → Too specific (implementation choice - abstract or omit)

❓ "Am I describing WHAT component does, or HOW it's coded?"
   ✅ WHAT → Architecture (keep it)
   ❌ HOW  → Implementation (abstract or omit)

❓ "Is this a proper noun (library/vendor/API name)?"
   ✅ External service from PRD → Keep exact name
   ✅ Internal tech choice (LocalStorage, Redis, React) → Abstract to role
   ❌ Implementation detail → Omit
```

---

## Heuristic Rules: When to Abstract

**Rule 1: Technology Names**
- **If it's a library, framework, tool, or vendor product → Abstract to its ROLE**
  - Don't say: "LocalStorage", "sessionStorage", "IndexedDB"
  - Say: "Client-side persistence adapter"
  - Why: The role is architectural; the specific tech is implementation
  
- **Exception: PRD explicitly names external services**
  - Do say: "Stripe API" (if PRD specifies), "NewsData.io API"
  - Why: External dependencies are architectural constraints

**Rule 2: Platform-Specific Capabilities**
- **If it references a specific platform's API or feature → Abstract to generic interface**
  - Don't say: "browser storage", "browser history", "window.location", "DOM API"
  - Say: "persistence interface", "navigation state", "URL routing"
  - Why: Platform APIs are implementation; interfaces are architecture
  
- **Don't say: "CORS", "same-origin policy", "browser security model"**
  - Say: "cross-origin access restrictions", "service access policy"
  - Why: These are implementation mechanisms, not architectural decisions

**Rule 3: Deployment/Hosting Terms**
- **If it describes where/how code runs → Extract constraint only**
  - Don't say: "static hosting", "CDN", "web server", "serverless functions"
  - Say (if needed): "Frontend-only architecture (no backend)", "Stateless deployment"
  - Why: Deployment is operations; constraint is architecture

**Rule 4: UI Implementation**
- **If it describes HOW UI works → Describe responsibility only**
  - Don't say: "tab-based navigation", "modal dialog", "toast notification"
  - Say: "Primary navigation interface", "User feedback mechanism"
  - Why: UI patterns are implementation; roles are architecture

**Rule 5: Data Formats & Protocols**
- **If it's a standard format/protocol → Omit unless it's a cross-boundary contract**
  - Don't say: "JSON", "XML", "HTTP", "REST", "WebSocket" (unless contract)
  - Say (if needed): "Structured data exchange", "Request-response protocol"
  - Why: These are implementation transports; contracts are architecture

---

## Three-Tier Classification

**Tier 1: Document Exactly (Architectural Constraints)**
- External services named in PRD: "Stripe API", "NewsData.io"
- Platform constraint INTENT: "Frontend-only" (not "browser-based")
- Architecture patterns: "Layered", "Event-driven"
- Technology prohibitions: "No MongoDB", "No GraphQL"

**Tier 2: Abstract to Role (Technology Choices)**
- Any library/framework/tool name → Its architectural role
- Any platform-specific API → Generic interface
- Examples:
  - "LocalStorage" / "Redis" / "PostgreSQL" → "Persistence adapter" / "Cache layer" / "Data store"
  - "React Router" / "Vue Router" → "Routing mechanism"
  - "browser storage" / "window API" → "Client-side persistence" / "Platform interface"

**Tier 3: Omit Entirely (Implementation Details)**
- Config values: timeouts, retry counts, buffer sizes
- Code constructs: variable names, function signatures, type definitions
- UI specifics: component props, CSS properties, animation timings
- Algorithms: sorting methods, hashing algorithms, compression schemes

---

## Self-Validation Process

**Before writing each sentence, ask yourself:**

1. **"Is this a proper noun (library/vendor)?"**
   - External service from PRD? → Keep name
   - Internal tech choice? → Abstract to role

2. **"Am I describing WHAT or HOW?"**
   - WHAT component does? → Architecture (keep)
   - HOW it's implemented? → Implementation (abstract/omit)

3. **"Could this sentence work with ANY implementation?"**
   - YES → Good abstraction
   - NO → Too specific, rewrite

4. **"Did I extract INTENT from PRD, not copy wording?"**
   - PRD says "browser storage" → Intent is "client-side persistence required"
   - PRD says "static hosting" → Intent is "stateless deployment required"

**If any answer is unclear → Default to MORE abstraction, not less**

**🚨 MANDATORY: External Services/APIs Documentation**

When PRD specifies external services or APIs, you MUST:

1. **Create dedicated "External Services (Per PRD)" section** in Infrastructure chapter
2. **List EVERY service by exact name** with PRD section reference
3. **Check for exclusions** - If PRD says "X is excluded/not available", NEVER include X anywhere

**How to apply this:**
1. Read PRD carefully for explicit technology/service/pattern requirements
2. **CRITICAL: Check for explicit exclusions** - If PRD says "X is excluded", "Do NOT use X", or "X is not available", you MUST NOT include X in design
3. Document ALL PRD constraints (requirements AND prohibitions) in appropriate sections
4. Avoid documenting details YOU chose that PRD didn't specify

**Negative Constraints (Exclusions):**
- If PRD explicitly excludes a technology/service (e.g., "X is not available", "Do NOT use X", "X is excluded"), treat it as FORBIDDEN
- Do NOT include excluded items even if they seem like obvious choices for the domain
- Do NOT mention excluded items anywhere in the design document
- Example: If PRD says "CryptoPanic is excluded", do NOT design CryptoPanic adapter, do NOT mention it in examples, do NOT include it in provider lists

**External Service Documentation (CRITICAL):**
1. Scan PRD for ALL explicitly named external services/APIs
2. Create dedicated "External Services (Per PRD)" section listing EVERY service by exact name
3. Do NOT use generic names (e.g., "NewsAPI") when PRD specifies exact services (e.g., "NewsData.io", "TheNewsAPI")
4. Include purpose and PRD section reference for each service

{{#if directive}}
════════════════════════════════════════════════════════════════════════════════
## 📝 USER DIRECTIVE (CONTEXT ONLY - NOT SOURCE OF TRUTH)
════════════════════════════════════════════════════════════════════════════════

{{directive}}

**Priority**: PRD provides baseline requirements. Directive overrides specific PRD content when explicitly specified.
{{/if}}

{{#if referenceRequests}}
════════════════════════════════════════════════════════════════════════════════
## 📚 REFERENCE PROJECTS AVAILABLE
════════════════════════════════════════════════════════════════════════════════

{{#each referenceRequests}}
- **{{this.project}}**{{#if this.branch}} (branch: {{this.branch}}){{/if}}
{{/each}}

Use `search_reference_code` tool to query these projects. See rules for constraints.
{{/if}}

{{#if designDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🚨 API CONTRACT (IMMUTABLE SPECIFICATION - HIGHEST PRIORITY)
════════════════════════════════════════════════════════════════════════════════

**⚠️ CRITICAL: This API Contract was already finalized and CANNOT be changed!**

────────────────────────────────────────────────────────────────────────────────

{{designDoc}}

────────────────────────────────────────────────────────────────────────────────
{{/if}}

════════════════════════════════════════════════════════════════════════════════
## 📐 DOCUMENT TYPE-SPECIFIC GUIDE
════════════════════════════════════════════════════════════════════════════════

**Your document type is determined by task.targetFile:**
- `api-contract-main.md` - Binding API specification (WHAT interfaces exist)
- `fe-system-main.md` - Frontend architecture (standalone or consuming APIs)
- `be-system-main.md` - Backend architecture (HOW to implement APIs)
- `be-system-main.md` - Unified design (rare fallback for unclassified projects)

**A document type-specific guide has been automatically injected above** with:
- **Section Catalog (CLOSED LIST)** defining the ONLY allowed sections for this document type
- **Scope Ceiling** defining topics that MUST NOT appear in the document
- Anti-patterns and common mistakes to avoid
- Core principles specific to this document type

**If no type-specific guide appears above**, you're writing **`be-system-main.md` (unified)**:

### Unified System Design Structure

**Use this for:**
- Projects where environment is unknown (CLI tools, libraries)
- Projects without separate FE/BE split

**Adapt sections based on project type** (skip non-applicable sections):

1. **Overview**: System purpose, architecture style, key use cases
2. **Responsibilities & Boundaries**: Architecture pattern (Layered, Hexagonal, MVC, ECS, etc.), component/layer boundaries
3. **State Model & Ownership**: State classification (Domain/Session/UI), single source of truth per state type
4. **Core Domain Concepts**: Key entities, relationships, domain invariants (describe concepts, NOT full schemas)
5. **Core Interfaces & Contracts**: Boundary contracts (services, engines, ports, providers) - define once, reference elsewhere
6. **Main Execution Flows**: Key flows (e.g., "user action flow", "game loop") - high-level who-calls-whom
7. **Directory Structure & Boundary Mapping** (if framework augmentation injected): Boundary-to-directory mapping principle, coding phase directives
8. **Technology Stack**: Framework, database (if any), key libraries, platform constraints
9. **Non-Functional Requirements** (if PRD specifies): Security, performance, integrations

**Critical**: Focus on architecture decisions and component interaction, NOT implementation formulas.

════════════════════════════════════════════════════════════════════════════════
## 🚫 ABSOLUTELY FORBIDDEN (Unless PRD EXPLICITLY requests)
════════════════════════════════════════════════════════════════════════════════

**DO NOT add requirements that are NOT in the PRD**, even if they are industry "best practices":

**Operational Concerns:**
- ❌ Deployment architecture / CI/CD pipelines
- ❌ Infrastructure planning / cloud setup / Kubernetes
- ❌ Operations / monitoring / alerting
- ❌ Migration plans / rollout strategies
- ❌ Test plans / QA schedules
- ❌ Project timelines / milestones / team structure
- ❌ Budget / cost analysis

**Unstated Requirements (Do NOT invent):**
- ❌ Accessibility standards (WCAG, ARIA, a11y) unless PRD explicitly requires them
- ❌ Testing strategies unless PRD mentions testing
- ❌ Security compliance (SOC2, HIPAA, GDPR) unless PRD requires them
- ❌ Performance SLAs (99.9% uptime) unless PRD specifies them
- ❌ Internationalization (i18n) unless PRD mentions multiple languages
- ❌ Analytics/tracking unless PRD requests it

**Golden Rule**: If it's not in the PRD, DON'T design it. Your job is to design what was ASKED FOR.

**Focus on WHAT to build and HOW components interact, NOT what you think SHOULD BE there.**

════════════════════════════════════════════════════════════════════════════════

**NOTE**: Universal writing rules and forbidden content are defined in your system prompt.

**FINAL CHECKLIST**:
1. ✅ **Architecture defined**: Clear pattern selection (Layered, MVC, etc.)?
2. ✅ **Component boundaries**: Modules/layers and responsibilities specified?
3. ✅ Followed PRD constraints (tech stack, scope)?
4. ✅ Skipped sections not applicable to project type?
5. ✅ Stayed within YOUR task's line budget?
6. ✅ Created appropriate number of chapters for your budget?
7. ✅ Ultra-concise (1 sentence per point)?
8. ✅ **Code blocks ≤3 total, each ≤8 lines**?
9. ✅ **NO implementation details** (formulas, algorithms, detailed pseudocode, internal state schemas)?
10. ✅ NO forbidden sections (deployment, ops, monitoring)?
11. ✅ Covered all critical architectural decisions and component interactions?
12. ✅ **ABSTRACTION SELF-CHECK** - For each sentence, verify:
    - ✅ Describes WHAT/WHO, not HOW implementation works?
    - ✅ Could be implemented 10+ different ways?
    - ✅ No library/framework/tool names (except external services from PRD)?
    - ✅ No platform-specific API names (browser, window, DOM, etc.)?
    - ✅ No concrete technology names abstracted to architectural roles?
    - ✅ Extracted INTENT from PRD constraints, not copied wording?
13. ✅ **EXTERNAL SERVICES CHECK** - If PRD specifies external APIs:
    - ✅ Created dedicated "External Services (Per PRD)" section?
    - ✅ Listed EVERY service by exact name with PRD §reference?
    - ✅ Checked for exclusions (services PRD says NOT to use)?
    - ✅ NO generic names (e.g., "NewsAPI" when PRD says "NewsData.io")?
14. ✅ **TECHNOLOGY ABSTRACTION** - Applied Heuristic Rules:
    - ✅ Library/framework names → Architectural roles?
    - ✅ Platform APIs → Generic interfaces?
    - ✅ Deployment terms → Constraint intents only?
    - ✅ UI implementation patterns → Component responsibilities?
15. ✅ **DIRECTORY STRUCTURE** (if framework augmentation was injected above):
    - ✅ Boundary-to-directory mapping principle stated?
    - ✅ Coding phase directives included?
    - ✅ Import direction / dependency rules between boundaries stated?

**If YES to all → Output using XML tags per rules.md. If NO → Fix first!**
