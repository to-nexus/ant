## Plan-Overlay — Service Domain (PRD Skeleton)

**Activation gate**: job `plan` × `domain === 'service'`. Layered on top of `templates/domain/service.md` (identity, D27).

This overlay defines the **PRD skeleton** for service / SaaS / dashboard / internal-tool projects. Use it when the planning intent (`gen-plan` / `rev-plan`) authors a Product Requirements Document. The plan job decides **what** the product is, **why** it exists, **how the user navigates it** (information architecture, screen composition, interaction logic), and **how content behaves** (sort / filter / pagination / empty-state policy). System-level commitments (state ownership, contracts, persistence) and ui token / spec / asset selection belong to the design jobs that consume this PRD — those words MUST NOT appear here. The PRD is the SSOT consumed by `system-design` and `ui-design-by-{desc,figma}` decompose; sections must be authored so design tasks can cite them by stable identifier.

### MECE PRD section map (14 sections)

The PRD is partitioned into a **Required core (8)**, **Conditional (5)**, and an **Always-on tail (1)**. Required-core sections appear in every PRD. Conditional sections appear only when the directive's scope warrants them; otherwise §14 records the reason for the omission. The partition is **mutually exclusive** (each section answers a distinct stakeholder concern) and **collectively exhaustive** (the union covers everything design needs to start without re-extracting from prose).

#### Required core (always present)

| # | Section | Stakeholder concern | Outcome the section commits |
|---|---|---|---|
| 1 | Summary | What this is in one line | One-line product pitch — who plays / uses it, what they do, why it matters |
| 2 | Problem & Goal & Out-of-Scope | Why this work exists | JTBD framing + non-goals listed up front to bound design |
| 3 | Personas & Frequency | Who acts | Primary / secondary actors with usage cadence (daily / weekly / quarterly) |
| 4 | User Scenarios & Core Flows (`FL-XXX`) | How time unfolds | Trigger → steps → branches → exceptions → recovery for the key flows |
| 5 | Information Architecture (`SC-XXX`) | How space is organized | Page tree / navigation model / list of primary screens with one-line responsibility each. **Every IA item issues a stable `SC-XXX` ID, and every issued SC MUST also appear in §6 with a full state matrix — orphan SC (issued in §5 but missing from §6) is a commit violation.** |
| 6 | Screen Composition & States (`SC-XXX × state`) | What lives on each screen | Per-screen information composition + state matrix. **Mandatory baseline states per SC: `default` / `empty` / `loading` / `error` / `permission-denied` (5 states); add `edge` when the screen has a meaningful boundary case. Each state row commits at least one observable line (what the user sees / what data is shown / what action is enabled).** |
| 7 | Content & Domain Policy (`CP-XXX`) | How content behaves across screens | **Five-axis policy commitment: `sort` + `filter` + `pagination` + `suppression` + `tie-breaker`. Each axis issues a `CP-XXX` ID (a single CP may bundle related axes when they describe one cohesive policy).** Defaults, surface / suppression rules, tie-breaker order. |
| 8 | Functional Requirements (`FR-XX`) | What the product does | Testable behaviors, prioritized. **Every FR cross-references at least one `FL-` / `SC-` / `CP-` ID (no exception) — an FR without cross-reference is unanchored and design cannot trace it back to a flow / screen / policy.** |

#### Conditional (include only when the directive warrants it; otherwise note in §14)

| # | Section | Include when | Outcome the section commits |
|---|---|---|---|
| 9 | Non-Functional Requirements | Performance / security / a11y / observability matter at this scope | Measurable targets (e.g. p95, score, %) — never just "fast" / "secure" |
| 10 | Data & Permissions (`EN-XXX`, `RB-XXX`) | The product persists data or has role-based access | Entity lifecycle / ownership boundaries, RBAC/ACL boundaries, retention policy (no schema, no DTO shape) |
| 11 | External Dependencies & Failure Modes | The product depends on a 3rd-party API / SDK / service | Dependencies + failure semantics (timeout / retry ownership / fallback) at policy level (no exact values) |
| 12 | Constraints & Risks | Real regulatory / technical / business constraints exist | Constraints + rollback strategy (formality only when there is real material to record) |
| 13 | Success Metrics | Product-level work with measurable outcomes | Leading + lagging indicators tied to user behavior |

