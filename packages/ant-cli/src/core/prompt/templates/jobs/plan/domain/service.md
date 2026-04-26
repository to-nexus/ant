## Plan-Overlay — Service Domain (PRD Skeleton)

**Activation gate**: job `plan` × `domain === 'service'`. Layered on top of `templates/domain/service.md` (identity, D27).

This overlay defines the **PRD skeleton** for service / SaaS / dashboard / internal-tool projects. Use it when the planning intent (`gen-plan` / `rev-plan`) authors a Product Requirements Document. The plan job decides **what** the product is and **why**; system decomposition (state ownership, contracts, persistence) is the design job's responsibility — those words MUST NOT appear here.

### MECE PRD section map

The PRD is partitioned into 9 sections. The partition is **mutually exclusive** (each section answers a different stakeholder concern) and **collectively exhaustive** (the union covers every commitment a service PM must make before design starts).

| # | Section | Stakeholder concern | Outcome the section commits |
|---|---|---|---|
| 1 | Problem & Goal | Why the work exists | Job-to-be-done framed; non-goals listed |
| 2 | Personas & User Scenarios | Who acts | Primary / secondary actors + key flows |
| 3 | Functional Requirements | What the product does | Testable behaviors, prioritized |
| 4 | Non-Functional Requirements | How well it behaves | Performance / security / accessibility / observability targets |
| 5 | Data & Permissions | What is owned, by whom | Entities, ownership, lifecycle, RBAC/ACL boundaries, retention |
| 6 | External Dependencies | What this product depends on | APIs / SDKs / 3rd-party services + failure modes (policy level) |
| 7 | Constraints & Risks | What limits the work | Regulatory, technical, business; rollback plan |
| 8 | Success Metrics | What "done" looks like | Leading + lagging indicators tied to user behavior |
| 9 | Out-of-Scope | What this PRD does NOT promise | Explicit cuts that bound design |

If the directive overlaps multiple sections, **split** rather than merge — duplication across sections is an MECE violation that downstream design will inherit.

### Section authoring principles (FPOP)

| Principle | Example violation | Example compliant |
|---|---|---|
| **Principles over Examples** | "Pricing tier shows 3 plans" | "Pricing tier surfaces enough plans that users can self-select; the count is observed from competitor research, not assumed" |
| **What over How** | "Use Redis to cache the dashboard" | "Dashboard reads MUST be sub-100ms p95; caching is design's call" |
| **Observable over Assumed** | "Most users want CSV export" | Either cite the observation source or list it as an open question |
| **Universal over Specific** (outside the gate) | "Use Next.js Server Actions" | "Server-side rendering is preferred; framework choice belongs to design" |
| **Constraints over Instructions** | "Make the form simple" | "MUST require fewer than 5 fields on the primary signup flow" |
| **Reminders for Blind Spots** | (none) | "⚠️ The PRD MUST list non-goals — without them every reviewer infers a different scope" |

### Section authoring discipline (SBS)

This file is gated on `domain === 'service'`. It is REQUIRED to use service-domain vocabulary (personas, roles, RBAC, audit, retention, SLA, integration). It is FORBIDDEN to:

- Specify entity schemas or DTO shapes — that is design's surface
- Specify storage backends, framework names, or library choices unless the directive demands them
- Use game-domain vocabulary (`coreloop`, `mechanic`, `progression curve`, `5-minute hook`, `fail condition`, `MDA`) — the matrix gate already excluded those concepts; surfacing them here is a category error

### Blind-spot reminders

- ⚠️ A service PRD without **non-goals** under-constrains design and invites scope creep. The Out-of-Scope section is mandatory, even if short.
- ⚠️ **Permissions** sit above features — list them once in section 5 and reference them by name in functional requirements. Do NOT redefine roles per feature.
- ⚠️ **Non-Functional Requirements** without measurable targets are dead text. State a number or state "to be benchmarked in design", do not write "fast" / "secure" alone.
- ⚠️ **Personas** without a frequency hint (daily / weekly / quarterly user) make prioritization impossible. List the cadence.
- ⚠️ **External Dependencies** must declare failure semantics (timeout / retry ownership / fallback). A PRD that names a 3rd-party API without saying what happens on outage is incomplete.

### Refine-mode discipline

When refining an existing PRD (`rev-plan`), the directive defines the scope. Do NOT expand into adjacent sections, even when the refinement reveals a gap there — surface the gap as an open question or a follow-up directive, do not silently rewrite.
