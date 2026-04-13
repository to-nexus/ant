## 📋 TASK CREATION RULES

### Section Assignment (BINDING)

**Constraint**: Each task MUST include `assignedSections` — an array of catalog section names that define the task's EXCLUSIVE scope.

- `assignedSections` is the **source of truth** for what a task writes
- Each catalog section MUST appear in exactly ONE task's `assignedSections` (no overlap, no gaps)
- The **document-type guide** defines the allowed section catalog (scope ceiling)
- `description` provides additional context but is NOT the scope authority

**Why?** Without explicit section assignments, tasks interpret scope from description text alone. Ambiguous keywords (e.g., "boundary" appearing in multiple section names) cause tasks to overstep and duplicate content.

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

### `assignedSections` Rules

- List catalog section names exactly as they appear in the Section Catalog (e.g., `"§ Overview"`, `"§ Architecture Boundaries"`)
- Every catalog section (except conditional ones whose condition is not met) MUST be assigned to exactly one task
- A task with 1–3 assigned sections is ideal
- Do NOT assign the same section to multiple tasks

### Task Description Must Include

- Which **topic areas** to cover (reference guide section names, NOT chapter numbers!)

**Constraint**: Do NOT list specific content items beyond topic area names. The individual task's plan phase determines actual content within the guide's section catalog.

### Source File Assignment

{{#if sourceFileNames}}
Each task MUST include `sourceFiles` — an array of source filenames that the task needs to reference.

Available source files: {{#each sourceFileNames}}`{{this}}`{{#unless @last}}, {{/unless}}{{/each}}

- A task MAY reference 1 or more files depending on its scope
- Observe each file's relevance to the task's domain concepts, not just its assigned sections
- **Constraint**: Do NOT omit a file that contains requirements relevant to the task scope
- ⚠️ **Blind spot**: Foundational context files (domain glossaries, shared models) are relevant to tasks that reference those domain concepts — do NOT skip them because they lack a direct section mapping
{{/if}}

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
{{#if (eq detectedMode "refactor")}}
- ❌ Multiple tasks targeting the SAME file (one task per file only)
- ❌ Full document regeneration (only modify requested section)
{{/if}}

---

{{#unless (eq detectedMode "refactor")}}
## MULTI-DOCUMENT STRATEGY (if applicable)

### Principle

Each design document is derived independently from the requirements. Documents cover distinct, non-overlapping concerns:
- **api-contract**: External interface specification (WHAT endpoints exist)
- **fe-system**: Frontend internal architecture (HOW frontend is structured)
- **be-system**: Backend internal architecture (HOW backend is structured)

All document types can be generated in parallel. Tasks targeting the SAME file share the same `parallelGroup` (sequential within file, parallel across files).

### Fullstack (frontend + backend)

| Priority Range | Target File | Concern |
|---------------|-------------|---------|
| 200-249 | api-contract-main.md | Per api-contract-guide section catalog |
| 200-249 | fe-system-main.md | Per frontend-guide section catalog |
| 200-249 | be-system-main.md | Per backend-guide section catalog |

### Backend-only (no frontend)

| Priority Range | Target File | Concern |
|---------------|-------------|---------|
| 200-249 | api-contract-main.md | Per api-contract-guide section catalog |
| 200-249 | be-system-main.md | Per backend-guide section catalog |

**Constraint**: Tasks targeting the SAME file MUST share the same `parallelGroup`. Tasks targeting DIFFERENT files can run in parallel.

---

## MSA MULTI-DOCUMENT STRATEGY (if service/package boundaries detected)

**When source documents define multiple backend service boundaries OR multiple frontend package boundaries.**

MSA applies to BOTH tiers independently:
- **Backend MSA**: Multiple backend services → `be-system-{service}.md` + `api-contract-{service}.md` per service
- **Frontend MSA**: Multiple frontend packages/micro-frontends → `fe-system-{package}.md` per package
- Both can coexist in a fullstack project

### Priority Assignment

All document types use the same priority range (200-249). Tasks targeting different files run in parallel; tasks targeting the same file run sequentially within their `parallelGroup`.

| Priority Range | Target File | Concern |
|---------------|-------------|---------|
| 200-249 | api-contract-{service}.md | **Per service** - Endpoints this service provides/consumes, events, DTOs |
| 200-249 | fe-system-{package}.md | **Per package** (if FE MSA) or fe-system-main.md (if single FE) |
| 200-249 | be-system-{service}.md | **Per service** (if BE MSA) or be-system-main.md (if single BE) |

### Document Naming

| Tier | Constraint | Rule |
|------|------------|------|
| API Contract | Filename pattern | `api-contract-{service}.md` where `{service}` is the name from source documents (or `main` if single) |
| Backend | Filename pattern | `be-system-{service}.md` where `{service}` is the name from source documents (or `main` if single) |
| Frontend | Filename pattern | `fe-system-{package}.md` where `{package}` is the name from source documents (or `main` if single) |
| All | Case | Use exact case from source documents (lowercase recommended) |
| All | No invention | Do NOT create names not found in source documents |

### Per-Service api-contract-{service}.md for MSA

Each per-service document uses the **same catalog sections** but organizes content by **communication direction** (provided vs consumed, published vs subscribed) within each section. Top-level sections MUST come from the catalog — direction sub-headings are internal structure only.
{{/unless}}

---

{{#if (eq detectedMode "refactor")}}
## 📤 OUTPUT FORMAT (REFACTOR MODE)

Respond with ONLY JSON wrapped in `<decompose>` tags. No markdown fences.

**Create one task per affected file.** Most refactors need only one task (one file). If the change genuinely spans multiple documents (e.g., auth change affecting both `be-system-main.md` and `api-contract-main.md`), create one task per affected file — tasks targeting different files run in parallel.

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
  "targetFiles": ["{affected-file-1}", "{affected-file-2-if-needed}"],
  "tasks": [
    {
      "id": "refactor-{file-scope}",
      "name": "Refactor: {brief description}",
      "targetFile": "{affected-file}",
      "parallelGroup": "{affected-file-without-ext}",
      "description": "{modification scope}. Keep all other content unchanged.",
      "priority": 200
    }
  ]
}
```

### Constraints (Refactor Mode)

| Constraint | Requirement |
|------------|-------------|
| Tasks per file | Exactly ONE — never split a single file into multiple tasks |
| Cross-file tasks | Allowed when change genuinely spans multiple documents |
| ID format | `refactor-{file-scope}` (e.g., `refactor-be-auth`, `refactor-api-auth`) |
| Name format | `Refactor: {description}` |
| Description | Must include "Keep all other content unchanged" |
| targetFile | MUST match an existing design document filename |
| targetFiles | Include ONLY affected files — do NOT list files unrelated to the change |
| parallelGroup | `{targetFile without .md}` — tasks targeting different files run in parallel |

{{else}}
## 📤 OUTPUT FORMAT (GENERATE MODE)

Respond with ONLY JSON wrapped in `<decompose>` tags. No markdown fences.

<decompose>
{
  "documentType": "unified" | "contract-first" | "msa-contract-first",
  "services": [],
  "fePackages": [],
  "techTier": { "stack": "<frontend | backend | fullstack>", "language": "<language>", "framework": "<framework or omit>" },
  "packageTiers": {},
  "targetFiles": ["..."],
  "tasks": [...]
}
</decompose>

### Technology Tiers

The `techTier` object describes the job-level technology stack (singular). When `stack` is `"fullstack"`, the `packageTiers` map provides per-package breakdowns so each task inherits the correct technology context.

**`techTier` (required):** Job-level summary — `stack`, `language`, `framework`.

**`packageTiers` (optional, fullstack/monorepo only):**

| Key pattern | Meaning |
|-------------|---------|
| `be-main` | Backend default tier (non-MSA: exact match; MSA: tier fallback) |
| `fe-main` | Frontend default tier (non-MSA: exact match; MSA: tier fallback) |
| `be-{service}` | MSA backend service override (only if different from `be-main`) |
| `fe-{package}` | Frontend package override (only if different from `fe-main`) |

**Constraints:**
- Observe language/framework mentions in directive and source documents — do NOT assume or infer technologies not explicitly stated
- If no technology is mentioned for a tier, omit that tier's key entirely
- For MSA: if ALL backend services share the same stack, a single `be-main` entry suffices — add `be-{service}` overrides only for services that differ
- Value shape: `{ "language": "<language>", "framework": "<framework or omit>", "stack": "frontend" | "backend" }`
- Do NOT include `packageTiers` when all packages share the same language and framework

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
- services: `["<service1>", "<service2>", ...]` (backend services from source documents, empty if single backend)
- fePackages: `["<package1>", "<package2>", ...]` (frontend packages from source documents, empty if single frontend)
- targetFiles: computed from services and fePackages

**⚠️ Constraint**: Only use `msa-contract-first` when service or package boundaries are observed in source documents.

### Task Properties

| Property | Requirements |
|----------|--------------|
| id | Unique, kebab-case (e.g., "design-arch", "design-ch1-2") |
| name | Concise (< 60 chars) |
| targetFile | MUST match one of targetFiles |
| assignedSections | Array of catalog section names (e.g., `["§ Overview", "§ Architecture Boundaries"]`). EXCLUSIVE scope — no overlap between tasks. |
{{#if sourceFileNames}}| sourceFiles | Array of source filenames relevant to this task (1 or more). |
{{/if}}| description | ABSTRACT terms providing context (section assignments are authoritative) |
| priority | 200-299 range |
| parallelGroup | Group ID for parallel scheduling (tasks with same group conflict) |

### Parallel Execution Hints (`parallelGroup`)

Each task MUST include `"parallelGroup": "<group-id>"`.

**`parallelGroup: "<group-id>"`** — Tasks with SAME group ID cannot run simultaneously. Tasks with DIFFERENT group IDs can run in parallel.

- **"unified"** mode: All tasks target the SAME file → same group ID (e.g., `"fe-system-main"`)
- **"contract-first"** mode: Each document type targets a DIFFERENT file → different group IDs (e.g., `"api-contract-main"`, `"fe-system-main"`, `"be-system-main"`)
- **"msa-contract-first"** mode: Each file gets its own group ID (e.g., `"api-contract-auth"`, `"be-system-auth"`, `"be-system-order"`)

**Constraint:** Tasks writing to the same file MUST share the same `parallelGroup`.

---

## 📋 OUTPUT STRUCTURE

**Principle**: The JSON structure below defines the required output shape. Field values are placeholders — derive actual values from the requirements and the rules above.

<decompose>
{
  "documentType": "<unified | contract-first | msa-contract-first>",
  "services": [],
  "fePackages": [],
  "techTier": { "stack": "<stack>", "language": "<language>", "framework": "<framework or omit>" },
  "packageTiers": {},
  "targetFiles": ["<target-file>.md"],
  "tasks": [
    {
      "id": "<unique-kebab-case-id>",
      "name": "<concise task name>",
      "targetFile": "<must match one of targetFiles>",
      "parallelGroup": "<group-id: same file = same group>",
      "assignedSections": ["§ <exact catalog section name>", "§ <exact catalog section name>"],
{{#if sourceFileNames}}      "sourceFiles": ["<source filename>"],
{{/if}}      "description": "<abstract topic areas; section assignments are authoritative>",
      "priority": 200
    }
  ]
}
</decompose>

**Constraints:**
- `assignedSections` values MUST use exact names from the document-type catalog (e.g., `"§ API Endpoints"`, NOT abbreviated forms like `"§ Endpoints"`)
- Each catalog section assigned to exactly ONE task — no overlap, no gaps
- 1-3 assigned sections per task is ideal; split into multiple tasks if a file has many sections
- ⚠️ **Blind spot**: For api-contract documents, § API Endpoints and § Shared Type Definitions have strong dependency — prefer assigning them to the SAME task to avoid cross-task DTO duplication
- Tasks targeting the SAME file share the same `parallelGroup`; different files get different groups
- All document types use the same priority range (200-249) — they run in parallel across files
- Description provides context in abstract terms; `assignedSections` is the authoritative scope
- For MSA, replace `main` with `{service}` (BE/API) or `{package}` (FE) per Document Naming rules above

---

## 📚 REFERENCE PROJECTS (Optional)

### Principle

If directive mentions an external codebase to reference for design → extract and register it.

### Output Format

Include `references` array when reference project is observed:

<decompose>
{
  "documentType": "...",
  "targetFiles": [...],
  "references": [
    { "project": "<project-name>", "reason": "<why-needed>" }
  ],
  "tasks": [...]
}
</decompose>

### Constraint

Only include projects **explicitly mentioned** in directive. Do NOT infer or assume references.

---

## ✅ VALIDATION CHECKLIST (GENERATE MODE)

Before outputting, verify:
- ✅ Output wrapped in `<decompose>` tags (no markdown fences)
- ✅ Valid JSON syntax
- ✅ `documentType` is "unified", "contract-first", or "msa-contract-first"
- ✅ `services` array present (empty `[]` for non-MSA)
- ✅ `targetFiles` matches documentType
- ✅ Every task's `targetFile` is in `targetFiles`
- ✅ All fields present (id, name, targetFile, assignedSections, description, priority)
- ✅ `assignedSections` lists exact catalog section names (e.g., `"§ Overview"`)
- ✅ Every catalog section (except unmet conditionals) is assigned to exactly ONE task — no overlap, no gaps
- ✅ Description uses ABSTRACT terms (no LocalStorage, React Router, etc.)
- ✅ Priority in 200-299 range
- ✅ No forbidden tasks (deployment, ops, verification)
{{#if sourceFileNames}}- ✅ Every task has `sourceFiles` with relevant source filenames
{{/if}}- ✅ `techTier` present with `stack`, `language` (and `framework` if applicable)
- ✅ `packageTiers` keys use `{tier}-main` or `{tier}-{name}` format (e.g., `be-main`, `fe-main`, `be-auth`) — only when fullstack/monorepo
- ✅ `packageTiers` contains only explicitly mentioned technologies — no assumptions
- ✅ If reference project mentioned → `references` array included
- ✅ Every task has `parallelGroup: "<id>"`
- ✅ Tasks targeting the same file share the same `parallelGroup`
- ✅ All filenames use `{type}-{identifier}.md` format (no bare `api-contract.md` or `system-design.md`)

**MSA-specific validation:**
- ✅ If `msa-contract-first` → at least one of `services` or `fePackages` is NOT empty
- ✅ If `msa-contract-first` → names match source documents exactly (do NOT invent)
- ✅ If `services` present → each service has `be-system-{service}.md` AND `api-contract-{service}.md` in targetFiles
- ✅ If `fePackages` present → each package has `fe-system-{package}.md` in targetFiles
- ✅ Each MSA task has `targetService` field matching its service/package name
{{/if}}