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

```
<documentType>unified</documentType>
<jobMode>refactor</jobMode>
<targetFiles>["{affected-file-1}", "{affected-file-2-if-needed}"]</targetFiles>
<tasks>
  <task>{"id":"refactor-{file-scope}","name":"Refactor: {brief description}","targetFile":"{affected-file}","parallelGroup":"{affected-file-without-ext}"{{#if sourceFileNames}},"sourceFiles":["<source filename>"]{{/if}},"description":"{modification scope}. Keep all other content unchanged.","priority":200}</task>
</tasks>
```

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

These are initial defaults for this tier. **MULTI-BOUNDARY DETECTION below may expand them** (e.g., `be-system-main.md` → per-service files). The tier is immutable; only file granularity may change.

{{#if (eq environment "frontend")}}
**FRONTEND-ONLY project.**
- `documentType`: `"unified"` by default; becomes `"contract-first"` when `consumedApis` is non-empty, and `"msa-contract-first"` when FE multi-boundary is observed below (with or without `consumedApis`).
- All system-design tasks MUST target `fe-system-{name}.md` where `{name}` is determined by the MULTI-BOUNDARY DETECTION below. `{name}` = `"main"` ONLY when no FE boundaries are observed; otherwise `{name}` is each package identifier extracted from the source. Single and multi-package are equally valid outcomes — let the source decide.
- Do NOT create `be-system-*.md` tasks (frontend projects own no provider boundary).
- `services` MUST stay empty for frontend-only (no provider services).
- **External API consumer hints** — observe the supplied PRD / directive / refs for **external API contract sources**: a URL, a repository handle, a command that emits the contract, or any other addressable handle. IF observed, populate `consumedApis: [<host>, …]`. Each entry produces `api-contract-{host}.md` as a CONSUMER-perspective snapshot. Use `["main"]` when only one host is observable; use per-host names otherwise. If none observed, leave `consumedApis: []`.
- All `api-contract-*.md` tasks (when present) author from the CONSUMER perspective — they capture an EXTERNAL contract this project consumes; the `api-contract-guide.md` "External Contract Discovery" rules apply.
- The CONTRACT-FIRST DETECTION section below targets PROVIDER decisions and MUST be skipped here. The MULTI-BOUNDARY DETECTION section applies only to frontend package boundaries (multiple FE apps).
{{/if}}
{{#if (eq environment "backend")}}
**BACKEND-ONLY project.**
- Do NOT create `fe-system-*.md` tasks.
- `services` (provider) — observe for backend service boundaries this project owns; each entry produces `be-system-{s}.md` + `api-contract-{s}.md`.
- `consumedApis` (consumer) — observe for external APIs this project's backend depends on; each entry produces `api-contract-{c}.md` only (no co-creation).
- CONTRACT-FIRST DETECTION and MULTI-BOUNDARY DETECTION below apply for the provider axis.
{{/if}}
{{#if (eq environment "fullstack")}}
**FULLSTACK project.**
- All sections below (CONTRACT-FIRST, MULTI-BOUNDARY) apply normally for the provider axis (`services`, `fePackages`).
- `consumedApis` (consumer) — observe for external APIs this project depends on; orthogonal to `services`. Each entry produces `api-contract-{c}.md` only.
- `services` and `consumedApis` MUST NOT share names (provider authorship and consumer snapshot of the same name conflict).
{{/if}}
{{/if}}

**Consumer task description format (when `consumedApis` is non-empty)**:
- For each entry in `consumedApis`, the corresponding `api-contract-{host}` task's `description` MUST include the contract handle VERBATIM as the first sentence. Use one of the following forms based on what the source materials provide:
  - URL: `Source contract: <full URL>` (e.g., `Source contract: https://api.example.com/openapi.json`)
  - File: `Source contract: file <path>` (e.g., `Source contract: file apis/openapi.yaml`)
  - Command: `Source contract: command <command>`
- Do NOT replace the handle with abstract phrases like "derivable from the codegen source" or "shapes inferred from PRD" — execute LLM relies on this handle to invoke retrieve via the "External Contract Discovery" workflow in `api-contract-guide.md`.
- Provider tasks (`services`-derived) have NO equivalent requirement — they author DTO shapes from PRD and architectural decisions, not from an upstream contract.

---

## 📥 INPUT CONTEXT

### Requirements ({{documentName}})

The requirements document (`prd.md` for service domain, `gdd.md` for game domain — both authored by the plan job and stored in `sources/`) is the SSOT for product surface. Cite PRD/GDD sections by stable identifier (`PRD §5 / SC-Search`, `GDD §8 / EN-Hero`) when a task depends on a specific section. Do not re-derive content the document already commits to.

{{> jobs/design/nodes/decompose/shared/input-context}}

---

## 📊 PROJECT SCOPE ANALYSIS

**Analyze requirements complexity before breaking down tasks.** Each complexity question below maps to a specific PRD/GDD section — observe that section first, fall back to LLM extraction only if the section is missing (and surface the gap as an Open Question rather than fabricating).

### Step 1: Complexity Questions (cite PRD/GDD §X)

| # | Question | Service domain (PRD) | Game domain (GDD) |
|---|---|---|---|
| 1 | **Backend Complexity** — does it need a backend / database / how many entities? | PRD §10 Data & Permissions (count `EN-XXX`); PRD §11 External Dependencies (whether 3rd-party storage replaces an owned DB) | GDD §11 Meta-Progression (whether session-spanning persistence exists) + GDD §10 Game Modes (whether multiplayer requires a server) |
| 2 | **Feature Count** — how many distinct user-facing features? | PRD §8 Functional Requirements (count `FR-XX`) | GDD §4 MDA Mechanics (count `MC-XXX`) |
| 3 | **Pages / Views** — how many different screens/pages? | PRD §5 IA (count `SC-XXX`) | GDD does not have "pages" in the service sense — substitute with §2 Coreloop step count (`CL-XXX`) and §10 Game Mode count (`GM-XXX`) |
| 4 | **External Systems** — does it integrate with external APIs, payment, auth services? | PRD §11 External Dependencies | Usually 0 for a game prototype; if non-zero, the GDD records it under §12 Out-of-Scope or as a single line in §1 Core Concept |
| 5 | **User Roles** — multiple user types with different permissions? | PRD §3 Personas + PRD §10 Permissions (count `RB-XXX`) | GDD §10 Game Modes (count distinct player roles per mode, e.g. host vs joiner) |

If a referenced section is missing from the PRD/GDD, treat the corresponding score input as a known gap — record it in the task description as `Source missing: PRD §N` and proceed with the most defensible interpretation. Do NOT fabricate counts.

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
- **PRD/GDD hand-off citation** — each task's `description` MUST cite the PRD/GDD sections / stable IDs the task elaborates (e.g. `Implements PRD §10 / RB-Seller and §11 (payment dependency)` or `Implements GDD §4 / MC-Combat`). Tasks without a hand-off citation are likely duplicating PRD/GDD content. When the task is purely architectural (e.g. error-propagation policy not bound to a specific identifier), write `Architectural — no direct PRD/GDD hand-off`.

---

## 🎯 WHAT SYSTEM DESIGN SHOULD COVER

**Focus on architecture, NOT implementation.**

**Constraint**: Each document type has a guide (frontend-guide, backend-guide, api-contract-guide) that defines a **Section Catalog (CLOSED LIST)**. Each task's `assignedSections` MUST reference sections from that catalog. The guide's Section Catalog and Scope Ceiling are authoritative — `assignedSections` defines EXCLUSIVE scope per task.

### Section Catalogs by Document Type

Use these catalogs to distribute sections across tasks. Each task description references 1-3 catalog section **names** only.

{{#if (or (eq environment "frontend") (eq environment "fullstack"))}}
#### Frontend (`fe-system-{name}.md`) Section Catalog:
{{> jobs/design/base/catalogs/frontend-catalog-names}}
{{/if}}

{{#if (or (eq environment "backend") (eq environment "fullstack"))}}
#### Backend (`be-system-{name}.md`) Section Catalog:
{{> jobs/design/base/catalogs/backend-catalog-names}}

#### API Contract (`api-contract-{name}.md`) Section Catalog:
{{> jobs/design/base/catalogs/api-contract-catalog-names}}
{{/if}}

### Abstraction Level (applies to ALL document types)

System design is bounded by **three axes**, not two. The **Content/UX Level** is owned by the PRD/GDD authored in the plan job — system design MUST cite it, not duplicate it.

| ✅ Architecture Level (system design owns) | 🛡 Content / UX Level (PRD/GDD owns — cite, do NOT restate) | ❌ Implementation Level (forbidden) |
|---|---|---|
| Boundary responsibilities and ownership | Service: screen list (`SC-XXX`), screen composition & states, content & domain policy (`CP-XXX`) → cite PRD §5 / §6 / §7. Game: coreloop steps (`CL-XXX`), mechanic catalog (`MC-XXX`), entity catalog (`EN-XXX`), aesthetic vocabulary, viewport / orientation policy → cite GDD §2 / §4 / §8 / §9. | Specific algorithms, formulas, calculation steps |
| Data flow direction between boundaries | Service: user flows (`FL-XXX`) and their branches / exceptions / recoveries → cite PRD §4. Game: fail conditions and reward catalogs (`RW-XXX`) → cite GDD §6 / §7. | Exact parameter values (timeouts, coefficients, thresholds) |
| Dependency rules (what imports what) | (PRD/GDD does not own this axis — it is purely architectural.) | Library/framework usage details (API calls, syntax) |
| Design rationale (WHY this pattern) | Functional requirements (`FR-XX`) the architecture is justifying — cite PRD §8. | Performance optimization tricks |
| Error propagation POLICY | Permission boundaries (`RB-XXX`), entity ownership (`EN-XXX`) — cite PRD §10. | Storage implementation details (key names, serialization format) |

**Constraint**: When the architecture decision references a PRD/GDD-owned identifier, the design output MUST link back with a stable-ID citation (e.g. `enforces PRD §10 / RB-Seller`). Re-listing the screen catalog or the entity catalog inside system design — without citation — is a duplication that downstream code consumers will treat as the authoritative source, fragmenting MECE.

---

## DOCUMENT STRUCTURE DETECTION

### Principle

Separate concerns into distinct design documents. Each document covers a non-overlapping concern and is derived independently from the requirements.

### Observation Target

Observe the project's tier structure to determine which documents are needed:

| Observation | Document Structure (tier composition only) |
|-------------|-------------------|
| Project has **both frontend and backend** | `contract-first` (api-contract + fe + be — all independent) |
| Project is **backend-only** and exposes external API | `contract-first` without FE (api-contract + be — both independent) |
| Project is **frontend-only** | `unified` (`fe-system-main.md`) |

**Orthogonality**: `documentType` is orthogonal to package count. The rubric above selects the document-type axis (`unified` / `contract-first`) from tier composition alone. The MULTI-BOUNDARY DETECTION below selects each tier's package count from observable source signals. When any tier has multiple boundaries, `documentType` upgrades to `msa-contract-first` — regardless of how the rubric above classified the tier composition.

### Decision

**IF fullstack → CONTRACT-FIRST** (`api-contract-main.md` + `fe-system-main.md` + `be-system-main.md`)
**IF backend with external API → CONTRACT-FIRST without FE** (`api-contract-main.md` + `be-system-main.md`)
**IF frontend-only → UNIFIED** (`fe-system-main.md`)

**Upgrade rule (applies after MULTI-BOUNDARY DETECTION below)**: if any tier produces multiple boundaries (`services.length > 0` or `fePackages.length > 0`), the final `documentType` is `msa-contract-first` and per-boundary filenames replace the corresponding `*-main.md`. Examples:

- Frontend-only with multi-package observed → `msa-contract-first`, files: `fe-system-{pkg1}.md` + `fe-system-{pkg2}.md` + …
- Backend-only with multi-service observed → `msa-contract-first`, files: `be-system-{svc}.md` + `api-contract-{svc}.md` per service.
- Fullstack with multi-service AND multi-package → `msa-contract-first`, files per service AND per FE package; tiers without observed boundaries keep `*-main.md`.

---

## MULTI-BOUNDARY DETECTION

**Principle**: Decide each tier's granularity from the source. Backend and frontend decisions are independent.

### Authority Order

1. **Directive** — if it expresses any opinion about package or service boundaries (in any language, in any wording), that opinion is authoritative.
2. **Source documents (PRD/GDD)** — otherwise, the requirements determine the granularity.

### Observable (per tier) — positive boundary signals

Each row is a positive boundary observation. **If ANY row is observed for a tier, that tier's boundaries are populated (the corresponding array is NOT empty).**

| Tier | Observable |
|------|------------|
| BE | Source defines bounded contexts / services with distinct data ownership and lifecycle |
| BE | Multiple deployable backend services with independent operational characteristics |
| BE | Inter-service communication (sync or async) described as an architectural commitment |
| FE | Source describes multiple independent audience shells (e.g. admin / operations console vs end-user app) with distinct IA, navigation, or deploy cadence |
| FE | Multiple deployable frontend packages or micro-frontends with independent ownership |
| FE | Multiple frontends consume disjoint backend boundaries that the source itself separates |

⚠️ **Blind spot**: Source-side explicit decomposition signals (separate console, separate audience shells, bounded context maps, domain boundary definitions) ARE evidence of boundaries. Qualifying language ("shell-only", "uses the same responsive principles", "shares the design system") does NOT erase the boundary signal — it only constrains implementation rhythm. Do NOT disregard the signal because of the qualifier.

### Constraints (symmetric — both directions need source grounding)

- **Splits must be source-grounded, not theoretical** — do NOT split a tier without a positive observable above.
- **Single must equally be source-grounded** — do NOT collapse a tier with explicit decomposition signals into one boundary on parsimony alone.
- Do NOT invent identifiers — extract names from the source exactly as written.
- Do NOT match incidental technology terms (specific language / framework / runtime names) — but DO take seriously source-side decomposition vocabulary (`separate console`, `separate shell`, `bounded context`, `micro-frontend`, audience-shell language, etc.) when it appears as an architectural commitment.
- Backend and frontend granularities are independent: a fullstack project may have one backend with multiple frontends, multiple backends with one frontend, or any combination.

### Encoding & extraction

When boundaries are observed for a tier, populate the array AND ground each entry in the source:

- **Names** — exact identifiers (package / service / shell names) from the source. Do NOT translate, rename, or invent.
- **Responsibilities** — what each unit owns (audience, data, surface). Captured during DocGen; the decompose-time names must be unambiguous about which unit owns what.
- **Inter-unit relation** — for BE, communication patterns (sync vs async); for FE, audience & IA boundary (which shell serves which role / surface).

Output mapping:

- Single (no observables for a tier) → `services: []` / `fePackages: []`, keep `*-main.md`.
- Multiple (one or more observables) → `services: [<id>, ...]` / `fePackages: [<id>, ...]`. The validator expands them into per-boundary files: each service identifier produces `be-system-{id}.md` + `api-contract-{id}.md`; each frontend package produces `fe-system-{id}.md`. Tiers without observables keep `*-main.md`.

---

{{> jobs/design/nodes/decompose/variants/system-design/rules}}
