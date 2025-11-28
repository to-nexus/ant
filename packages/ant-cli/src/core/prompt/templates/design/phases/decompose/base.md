You are analyzing requirements to break them into chapter-based design tasks.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIREMENTS:
{{spec}}

{{#if hasExistingDesign}}
📄 EXISTING DESIGN DETECTED

Previous design:
{{designPreview}}
{{else}}
🆕 NEW DESIGN (no previous design)
{{/if}}

{{#if hasExistingCode}}
📂 EXISTING CODEBASE DETECTED

This is an evolution or refactor task. Consider the current implementation:
{{codePreview}}
{{/if}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## TASK BREAKDOWN STRATEGY

**⚠️ CRITICAL: Analyze project scope CAREFULLY before breaking down!**

### Project Scope Analysis

**STEP 1: Analyze Requirements Complexity**

Ask yourself these questions:
1. **Backend Complexity**: Does it need a backend? Database? How many tables/entities?
2. **Feature Count**: How many distinct user-facing features?
3. **Pages/Views**: How many different screens/pages?
4. **External Systems**: Does it integrate with external APIs, payment, auth services?
5. **User Roles**: Multiple user types with different permissions?

**STEP 2: Score the Project**

Count YES answers:
- ❌ NO backend → Frontend-only (STOP counting, this is Simple!)
- ✅ Backend with 1-3 tables → +1
- ✅ Backend with 4+ tables or complex relationships → +2
- ✅ Multiple user roles/auth → +1
- ✅ 5+ distinct features → +1
- ✅ External integrations (payment, email, SMS) → +1
- ✅ Multiple pages (5+) → +1

**CRITICAL: If "NO backend" → Automatically Simple, ignore other factors!**

**STEP 3: Determine Total Line Budget**

**Score 0 (Simple)**: **120-180 lines MAX**
- Pure frontend, no backend
- Single page or 2-3 simple views
- No database, no auth
- **Create 2 tasks, ~60-90 lines each** (buffer for LLM overrun)

**Score 1-2 (Medium)**: **225-375 lines MAX**
- Simple backend OR multiple frontend features
- Basic database (1-3 tables)
- 3-5 pages/views
- **Create 3 tasks, ~75-125 lines each** (buffer for LLM overrun)

**Score 3+ (Complex)**: **450-750 lines MAX**
- Full-stack with multiple features
- Complex database (4+ tables with relationships)
- Authentication, multiple user roles
- 5+ pages, external integrations
- **Create 4 tasks, ~112-187 lines each** (buffer for LLM overrun)

**⚠️ STAY WITHIN YOUR BUDGET - BE REALISTIC!**
- Choose appropriate budget based on actual system complexity
- Focus on architecture decisions, NOT implementation details
- Skip non-applicable sections (e.g., no backend? No database chapter!)
- Balance completeness with conciseness - cover all critical aspects

**STEP 4: Divide Budget Across Tasks**
- Divide total budget by number of tasks
- Example: 200 lines / 3 tasks = ~65 lines per task
- Each task description MUST include its line budget

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## TASK CREATION RULES

### Incremental Document Building
- ALL tasks write to the SAME design document file
- Task 1: Creates document with first sections
- Task 2+: Appends new sections to existing document
- Later tasks build upon earlier content

### Task Naming
- Task 1: "Design Document: [Section Topics]"
- Task 2+: "Design Document: [Section Topics]" (continues same doc)

### Task Description Must Include
- Which **topics/sections** to write (NO chapter numbers!)
- Key content to cover
- **Length budget** (see below)
- How it builds upon previous sections (if applicable)

### Length Budgets (MANDATORY)

**Total line budgets based on project scope:**
- **Minimal (single component/utility)**: 80-150 lines total
- **Simple (frontend-only, 1-3 features)**: 150-300 lines total
- **Medium (multi-feature OR simple backend)**: 300-600 lines total  
- **Complex (full-stack, multi-page)**: 600-1200 lines total
- **Very Complex (microservices, multi-module)**: 1200-2000 lines total

**⚠️ RECOMMENDED MAXIMUM: 2000 lines - Only exceed for exceptionally complex systems!**

**Budget allocation per task:**
- Divide total budget evenly across N tasks
- Example: 270 lines / 3 tasks = 90 lines per task MAX

**Every task description MUST state:**
```
"Write sections on [topics]. 
MAX [N] lines for this task! 
(Total doc limit: [Total] lines across all tasks)"
```

**Examples:**
- Minimal project (120 lines / 1 task): "MAX 120 lines total!"
- Simple project (240 lines / 2 tasks): "MAX 120 lines for this task! (Total limit: 240 lines)"
- Medium project (450 lines / 3 tasks): "MAX 150 lines for this task! (Total limit: 450 lines)"
- Complex project (900 lines / 4 tasks): "MAX 225 lines for this task! (Total limit: 900 lines)"
- Very Complex project (1600 lines / 5 tasks): "MAX 320 lines for this task! (Total limit: 1600 lines)"

### Priority Assignment
- Use 200-299 range
- Lower number = higher priority
- Example: 220, 240, 260, 280 for sequential chapters

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🚫 FORBIDDEN TASK TYPES

DO NOT CREATE tasks for:
- ❌ Deployment / CI/CD / Infrastructure
- ❌ Operations / Monitoring
- ❌ Migration / Rollout strategies
- ❌ Test planning / QA
- ❌ Project timeline / Resource planning
- ❌ "Final verification" or "review" tasks
- ❌ Separate documents (all tasks → ONE document)
- ❌ Overly granular tasks (e.g., "Define one API endpoint")

**Why?** These are project management/operations, NOT software architecture design.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## EXAMPLES

**Example 1: Minimal (1 task, 120 lines total)**
```
Input: "Add a counter button that shows current count"

{
  "tasks": [{
    "id": "design-doc",
    "name": "Create Design Document",
    "description": "Design the simple counter button component with state management. MAX 120 lines total!",
    "priority": 250
  }]
}
```

**Example 2: Simple (2 tasks, 240 lines total)**
```
Input: "Add a todo list feature with localStorage persistence"

{
  "tasks": [
    {
      "id": "design-arch-data",
      "name": "Design Document: Architecture & Data Model",
      "description": "Write sections on: System overview, todo data model, and localStorage strategy. MAX 120 lines for this task! (Total limit: 240 lines across 2 tasks)",
      "priority": 220
    },
    {
      "id": "design-ui-components",
      "name": "Design Document: UI Components & Interactions",
      "description": "Write sections on: Component hierarchy, user interactions, and state management. MAX 120 lines for this task! (Total limit: 240 lines, currently ~120 after task 1)",
      "priority": 240
    }
  ]
}
```

**Example 3: Medium (3 tasks, 450 lines total)**
```
Input: "Design a task management system with user authentication, task CRUD, and real-time notifications"

{
  "tasks": [
    {
      "id": "design-architecture",
      "name": "Design Document: System Architecture",
      "description": "Write sections on: Architecture pattern selection, layer definitions, technology stack, real-time architecture. MAX 150 lines! (Total limit: 450 lines across 3 tasks)",
      "priority": 220
    },
    {
      "id": "design-data-api",
      "name": "Design Document: Data Models & API",
      "description": "Write sections on: Database schema (users, tasks, notifications), RESTful API endpoints, WebSocket integration. MAX 150 lines! (Total limit: 450 lines, currently ~150 after task 1)",
      "priority": 240
    },
    {
      "id": "design-frontend-security",
      "name": "Design Document: Frontend & Security",
      "description": "Write sections on: Component hierarchy, state management, authentication flow, authorization. MAX 150 lines! (Total limit: 450 lines, currently ~300 after task 2)",
      "priority": 260
    }
  ]
}
```

**Example 4: Complex (4 tasks, 900 lines total)**
```
Input: "Design full-stack e-commerce platform with product catalog, cart, checkout, payment integration, admin panel, and analytics"

{
  "tasks": [
    {
      "id": "design-architecture",
      "name": "Design Document: System Architecture",
      "description": "Write sections on: Overall architecture, microservices design (if applicable), technology stack, scalability considerations. MAX 225 lines! (Total limit: 900 lines across 4 tasks)",
      "priority": 220
    },
    {
      "id": "design-data-api",
      "name": "Design Document: Data Models & API",
      "description": "Write sections on: Database schema (products, orders, users, inventory), RESTful API design, GraphQL endpoints (if applicable). MAX 225 lines! (Total limit: 900 lines, currently ~225 after task 1)",
      "priority": 240
    },
    {
      "id": "design-frontend",
      "name": "Design Document: Frontend Architecture",
      "description": "Write sections on: Component architecture, routing structure, state management (Redux/Context), design system, responsive design. MAX 225 lines! (Total limit: 900 lines, currently ~450 after task 2)",
      "priority": 260
    },
    {
      "id": "design-integrations",
      "name": "Design Document: Integrations & Security",
      "description": "Write sections on: Payment gateway integration, authentication & authorization, analytics integration, admin dashboard features. MAX 225 lines! (Total limit: 900 lines, currently ~675 after task 3)",
      "priority": 280
    }
  ]
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🔀 DUAL DESIGN MODE: Frontend + Backend Separation

**IF the project requires BOTH distinct Frontend AND Backend components:**

### Detection Criteria
- Project has BOTH UI requirements AND backend/database requirements
- Mentions "SPA + API server", "React frontend with Express backend", or similar
- Has API endpoints AND UI components
- Explicitly separates frontend and backend concerns

### Task Breakdown Strategy for Dual Design

**CRITICAL: Each document (FE and BE) gets its OWN independent line budget!**

**Analyze Frontend complexity separately:**
- Simple frontend (1-3 pages, basic state): 150-250 lines
- Medium frontend (4-6 pages, complex state): 300-500 lines
- Complex frontend (7+ pages, advanced patterns): 600-1000 lines

**Analyze Backend complexity separately:**
- Simple backend (CRUD API, 1-3 tables): 150-250 lines
- Medium backend (auth, business logic, 4-6 tables): 300-500 lines
- Complex backend (multi-service, complex data, 7+ tables): 600-1000 lines

**Create SEPARATE task groups for FE and BE:**

**CRITICAL RULE: Group FE tasks together (priorities 210-229), then BE tasks (priorities 230-249)**

Example: Medium Frontend (300 lines, 2 tasks) + Medium Backend (330 lines, 2 tasks)
```json
{
  "tasks": [
    {
      "id": "design-fe-overview",
      "name": "Frontend Design: Overview & Architecture",
      "description": "Create fe-system-design.md with: System overview, component architecture, routing, state management. MAX 150 lines! (FE total budget: 300 lines)",
      "priority": 210
    },
    {
      "id": "design-fe-api-ui",
      "name": "Frontend Design: API Integration & UI",
      "description": "Append to fe-system-design.md with: API integration layer (DTOs, endpoints - consumer view), UI/UX design, styling approach. MAX 150 lines! (FE total budget: 300 lines, currently ~150 after task 1)",
      "priority": 220
    },
    {
      "id": "design-be-overview",
      "name": "Backend Design: Overview & Data",
      "description": "Create be-system-design.md with: System overview, architecture layers, database design, entity relationships. MAX 165 lines! (BE total budget: 330 lines)",
      "priority": 230
    },
    {
      "id": "design-be-api-service",
      "name": "Backend Design: API & Services",
      "description": "Append to be-system-design.md with: API specification (endpoints, DTOs - MUST MATCH FE), service layer, business logic, error handling. MAX 165 lines! (BE total budget: 330 lines, currently ~165 after task 1)",
      "priority": 240
    }
  ]
}
```

**Task Grouping Strategy:**
- **Tasks 1-N**: Complete `fe-system-design.md` (priorities 210, 211, 212, ...)
- **Tasks N+1 onwards**: Complete `be-system-design.md` (priorities 230, 231, 232, ...)
- This ensures FE document is fully completed before starting BE document

**KEY RULES for Dual Design Tasks:**
1. **Separate Task Groups**: Create FE tasks first (complete fe-system-design.md), then BE tasks (complete be-system-design.md)
2. **Independent Budgets**: FE and BE documents each have their own 150-1000 line limit (NOT shared, scale based on complexity)
3. **Explicit File Naming**: 
   - First FE task: "Create fe-system-design.md with..."
   - Subsequent FE tasks: "Append to fe-system-design.md with..."
   - First BE task: "Create be-system-design.md with..."
   - Subsequent BE tasks: "Append to be-system-design.md with..."
4. **API Protocol Alignment**: Both FE and BE tasks MUST emphasize DTOs and endpoints must match exactly
5. **Priority Grouping**: 
   - FE tasks: 210-229 range
   - BE tasks: 230-249 range
6. **Budget Clarity**: Each task description must state its document's total budget and current progress

**DO NOT create dual design tasks if:**
- Project is frontend-only (React app, Vue SPA with no backend) → Use `system-design.md` only
- Project is backend-only (REST API, microservice, CLI tool) → Use `system-design.md` only
- Project is fullstack SSR (Next.js, Nuxt) where FE/BE are tightly coupled → Use `system-design.md` only

**For non-dual design projects (frontend-only, backend-only, or unified):**
- **ALL tasks must write to `system-design.md`**
- **First task description must include**: "Write to system-design.md with sections..."
- **Subsequent task descriptions must include**: "Append to system-design.md with sections..."
- **NEVER use fe-system-design.md or be-system-design.md** for single-tier projects

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 FINAL CHECK: Review task names. If ANY contains these words, DELETE IT:
"Deployment", "Operations", "Migration", "Infrastructure", "Testing", "CI/CD", "Monitoring", "Rollout"

Only output tasks focused on: Architecture, Data Models, API Design, Component Design, Security Design, Performance Design

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analyze the requirements and output the JSON task breakdown:
