## 📋 TASK CREATION RULES

### Task Description Requirements

**Task descriptions guide WHAT to design, NOT HOW to implement.**

| ❌ Forbidden | ✅ Required |
|-------------|-------------|
| "LocalStorage" | "client-side persistence" |
| "React Router" | "routing mechanism" |
| "Zustand/Redux" | "state management" |
| "NewsData.io, TheNewsAPI" | "multi-source APIs" |

**Why?** Task descriptions flow into docGen prompts. Concrete tech names get copied into System Design.

### Incremental Document Building

- ALL tasks write to the SAME design document file
- Task 1: Creates document with first sections
- Task 2+: Appends new sections to existing document

### Task Description Must Include

- Which **topics** to write (NO chapter numbers!)
- Key content to cover
- **Length budget**: "MAX [N] lines for this task!"
- **Total limit**: "(Total doc limit: [Total] lines)"

### Priority Assignment

- Use 200-299 range
- Lower number = higher priority
- Example: 220, 240, 260, 280 for sequential chapters

---

## 🚫 FORBIDDEN TASK TYPES

DO NOT CREATE tasks for:
- ❌ Deployment / CI/CD / Infrastructure
- ❌ Operations / Monitoring
- ❌ Migration / Rollout strategies
- ❌ Test planning / QA
- ❌ "Final verification" or "review" tasks
- ❌ Separate documents (all tasks → ONE document per tier)
{{#if (eq jobMode "refactor")}}
- ❌ Multiple chapter-based tasks (refactor mode = single focused task)
- ❌ Full document regeneration (only modify requested section)
{{/if}}

---

{{#unless (eq jobMode "refactor")}}
## 📋 CONTRACT-FIRST STRATEGY (if applicable)

**When dual design is detected:**

| Phase | Priority | Target File | Content |
|-------|----------|-------------|---------|
| 1 | 200-209 | api-contract.md | REST endpoints, DTOs, auth scheme, error format |
| 2 | 210-229 | fe-system-design.md | Component architecture, routing, state, API integration |
| 3 | 230-249 | be-system-design.md | Service layers, database schema, endpoint implementations |

**Execution order ensures FE and BE are ALWAYS aligned!**
{{/unless}}

---

{{#if (eq jobMode "refactor")}}
## 📤 OUTPUT FORMAT (REFACTOR MODE)

**Create exactly ONE task for the specific modification requested.**

```json
{
  "documentType": "unified",
  "jobMode": "refactor",
  "targetFiles": ["system-design.md"],
  "tasks": [
    {
      "id": "refactor-{section}",
      "name": "Refactor: {brief description}",
      "targetFile": "system-design.md",
      "description": "{modification scope}. Keep all other content unchanged.",
      "priority": 200
    }
  ]
}
```

### Constraints (Refactor Mode)

| Constraint | Requirement |
|------------|-------------|
| Task count | Exactly ONE |
| ID format | `refactor-{section}` |
| Name format | `Refactor: {description}` |
| Description | Must include "Keep all other content unchanged" |

{{else}}
## 📤 OUTPUT FORMAT (GENERATE MODE)

```json
{
  "documentType": "unified" | "contract-first",
  "targetFiles": ["system-design.md"] | ["api-contract.md", "fe-system-design.md", "be-system-design.md"],
  "tasks": [
    {
      "id": "design-arch",
      "name": "Design Document: Architecture & Data",
      "targetFile": "system-design.md",
      "description": "Design system architecture and data models. MAX 100 lines! (Total: 200 lines)",
      "priority": 220
    }
  ]
}
```

### Document Type Rules

**"unified"**:
- Use for: Frontend-only, Backend-only, or tightly coupled fullstack
- targetFiles: `["system-design.md"]`

**"contract-first"**:
- Use for: Frontend AND Backend with clear API separation
- targetFiles: `["api-contract.md", "fe-system-design.md", "be-system-design.md"]`

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique, kebab-case (e.g., "design-arch", "design-ch1-2") |
| name | Concise (< 60 chars) |
| targetFile | MUST match one of targetFiles |
| description | ABSTRACT terms + "MAX N lines!" |
| priority | 200-299 range |

---

## 📋 EXAMPLES

### Example 1: Frontend-only (Unified)

```json
{
  "documentType": "unified",
  "targetFiles": ["system-design.md"],
  "tasks": [
    {
      "id": "design-arch",
      "name": "Design Document: Architecture & Data",
      "targetFile": "system-design.md",
      "description": "Design system architecture, API integration strategy, and data models. MAX 100 lines! (Total: 200 lines)",
      "priority": 220
    },
    {
      "id": "design-ui",
      "name": "Design Document: UI Components",
      "targetFile": "system-design.md",
      "description": "Design component structure, routing, and interaction patterns. MAX 100 lines! (Total: 200 lines, ~100 after task 1)",
      "priority": 240
    }
  ]
}
```

### Example 2: Frontend + Backend (Contract-First)

```json
{
  "documentType": "contract-first",
  "targetFiles": ["api-contract.md", "fe-system-design.md", "be-system-design.md"],
  "tasks": [
    {
      "id": "design-contract",
      "name": "API Contract Definition",
      "targetFile": "api-contract.md",
      "description": "Define REST endpoints, DTOs, auth scheme, error format. MAX 120 lines!",
      "priority": 200
    },
    {
      "id": "design-frontend",
      "name": "Frontend System Design",
      "targetFile": "fe-system-design.md",
      "description": "Design frontend consuming API contract: components, state, integration. MAX 200 lines!",
      "priority": 220
    },
    {
      "id": "design-backend",
      "name": "Backend System Design",
      "targetFile": "be-system-design.md",
      "description": "Design backend implementing API contract: services, database, endpoints. MAX 200 lines!",
      "priority": 240
    }
  ]
}
```

---

## 📚 REFERENCE PROJECTS (Optional)

### Principle

If directive mentions an external codebase to reference for design → extract and register it.

### Output Format

Include `references` array when reference project is observed:

```json
{
  "documentType": "...",
  "targetFiles": [...],
  "references": [
    { "project": "<project-name>", "reason": "<why-needed>" }
  ],
  "tasks": [...]
}
```

### Constraint

Only include projects **explicitly mentioned** in directive. Do NOT infer or assume references.

---

## ✅ VALIDATION CHECKLIST (GENERATE MODE)

Before outputting, verify:
- ✅ Valid JSON syntax
- ✅ `documentType` is "unified" or "contract-first"
- ✅ `targetFiles` matches documentType
- ✅ Every task's `targetFile` is in `targetFiles`
- ✅ All fields present (id, name, targetFile, description, priority)
- ✅ Description includes "MAX N lines!"
- ✅ Description uses ABSTRACT terms (no LocalStorage, React Router, etc.)
- ✅ Priority in 200-299 range
- ✅ No forbidden tasks (deployment, ops, verification)
- ✅ If reference project mentioned → `references` array included
{{/if}}