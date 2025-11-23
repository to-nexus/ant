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

**⚠️ CRITICAL: Analyze complexity and break down properly. DO NOT default to single task!**

### 1. Simple Requirements (< 300 words, single simple feature)
- **Create 1 task ONLY**: "Create Design Document"
- Examples: "Add counter button", "Change navbar color"
- **If in doubt, use 2 tasks instead!**

### 2. Medium Requirements (300-1500 words OR multiple features)
- **Create 2-3 chapter-based tasks**
- Each task writes specific chapters of the SAME document
- Examples: Multiple features, database design, API endpoints, authentication

### 3. Complex Requirements (> 1500 words OR system design)
- **Create 3-5 chapter-based tasks**
- Each task contributes a major section
- Examples: Microservices, real-time systems, multi-page SaaS

**⚠️ WHEN IN DOUBT, CREATE MORE TASKS!**
- Unsure 1 vs 2? → Create 2
- Unsure 2 vs 3? → Create 3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## TASK CREATION RULES

### Incremental Document Building
- ALL tasks write to the SAME design document file
- Task 1: Creates document skeleton + first chapters
- Task 2+: Appends new chapters to existing document
- Later tasks build upon earlier chapters

### Task Naming
- Task 1: "Design Document: [Chapter Names]"
- Task 2+: "Design Document: [Chapter Names]" (continues same doc)

### Task Description Must Include
- Which chapters/sections to write
- Key topics to cover
- **Length budget** (see below)
- How it builds upon previous chapters (if applicable)

### Length Budgets (MANDATORY)
When creating N tasks:
- **Simple**: 150 lines total ÷ N tasks
- **Medium**: 300 lines total ÷ N tasks
- **Complex**: 500 lines total ÷ N tasks

**Example for Medium (3 tasks)**: 300 ÷ 3 = 100 lines per task MAX

**Every task description MUST state**:
```
"Write chapters X-Y: [topics]. 
MAX [N] lines for this task! 
(Total doc limit: [Total] lines across all tasks)"
```

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

**Example 1: Simple (1 task)**
```
Input: "Add a counter button that shows current count"

{
  "tasks": [{
    "id": "design-doc",
    "name": "Create Design Document",
    "description": "Design the simple counter button component with state management. MAX 150 lines total!",
    "priority": 250
  }]
}
```

**Example 2: Medium (2 tasks)**
```
Input: "Add a todo list feature"

{
  "tasks": [
    {
      "id": "design-ch1-2",
      "name": "Design Document: Architecture & Data Model",
      "description": "Write chapters 1-2: System overview, todo data model, and database schema. MAX 150 lines for this task! (Total limit: 300 lines across 2 tasks)",
      "priority": 220
    },
    {
      "id": "design-ch3-4",
      "name": "Design Document: API & UI Components",
      "description": "Write chapters 3-4: REST API endpoints and UI component specifications. MAX 150 lines for this task! (Total limit: 300 lines, currently ~150 after task 1)",
      "priority": 240
    }
  ]
}
```

**Example 3: Complex (4 tasks)**
```
Input: "Design microservices-based social media platform with posts, comments, likes, profiles, and real-time notifications"

{
  "tasks": [
    {
      "id": "design-ch1",
      "name": "Design Document: System Architecture",
      "description": "Write chapter 1: Microservices architecture, service boundaries, technology stack. MAX 125 lines! (Total limit: 500 lines across 4 tasks)",
      "priority": 220
    },
    {
      "id": "design-ch2",
      "name": "Design Document: Data Models & Storage",
      "description": "Write chapter 2: Database design for each microservice (Users, Posts, Comments, Notifications). MAX 125 lines! (Total limit: 500 lines, currently ~125 after task 1)",
      "priority": 240
    },
    {
      "id": "design-ch3",
      "name": "Design Document: API & Service Contracts",
      "description": "Write chapter 3: RESTful API specifications and GraphQL gateway design. MAX 125 lines! (Total limit: 500 lines, currently ~250 after task 2)",
      "priority": 260
    },
    {
      "id": "design-ch4",
      "name": "Design Document: Real-time & Frontend",
      "description": "Write chapter 4: WebSocket/SSE design, frontend architecture, component hierarchy. MAX 125 lines! (Total limit: 500 lines, currently ~375 after task 3)",
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