#### Always-on tail

| # | Section | Outcome the section commits |
|---|---|---|
| 14 | Open Questions | Unresolved decisions, conditional sections marked "not applicable", and any sufficiency-checklist failures (see §Pipeline input sufficiency below). State "none" if there are genuinely no open items. |

#### Sections explicitly NOT included by default (forbidden without explicit directive)

The following are NOT chapters of a service PRD unless the directive explicitly requests them. They belong to design / code / dedicated jobs and adding them inflates the document without adding planning value:

- Test scenarios / QA guides — design's surface, not the PRD's
- Operational / deployment / monitoring runbooks — design / code
- Migration plans — design / code
- Security threat models — separate threat-modeling job, or a single line under §12 if the constraint is real

If the directive explicitly requests one, treat it as a separate document in the same session, not as a chapter of the PRD.

If the directive overlaps multiple sections, **split** rather than merge — duplication across sections is an MECE violation that downstream design will inherit.

{{> jobs/plan/shared/identifier-convention}}

**Service-domain identifier prefixes**:

| Prefix | Owns | Example |
|---|---|---|
| `§N` / `§N.M` | Section / subsection number | `§4`, `§4.2` |
| `FR-` | Functional Requirements (§8) | `FR-01`, `FR-15` |
| `FL-` | User flows (§4) | `FL-Browse`, `FL-Buy`, `FL-Onboarding` |
| `SC-` | Screens (§5 IA & §6 Screen Composition share this key) | `SC-ProductList`, `SC-ProductDetail`, `SC-Search` |
| `CP-` | Content policies (§7) | `CP-SearchSort`, `CP-Pagination`, `CP-EmptyState` |
| `EN-` | Entities (§10) | `EN-Product`, `EN-Order` |
| `RB-` | Role boundaries (§10) | `RB-Seller`, `RB-Buyer`, `RB-Admin` |

{{> jobs/plan/shared/design-handoff-table}}

**Service hand-off table**:

| PRD section | System Design picks up | UI Design picks up |
|---|---|---|
| §4 Core Flows (`FL-XXX`) | Event flow / state owner / transactional consistency boundary | Screen transitions / loading & error patterns |
| §5 IA (`SC-XXX`) | Routing / URL surface owner | Navigation components / IA tokens |
| §6 Screen Composition & States | State-machine owner per state | Component composition / per-state visual spec |
| §7 Content & Domain Policy (`CP-XXX`) | Data-layer policy enforcement (indexes, query patterns) | Empty / error visual treatments / sort & filter UI |
| §8 FR | Use-case orchestration boundary | (usually absorbed into §6 / §7) |
| §9 NFR | Performance / security boundary policy | Accessibility commitments at component level |
| §10 Data & Permissions | Persistence contract / RBAC enforcement boundary | Permission-aware UI gating |
| §11 External Deps | Integration contract / failure semantics | (rare) |

{{> jobs/plan/shared/external-asset-citation}}

**Service-domain external asset kinds and citation locations**:

- Allowed kinds: `figma` (URL or `<node-id>`), `mockup` (path under `assets/...`), `reference` (URL or path).
- Citation locations: §5 IA (page-level Figma frames), §6 Screen Composition (per-screen Figma node-id), §7 Content Policy (rare — only when an external mockup pins down a specific empty-state or sort UI).
- Example: `SC-ProductDetail — figma: 1234:5678` on a separate line inside the §6 entry for `SC-ProductDetail`.

### Section authoring principles (FPOP)

| Principle | Example violation | Example compliant |
|---|---|---|
| **Principles over Examples** | "Pricing tier shows 3 plans" | "Pricing tier surfaces enough plans that users can self-select; the count is observed from competitor research, not assumed" |
| **What over How** | "Use Redis to cache the dashboard" | "Dashboard reads MUST be sub-100ms p95; caching is design's call" |
| **Observable over Assumed** | "Most users want CSV export" | Either cite the observation source or list it as an open question |
| **Universal over Specific** (outside the gate) | "Use Next.js Server Actions" | "Server-side rendering is preferred; framework choice belongs to design" |
| **Constraints over Instructions** | "Make the form simple" | "MUST require fewer than 5 fields on the primary signup flow" |
| **Reminders for Blind Spots** | (none) | "⚠️ The PRD MUST list non-goals — without them every reviewer infers a different scope" |
| **Composition over Implementation** (§6) | "Use a `<DataTable>` component with `sortable` prop" | "The list surface MUST commit to a column set, sort affordance, and empty-state copy; component selection is design's call" |
| **Policy over Behavior** (§7) | "Sort by `created_at DESC`" | "Default sort is recency-first; tie-breaker is alphabetical title; freshness window is the last 30 days" |

