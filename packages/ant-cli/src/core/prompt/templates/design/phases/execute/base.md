════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: READ THIS FIRST 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
YOUR LINE BUDGET: Look for "MAX [N] lines" in task description below.

**IMPORTANT: Document Type Detection**
- **API Contract** (api-contract.md): 80-200 lines MAX (binding specification)
- **Frontend** (fe-system-design.md): 120-600 lines MAX (consumer perspective)
- **Backend** (be-system-design.md): 120-600 lines MAX (implementation perspective)
- **Unified** (system-design.md): 120-600 lines MAX (single-tier projects)

CHAPTER LIMIT based on budget:
- Budget ≤ 60 lines → Create EXACTLY 1 chapter
- Budget 61-120 lines → Create 1-2 chapters MAX
- Budget 121-200 lines → Create 2-3 chapters MAX
- Budget 201-300 lines → Create 3-4 chapters MAX
- Budget 301+ lines → Create 4-6 chapters MAX

STRUCTURE PER CHAPTER:
- Maximum 5-6 subsections (###) for complex chapters
- Each subsection: 3-8 bullet points
- Each bullet: 1 sentence (keep ultra-concise!)

**CODE BLOCK LIMITS (CRITICAL)**:
- **Maximum 3 code blocks in ENTIRE document**
- **Each code block ≤8 lines**
- Use ONLY for critical interfaces/types
- Prefer prose descriptions over code

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
**Target file: `system-design.md`** (default)
{{/if}}

⚠️ You MUST append to existing document (see rules.md for HOW)

{{else}}
🆕 NEW DOCUMENT - START FROM ## 1.
════════════════════════════════════════════════════════════════════════════════

**This is the first task for this document.**

{{#if currentTask.targetFile}}
**Target file: `{{currentTask.targetFile}}`** (defined by decompose, DO NOT change!)
{{else}}
**Target file: `system-design.md`** (default)
{{/if}}

{{/if}}
════════════════════════════════════════════════════════════════════════════════
🎯 CURRENT TASK
════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
**Task**: {{currentTask.name}}
**Description**: {{currentTask.description}}

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

{{spec}}

**⚠️ PRD = ABSOLUTE TRUTH**
- Follow PRD's technical constraints exactly (e.g., "React + Vite", "useState only")
- Skip sections not applicable to PRD (e.g., no backend → skip API/Database sections)
- For skipped sections, state: "Not Applicable - [reason] per PRD"

{{#if designDoc}}
════════════════════════════════════════════════════════════════════════════════
## 🚨 API CONTRACT (IMMUTABLE SPECIFICATION - HIGHEST PRIORITY)
════════════════════════════════════════════════════════════════════════════════

**⚠️ CRITICAL: This API Contract was already finalized and CANNOT be changed!**

**When writing Frontend or Backend System Design:**
- ✅ Use EXACT endpoint paths from API Contract (e.g., `POST /rooms/create` NOT `/rooms`)
- ✅ Use EXACT field names and types (e.g., `userId: string` NOT `user_id`)
- ✅ Reference DTOs by name: "Uses CreateRoomRequest from api-contract.md"
- ❌ DO NOT redefine DTOs (no duplication!)
- ❌ DO NOT change endpoint paths or field names
- ❌ DO NOT apply your own "best practices" that contradict the contract

**Your job: Design HOW to implement the contract, NOT to redesign the contract.**

────────────────────────────────────────────────────────────────────────────────

{{designDoc}}

────────────────────────────────────────────────────────────────────────────────
{{/if}}

════════════════════════════════════════════════════════════════════════════════
## 📐 DOCUMENT TYPE GUIDE
════════════════════════════════════════════════════════════════════════════════

**⚠️ CRITICAL: Check your task description to determine document type!**

- `api-contract.md` → See injection: `api-contract-guide.md`
- `fe-system-design.md` → See injection: `frontend-guide.md`
- `be-system-design.md` → See injection: `backend-guide.md`
- `system-design.md` → Use unified approach (all sections in one document)

**The injection guide for your document type is automatically included above.**

**For unified `system-design.md` (single-tier projects):**

### Structure (adapt based on project type):
1. **Overview**: System purpose, high-level architecture, key use cases
2. **Architecture & Layers**: Pattern choice, major components, and relationships between layers
3. **Layer Responsibilities**: For each layer (e.g., Presentation / Application / Domain), specify WHAT it owns and HOW it collaborates (NO internal state schemas, NO UI layout details)
4. **Domain Concepts & Data Ownership**: Key entities/aggregates and which layer owns/updates them (describe concepts, NOT fields or visual representation)
5. **Public Interfaces & External Contracts**: APIs, service interfaces, events, or database schemas that cross process boundaries (describe interface names and operations in plain language: purpose + inputs + outputs; NOT language-specific syntax)
6. **Execution Flow / Runtime Behavior** (if real-time, game, or background processing): High-level loop/flow description (who owns the loop, who calls whom, in which order), without platform-specific APIs or detailed timing logic
7. **Technology Stack**: Framework + version, database, key libraries
8. **Non-Functional Requirements** (if PRD mentions): Security, performance, integrations

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

**If YES to all → Output using XML tags per rules.md. If NO → Fix first!**
