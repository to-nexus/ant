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

## 🔀 CONTRACT-FIRST DESIGN: Frontend + Backend Separation

**⚡ CRITICAL: When project has BOTH Frontend AND Backend, use 3-PHASE approach:**

### Detection Criteria (Dual Design Required)
- Project has BOTH UI requirements AND backend/database requirements
- Mentions "SPA + API server", "React frontend with Express backend", or similar
- Has REST/GraphQL/WebSocket API endpoints AND UI components
- Explicitly separates frontend and backend concerns

**IF detected → Use CONTRACT-FIRST 3-PHASE approach below**
**ELSE → Use unified `system-design.md` (standard mode, line 183-254)**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 📋 CONTRACT-FIRST 3-PHASE STRATEGY

**Philosophy: API Contract is the SINGLE SOURCE OF TRUTH**

**PHASE 1 (Priority 200-209): API Contract Definition** → `api-contract.md`
**PHASE 2 (Priority 210-229): Frontend Implementation** → `fe-system-design.md`
**PHASE 3 (Priority 230-249): Backend Implementation** → `be-system-design.md`

**⚠️ CRITICAL EXECUTION ORDER:**
1. **Contract FIRST** (defines interface)
2. **Frontend SECOND** (consumes contract)
3. **Backend LAST** (implements contract)

This ensures FE and BE are ALWAYS aligned!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### PHASE 1: API Contract Definition (Priority 200-209)

**Goal: Define ALL communication interfaces between FE and BE**

**Budget: 80-200 lines** (scale based on API complexity)

**Simple API (1-5 endpoints, basic CRUD)**: 80-100 lines → 1 task
**Medium API (6-15 endpoints, auth, WebSocket)**: 120-150 lines → 1-2 tasks
**Complex API (16+ endpoints, multiple services)**: 180-200 lines → 2 tasks

**Example: Simple API (1 task)**
```json
{
  "id": "design-api-contract",
  "name": "API Contract: Complete Specification",
  "description": "Create api-contract.md with: REST endpoints (all methods, paths, request/response DTOs with EXACT field names and types), WebSocket events (if applicable), error response format, authentication scheme. This is the BINDING CONTRACT for both FE and BE. MAX 100 lines!",
  "priority": 200
}
```

**Example: Complex API (2 tasks)**
```json
{
  "tasks": [
    {
      "id": "design-api-contract-core",
      "name": "API Contract: Core Endpoints & Auth",
      "description": "Create api-contract.md with: Authentication endpoints (login, register, refresh), core resource endpoints (users, main entities), request/response DTOs with EXACT types. MAX 100 lines! (Total API contract budget: 180 lines)",
      "priority": 200
    },
    {
      "id": "design-api-contract-extended",
      "name": "API Contract: Extended Features & WebSocket",
      "description": "Append to api-contract.md with: Extended feature endpoints, WebSocket event specifications, error response format, rate limiting. MAX 80 lines! (Total API contract budget: 180 lines, currently ~100 after task 1)",
      "priority": 205
    }
  ]
}
```

**REQUIRED SECTIONS in api-contract.md:**
1. **REST API Endpoints** (method, path, request DTO, response DTO, status codes)
2. **WebSocket Events** (if applicable: event names, payload schemas)
3. **Shared Type Definitions** (DTOs, enums, common types)
4. **Authentication** (token format, headers, refresh flow)
5. **Error Response Format** (standard error structure)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### PHASE 2: Frontend Implementation (Priority 210-229)

**Goal: Design FE architecture that CONSUMES api-contract.md**

**Budget: 150-750 lines** (scale based on FE complexity)

**Simple FE (1-3 pages, basic state)**: 150-250 lines → 1-2 tasks
**Medium FE (4-6 pages, complex state)**: 300-500 lines → 2-3 tasks
**Complex FE (7+ pages, advanced patterns)**: 600-750 lines → 3-4 tasks

**Example: Medium FE (2 tasks)**
```json
{
  "tasks": [
    {
      "id": "design-fe-architecture",
      "name": "Frontend: Architecture & API Integration",
      "description": "Create fe-system-design.md with: System overview, component architecture, routing structure, state management, **API client layer (MUST USE api-contract.md types - import DTOs, create type-safe API client)**. MAX 250 lines! (FE total budget: 450 lines)",
      "priority": 210
    },
    {
      "id": "design-fe-components-ui",
      "name": "Frontend: Components & UI Design",
      "description": "Append to fe-system-design.md with: Component specifications (props, state, hooks), UI/UX design (layout, styling, responsiveness), form validation, error handling. MAX 200 lines! (FE total budget: 450 lines, currently ~250 after task 1)",
      "priority": 220
    }
  ]
}
```

**CRITICAL RULES for Frontend Tasks:**
1. **First FE task MUST mention**: "MUST USE api-contract.md types"
2. **Description MUST include**: "import DTOs from api-contract.md" or "use contract types"
3. **File naming**: "Create fe-system-design.md" (first) → "Append to fe-system-design.md" (subsequent)
4. **NO API definition**: FE tasks NEVER define APIs, only consume them!
5. **MECE Compliance**: NO DTO duplication - only reference contract!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### PHASE 3: Backend Implementation (Priority 230-249)

**Goal: Design BE architecture that IMPLEMENTS api-contract.md**

**Budget: 150-750 lines** (scale based on BE complexity)

**Simple BE (CRUD, 1-3 tables)**: 150-250 lines → 1-2 tasks
**Medium BE (auth, business logic, 4-6 tables)**: 300-500 lines → 2-3 tasks
**Complex BE (multi-service, complex data, 7+ tables)**: 600-750 lines → 3-4 tasks

