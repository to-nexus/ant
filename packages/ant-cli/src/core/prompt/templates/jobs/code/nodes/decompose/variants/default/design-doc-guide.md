{{#if hasDocuments}}
════════════════════════════════════════════════════════════════════════════════
## 📐 DESIGN SPECIFICATION AVAILABLE
════════════════════════════════════════════════════════════════════════════════

**The specification includes design documents.**

{{#if (or (eq mode "refactor") (eq mode "explain"))}}
**For Bug Fix/Refactor:**
- Directive describes the bug/issue
- Design document provides context
- Focus on what's broken, reference spec for context

{{else}}
**For New Features:**
- Follow the Development Source Rule (see Scope Determination above)
- When design docs ARE the development source: break tasks based on design document structure
- When a spec is active: design docs provide architectural context for the spec's requirements

════════════════════════════════════════════════════════════════════════════════
## 🏗️ REPOSITORY STRUCTURE DECISION
════════════════════════════════════════════════════════════════════════════════

**Observation target**: What independently runnable **applications** does the design describe, and which bodies of code do ≥ 2 of those applications consume identically? A document is a *design source*, NOT a package blueprint — one document's content distributes across multiple destinations (an application, a shared library, or a layer inside one application). Do NOT assume one document maps to one package.

A *unit* is one of two kinds:
- **Application** — a complete, independently runnable/deployable app or service, with its own entry, surface, and lifecycle. Each application is one application package.
- **Shared library** — a body of code that two or more applications consume identically (interface contracts, shared domain, shared component library / design system). Each shared body is one shared-library package, justified by shared *consumption*, not by the existence of a dedicated document.

| Checkpoint | What to observe |
|-----------|----------------|
| **Applications** | How many complete `*-system-{name}.md` documents exist, each describing a separately runnable app/service? Each one is its own application package — independent of stack. |
| **Shared code** | Reading the application documents' *content*, is there a body of code that ≥ 2 applications consume identically — a shared design system / component library, shared wire-contract types, shared domain? Such a body is a shared-library package **even when no document names it**. The signal is shared consumption, NOT the existence of a dedicated document. |

**Principle**: Package boundary follows **unit** boundary, NOT stack. Extract every application the design distinguishes (each frontend app, each backend service) plus every shared library that ≥ 2 applications consume identically. Stack count does NOT cap package count — a single stack with multiple complete applications is multi-package; a fullstack project is not merely "one frontend + one backend" but every application and service it describes, plus its shared libraries. A document's content distributes across destinations: extract only what ≥ 2 applications consume identically into a purpose-named shared-library package; code that merely *implements against* a shared contract (API clients, business logic, infra adapters) is NOT shared and lives in each consuming application's own layer.

**Constraint**: A complete application document (`*-system-{name}.md`) usually corresponds to one application package whose directory leaf is the document's **pure name** (never carry an `fe-`/`be-` prefix into the path). But a document is a design source, not a package blueprint: its content may also seed shared-library packages, and a shared-library package is named by its **purpose** — it need not mirror any document name. `api-contract-*` is a frontend↔backend wire-protocol contract — it documents an *interface*, not an application, so it never becomes an application package, and its presence does NOT by itself imply a backend application is part of this job (its consumer may be frontend-only, e.g. mock adapters). Only the shared *contract types* are extracted to a shared-library package (and only when ≥ 2 units consume them); the code that *implements* the contract lives in each consumer's own layer, not in the shared package.

**⚠️ Blind spot (the discriminator)**: Multiple audience views described **within a single application document** are ONE application package (internal route/layout separation) — do NOT split them into invented packages. Conversely, **separately-documented complete applications ARE separate packages** — do NOT collapse them into one merely because they share a stack. The signal is the design's described unit granularity, not audience count and not the frontend/backend axis.

**⚠️ Blind spot (the easily-missed shared library)**: A shared design system / component library referenced across multiple frontend application documents rarely has its own document, yet every frontend application consumes it — it IS a shared-library package. Do NOT bury it inside one application's package (e.g. inside one app's `shared/ui`). When the design describes a visual foundation shared across ≥ 2 frontend applications, extract it as a purpose-named shared-library package that every frontend app depends on.

**Setup task mapping**:
- **One application, no shared library** → single setup task (priority 100, exclusive)
- **Multiple units (applications and/or shared libraries)** → root workspace setup (priority 100, exclusive) + per-package setup (priority 101+, non-exclusive, distinct parallelGroup per package). The physical workspace layout (deployable apps vs shared libraries) is the setup task's concern.

════════════════════════════════════════════════════════════════════════════════
## 🏗️ MULTI-APPLICATION TASK DISCIPLINE (frontend apps · backend services · MSA)
════════════════════════════════════════════════════════════════════════════════

This section adds task discipline once the unit observation above has identified more than one application. It does NOT re-derive the package count — that follows the unit principle above, applied identically to frontend apps and backend services.

| Documents observed | Units (per the principle above) | Result |
|------------------|---------------|------------------|
| Single `*-system-main.md` only | 1 application | Single package |
| Multiple `fe-system-{name}.md` (e.g. user app + admin console) | application per document | Application package per app **+ a purpose-named shared-library package for code the apps share (e.g. a shared design system / component library), detected from the documents' content even when no document names it** |
| Multiple `be-system-{service}.md` | application per service | Application package per service + shared-library package(s) |
| Mixed `fe-system-*` + `be-system-*` (+ `api-contract-*`) | every app & service + shared | Package per app/service + shared-library package(s) — do NOT collapse all frontend or all backend into one |

**Constraint**: Each application/service task references ONLY its own design document via the `include` field (that unit's design-doc path). Do NOT mix multiple applications' implementations in a single task — each application task targets a single `*-system-{name}.md` scope.

**Constraint**: Tasks that integrate against a shared contract MUST add the `api-contract-*` path to their `include`. `api-contract-*` is consumed across stacks — its presence is a shared-contract signal, NOT evidence that a backend application is part of this job.

⚠️ **Blind spot**: When multiple services share a database or message queue, they APPEAR coupled but MUST still be separate tasks with separate packages. Cross-service coordination belongs in a shared foundation task.

════════════════════════════════════════════════════════════════════════════════

**Critical Rules:**
- ✅ Every task must reference its design doc via the `include` field (the design-doc path)
- ✅ Follow architecture decisions from the design documents
- ❌ Don't invent architecture not described in design documents
- ❌ Task scope is bounded by the Development Source (see Scope Determination)

{{/if}}

════════════════════════════════════════════════════════════════════════════════

{{#each documents}}
{{#if (includes path "fe-system-")}}
> Frontend architecture document.
{{/if}}
{{#if (includes path "be-system-")}}
> Backend architecture document.
{{/if}}
{{#if (includes path "api-contract-")}}
> API contract document.
{{/if}}

### {{label}}{{#if this.wasCompacted}} · compacted{{/if}}: {{path}}
{{#if this.wasCompacted}}
> Content compacted to a line-numbered outline. Use `read_file("{{path}}", startLine, endLine)` to fetch full sections.
{{/if}}

{{{content}}}

────────────────────────────────────────

{{/each}}

════════════════════════════════════════════════════════════════════════════════

{{/if}}
