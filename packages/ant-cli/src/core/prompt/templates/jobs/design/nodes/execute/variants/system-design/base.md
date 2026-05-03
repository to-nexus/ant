════════════════════════════════════════════════════════════════════════════════
PHASE ROLE
════════════════════════════════════════════════════════════════════════════════

You are running in the **docGen phase** of a design job. The
architecture model, boundary inventory, and chapter outline were
decided by the upstream **plan node** and sealed into the runtime
context (when present).

The artifact this phase produces is the system-design document at
`architecture/system/{{targetFile}}`. `documentOutline` is binding
for the chapter structure of that markdown; `decision` is the content
the markdown describes (the architectural rationale and direction the
document records), not the action this phase performs. Use tools to
verify the *detail precision of the document text* (exact DTO field
types, endpoint paths, contract values verified against reference
projects). When no sealed plan is injected (legacy / fallthrough),
derive structure from the PRD per the Section Catalog.

════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: READ THIS FIRST 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
CONCISENESS PRINCIPLE:
- Write the minimum content needed to convey each architectural decision
- If a section can be described in 3 bullets, do not write 10
- The Section Catalog defines WHAT to write; write only that, nothing more

{{#if (includes currentTask.targetFile "api-contract")}}
API Contract structure rules:
- Each chapter corresponds to ONE section from the Section Catalog
- Each catalog section produces exactly ONE top-level chapter (## heading)
- Do NOT split one catalog section into multiple ## chapters; use ### subsections instead
- Write ONLY chapters for your ASSIGNED sections (see Section Scope below)
- Section ordering: follow the catalog's listing order
- Do NOT embed FORBIDDEN section content as subsections within ASSIGNED chapters
- Prefer endpoint-by-endpoint specification, grouped by resource/use case
- Be precise; this document is a binding spec, not an architecture essay
- DTO scope rule: in all sections except § Shared Type Definitions, a DTO name reference IS the complete specification — do NOT expand names into field lists or create any type-definition chapter outside § Shared Type Definitions
- ⚠️ Blind spot: do NOT create variant-named type chapters ("Service DTOs", "Type Definitions (Extended)", etc.)
- Code blocks are allowed for schema clarity within your assigned sections only
{{else}}
CHAPTER COUNT:
- Each chapter corresponds to ONE section from the guide's Section Catalog
- Each ASSIGNED section produces exactly ONE top-level chapter (## heading)
- Do NOT split one catalog section into multiple ## chapters; use ### subsections instead
- Write ONLY chapters for your ASSIGNED sections (see Section Scope below)
- Section ordering: follow the catalog's listing order
- If all assigned sections are already in the document, output ONLY the metadata (LAST_SECTION comment) with no new content

STRUCTURE PER CHAPTER:
- Maximum 5-6 subsections (###) for complex chapters
- Each subsection: 3-8 bullet points
- Each bullet: 1-2 sentences MAX

CODE BLOCKS:
- Maximum 3 code blocks in ENTIRE document, each ≤8 lines
- Use ONLY for critical interfaces/types that cross boundaries
- Prefer prose descriptions over code
{{/if}}

⚠️ Focus on ARCHITECTURE and BOUNDARY INTERACTION, not implementation details!
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

{{#if sectionScope}}
🚨 **CRITICAL: Section Scope is BINDING** 🚨

{{{sectionScope}}}

**You MUST write ONLY the sections listed in ASSIGNED sections above.**
**You MUST NOT write ANY section listed in FORBIDDEN sections.**
**The Guide Section Catalog defines HOW each section should be written.**
**Task description provides context — section assignments are authoritative.**
{{/if}}

**Priority hierarchy:**
1. **Section assignments** → WHAT to write (binding scope)
2. **Guide Section Catalog** → HOW to write (content rules per section)
3. **Prompt rules below** → abstraction level
4. **Task description** → additional context

**If task description mentions a topic NOT in assigned sections → SKIP it.**
**If task description uses concrete terms → ABSTRACT them per prompt rules.**

🚨 STRUCTURAL CONSTRAINTS 🚨
**Chapter count:**
- Each chapter = ONE section from the guide's Section Catalog
- Write ONLY chapters for your ASSIGNED sections
- Do NOT write ANY chapter for FORBIDDEN sections, even if seemingly relevant

**Conciseness:**
- Write the minimum needed to convey each architectural decision
- Each bullet: 1 sentence; each subsection: 3-8 bullets
- Code blocks: Max 3 total, each ≤8 lines

**Focus**: Architecture decisions, boundary responsibilities, interaction patterns. NOT implementation formulas.
{{/if}}

════════════════════════════════════════════════════════════════════════════════
## 📋 REQUIREMENTS (SOURCE OF TRUTH)
════════════════════════════════════════════════════════════════════════════════

{{!-- Requirements are rendered via action-context injection —— no base template prdSpec/spec block needed --}}

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

PRD says: "Register @scope:registry=https://registry.example.com/repo in config"
Context: A specific technology was chosen; this URL is required to use it
System Design: "Package registry requires `@scope:registry=https://registry.example.com/repo`"
-- Technology-specific values in the spec mean that technology was CHOSEN.
-- Abstracting the URL away makes the constraint unactionable for the coding phase.
```

**Golden Rule:**
- PRD constraints = WHAT must be true
- Your design = HOW architecture achieves it (abstractly)
- PRD: "Use X technology" → You: Document "X" as architectural constraint (Tier 1)
- PRD: "browser storage" → You: Extract intent — "Client-side persistence required"
- PRD provides technology-specific values (URLs, registry paths, config entries) → The specificity IS the decision. Preserve verbatim.

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
   ⚠️ EXCEPTION: Spec-provided exact values tied to a technology decision
      have only ONE correct form — they ARE the decision, not "too specific".

❓ "Am I describing WHAT component does, or HOW it's coded?"
   ✅ WHAT → Architecture (keep it)
   ❌ HOW  → Implementation (abstract or omit)

❓ "Is this a proper noun (library/vendor/API name)?"
   ✅ PRD specified it (external service OR technology) → Keep exact name
   ✅ YOU chose it (internal tech choice) → Abstract to role
   ❌ Implementation detail → Omit
```

---

## Heuristic Rules: When to Abstract

**Rule 1: Technology Names**
- **If it's a library, framework, tool, or vendor product → Abstract to its ROLE**
  - Don't say: "LocalStorage", "sessionStorage", "IndexedDB"
  - Say: "Client-side persistence adapter"
  - Why: The role is architectural; the specific tech is implementation
  
- **Exception: PRD explicitly specifies a technology or external service**
  - Do say: "Stripe API", "NewsData.io API", "Tailwind CSS", "PostgreSQL" (if PRD specifies)
  - Why: PRD-specified technologies are architectural constraints (Tier 1), not implementation choices

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

**Entry Gate: "Who decided?"**
- PRD specified a technology → Tier 1 (document with exact name)
- YOU chose a technology → Classify per Tier 2/3 below

## Three-Tier Classification

**Tier 1: Document Exactly (Architectural Constraints)**
- PRD-specified technology choices: "Tailwind CSS", "PostgreSQL" (keep exact name)
- External services named in PRD: "Stripe API", "NewsData.io"
- Platform constraint INTENT: "Frontend-only" (not "browser-based")
- Architectural constraints from PRD: "event-driven communication required", "no microservices"
- Technology prohibitions: "No MongoDB", "No GraphQL"
- **Technology decisions AND their operational requirements**: Spec-provided values (registry URLs, package scopes, SDK endpoints, required config entries) tied to a technology choice

**Tier 2: Abstract to Role (Technology Choices)**
- Any library/framework/tool name → Its architectural role
- Any platform-specific API → Generic interface
- Examples:
  - "LocalStorage" / "Redis" / "SQLite" → "Persistence adapter" / "Cache layer" / "Data store"
  - "React Router" / "Vue Router" → "Routing mechanism"
  - "browser storage" / "window API" → "Client-side persistence" / "Platform interface"
- **Applies only to technologies YOU choose** — PRD-specified technologies are Tier 1

**Tier 3: Omit Entirely (Implementation Details)**
- Config values YOU chose: timeouts, retry counts, buffer sizes (spec-provided values are Tier 1)
- Code constructs: variable names, function signatures, type definitions
- UI specifics: component props, CSS properties, animation timings
- Algorithms: sorting methods, hashing algorithms, compression schemes

---

## Self-Validation Process

**Before writing each sentence, ask yourself:**

1. **"Who decided this — PRD or me?"**
   - PRD specified it? → Document exactly (Tier 1 constraint). **Stop — skip Q2-Q5.**
   - I chose it? → Apply questions 2-5 below

2. **"Is this a proper noun (library/vendor)?"**
   - PRD specified it (service or technology)? → Keep name
   - YOU chose it? → Abstract to role

3. **"Am I describing WHAT or HOW?"**
   - WHAT component does? → Architecture (keep)
   - HOW it's implemented? → Implementation (abstract/omit)

4. **"Could this sentence work with ANY implementation?"**
   - YES → Good abstraction
   - NO → Too specific, rewrite

5. **"Did I extract INTENT from PRD, not copy wording?"**
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

════════════════════════════════════════════════════════════════════════════════
## 📐 DOCUMENT TYPE-SPECIFIC GUIDE
════════════════════════════════════════════════════════════════════════════════

**Your document type is determined by task.targetFile:**
- `api-contract-main.md` - External API interface specification (WHAT endpoints exist)
- `fe-system-main.md` - Frontend internal architecture (HOW frontend is structured)
- `be-system-main.md` - Backend internal architecture (HOW backend is structured)

**A document type-specific guide has been automatically injected above** with:
- **Section Catalog (CLOSED LIST)** defining the ONLY allowed sections for this document type
- **Scope Ceiling** defining topics that MUST NOT appear in the document
- Anti-patterns and common mistakes to avoid
- Core principles specific to this document type

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

**Focus on WHAT to build and HOW boundaries interact, NOT what you think SHOULD BE there.**

════════════════════════════════════════════════════════════════════════════════

**NOTE**: Universal writing rules and forbidden content are defined in your system prompt.

**FINAL CHECKLIST**:
1. ✅ **Architecture defined**: Design decisions (organization, internal structure) stated with rationale?
2. ✅ **Architecture boundaries**: Modules/layers and responsibilities specified?
3. ✅ Followed PRD constraints (tech stack, scope)?
4. ✅ Skipped sections not applicable to project type?
5. ✅ Each chapter maps to an ASSIGNED section (no invented sections, no FORBIDDEN sections)?
6. ✅ Concise — minimum content for each architectural decision?
7. ✅ **Code blocks ≤3 total, each ≤8 lines**?
8. ✅ **NO implementation details** (formulas, algorithms, detailed pseudocode, internal state schemas)?
9. ✅ NO forbidden sections (deployment, ops, monitoring)?
10. ✅ Covered all critical architectural decisions and boundary interactions?
11. ✅ **ABSTRACTION SELF-CHECK** - For each sentence, verify:
    - ✅ Describes WHAT/WHO, not HOW implementation works?
    - ✅ Could be implemented 10+ different ways?
    - ✅ No library/framework/tool names YOU chose (PRD-specified technologies are Tier 1 — keep them)?
    - ✅ No platform-specific API names (browser, window, DOM, etc.)?
    - ✅ Technologies YOU chose abstracted to architectural roles (not left as concrete names)?
    - ✅ Extracted INTENT from PRD constraints, not copied wording?
12. ✅ **EXTERNAL SERVICES CHECK** - If PRD specifies external APIs:
    - ✅ Created dedicated "External Services (Per PRD)" section?
    - ✅ Listed EVERY service by exact name with PRD §reference?
    - ✅ Checked for exclusions (services PRD says NOT to use)?
    - ✅ NO generic names (e.g., "NewsAPI" when PRD says "NewsData.io")?
13. ✅ **TECHNOLOGY ABSTRACTION** - Applied Heuristic Rules:
    - ✅ Library/framework names YOU chose → Architectural roles (PRD-specified → keep as Tier 1)?
    - ✅ Platform APIs → Generic interfaces?
    - ✅ Deployment terms → Constraint intents only?
    - ✅ UI implementation patterns → Component responsibilities?
14. ✅ **DIRECTORY STRUCTURE** (if framework augmentation was injected above):
    - ✅ Boundary-to-directory mapping principle stated?
    - ✅ Coding phase directives included?
    - ✅ Import direction / dependency rules between boundaries stated?

**If YES to all → Output using XML tags per rules.md. If NO → Fix first!**

{{{runtimeContext}}}
