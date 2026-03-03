## 📋 TASK CREATION RULES

### Task Description Role

**Constraint**: Task descriptions are TOPIC HINTS — they suggest approximate coverage areas for each task. They are NOT authoritative plans.

- The **document-type guide** (frontend-guide, backend-guide, api-contract-guide) defines the allowed section catalog (scope ceiling)
- The **individual task's plan phase** makes the actual section decisions at execution time
- The **decompose description** provides hints about which guide sections to cover in this task

**Why?** If descriptions are too prescriptive, the execution phase copies them verbatim — including invented component names, procedural flows, and implementation details. Keeping descriptions as hints lets the guide's section catalog control what actually gets written.

### Task Description Content Rules

| ❌ Forbidden in descriptions | ✅ Required in descriptions |
|-------------|-------------|
| Concrete technology names ("LocalStorage", "React Router") | Abstract terms ("client-side persistence", "routing mechanism") |
| Component/service names ("GNB", "AuthService") | Boundary roles ("navigation boundary", "auth orchestration") |
| Step-by-step procedures | Topic areas referencing guide sections |
| Implementation-level detail ("polling every 5s") | Architecture-level scope ("real-time data strategy") |

### Incremental Document Building

- ALL tasks write to the SAME design document file
- Task 1: Creates document with first sections
- Task 2+: Appends new sections to existing document

### Task Description Must Include

- Which **topic areas** to cover (reference guide section names, NOT chapter numbers!)

**Constraint**: Do NOT list specific content items beyond topic area names. The individual task's plan phase determines actual content within the guide's section catalog.

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

| Phase | Priority | Target File | Content Scope |
|-------|----------|-------------|---------|
| 1 | 200-209 | api-contract-main.md | Per api-contract-guide section catalog |
| 2 | 210-229 | fe-system-main.md | Per frontend-guide section catalog |
| 3 | 230-249 | be-system-main.md | Per backend-guide section catalog |

### Backend-only (no frontend)

| Phase | Priority | Target File | Content Scope |
|-------|----------|-------------|---------|
| 1 | 200-209 | api-contract-main.md | Per api-contract-guide section catalog |
| 2 | 210-229 | be-system-main.md | Per backend-guide section catalog |

**Constraint**: api-contract-*.md tasks are ALWAYS written first (exclusive). Implementation documents follow.

---

## 📋 MSA-CONTRACT-FIRST STRATEGY (if service/package boundaries detected)

**When PRD explicitly indicates multiple backend service boundaries OR multiple frontend package boundaries.**

MSA applies to BOTH tiers independently:
- **Backend MSA**: Multiple backend services → `be-system-{service}.md` + `api-contract-{service}.md` per service
- **Frontend MSA**: Multiple frontend packages/micro-frontends → `fe-system-{package}.md` per package
- Both can coexist in a fullstack project

### Priority Assignment

| Phase | Priority | Target File | Content |
|-------|----------|-------------|---------|
| 1 | 200-209 | api-contract-{service}.md | **Per service** - Endpoints this service provides/consumes, events, DTOs |
| 2 | 210-219 | fe-system-{package}.md | **Per package** (if FE MSA) or fe-system-main.md (if single FE) |
| 3 | 220-249 | be-system-{service}.md | **Per service** (if BE MSA) or be-system-main.md (if single BE) |

### Document Naming

| Tier | Constraint | Rule |
|------|------------|------|
| API Contract | Filename pattern | `api-contract-{service}.md` where `{service}` is PRD-specified name (or `main` if single) |
| Backend | Filename pattern | `be-system-{service}.md` where `{service}` is PRD-specified name (or `main` if single) |
| Frontend | Filename pattern | `fe-system-{package}.md` where `{package}` is PRD-specified name (or `main` if single) |
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

### Constraints (Refactor Mode)

| Constraint | Requirement |
|------------|-------------|
| Task count | Exactly ONE |
| ID format | `refactor-{section}` |
| Name format | `Refactor: {description}` |
| Description | Must include "Keep all other content unchanged" |
| targetFile | MUST match an existing design document filename |
| targetFiles | Include ONLY the file being modified — do NOT list files unrelated to the change |

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
- targetFiles (frontend-only): `["fe-system-main.md"]`
- targetFiles (backend without external API): `["be-system-main.md"]`
- services: `[]`, fePackages: `[]`

