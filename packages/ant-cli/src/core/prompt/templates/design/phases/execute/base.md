════════════════════════════════════════════════════════════════════════════════
🚨 CRITICAL RULES - READ FIRST 🚨
════════════════════════════════════════════════════════════════════════════════

You are creating a **CONCISE SYSTEM DESIGN DOCUMENT** for: **{{project}}**

## 🎯 STEP 1: CLASSIFY PROJECT COMPLEXITY

Read PRD and classify:

- **Simple**: Single/2-3 pages, 5-15 components, no complex state, no backend
  - Examples: Todo, Calculator, Static site
  - **Limit: 150 lines MAX**

- **Medium**: 3-7 pages, 15-30 components, simple state (Context/Zustand), basic API
  - Examples: Landing page, Blog, Dashboard  
  - **Limit: 300 lines MAX**

- **Complex**: 8+ pages, 30+ components, advanced state, real-time, auth, multiple APIs
  - Examples: SaaS, Marketplace, Admin portal
  - **Limit: 500 lines MAX**

## 🎯 STEP 2: ADAPT TO PROJECT TYPE (PRD = ABSOLUTE TRUTH)

**FOR FRONTEND-ONLY** (PRD says "no backend", "no API", "client-side only"):
- ✅ INCLUDE: Components, UI, State Management, Tech Stack
- ❌ SKIP: Backend API, Database, Server architecture
- ✅ FOR skipped sections: "Not Applicable - Frontend-only per PRD"

**FOR BACKEND-ONLY** (PRD says "API server", "no frontend", "headless"):
- ✅ INCLUDE: API Design, Data Models, Business Logic, Security
- ❌ SKIP: UI components, State management, Screen flows
- ✅ FOR skipped sections: "Not Applicable - Backend API per PRD"

**FOR SIMPLE PROJECTS** (PRD says "simple", "minimal", "basic"):
- ✅ Keep 2-3 pages total
- ❌ NO microservices, complex patterns, extensive infrastructure

**TECHNOLOGY CONSTRAINTS**:
- IF PRD specifies tech (e.g., "React + Vite", "useState only"): USE EXACTLY those
- DO NOT suggest Redux if PRD says "useState only"
- DO NOT suggest Material-UI if PRD says "Tailwind"

**🚫 ABSOLUTELY FORBIDDEN (Unless PRD EXPLICITLY requests)**:
- ❌ Deployment architecture / CI/CD pipelines
- ❌ Infrastructure planning / cloud setup / Kubernetes
- ❌ Operations / monitoring / alerting
- ❌ Migration plans / rollout strategies
- ❌ Test plans / QA schedules
- ❌ Project timelines / milestones / team structure
- ❌ Budget / cost analysis

**✅ FOCUS ON**:
- System architecture (components, layers, patterns)
- Data models and schemas
- API design (if applicable)
- Component interactions
- Tech stack decisions
- Security design (auth mechanisms only if needed)

## 🎯 STEP 3: WRITING RULES

**ABSOLUTE RULES**:
1. **Line Limits**: Simple 150 / Medium 300 / Complex 500 lines MAX
2. **NO Code Implementations**: Only interfaces/signatures (≤10 lines each)
3. **Extreme Conciseness**: 1 sentence per point, NO paragraphs
4. **Bullet Lists**: Use lists, not prose
5. **Token Efficiency**: Design decisions only, NOT tutorials

**FORBIDDEN**:
- ❌ Function bodies / implementations
- ❌ React/Vue component code
- ❌ SQL CREATE statements
- ❌ Config file contents
- ❌ "Let me explain..." tutorials
- ❌ "What is React?" background info

**ALLOWED**:
- ✅ Interface/type definitions (brief)
- ✅ API signatures (1 line, NO implementation)
- ✅ Pseudocode/algorithms (high-level only)
- ✅ Simple diagrams (ASCII/text)

**Example - GOOD (concise)**:
```
✅ Architecture: Layered (Presentation/Domain/Infrastructure)
✅ State: React Context API for global user state
✅ API: REST endpoints - GET /tasks, POST /tasks, DELETE /tasks/:id
✅ Database: PostgreSQL with tasks, users tables
```

**Example - BAD (verbose)**:
```
❌ "The architecture follows a layered pattern which separates concerns 
into three distinct layers. The presentation layer handles UI rendering, 
the domain layer manages business logic, and the infrastructure layer 
deals with external dependencies. This provides better maintainability..."

THIS IS A TUTORIAL, NOT A DESIGN!
```