**Example: Medium BE (2 tasks)**
```json
{
  "tasks": [
    {
      "id": "design-be-architecture-api",
      "name": "Backend: Architecture & API Implementation",
      "description": "Create be-system-design.md with: System overview, architecture layers (controller/service/repository), **API endpoint implementation (MUST IMPLEMENT api-contract.md EXACTLY - map each endpoint, confirm request/response types match 100%)**, authentication middleware. MAX 250 lines! (BE total budget: 480 lines)",
      "priority": 230
    },
    {
      "id": "design-be-data-services",
      "name": "Backend: Data Layer & Business Logic",
      "description": "Append to be-system-design.md with: Database schema (entities, relationships, indexes), service layer design (business logic, validation, transactions), error handling strategy. MAX 230 lines! (BE total budget: 480 lines, currently ~250 after task 1)",
      "priority": 240
    }
  ]
}
```

**CRITICAL RULES for Backend Tasks:**
1. **First BE task MUST mention**: "MUST IMPLEMENT api-contract.md EXACTLY"
2. **Description MUST include**: "reference contract for DTOs" or "implement per contract"
3. **File naming**: "Create be-system-design.md" (first) → "Append to be-system-design.md" (subsequent)
4. **NO API deviation**: If deviation needed, must document WHY in design doc!
5. **MECE Compliance**: NO DTO duplication - only reference contract and describe implementation!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 🎯 MECE PRINCIPLE: Each Document's Distinct Role

**CRITICAL: Avoid content duplication between api-contract.md and implementation docs!**

**api-contract.md** = WHAT (Interface Definition):
- ✅ Endpoint specs: paths, methods, status codes
- ✅ Complete DTO definitions: all fields, types, validations
- ✅ WebSocket event schemas
- ❌ NO "how to call" (that's FE's job)
- ❌ NO "how to implement" (that's BE's job)

**fe-system-design.md** = HOW (Consumer Implementation):
- ✅ HOW to call APIs: fetch wrappers, error handling, loading states
- ✅ Component architecture, routing, state management
- ✅ Use contract types: "import LoginRequest from api-contract.md"
- ❌ NO DTO redefinition (import/use only!)

**be-system-design.md** = HOW (Provider Implementation):
- ✅ HOW to implement: service methods, business logic, DB queries
- ✅ Architecture layers, middleware, database schema
- ✅ Reference contract: "implements LoginRequest → LoginResponse per contract"
- ❌ NO DTO redefinition (reference only!)

**Example (MECE):**
```markdown
# ❌ BAD (in be-system-design.md):
POST /api/auth/login
- Request: { email: string, password: string }  ← Duplicates contract!

# ✅ GOOD (in be-system-design.md):
POST /api/auth/login
**Contract**: LoginRequest → LoginResponse (api-contract.md §3.1)
**Implementation**: Controller validates → AuthService.authenticate → JWT.sign
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 📐 Complete Example: Simple Dual Design (4 tasks total)

**Project: Todo App (Simple CRUD + Auth)**
- API: 5 endpoints (login, register, CRUD todos)
- FE: 2 pages (login, todo list)
- BE: 2 tables (users, todos)

```json
{
  "tasks": [
    {
      "id": "design-api-contract",
      "name": "API Contract: Complete Specification",
      "description": "Create api-contract.md with: Auth endpoints (POST /auth/login, POST /auth/register), Todo CRUD endpoints (GET/POST/PUT/DELETE /todos), request/response DTOs with exact field types (User: {id, email, name}, Todo: {id, title, completed, userId}), JWT auth header format, error response structure. This is BINDING for FE and BE. MAX 100 lines!",
      "priority": 200
    },
    {
      "id": "design-fe-architecture",
      "name": "Frontend: Architecture & Components",
      "description": "Create fe-system-design.md with: React component architecture, routing (/, /login), state management (Context API for auth), **API client (USE api-contract.md types - NO DTO duplication, show HOW to call APIs with fetch wrappers)**, form components (LoginForm, TodoForm). MAX 150 lines! (FE total budget: 150 lines)",
      "priority": 210
    },
    {
      "id": "design-be-architecture",
      "name": "Backend: Architecture & API",
      "description": "Create be-system-design.md with: Express layered architecture (routes/controllers/services), **API implementation (USE api-contract.md specification - NO DTO duplication, show HOW to implement with service methods and error handling)**, JWT middleware, validation. MAX 150 lines! (BE total budget: 300 lines)",
      "priority": 230
    },
    {
      "id": "design-be-data",
      "name": "Backend: Database & Services",
      "description": "Append to be-system-design.md with: PostgreSQL schema (users table: id, email, password_hash, name; todos table: id, title, completed, user_id with FK), service layer (AuthService, TodoService), password hashing (bcrypt). MAX 150 lines! (BE total budget: 300 lines, currently ~150 after task 1)",
      "priority": 240
    }
  ]
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ⚠️ SPECIAL CASES

**Single-Tier Projects (NO dual design):**
- **Frontend-only** (React SPA with no backend): Use `system-design.md` only
- **Backend-only** (REST API, microservice, CLI): Use `system-design.md` only
- **Fullstack SSR** (Next.js, Nuxt with tightly coupled FE/BE): Use `system-design.md` only

**For single-tier projects:**
- Create tasks that write to `system-design.md` (standard mode, line 183-254)
- NEVER create api-contract.md, fe-system-design.md, or be-system-design.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 FINAL CHECK: Review task names. If ANY contains these words, DELETE IT:
"Deployment", "Operations", "Migration", "Infrastructure", "Testing", "CI/CD", "Monitoring", "Rollout"

Only output tasks focused on: Architecture, Data Models, API Design, Component Design, Security Design, Performance Design

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{> design/phases/decompose/rules}}
