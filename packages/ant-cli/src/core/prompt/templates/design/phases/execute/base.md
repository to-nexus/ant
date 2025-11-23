════════════════════════════════════════════════════════════════════════════════
🎯 CURRENT TASK
════════════════════════════════════════════════════════════════════════════════

You are creating a **CONCISE SYSTEM DESIGN DOCUMENT** for: **{{project}}**

{{#if currentTask}}
**Task**: {{currentTask.name}}
**Description**: {{currentTask.description}}
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
## 📄 DOCUMENT STATUS
════════════════════════════════════════════════════════════════════════════════

{{#if designDoc}}
**EXISTING DESIGN DOCUMENT** (~{{designDocLines}} lines):

{{designDoc}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**YOUR TASK: CONTINUATION**
- ❌ NO repeating existing content
- ✅ Write ONLY your assigned chapters (see task description above)
- ✅ Use `<append>` tag to add new content
- ✅ Track total lines: existing (~{{designDocLines}}) + your addition
- ✅ TOTAL must not exceed project limit (150/300/500 lines)!

{{else}}

**YOUR TASK: CREATE NEW DOCUMENT**
- ✅ This is the first task
- ✅ Use `<file>` tag to create the document
- ✅ Follow the structure guide below
- ✅ Stay within your task's line budget (see task description above)

{{/if}}

════════════════════════════════════════════════════════════════════════════════
## 📐 DESIGN DOCUMENT STRUCTURE
════════════════════════════════════════════════════════════════════════════════

Adapt sections based on project type (frontend-only / backend-only / full-stack):

### 1. Overview
- System purpose (2-3 sentences)
- High-level architecture (text diagram or 1 paragraph)
- Core use cases (bullet list, ≤5 items)

### 2. Architecture
- Pattern choice + rationale (e.g., "Layered - separates UI/logic/data")
- Major components (list with 1-sentence responsibility each)
- Data flow (how data moves through system)

### 3. Key Design Decisions

**3.1 Component Structure**:
- List major components (≤5)
- For each: Purpose (1 sentence) + Interface (type definition ≤10 lines) + Dependencies

**3.2 Data Models** (SKIP if no backend):
- List entities with fields ONLY. NO SQL. NO ORM code.
- State relationships (e.g., "User 1:N Tasks")

**3.3 API Contracts** (SKIP if no API):
- List endpoints with request/response types ONLY. NO handler code.

### 4. Technology Stack
- Framework: [name + version]
- Database: [name] (if applicable)
- Key libraries: [list 3-5]
- Rationale: "Per PRD" OR "Chosen because [1 sentence]"

### 5. Non-Functional Requirements (ONLY if PRD mentions)
- Security: Auth mechanism (if needed)
- Performance: Caching strategy (if needed)
- Integration: External APIs (if needed)

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
4. **Line Limits**: Stay within YOUR task's budget (see description)
5. **No Tutorials**: Design decisions only, NOT "What is React?" explanations

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

{{> base/text-response-format}}

════════════════════════════════════════════════════════════════════════════════

**FINAL CHECKLIST**:
1. ✅ Followed PRD constraints (tech stack, scope)?
2. ✅ Skipped sections not applicable to project type?
3. ✅ Stayed within YOUR task's line budget?
4. ✅ Concise (1 sentence per point)?
5. ✅ NO code implementations?
6. ✅ NO forbidden sections (deployment, ops, monitoring)?

**If YES to all → Output using XML tags. If NO → Fix first!**
