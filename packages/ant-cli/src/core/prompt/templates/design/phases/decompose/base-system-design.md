{{#if hasJobHistory}}
{{> design/base/injections/job-history}}
{{/if}}

# System Design Task Decomposition

You are analyzing requirements to break them into design tasks.

**Job Mode**: {{detectedMode}}

{{#if (eq detectedMode "refactor")}}
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

**Philosophy**: Create focused task(s) that modify only the specific section/part requested. One task per affected file — never split a single file into multiple chapter-based tasks.

### Rules for Refactor Mode

1. **One task per affected file** — if the change spans multiple documents (e.g., `be-system-main.md` + `api-contract-main.md`), create one task for each affected file
2. **Do NOT create chapter-based tasks** — never split modifications to a single file into multiple tasks
3. **Focus on the specific change** — only modify what was requested
4. **Preserve existing content** — do NOT regenerate entire documents
5. **Use descriptive task ID** — e.g., "refactor-api-auth", "refactor-be-auth"
6. **Use EXACT existing filename** — `targetFile` must match an existing document filename

### Task Output Format (Refactor Mode)

<decompose>
{
  "documentType": "unified",
  "jobMode": "refactor",
  "targetFiles": ["{affected-file-1}", "{affected-file-2-if-needed}"],
  "tasks": [
    {
      "id": "refactor-{file-scope}",
      "name": "Refactor: {brief description}",
      "targetFile": "{affected-file}",
      "parallelGroup": "{affected-file-without-ext}",
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "{modification scope}. Keep all other content unchanged.",
      "priority": 200
    }
  ]
}
</decompose>

**⚠️ Choose `targetFile`(s) based on the directive.** Analyze which existing document(s) the requested change belongs to, and target ONLY those files. Most refactors affect a single file — only add additional tasks when the change genuinely requires consistent modifications across multiple documents.

{{else}}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE - Create New Documents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**You are creating NEW system design documents from scratch.**
{{/if}}

{{#if environment}}
---

## ⚠️ ENVIRONMENT TIER (Pre-resolved — DO NOT change)

**Environment**: `{{environment}}`

The environment tier (frontend / backend / fullstack) is determined by the detection phase. You MUST NOT change it.

**Default Target Files**: {{#each resolvedTargetFiles}}`{{this}}`{{#unless @last}}, {{/unless}}{{/each}}

These are initial defaults for this tier. **MSA DETECTION below may expand them** (e.g., `be-system-main.md` → per-service files). The tier is immutable; only file granularity may change.

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
- CONTRACT-FIRST DETECTION and MSA DETECTION below apply — observe source documents for service boundaries
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

**Observe source documents for these patterns to determine Score in Step 2.**

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

Separate concerns into distinct design documents. Each document covers a non-overlapping concern and is derived independently from the requirements.

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

**Principle**: After document structure detection, observe whether source documents define multiple independent units within either tier. Each tier's granularity is decided independently.

⚠️ **Blind spot**: Source documents containing service decomposition, bounded context maps, or domain boundary definitions ARE explicit evidence of service boundaries. Do NOT disregard them.

### Observation Target

| Tier | What to observe in source documents |
|------|-------------------------------------|
| BE | Service decomposition defining separate services with distinct responsibilities? |
| BE | Multiple bounded contexts or independent domains with separate data ownership? |
| BE | Inter-service communication patterns (sync or async) described? |
| FE | Multiple independent frontend applications or deployable packages? |

### Decision Principle

**If ANY backend observation is positive → MSA detected for backend. Set `services` array.**
**If ANY frontend observation is positive → MSA detected for frontend. Set `fePackages` array.**

| Observation Result | Action |
|-------------------|--------|
| No unit boundaries observed in source documents | Keep `*-main.md`, `services: []`, `fePackages: []` |
| **Backend service boundaries observed** | Set `services`, expand to `be-system-{service}.md` + `api-contract-{service}.md` |
| **Frontend package boundaries observed** | Set `fePackages`, expand to `fe-system-{package}.md` |

**Constraint**: Do NOT invent service/package names. Extract exact identifiers from source documents.

### When MSA Detected

**MUST extract from source documents:**

1. **Names** — exact service/package identifiers (do NOT invent)
2. **Responsibilities** — what each unit owns
3. **Communication patterns** — sync vs async between units

**Structural mapping** (how names map to files):
- Each backend service in `services` → `be-system-{service}.md` + `api-contract-{service}.md`
- Each frontend package in `fePackages` → `fe-system-{package}.md`
- Unaffected tiers keep their `*-main.md` file

---

{{> design/phases/decompose/rules-system-design}}
