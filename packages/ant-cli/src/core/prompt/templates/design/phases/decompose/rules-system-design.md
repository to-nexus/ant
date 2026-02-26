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

### Principle

API contract is written first as the single source of truth. Implementation documents reference the contract.

### Fullstack (frontend + backend)

| Phase | Priority | Target File | Content |
|-------|----------|-------------|---------|
| 1 | 200-209 | api-contract-main.md | Endpoints, DTOs, auth scheme, error format |
| 2 | 210-229 | fe-system-design-main.md | Component architecture, routing, state, API integration |
| 3 | 230-249 | be-system-design-main.md | Service layers, database schema, endpoint implementations |

### Backend-only (no frontend)

| Phase | Priority | Target File | Content |
|-------|----------|-------------|---------|
| 1 | 200-209 | api-contract-main.md | Endpoints, DTOs, auth scheme, error format |
| 2 | 210-229 | be-system-design-main.md | Service layers, database schema, endpoint implementations |

**Constraint**: api-contract-*.md tasks are ALWAYS written first (exclusive). Implementation documents follow.

---

## 📋 MSA-CONTRACT-FIRST STRATEGY (if service/package boundaries detected)

**When PRD explicitly indicates multiple backend service boundaries OR multiple frontend package boundaries.**

MSA applies to BOTH tiers independently:
- **Backend MSA**: Multiple backend services → `be-system-design-{service}.md` + `api-contract-{service}.md` per service
- **Frontend MSA**: Multiple frontend packages/micro-frontends → `fe-system-design-{package}.md` per package
- Both can coexist in a fullstack project

### Priority Assignment

| Phase | Priority | Target File | Content |
|-------|----------|-------------|---------|
| 1 | 200-209 | api-contract-{service}.md | **Per service** - Endpoints this service provides/consumes, events, DTOs |
| 2 | 210-219 | fe-system-design-{package}.md | **Per package** (if FE MSA) or fe-system-design-main.md (if single FE) |
| 3 | 220-249 | be-system-design-{service}.md | **Per service** (if BE MSA) or be-system-design-main.md (if single BE) |

### Document Naming

| Tier | Constraint | Rule |
|------|------------|------|
| API Contract | Filename pattern | `api-contract-{service}.md` where `{service}` is PRD-specified name (or `main` if single) |
| Backend | Filename pattern | `be-system-design-{service}.md` where `{service}` is PRD-specified name (or `main` if single) |
| Frontend | Filename pattern | `fe-system-design-{package}.md` where `{package}` is PRD-specified name (or `main` if single) |
| All | Case | Use exact case from PRD (lowercase recommended) |
| All | No invention | Do NOT create names not in PRD |

### Per-Service api-contract-{service}.md Structure for MSA

**Each service gets its own API contract document containing:**

| Section | Content |
|---------|---------|
| § Provided API | Endpoints THIS service implements (public + internal) |
| § Consumed API | Endpoints THIS service calls from OTHER services (cross-reference) |
| § Events Published | Events THIS service publishes |
| § Events Subscribed | Events THIS service listens to |
| § Service DTOs | Type definitions specific to this service |
{{/unless}}

---