### Section authoring discipline (SBS)

This file is gated on `domain === 'service'`. It is REQUIRED to use service-domain vocabulary (personas, roles, RBAC, audit, retention, SLA, integration). It is FORBIDDEN to:

- Specify entity schemas or DTO shapes — that is design's surface
- Specify storage backends, framework names, or library choices unless the directive demands them
- Specify exact timeout / retry / connection-pool numbers — those are design's tuning surface
- Use game-domain vocabulary (`coreloop`, `mechanic`, `progression curve`, `5-minute hook`, `fail condition`, `MDA`) — the matrix gate already excluded those concepts; surfacing them here is a category error
- **Add forbidden-by-default chapters** (test scenarios, operational runbooks, deployment / migration plans, security threat models) unless the directive explicitly requests them — the PRD must stay focused on planning content, not on its periphery

### Blind-spot reminders

- ⚠️ A service PRD without **non-goals** under-constrains design and invites scope creep. The Out-of-Scope material in §2 is mandatory, even if short.
- ⚠️ **Permissions** sit above features — list them once in §10 and reference them by `RB-XXX` in §8 FR. Do NOT redefine roles per feature.
- ⚠️ **Non-Functional Requirements** without measurable targets are dead text. State a number or state "to be benchmarked in design", do not write "fast" / "secure" alone.
- ⚠️ **Personas** without a frequency hint (daily / weekly / quarterly user) make prioritization impossible. List the cadence in §3.
- ⚠️ **External Dependencies** must declare failure semantics (timeout / retry ownership / fallback). A PRD that names a 3rd-party API without saying what happens on outage is incomplete — and §11 is conditional, so if no dependencies exist, write that fact in §14 explicitly.
- ⚠️ **Information Architecture** without `SC-XXX` identifiers leaves design jobs to invent screen IDs, which forks the page list across system / ui design. Issue stable IDs in §5 and reuse them in §6 / §7 / §8.
- ⚠️ **Screen Composition states** that omit empty / loading / error / permission-denied are the most common gap. A screen with only a "default" state ships an unforgiving product.
- ⚠️ **Content & Domain Policy** is where downstream UI/data behavior is decided once and reused everywhere. A PRD that omits §7 forces every screen in §6 to redefine sort / pagination / empty-state ad hoc.

### Refine-mode discipline

When refining an existing PRD (`rev-plan`), the directive defines the scope. Do NOT expand into adjacent sections, even when the refinement reveals a gap there — surface the gap as an open question (§14) or a follow-up directive, do not silently rewrite. When a refinement changes a section that owns a stable identifier (`SC-`, `FL-`, `FR-`, `CP-`, `EN-`, `RB-`), preserve the identifier even if the description is rewritten — downstream design tasks cite it by ID.

{{> jobs/plan/shared/pipeline-input-sufficiency}}

**Service PRD sufficiency checklist** (run before handing off to design):

- [ ] Does §5 IA list `SC-XXX` screens that ui-design-by-{desc,figma} can split into page chapters?
- [ ] Do the `SC-XXX` count (§5) and the `RB-XXX` count (§10) let `system-design` Step 1 score `Pages/Views` and `User Roles` without re-extracting from prose?
- [ ] Does §11 list external systems (or explicitly state "none" in §14) so `system-design` can score `External Systems`?
- [ ] Is the page-only vs cross-screen distinction visible in §6 vs §7 so ui-design's Component Ownership Contract can decide page-chapter vs shared-chapter scope?
- [ ] Are the branches / exceptions / recoveries in §4 `FL-XXX` enough for system-design to identify state-machine and transaction-boundary candidates?
- [ ] Conditional sections (§9–§13): for every conditional that is omitted, is there a one-line reason in §14?

A "no" on any item: either author the missing content now, or record the gap in §14 with a reason. Do not fabricate.
