════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: READ THIS FIRST 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
YOUR LINE BUDGET: Look for "MAX [N] lines" in task description below.

**IMPORTANT: Document Type Detection**
- **API Contract** (api-contract.md): 80-200 lines MAX (binding specification)
- **Frontend** (fe-system-design.md): 150-750 lines MAX (consumer perspective)
- **Backend** (be-system-design.md): 150-750 lines MAX (implementation perspective)
- **Unified** (system-design.md): 150-750 lines MAX (single-tier projects)

CHAPTER LIMIT based on budget:
- Budget ≤ 60 lines → Create EXACTLY 1 chapter
- Budget 61-120 lines → Create 1-2 chapters MAX
- Budget 121-200 lines → Create 2-3 chapters MAX
- Budget 201-300 lines → Create 3-5 chapters MAX
- Budget 301+ lines → Create 4-8 chapters MAX

STRUCTURE PER CHAPTER:
- Maximum 8 subsections (###) for complex chapters
- Each subsection: 4-10 bullet points
- Each bullet: 1-2 sentences (keep concise!)

⚠️ Focus on quality and completeness within your budget, not artificial limits!
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{#if lastSectionNumber}}
🚨 CONTINUE SECTION NUMBERING FROM {{lastSectionNumber}}! 🚨
════════════════════════════════════════════════════════════════════════════════

**EXISTING DOCUMENT DETECTED**

**Last section in document: ## {{lastSectionNumber}}.**
**Your first section MUST be: ## {{add lastSectionNumber 1}}.**

**YOUR OUTPUT MUST FOLLOW THIS FORMAT:**

**⚠️ IMPORTANT: Check your task description for the target file name!**
- If description mentions "api-contract.md", use that file
- If description mentions "fe-system-design.md", use that file
- If description mentions "be-system-design.md", use that file
- Otherwise, use "system-design.md"

```
<append path="outputs/design/[FILE-NAME-FROM-TASK-DESCRIPTION]">

## {{add lastSectionNumber 1}}. [Your First Topic]
...

## {{add lastSectionNumber 2}}. [Your Second Topic]
...

<!-- LAST_SECTION: {{add lastSectionNumber 2}} -->
</append>
```

**⚠️ CRITICAL INSTRUCTIONS:**
1. **USE THE CORRECT FILE NAME** from your task description
2. Start sections from {{add lastSectionNumber 1}}, {{add lastSectionNumber 2}}, etc.
3. **END your output with metadata comment**: `<!-- LAST_SECTION: N -->` where N is your LAST section number
4. Remove the old metadata line (it will be at the end of existing document)
5. NEVER reuse numbers 1 through {{lastSectionNumber}}

{{else}}
════════════════════════════════════════════════════════════════════════════════
🆕 NEW DOCUMENT - START FROM ## 1.
════════════════════════════════════════════════════════════════════════════════

**This is the first task for this document.**

**⚠️ IMPORTANT: Check your task description for the target file name!**
- If description mentions "Create api-contract.md", use `api-contract.md` → **API Contract Document**
- If description mentions "Create fe-system-design.md", use `fe-system-design.md` → **Frontend Design Document**
- If description mentions "Create be-system-design.md", use `be-system-design.md` → **Backend Design Document**
- Otherwise, use `system-design.md` → **System Design Document**

**YOUR OUTPUT MUST FOLLOW THIS FORMAT:**
```
<file path="outputs/design/[FILE-NAME-FROM-TASK-DESCRIPTION]">

# [API Contract/Frontend Design/Backend Design/System Design] Document: [Project Name]

## 1. Overview
...

## 2. [Topic]
...

<!-- LAST_SECTION: 2 -->  <!-- ⚠️ This is an EXAMPLE for a 2-section document -->
</file>
```

**⚠️ CRITICAL INSTRUCTIONS:**
1. **USE THE CORRECT FILE NAME** from your task description
2. **Use appropriate title**:
   - `api-contract.md` → "API Contract Document"
   - `fe-system-design.md` → "Frontend Design Document"
   - `be-system-design.md` → "Backend Design Document"
   - `system-design.md` → "System Design Document"
3. **END your document with**: `<!-- LAST_SECTION: N -->` where N is your LAST section number

{{/if}}
════════════════════════════════════════════════════════════════════════════════
🎯 CURRENT TASK
════════════════════════════════════════════════════════════════════════════════

You are creating a **CONCISE SYSTEM DESIGN DOCUMENT** for: **{{project}}**

{{#if currentTask}}
**Task**: {{currentTask.name}}
**Description**: {{currentTask.description}}

🚨 STRUCTURAL CONSTRAINTS 🚨
**Chapter limit based on your line budget:**
- If budget ≤ 60 lines → Create 1 chapter
- If budget 61-120 lines → Create 1-2 chapters
- If budget 121-200 lines → Create 2-3 chapters
- If budget 201-300 lines → Create 3-5 chapters
- If budget 301+ lines → Create 4-8 chapters

**For each chapter:**
- **Maximum 8 subsections (###)** (adjust based on complexity)
- **Each subsection: 4-10 bullet points** (adjust based on detail needed)
- **Each bullet: 1-2 sentences** (keep concise but complete)
- **Code blocks ≤ 20 lines** (use sparingly for critical examples)

Balance completeness with conciseness - meet your line budget while covering all requirements.
{{/if}}

════════════════════════════════════════════════════════════════════════════════
## 📋 REQUIREMENTS (SOURCE OF TRUTH)
════════════════════════════════════════════════════════════════════════════════

{{spec}}

**⚠️ PRD = ABSOLUTE TRUTH**
- Follow PRD's technical constraints exactly (e.g., "React + Vite", "useState only")
- Skip sections not applicable to PRD (e.g., no backend → skip API/Database sections)
- For skipped sections, state: "Not Applicable - [reason] per PRD"

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
1. **Overview**: System purpose, architecture, use cases
2. **Architecture**: Pattern choice, major components, data flow
3. **Component/Module Design**: List (≤5) with purpose + interface + dependencies
4. **Data Models** (if database): Entities with fields, relationships
5. **API Design** (if applicable): Endpoints with request/response types, auth
6. **Technology Stack**: Framework + version, database, key libraries
7. **Non-Functional Requirements** (if PRD mentions): Security, performance, integrations

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
1. ✅ Followed PRD constraints (tech stack, scope)?
2. ✅ Skipped sections not applicable to project type?
3. ✅ Stayed within YOUR task's line budget?
4. ✅ Created appropriate number of chapters for your budget?
5. ✅ Balanced conciseness with completeness (1-2 sentences per point)?
6. ✅ NO code implementations?
7. ✅ NO forbidden sections (deployment, ops, monitoring)?
8. ✅ Covered all critical architectural decisions and components?

**If YES to all → Output using XML tags. If NO → Fix first!**