**"contract-first"**:
- Use for: Projects that expose external API (fullstack or backend-only)
- targetFiles (fullstack): `["api-contract-main.md", "fe-system-main.md", "be-system-main.md"]`
- targetFiles (backend-only): `["api-contract-main.md", "be-system-main.md"]`
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
| description | ABSTRACT terms referencing guide section names as topic hints |
| priority | 200-299 range |
| exclusive | `true` if task must run alone (e.g., api-contract) |
| parallelGroup | Group ID for parallel scheduling (tasks with same group conflict) |

### Parallel Execution Hints (`exclusive` and `parallelGroup`)

Each task MUST include either `"exclusive": true` OR `"parallelGroup": "<group-id>"`.

**`exclusive: true`** — Task must run alone (no concurrent execution):
- API contract tasks (`api-contract-*.md`) → ALWAYS exclusive (defines shared interface)

**`parallelGroup: "<group-id>"`** — Tasks with SAME group ID cannot run simultaneously. Tasks with DIFFERENT group IDs can run in parallel.

- **"unified"** mode: All tasks target the SAME file → same group ID (e.g., `"fe-system-main"`)
- **"contract-first"** mode: Implementation tasks target DIFFERENT files → different group IDs (e.g., `"fe-main"`, `"be-main"`)
- **"msa-contract-first"** mode: Each service targets a DIFFERENT file → each service gets its own group ID (e.g., `"be-auth"`, `"be-order"`)

**⚠️ Constraint:** If tasks write to the same file, they MUST share the same `parallelGroup`.

---

## 📋 STRUCTURAL EXAMPLE

**Principle**: One example shows the JSON structure. Variations (unified, MSA) follow from the Document Type Rules and MSA Detection sections above.

```json
{
  "documentType": "contract-first",
  "services": [],
  "fePackages": [],
  "targetFiles": ["api-contract-main.md", "fe-system-main.md", "be-system-main.md"],
  "tasks": [
    {
      "id": "design-contract",
      "name": "API Contract Definition",
      "targetFile": "api-contract-main.md",
      "exclusive": true,
      "description": "Cover api-contract-guide sections: Overview, Endpoints, Shared Types, Error Handling.",
      "priority": 200
    },
    {
      "id": "design-frontend",
      "name": "Frontend System Design",
      "targetFile": "fe-system-main.md",
      "parallelGroup": "fe-main",
      "description": "Cover frontend-guide sections: Overview, Architecture Boundaries, API Integration.",
      "priority": 220
    },
    {
      "id": "design-backend",
      "name": "Backend System Design",
      "targetFile": "be-system-main.md",
      "parallelGroup": "be-main",
      "description": "Cover backend-guide sections: Overview, Architecture Pattern, Endpoint Mapping.",
      "priority": 240
    }
  ]
}
```

**Key patterns demonstrated:**
- `exclusive: true` for api-contract tasks (shared interface, must run alone)
- `parallelGroup` for implementation tasks (same file = same group, different files = different groups)
- Description references guide section catalog as topic HINTS
- For MSA, replace `main` with `{service}` (BE/API) or `{package}` (FE) per Document Naming rules above

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
- ✅ Description references guide section names as topic hints (not implementation topics)
- ✅ Description uses ABSTRACT terms (no LocalStorage, React Router, etc.)
- ✅ Priority in 200-299 range
- ✅ No forbidden tasks (deployment, ops, verification)
- ✅ If reference project mentioned → `references` array included
- ✅ Every task has either `exclusive: true` OR `parallelGroup: "<id>"`
- ✅ api-contract-* tasks have `exclusive: true`
- ✅ Tasks targeting the same file share the same `parallelGroup`
- ✅ All filenames use `{type}-{identifier}.md` format (no bare `api-contract.md` or `system-design.md`)

**MSA-specific validation:**
- ✅ If `msa-contract-first` → at least one of `services` or `fePackages` is NOT empty
- ✅ If `msa-contract-first` → names match PRD exactly (do NOT invent)
- ✅ If `services` present → each service has `be-system-{service}.md` AND `api-contract-{service}.md` in targetFiles
- ✅ If `fePackages` present → each package has `fe-system-{package}.md` in targetFiles
- ✅ Each MSA task has `targetService` field matching its service/package name
{{/if}}