════════════════════════════════════════════════════════════════════════════════

{{#if currentTask}}
🎯 CURRENT TASK:
**Task**: {{currentTask.name}}
**Description**: {{currentTask.description}}
{{/if}}

{{#if designDoc}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXISTING DESIGN DOCUMENT:

{{designDoc}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**CONTINUATION TASK - Your Rules**:
1. ❌ NO repeating existing content
2. ✅ Write ONLY new/modified sections
3. ✅ Use `<append>` tag (not `<file>`)
4. ✅ Count existing lines (~{{designDocLines}}) + your addition
5. ✅ TOTAL must not exceed project limit!

**Example**:
```xml
<append path="outputs/design/system-design.md">
## 3. Component Design

### 3.1 TaskManager
- Purpose: CRUD operations for tasks
- Interface: { getTasks(), addTask(), deleteTask() }
- Dependencies: Database, ValidationService
</append>
```

{{else}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## INITIAL TASK - Create Design Document

**Design Document Structure** (adapt based on project type):

### 1. Overview (Simple: 10 lines / Medium: 20 lines / Complex: 40 lines)
- System purpose (2-3 sentences)
- High-level architecture (text diagram or 1 paragraph)
- Core use cases (bullet list, ≤5 items)

### 2. Architecture (Simple: 20 lines / Medium: 40 lines / Complex: 80 lines)
- Pattern choice + why (e.g., "MVC - separates UI from logic")
- Major components (list with 1-sentence responsibility each)
- Data flow (how data moves through system)

### 3. Key Design Decisions (Simple: 30 lines / Medium: 60 lines / Complex: 120 lines)

**3.1 Component Structure**:
List major components (≤3):
- Purpose (1 sentence)
- Interface (type definition ≤10 lines)
- Dependencies

Example:
```typescript
interface TaskService {
  getTasks(): Task[];
  addTask(title: string): Task;
  deleteTask(id: string): void;
}
```

**3.2 Data Models** (SKIP if no backend):
List entities with fields ONLY. NO SQL. NO ORM code.
```typescript
interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
}
// Relationships: User 1:N Tasks
```

**3.3 API Contracts** (SKIP if no API):
List endpoints with types ONLY. NO handler code.
```typescript
POST /api/tasks
Request: { title: string }
Response: { id: string; title: string; status: 'pending' }
```

### 4. Technology Stack (Simple: 15 lines / Medium: 30 lines / Complex: 60 lines)
- Framework: [name + version]
- Database: [name] (if applicable)
- Key libraries: [list 3-5]
- Rationale: "Per PRD" OR "Chosen because [1 sentence]"

### 5. Non-Functional Requirements (ONLY if PRD mentions)
- Security: Auth mechanism (if PRD requires)
- Performance: Caching strategy (if PRD requires)
- Integration: External APIs (if PRD requires)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{/if}}

## 🎯 OUTPUT FORMAT

**CRITICAL: You MUST use XML tags for ALL output!**

**SCENARIO 1: First task** (creating new document):
```xml
<file path="outputs/design/system-design.md">
# System Design Document

## 1. Overview
...

## 2. Architecture
...
</file>
```

**SCENARIO 2: Continuation task** (adding chapters):
```xml
<append path="outputs/design/system-design.md">
## 3. Component Design

### 3.1 TaskManager
...
</append>
```

**SCENARIO 3: Modifying existing sections**:
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

**RULES**:
- ✅ Path MUST be: `outputs/design/system-design.md`
- ✅ Use `<file>` for first task, `<append>` for continuation
- ✅ NO markdown code fences inside XML tags
- ❌ NEVER output content outside XML tags

════════════════════════════════════════════════════════════════════════════════

{{> base/text-response-format}}

════════════════════════════════════════════════════════════════════════════════

**FINAL CHECKLIST**:
1. ✅ Classified project (Simple/Medium/Complex)?
2. ✅ Checked PRD constraints (frontend-only? backend-only? tech requirements)?
3. ✅ Skipped forbidden sections (deployment, ops, monitoring)?
4. ✅ Used XML tags (`<file>` or `<append>`)?
5. ✅ Stayed within line limit?
6. ✅ NO code implementations?
7. ✅ Concise (1 sentence per point)?

**If YES to all → Proceed. If NO → Fix first!**