{{#if (eq jobMode "refactor")}}
## 📤 OUTPUT FORMAT (REFACTOR MODE)

**Create exactly ONE task for the specific modification requested.**

{{#if existingDesignFiles}}
**⚠️ CRITICAL: `targetFile` MUST be one of these existing files:**
{{#each existingDesignFiles}}
- `{{this}}`
{{/each}}
{{/if}}

```json
{
  "documentType": "unified",
  "jobMode": "refactor",
  "targetFiles": ["{{primaryDesignFile}}"],
  "tasks": [
    {
      "id": "refactor-{section}",
      "name": "Refactor: {brief description}",
      "targetFile": "{{primaryDesignFile}}",
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
| targetFile | MUST match an existing design document filename |

{{else}}
## 📤 OUTPUT FORMAT (GENERATE MODE)

```json
{
  "documentType": "unified" | "contract-first" | "msa-contract-first",
  "services": [],
  "fePackages": [],
  "targetFiles": ["..."],
  "tasks": [...]
}
```

### Document Type Rules

**"unified"**:
- Use for: Frontend-only projects, CLI tools, or projects without externally-consumed API
- targetFiles (frontend-only): `["fe-system-design-main.md"]`
- targetFiles (backend without external API): `["be-system-design-main.md"]`
- services: `[]`, fePackages: `[]`

**"contract-first"**:
- Use for: Projects that expose external API (fullstack or backend-only)
- targetFiles (fullstack): `["api-contract-main.md", "fe-system-design-main.md", "be-system-design-main.md"]`
- targetFiles (backend-only): `["api-contract-main.md", "be-system-design-main.md"]`
- services: `[]`, fePackages: `[]`

**"msa-contract-first"**:
- Use for: Projects with **multiple backend service boundaries** and/or **multiple frontend package boundaries**
- services: `["<service1>", "<service2>", ...]` (backend services from PRD, empty if single backend)
- fePackages: `["<package1>", "<package2>", ...]` (frontend packages from PRD, empty if single frontend)
- targetFiles: computed from services and fePackages

**⚠️ Constraint**: Only use `msa-contract-first` if PRD explicitly defines service or package boundaries.

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique, kebab-case (e.g., "design-arch", "design-ch1-2") |
| name | Concise (< 60 chars) |
| targetFile | MUST match one of targetFiles |
| description | ABSTRACT terms + "MAX N lines!" |
| priority | 200-299 range |
| exclusive | `true` if task must run alone (e.g., api-contract) |
| parallelGroup | Group ID for parallel scheduling (tasks with same group conflict) |

### Parallel Execution Hints (`exclusive` and `parallelGroup`)

Each task MUST include either `"exclusive": true` OR `"parallelGroup": "<group-id>"`.

**`exclusive: true`** — Task must run alone (no concurrent execution):
- API contract tasks (`api-contract-*.md`) → ALWAYS exclusive (defines shared interface)

**`parallelGroup: "<group-id>"`** — Tasks with SAME group ID cannot run simultaneously. Tasks with DIFFERENT group IDs can run in parallel.

- **"unified"** mode: All tasks target the SAME file → same group ID (e.g., `"fe-system-design-main"`)
- **"contract-first"** mode: Implementation tasks target DIFFERENT files → different group IDs (e.g., `"fe-main"`, `"be-main"`)
- **"msa-contract-first"** mode: Each service targets a DIFFERENT file → each service gets its own group ID (e.g., `"be-auth"`, `"be-order"`)

**⚠️ Constraint:** If tasks write to the same file, they MUST share the same `parallelGroup`.

---

## 📋 EXAMPLES

### Example 1: Frontend-only (Unified)

```json
{
  "documentType": "unified",
  "services": [],
  "targetFiles": ["fe-system-design-main.md"],
  "tasks": [
    {
      "id": "design-arch",
      "name": "Design Document: Architecture & Data",
      "targetFile": "fe-system-design-main.md",
      "parallelGroup": "fe-system-design-main",
      "description": "Design system architecture, API integration strategy, and data models. MAX 100 lines! (Total: 200 lines)",
      "priority": 220
    },
    {
      "id": "design-ui",
      "name": "Design Document: UI Components",
      "targetFile": "fe-system-design-main.md",
      "parallelGroup": "fe-system-design-main",
      "description": "Design component structure, routing, and interaction patterns. MAX 100 lines! (Total: 200 lines, ~100 after task 1)",
      "priority": 240
    }
  ]
}
```

### Example 2: Backend-only with API (Contract-First without FE)

```json
{
  "documentType": "contract-first",
  "services": [],
  "targetFiles": ["api-contract-main.md", "be-system-design-main.md"],
  "tasks": [
    {
      "id": "design-contract",
      "name": "API Contract Definition",
      "targetFile": "api-contract-main.md",
      "exclusive": true,
      "description": "Define API contract (endpoints, DTOs, auth scheme, error format). MAX 120 lines!",
      "priority": 200
    },
    {
      "id": "design-backend",
      "name": "Backend System Design",
      "targetFile": "be-system-design-main.md",
      "parallelGroup": "be-main",
      "description": "Design backend architecture implementing API contract: services, database, endpoints. MAX 200 lines!",
      "priority": 220
    }
  ]
}
```

### Example 3: Frontend + Backend (Contract-First)

```json
{
  "documentType": "contract-first",
  "services": [],
  "targetFiles": ["api-contract-main.md", "fe-system-design-main.md", "be-system-design-main.md"],
  "tasks": [
    {
      "id": "design-contract",
      "name": "API Contract Definition",
      "targetFile": "api-contract-main.md",
      "exclusive": true,
      "description": "Define REST endpoints, DTOs, auth scheme, error format. MAX 120 lines!",
      "priority": 200
    },
    {
      "id": "design-frontend",
      "name": "Frontend System Design",
      "targetFile": "fe-system-design-main.md",
      "parallelGroup": "fe-main",
      "description": "Design frontend consuming API contract: components, state, integration. MAX 200 lines!",
      "priority": 220
    },
    {
      "id": "design-backend",
      "name": "Backend System Design",
      "targetFile": "be-system-design-main.md",
      "parallelGroup": "be-main",
      "description": "Design backend implementing API contract: services, database, endpoints. MAX 200 lines!",
      "priority": 240
    }
  ]
}
```

### Example 4: Backend MSA with Multiple Services (MSA-Contract-First)

```json
{
  "documentType": "msa-contract-first",
  "services": ["auth", "order", "payment"],
  "fePackages": [],
  "targetFiles": [
    "api-contract-auth.md",
    "api-contract-order.md",
    "api-contract-payment.md",
    "fe-system-design-main.md",
    "be-system-design-auth.md",
    "be-system-design-order.md",
    "be-system-design-payment.md"
  ],
  "tasks": [
    {
      "id": "design-contract-auth",
      "name": "API Contract: Auth Service",
      "targetFile": "api-contract-auth.md",
      "exclusive": true,
      "description": "Define auth service API: provided endpoints, consumed APIs, events, DTOs. MAX 80 lines!",
      "priority": 200
    },
    {
      "id": "design-contract-order",
      "name": "API Contract: Order Service",
      "targetFile": "api-contract-order.md",
      "exclusive": true,
      "description": "Define order service API: provided endpoints, consumed APIs, events, DTOs. MAX 80 lines!",
      "priority": 201
    },
    {
      "id": "design-contract-payment",
      "name": "API Contract: Payment Service",
      "targetFile": "api-contract-payment.md",
      "exclusive": true,
      "description": "Define payment service API: provided endpoints, consumed APIs, events, DTOs. MAX 80 lines!",
      "priority": 202
    },
    {
      "id": "design-frontend",
      "name": "Frontend System Design",
      "targetFile": "fe-system-design-main.md",
      "parallelGroup": "fe-main",
      "description": "Design frontend consuming public API from api-contracts. MAX 150 lines!",
      "priority": 210
    },
    {
      "id": "design-be-auth",
      "name": "Backend: Auth Service",
      "targetFile": "be-system-design-auth.md",
      "targetService": "auth",
      "parallelGroup": "be-auth",
      "description": "Design auth service architecture implementing endpoints from api-contract-auth.md. MAX 120 lines!",
      "priority": 220
    },
    {
      "id": "design-be-order",
      "name": "Backend: Order Service",
      "targetFile": "be-system-design-order.md",
      "targetService": "order",
      "parallelGroup": "be-order",
      "description": "Design order service architecture implementing endpoints from api-contract-order.md. MAX 120 lines!",
      "priority": 230
    },
    {
      "id": "design-be-payment",
      "name": "Backend: Payment Service",
      "targetFile": "be-system-design-payment.md",
      "targetService": "payment",
      "parallelGroup": "be-payment",
      "description": "Design payment service architecture implementing endpoints from api-contract-payment.md. MAX 120 lines!",
      "priority": 240
    }
  ]
}
```

**⚠️ Note**: Service names (`auth`, `order`, `payment`) MUST come from PRD. Do NOT invent.

### Example 5: Frontend MSA with Multiple Packages

```json
{
  "documentType": "msa-contract-first",
  "services": [],
  "fePackages": ["web", "admin"],
  "targetFiles": [
    "api-contract-main.md",
    "fe-system-design-web.md",
    "fe-system-design-admin.md",
    "be-system-design-main.md"
  ],
  "tasks": [
    {
      "id": "design-contract",
      "name": "API Contract Definition",
      "targetFile": "api-contract-main.md",
      "exclusive": true,
      "description": "Define API contract for both client apps (public user + admin). MAX 150 lines!",
      "priority": 200
    },
    {
      "id": "design-fe-web",
      "name": "Frontend: Web App",
      "targetFile": "fe-system-design-web.md",
      "targetService": "web",
      "parallelGroup": "fe-web",
      "description": "Design public-facing web application consuming API contract. MAX 150 lines!",
      "priority": 210
    },
    {
      "id": "design-fe-admin",
      "name": "Frontend: Admin Dashboard",
      "targetFile": "fe-system-design-admin.md",
      "targetService": "admin",
      "parallelGroup": "fe-admin",
      "description": "Design admin dashboard consuming API contract. MAX 120 lines!",
      "priority": 220
    },
    {
      "id": "design-backend",
      "name": "Backend System Design",
      "targetFile": "be-system-design-main.md",
      "parallelGroup": "be-main",
      "description": "Design backend architecture implementing API contract. MAX 200 lines!",
      "priority": 230
    }
  ]
}
```

**⚠️ Note**: Package names (`web`, `admin`) MUST come from PRD. Do NOT invent.

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
- ✅ Every task has either `exclusive: true` OR `parallelGroup: "<id>"`
- ✅ api-contract-* tasks have `exclusive: true`
- ✅ Tasks targeting the same file share the same `parallelGroup`
- ✅ All filenames use `{type}-{name}.md` format (no bare `api-contract.md` or `system-design.md`)

**MSA-specific validation:**
- ✅ If `msa-contract-first` → at least one of `services` or `fePackages` is NOT empty
- ✅ If `msa-contract-first` → names match PRD exactly (do NOT invent)
- ✅ If `services` present → each service has `be-system-design-{service}.md` AND `api-contract-{service}.md` in targetFiles
- ✅ If `fePackages` present → each package has `fe-system-design-{package}.md` in targetFiles
- ✅ Each MSA task has `targetService` field matching its service/package name
{{/if}}