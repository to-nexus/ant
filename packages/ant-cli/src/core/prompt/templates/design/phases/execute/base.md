════════════════════════════════════════════════════════════════════════════════
🚨🚨🚨 CRITICAL: READ THIS FIRST 🚨🚨🚨
════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
YOUR LINE BUDGET: Look for "MAX [N] lines" in task description below.

CHAPTER LIMIT based on budget:
- Budget ≤ 50 lines → Create EXACTLY 1 chapter
- Budget 51-80 lines → Create 1-2 chapters MAX
- Budget 81-120 lines → Create 2-3 chapters MAX

STRUCTURE PER CHAPTER:
- Maximum 5 subsections (###)
- Each subsection: 3-8 bullet points
- Each bullet: ONE sentence only

IF YOU CREATE MORE CHAPTERS THAN ALLOWED, YOU WILL FAIL THIS TASK!
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{#if lastSectionNumber}}
🚨 CONTINUE SECTION NUMBERING FROM {{lastSectionNumber}}! 🚨
════════════════════════════════════════════════════════════════════════════════

**EXISTING DOCUMENT DETECTED**

**Last section in document: ## {{lastSectionNumber}}.**
**Your first section MUST be: ## {{add lastSectionNumber 1}}.**

**YOUR OUTPUT MUST FOLLOW THIS FORMAT:**
```
<append path="outputs/design/system-design.md">

## {{add lastSectionNumber 1}}. [Your First Topic]
...

## {{add lastSectionNumber 2}}. [Your Second Topic]
...

<!-- LAST_SECTION: {{add lastSectionNumber 2}} -->
</append>
```

**⚠️ CRITICAL INSTRUCTIONS:**
1. Start sections from {{add lastSectionNumber 1}}, {{add lastSectionNumber 2}}, etc.
2. **END your output with metadata comment**: `<!-- LAST_SECTION: N -->` where N is your LAST section number
3. Remove the old metadata line (it will be at the end of existing document)
4. NEVER reuse numbers 1 through {{lastSectionNumber}}

{{else}}
════════════════════════════════════════════════════════════════════════════════
🆕 NEW DOCUMENT - START FROM ## 1.
════════════════════════════════════════════════════════════════════════════════

**This is the first task.**

**YOUR OUTPUT MUST FOLLOW THIS FORMAT:**
```
<file path="outputs/design/system-design.md">

# System Design Document: [Project Name]

## 1. Overview
...

## 2. Architecture
...

<!-- LAST_SECTION: 2 -->
</file>
```

**⚠️ CRITICAL: END your document with**: `<!-- LAST_SECTION: N -->` where N is your LAST section number

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
- If budget ≤ 50 lines → Create 1 chapter
- If budget 51-80 lines → Create 1-2 chapters
- If budget 81-120 lines → Create 2-3 chapters

**For each chapter:**
- **Maximum 5 subsections (###)**
- **Each subsection: 3-8 bullet points MAX**
- **Each bullet: ONE sentence (no sub-bullets)**
- **NO code blocks > 10 lines**

These structural limits ensure you stay within your line budget.
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
## 📐 DESIGN DOCUMENT STRUCTURE GUIDE
════════════════════════════════════════════════════════════════════════════════

**Structure your sections logically** (adapt based on project type):

### Overview Section (if first task)
- System purpose (2-3 sentences)
- High-level architecture (text diagram or 1 paragraph)
- Core use cases (bullet list, ≤5 items)

### Architecture Section
- Pattern choice + rationale (e.g., "Layered - separates UI/logic/data")
- Major components (list with 1-sentence responsibility each)
- Data flow (how data moves through system)

### Component/Module Design
- List major components/modules (≤5)
- For each: Purpose (1 sentence) + Interface (type definition ≤10 lines) + Dependencies

### Data Models (SKIP if no backend)
- List entities with fields ONLY. NO SQL. NO ORM code.
- State relationships (e.g., "User 1:N Tasks")

### API Contracts (SKIP if no API)
- List endpoints with request/response types ONLY. NO handler code.

### Technology Stack
- Framework: [name + version]
- Database: [name] (if applicable)
- Key libraries: [list 3-5]
- Rationale: "Per PRD" OR "Chosen because [1 sentence]"

### Non-Functional Requirements (ONLY if PRD mentions)
- Security: Auth mechanism (if needed)
- Performance: Caching strategy (if needed)
- Integration: External APIs (if needed)

**⚠️ CRITICAL**: Number your sections based on what already exists in the document!
- If this is the first task: Start with "## 1. Overview"
- If continuing: Start with the next available number

════════════════════════════════════════════════════════════════════════════════
## 🚫 ABSOLUTELY FORBIDDEN (Unless PRD EXPLICITLY requests)
════════════════════════════════════════════════════════════════════════════════

- ❌ Deployment architecture / CI/CD pipelines
- ❌ Infrastructure planning / cloud setup / Kubernetes
- ❌ Operations / monitoring / alerting
- ❌ Migration plans / rollout strategies
- ❌ Test plans / QA schedules
- ❌ Project timelines / milestones / team structure
- ❌ Budget / cost analysis

**Focus on WHAT to build and HOW components interact, NOT operational concerns.**

════════════════════════════════════════════════════════════════════════════════
## ✍️ WRITING RULES
════════════════════════════════════════════════════════════════════════════════

### Absolute Rules:
1. **Conciseness**: 1 sentence per point, NO paragraphs
2. **Bullet Lists**: Use lists, not prose
3. **No Code Implementations**: Only interfaces/signatures (≤10 lines each)
4. **No Tutorials**: Design decisions only, NOT "What is React?" explanations
5. **Chapter Count**: ONE task = ONE chapter (rarely TWO if task is large)
6. **Line Budget**: System enforces via token limits - focus on high-value content

### Forbidden:
- ❌ Function bodies / implementations
- ❌ React/Vue component code
- ❌ SQL CREATE statements
- ❌ Config file contents
- ❌ "Let me explain..." tutorials

### Allowed:
- ✅ Interface/type definitions (brief)
- ✅ API signatures (1 line, NO implementation)
- ✅ Pseudocode/algorithms (high-level only)
- ✅ Simple diagrams (ASCII/text)

### Example - GOOD (concise):
```
✅ Architecture: Layered (Presentation/Domain/Infrastructure)
✅ State: React Context API for global user state
✅ API: REST endpoints - GET /tasks, POST /tasks, DELETE /tasks/:id
✅ Database: PostgreSQL with tasks, users tables
```

### Example - BAD (verbose):
```
❌ "The architecture follows a layered pattern which separates concerns 
into three distinct layers. The presentation layer handles UI rendering..."

THIS IS A TUTORIAL, NOT A DESIGN!
```

════════════════════════════════════════════════════════════════════════════════

**FINAL CHECKLIST**:
1. ✅ Followed PRD constraints (tech stack, scope)?
2. ✅ Skipped sections not applicable to project type?
3. ✅ Stayed within YOUR task's line budget?
4. ✅ Created only 1-2 chapters MAX (not 3+)?
5. ✅ Concise (1 sentence per point)?
6. ✅ NO code implementations?
7. ✅ NO forbidden sections (deployment, ops, monitoring)?

**If YES to all → Output using XML tags. If NO → Fix first!**
