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

────────────────────────────────────────────────────────────────────────────────

{{designDoc}}

────────────────────────────────────────────────────────────────────────────────
{{/if}}

════════════════════════════════════════════════════════════════════════════════
## 📐 DOCUMENT TYPE-SPECIFIC GUIDE
════════════════════════════════════════════════════════════════════════════════

**Your document type is determined by task.targetFile:**
- `api-contract.md` - Binding API specification (WHAT interfaces exist)
- `fe-system-design.md` - Frontend architecture (HOW to consume APIs)
- `be-system-design.md` - Backend architecture (HOW to implement APIs)
- `system-design.md` - Unified design (single-tier or full-stack in one doc)

**A document type-specific guide has been automatically injected above** with:
- Required sections tailored to this document type
- Critical MECE rules (no duplication between docs)
- Code examples and anti-patterns
- Common mistakes to avoid

**If no type-specific guide appears above**, you're writing **`system-design.md` (unified)**:

### Unified System Design Structure

**Use this for:**
- Single-tier projects (frontend-only, backend-only, CLI tool)
- Full-stack projects that prefer one unified document
- Projects without separate FE/BE split

**Adapt sections based on project type** (skip non-applicable sections):

1. **Overview**: System purpose, architecture style, key use cases
2. **Responsibilities & Boundaries**: Architecture pattern (Layered, Hexagonal, MVC, ECS, etc.), component/layer boundaries
3. **State Model & Ownership**: State classification (Domain/Session/UI), single source of truth per state type
4. **Core Domain Concepts**: Key entities, relationships, domain invariants (describe concepts, NOT full schemas)
5. **Core Interfaces & Contracts**: Boundary contracts (services, engines, ports, providers) - define once, reference elsewhere
6. **Main Execution Flows**: Key flows (e.g., "user action flow", "game loop") - high-level who-calls-whom
7. **Technology Stack**: Framework, database (if any), key libraries, platform constraints
8. **Non-Functional Requirements** (if PRD specifies): Security, performance, integrations

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

**If YES to all → Output using XML tags per rules.md. If NO → Fix first!**
