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

**Observation target**: How many independently runnable units does the design describe, and what code is shared across them?

A *unit* is one of two kinds:
- **Application** — a complete, independently runnable/deployable app or service, with its own entry, surface, and lifecycle. Each application is one application package.
- **Shared library** — code consumed by two or more applications (interface contracts, shared domain, shared component library). Each shared body is one shared-library package.

| Checkpoint | What to observe |
|-----------|----------------|
| **Applications** | How many complete `*-system-{name}.md` documents exist, each describing a separately runnable app/service? Each one is its own application package — independent of stack. |
| **Shared code** | Is there code (e.g. `api-contract-*`, shared domain) consumed by ≥ 2 applications? That code becomes a shared-library package. |

**Principle**: Package boundary follows **unit** boundary, NOT stack. Extract every application the design distinguishes (each frontend app, each backend service) plus every shared library consumed by ≥ 2 applications. Stack count does NOT cap package count — a single stack with multiple complete applications is multi-package; a fullstack project is not merely "one frontend + one backend" but every application and service it describes, plus its shared libraries.

**Constraint**: A `*-system-{name}.md` document names an application package; the package name MUST match the document name. `api-contract-*` is a frontend↔backend wire-protocol contract — it documents an *interface*, not an application, so it never becomes an application package, and its presence does NOT by itself imply a backend application is part of this job (its consumer may be frontend-only, e.g. mock adapters). It becomes a shared-library package only when ≥ 2 units in this job consume it; with a single consumer it lives inside that unit.

**⚠️ Blind spot (the discriminator)**: Multiple audience views described **within a single application document** are ONE application package (internal route/layout separation) — do NOT split them into invented packages. Conversely, **separately-documented complete applications ARE separate packages** — do NOT collapse them into one merely because they share a stack. The signal is the design's described unit granularity, not audience count and not the frontend/backend axis.

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
| Multiple `fe-system-{name}.md` (e.g. user app + admin console) | application per document | Application package per app + shared-library package(s) |
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
