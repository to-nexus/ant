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

---

## 📋 MSA-CONTRACT-FIRST STRATEGY (if service boundaries detected)

**When PRD explicitly indicates multiple service boundaries:**

### Priority Assignment

| Phase | Priority | Target File | Content |
|-------|----------|-------------|---------|
| 1 | 200-209 | api-contract.md | **Unified** - All endpoints (public + internal + events) with Provider/Consumer metadata |
| 2 | 210-219 | fe-system-design.md | Frontend architecture consuming public API |
| 3 | 220-249 | be-system-design-{service}.md | **Per service** - Each service gets its own document |

### Service Document Naming

| Constraint | Rule |
|------------|------|
| Filename pattern | `be-system-design-{service}.md` where `{service}` is PRD-specified name |
| Case | Use exact case from PRD (lowercase recommended) |
| No invention | Do NOT create service names not in PRD |

### api-contract.md Structure for MSA

**All communication contracts in ONE file with metadata:**

| Section | Content | Required Metadata |
|---------|---------|-------------------|
| § Public API | Client → Gateway endpoints | `Routed To: {service}` |
| § Internal API | Gateway/Service → Service | `Provider: {service}`, `Consumers: [...]` |
| § Inter-Service API | Service ↔ Service direct | `Provider: {service}`, `Consumers: [...]` |
| § Async Events | Event definitions | `Publisher: {service}`, `Subscribers: [...]` |
| § Shared DTOs | Common type definitions | - |

**⚠️ Constraint**: Do NOT split api-contract.md per service. Keep unified with metadata.
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
  "documentType": "unified" | "contract-first" | "msa-contract-first",
  "services": [],
  "targetFiles": ["..."],
  "tasks": [...]
}
```

### Document Type Rules

**"unified"**:
- Use for: Frontend-only, Backend-only, or tightly coupled fullstack
- targetFiles: `["system-design.md"]`
- services: `[]` (empty)

**"contract-first"**:
- Use for: Frontend AND Backend with single backend
- targetFiles: `["api-contract.md", "fe-system-design.md", "be-system-design.md"]`
- services: `[]` (empty)

**"msa-contract-first"**:
- Use for: Frontend AND Backend with **multiple service boundaries**
- services: `["<service1>", "<service2>", ...]` (from PRD)
- targetFiles: `["api-contract.md", "fe-system-design.md", "be-system-design-<service1>.md", "be-system-design-<service2>.md", ...]`

**⚠️ Constraint**: Only use `msa-contract-first` if PRD explicitly defines service boundaries.

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
  "services": [],
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
  "services": [],
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

### Example 3: MSA with Multiple Services (MSA-Contract-First)

```json
{
  "documentType": "msa-contract-first",
  "services": ["auth", "order", "payment"],
  "targetFiles": [
    "api-contract.md",
    "fe-system-design.md",
    "be-system-design-auth.md",
    "be-system-design-order.md",
    "be-system-design-payment.md"
  ],
  "tasks": [
    {
      "id": "design-contract",
      "name": "API Contract Definition",
      "targetFile": "api-contract.md",
      "description": "Define all endpoints (public, internal, inter-service) with Provider/Consumer metadata. Define async events. MAX 200 lines!",
      "priority": 200
    },
    {
      "id": "design-frontend",
      "name": "Frontend System Design",
      "targetFile": "fe-system-design.md",
      "description": "Design frontend consuming public API from api-contract.md. MAX 150 lines!",
      "priority": 210
    },
    {
      "id": "design-be-auth",
      "name": "Backend: Auth Service",
      "targetFile": "be-system-design-auth.md",
      "targetService": "auth",
      "description": "Design auth service architecture implementing endpoints from api-contract.md. MAX 120 lines!",
      "priority": 220
    },
    {
      "id": "design-be-order",
      "name": "Backend: Order Service",
      "targetFile": "be-system-design-order.md",
      "targetService": "order",
      "description": "Design order service architecture implementing endpoints from api-contract.md. MAX 120 lines!",
      "priority": 230
    },
    {
      "id": "design-be-payment",
      "name": "Backend: Payment Service",
      "targetFile": "be-system-design-payment.md",
      "targetService": "payment",
      "description": "Design payment service architecture implementing endpoints from api-contract.md. MAX 120 lines!",
      "priority": 240
    }
  ]
}
```

**⚠️ Note**: Service names (`auth`, `order`, `payment`) MUST come from PRD. Do NOT invent.

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
- ✅ `documentType` is "unified", "contract-first", or "msa-contract-first"
- ✅ `services` array present (empty `[]` for non-MSA)
- ✅ `targetFiles` matches documentType
- ✅ Every task's `targetFile` is in `targetFiles`
- ✅ All fields present (id, name, targetFile, description, priority)
- ✅ Description includes "MAX N lines!"
- ✅ Description uses ABSTRACT terms (no LocalStorage, React Router, etc.)
- ✅ Priority in 200-299 range
- ✅ No forbidden tasks (deployment, ops, verification)
- ✅ If reference project mentioned → `references` array included

**MSA-specific validation:**
- ✅ If `msa-contract-first` → `services` array is NOT empty
- ✅ If `msa-contract-first` → service names match PRD exactly
- ✅ If `msa-contract-first` → each service has `be-system-design-{service}.md` in targetFiles
- ✅ If `msa-contract-first` → each service task has `targetService` field
{{/if}}