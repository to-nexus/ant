# System Design Task Decomposition

You are analyzing requirements to break them into design tasks.

**Job Mode**: {{jobMode}}

{{#if (eq jobMode "refactor")}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REFACTOR MODE - Modify Existing Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are modifying EXISTING system design documents.**

{{#if existingDesignFiles}}
### 📁 Existing Design Files
{{#each existingDesignFiles}}
- `{{this}}`
{{/each}}

**⚠️ CRITICAL: `targetFiles` and `targetFile` MUST use the EXACT filename from the list above.**
**Do NOT invent new filenames not in the list above.**
{{/if}}

**Philosophy**: Create a SINGLE focused task that modifies the specific section/part requested.

### Rules for Refactor Mode

1. **Create ONE task** - Do NOT create multiple chapter-based tasks
2. **Focus on the specific change** - Only modify what was requested
3. **Preserve existing content** - Do NOT regenerate entire documents
4. **Use descriptive task ID** - e.g., "modify-api-users", "modify-schema-orders"
5. **Use EXACT existing filename** - `targetFile` must match an existing document filename

### Task Output Format (Refactor Mode)

```json
{
  "documentType": "unified",
  "jobMode": "refactor",
  "targetFiles": ["{chosen-file-from-existing-list}"],
  "tasks": [
    {
      "id": "refactor-{section}",
      "name": "Refactor: {brief description}",
      "targetFile": "{chosen-file-from-existing-list}",
      "description": "{modification scope}. Keep all other content unchanged.",
      "priority": 200
    }
  ]
}
```

**⚠️ Choose `targetFile` based on the directive.** Analyze which existing document the requested change belongs to, and target ONLY that file. Do NOT include files unrelated to the requested change in `targetFiles`.

{{else}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE - Create New Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are creating NEW system design documents from scratch.**
{{/if}}

{{#if environment}}
---

## ⚠️ ENVIRONMENT SCOPE (Pre-resolved — DO NOT override)

**Environment**: `{{environment}}`
**Target Files**: {{#each resolvedTargetFiles}}`{{this}}`{{#unless @last}}, {{/unless}}{{/each}}

The environment has been determined by the detection phase. You MUST respect this constraint.

{{#if (eq environment "frontend")}}
**FRONTEND-ONLY project.**
- `documentType`: `"unified"`
- All tasks MUST target `fe-system-main.md` (or `fe-system-{package}.md` if FE MSA detected below)
- Do NOT create `api-contract-*.md` or `be-system-*.md` tasks
- Design from the CONSUMER perspective (how frontend consumes APIs), NOT the PROVIDER perspective
- **SKIP** the CONTRACT-FIRST DETECTION section below — it does not apply
- MSA DETECTION below applies ONLY to frontend package boundaries (multiple FE apps)
{{/if}}
{{#if (eq environment "backend")}}
**BACKEND-ONLY project.**
- Do NOT create `fe-system-*.md` tasks
- CONTRACT-FIRST DETECTION and MSA DETECTION below apply normally for backend services
{{/if}}
{{#if (eq environment "fullstack")}}
**FULLSTACK project.**
- All sections below (CONTRACT-FIRST, MSA) apply normally
{{/if}}
{{/if}}

---

## 📥 INPUT CONTEXT

### Requirements

{{spec}}

{{#if hasExistingDesign}}
### 📄 Existing Design Detected

Previous design:
{{designPreview}}
{{else}}
### 🆕 New Design (no previous design)
{{/if}}

---

## 📊 PROJECT SCOPE ANALYSIS

**Analyze requirements complexity before breaking down tasks.**

### Step 1: Complexity Questions

1. **Backend Complexity**: Does it need a backend? Database? How many tables/entities?
2. **Feature Count**: How many distinct user-facing features?
3. **Pages/Views**: How many different screens/pages?
4. **External Systems**: Does it integrate with external APIs, payment, auth services?
5. **User Roles**: Multiple user types with different permissions?

### Step 1.5: Backend/Fullstack Complexity Indicators

**Observe PRD for these patterns to determine Score in Step 2.**

| Category | Observe for Score |
|----------|------------------|
| **Communication** | Realtime (WebSocket/SSE)? Async jobs/queues? |
| **Storage** | Multiple DB types needed (RDB + Cache/NoSQL)? |
| **Scale** | Horizontal scaling mentioned? Stateful connections? |
| **Architecture** | Multiple independent domains? Service separation? |

**Note**: Detailed design guidance for these patterns is provided in document-specific guides (api-contract-guide, backend-guide) during DocGen phase.

### Step 2: Score the Project

| Condition | Score |
|-----------|-------|
| ❌ NO backend | → Simple (STOP counting) |
| Backend with 1-3 tables | +1 |
| Backend with 4+ tables | +2 |
| Multiple user roles/auth | +1 |
| 5+ distinct features | +1 |
| External integrations | +1 |
| Multiple pages (5+) | +1 |
| Realtime/WebSocket/SSE needed | +1 |
| Message queue/async processing needed | +1 |
| Multiple databases (RDB + NoSQL/Cache) | +1 |

### Step 3: Determine Task Count

| Score | Complexity | Max Tasks per Document |
|-------|------------|-----------------------|
| 0 | Simple | 2 tasks |
| 1-2 | Medium | 3 tasks |
| 3+ | Complex | 4 tasks |

### Step 4: Distribute Catalog Sections

- Each task covers 1-3 sections from the guide's Section Catalog via `assignedSections`
- `assignedSections` defines EXCLUSIVE scope — each section assigned to exactly ONE task
- Total tasks for a document type MUST NOT exceed the number of catalog sections for that type
- Skip conditional catalog sections whose condition is not met

---

## 🎯 WHAT SYSTEM DESIGN SHOULD COVER

**Focus on architecture, NOT implementation.**

**Constraint**: Each document type has a guide (frontend-guide, backend-guide, api-contract-guide) that defines a **Section Catalog (CLOSED LIST)**. Each task's `assignedSections` MUST reference sections from that catalog. The guide's Section Catalog and Scope Ceiling are authoritative — `assignedSections` defines EXCLUSIVE scope per task.

### Section Catalogs by Document Type

Use these catalogs to distribute sections across tasks. Each task description references 1-3 catalog section **names** only.

{{#if (or (eq environment "frontend") (eq environment "fullstack"))}}
#### Frontend (`fe-system-{name}.md`) Section Catalog:
{{> design/base/catalogs/frontend-catalog-names}}
{{/if}}

{{#if (or (eq environment "backend") (eq environment "fullstack"))}}
#### Backend (`be-system-{name}.md`) Section Catalog:
{{> design/base/catalogs/backend-catalog-names}}

#### API Contract (`api-contract-{name}.md`) Section Catalog:
{{> design/base/catalogs/api-contract-catalog-names}}
{{/if}}

### Abstraction Level (applies to ALL document types)

| ✅ Architecture Level | ❌ Implementation Level |
|----------------------|------------------------|
| Boundary responsibilities and ownership | Specific algorithms, formulas, calculation steps |
| Data flow direction between boundaries | Exact parameter values (timeouts, coefficients, thresholds) |
| Dependency rules (what imports what) | Library/framework usage details (API calls, syntax) |
| Design rationale (WHY this pattern) | Performance optimization tricks |
| Error propagation POLICY | Storage implementation details (key names, serialization format) |

---

## DOCUMENT STRUCTURE DETECTION

### Principle

Separate concerns into distinct design documents. Each document covers a non-overlapping concern and is derived independently from the PRD.

### Observation Target

Observe the project's tier structure to determine which documents are needed:

| Observation | Document Structure |
|-------------|-------------------|
| Project has **both frontend and backend** | `contract-first` (api-contract + fe + be — all independent) |
| Project is **backend-only** and exposes external API | `contract-first` without FE (api-contract + be — both independent) |
| Project is **frontend-only** | `unified` (`fe-system-main.md`) |

### Decision

**IF fullstack → CONTRACT-FIRST** (`api-contract-main.md` + `fe-system-main.md` + `be-system-main.md`)
**IF backend with external API → CONTRACT-FIRST without FE** (`api-contract-main.md` + `be-system-main.md`)
**IF frontend-only → UNIFIED** (`fe-system-main.md`)

---

## MSA / MULTI-UNIT DETECTION

**After document structure detection, check if either tier requires splitting into multiple units.**

MSA applies to BOTH tiers independently:
- **Backend**: multiple services → `be-system-{service}.md` + `api-contract-{service}.md`
- **Frontend**: multiple packages/micro-frontends → `fe-system-{package}.md`

### Observation Checklist

| Tier | Checkpoint | Observation Target |
|------|------------|-------------------|
| BE | **Domain Boundaries** | Multiple independent business domains with separate data ownership? |
| BE | **Deployment Independence** | Services need independent deployment or scaling? |
| BE | **Service Communication** | Inter-service communication (sync API or async events)? |
| FE | **App Boundaries** | Multiple independent frontend applications (user-facing + admin, etc.)? |
| FE | **Package Boundaries** | Separate deployable packages with different concerns? |

### Decision Principle

| Observation Result | Action |
|-------------------|--------|
| Single backend domain | Keep `be-system-main.md` + `api-contract-main.md` |
| **Multiple backend service boundaries** | Split to `be-system-{service}.md` + `api-contract-{service}.md`, set `services` |
| Single frontend app | Keep `fe-system-main.md` |
| **Multiple frontend app/package boundaries** | Split to `fe-system-{package}.md`, set `fePackages` |

**Constraint**: Do NOT assume MSA. Only split if PRD explicitly indicates boundaries.

### If MSA Detected

**⚠️ MUST extract from PRD:**

1. **Names** - exact service/package names as PRD specifies (do NOT invent)
2. **Responsibilities** - what each unit owns
3. **Communication patterns** - sync (HTTP/gRPC) vs async (events/messages)

**Output structure for Backend MSA:**
```json
{
  "documentType": "msa-contract-first",
  "services": ["<service1>", "<service2>"],
  "fePackages": [],
  "targetFiles": [
    "api-contract-<service1>.md",
    "api-contract-<service2>.md",
    "fe-system-main.md",
    "be-system-<service1>.md",
    "be-system-<service2>.md"
  ]
}
```

**Output structure for Frontend MSA:**
```json
{
  "documentType": "msa-contract-first",
  "services": [],
  "fePackages": ["<package1>", "<package2>"],
  "targetFiles": [
    "api-contract-main.md",
    "fe-system-<package1>.md",
    "fe-system-<package2>.md",
    "be-system-main.md"
  ]
}
```

---

{{> design/phases/decompose/rules-system-design}}
