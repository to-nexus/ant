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

**Score 0 (Simple)**: **80-120 lines MAX**
- Pure frontend, no backend
- Single page or 2-3 simple views
- No database, no auth
- **Create 2 tasks, ~40-60 lines each** (buffer for LLM overrun)

**Score 1-2 (Medium)**: **150-250 lines MAX**
- Simple backend OR multiple frontend features
- Basic database (1-3 tables)
- 3-5 pages/views
- **Create 3 tasks, ~50-80 lines each** (buffer for LLM overrun)

**Score 3+ (Complex)**: **300-500 lines MAX**
- Full-stack with multiple features
- Complex database (4+ tables with relationships)
- Authentication, multiple user roles
- 5+ pages, external integrations
- **Create 4 tasks, ~75-125 lines each** (buffer for LLM overrun)

**⚠️ NEVER EXCEED 500 LINES - NO EXCEPTIONS!**
- If requirements seem to need more, you're being too verbose
- Focus on architecture decisions, NOT implementation details
- Skip obvious sections (e.g., no backend? No database chapter!)

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
- **Simple (frontend-only, 1-2 features)**: 80-120 lines total
- **Medium (multi-feature OR simple backend)**: 150-250 lines total  
- **Complex (full-stack, multi-page)**: 300-500 lines total

**⚠️ ABSOLUTE MAXIMUM: 500 lines - NO project should exceed this!**

**Budget allocation per task:**
- Divide total budget evenly across N tasks
- Example: 180 lines / 3 tasks = 60 lines per task MAX

**Every task description MUST state:**
```
"Write sections on [topics]. 
MAX [N] lines for this task! 
(Total doc limit: [Total] lines across all tasks)"
```

**Examples:**
- Simple project (100 lines / 1 task): "MAX 100 lines total!"
- Medium project (200 lines / 3 tasks): "MAX 65 lines for this task! (Total limit: 200 lines)"
- Complex project (400 lines / 4 tasks): "MAX 100 lines for this task! (Total limit: 400 lines)"

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

**Example 1: Simple (1 task, 100 lines total)**
```
Input: "Add a counter button that shows current count"

{
  "tasks": [{
    "id": "design-doc",
    "name": "Create Design Document",
    "description": "Design the simple counter button component with state management. MAX 100 lines total!",
    "priority": 250
  }]
}
```

**Example 2: Medium (2 tasks, 180 lines total)**
```
Input: "Add a todo list feature with localStorage persistence"

{
  "tasks": [
    {
      "id": "design-arch-data",
      "name": "Design Document: Architecture & Data Model",
      "description": "Write sections on: System overview, todo data model, and localStorage strategy. MAX 90 lines for this task! (Total limit: 180 lines across 2 tasks)",
      "priority": 220
    },
    {
      "id": "design-ui-components",
      "name": "Design Document: UI Components & Interactions",
      "description": "Write sections on: Component hierarchy, user interactions, and state management. MAX 90 lines for this task! (Total limit: 180 lines, currently ~90 after task 1)",
      "priority": 240
    }
  ]
}
```

**Example 3: Complex (4 tasks, 400 lines total)**
```
Input: "Design full-stack e-commerce platform with product catalog, cart, checkout, and admin panel"

{
  "tasks": [
    {
      "id": "design-architecture",
      "name": "Design Document: System Architecture",
      "description": "Write sections on: Architecture pattern selection, layer definitions, technology stack. MAX 100 lines! (Total limit: 400 lines across 4 tasks)",
      "priority": 220
    },
    {
      "id": "design-data-api",
      "name": "Design Document: Data Models & API",
      "description": "Write sections on: Database schema (products, orders, users), RESTful API endpoints. MAX 100 lines! (Total limit: 400 lines, currently ~100 after task 1)",
      "priority": 240
    },
    {
      "id": "design-frontend",
      "name": "Design Document: Frontend Architecture",
      "description": "Write sections on: Component hierarchy, state management, routing, design system. MAX 100 lines! (Total limit: 400 lines, currently ~200 after task 2)",
      "priority": 260
    },
    {
      "id": "design-integrations",
      "name": "Design Document: Integrations & Security",
      "description": "Write sections on: Payment gateway integration, authentication, authorization. MAX 100 lines! (Total limit: 400 lines, currently ~300 after task 3)",
      "priority": 280
    }
  ]
}
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 FINAL CHECK: Review task names. If ANY contains these words, DELETE IT:
"Deployment", "Operations", "Migration", "Infrastructure", "Testing", "CI/CD", "Monitoring", "Rollout"

Only output tasks focused on: Architecture, Data Models, API Design, Component Design, Security Design, Performance Design

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analyze the requirements and output the JSON task breakdown:
