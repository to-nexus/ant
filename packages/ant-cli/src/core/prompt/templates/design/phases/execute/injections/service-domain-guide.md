## 🧩 SERVICE DOMAIN DESIGN GUIDE

**Purpose**: This injection is included **only** when the project design domain is classified as `service` (dashboards, CRUD apps, SaaS tools, content aggregators, internal tools, etc.).
It helps you keep System Design documents at the **correct abstraction level** for service systems.

### 1. System Design vs Implementation (Service Projects)
- System Design describes **architecture, boundaries, data flow, and domain rules** – **NOT** framework hooks, UI props, storage keys, or concrete data structures.
- Avoid low-level **HOW** details such as:
  - Exact storage keys, array/object layouts, or query parameter formats.
  - Specific chart types or visualization library names.
  - Concrete state management tool names or component lifecycle details.
- Instead, describe:
  - **What** data is persisted or visualized.
  - **Which layer** is responsible for owning or transforming that data.
  - **How** layers and modules collaborate at a conceptual level (commands, events, contracts).

### 2. Boundary Separation for Service Systems

Regardless of architecture pattern chosen, service systems MUST maintain these separations:

| Separation | What to Isolate |
|-----------|----------------|
| **UI vs Domain** | Rendering/interaction concerns from business rules and policies |
| **Orchestration vs Pure Rules** | Use-case coordination from stateless domain logic |
| **Technical vs Business** | External system dependencies from core domain contracts |

**Constraint**: If the architecture pattern observation (from the tier-specific guide) selects explicit layer separation, each boundary MUST have its own named responsibilities.

**Constraint**: Do NOT let all business logic live in the orchestration boundary. Domain policies, invariants, and calculation rules belong in a dedicated domain boundary.

**Principle**: Boundary names may vary across architecture patterns, but the separations above are mandatory for service systems with non-trivial domain logic.

### 3. Domain Layer as First-Class Citizen (Service)
- Do **not** let all business logic live in the Application layer.
- Define explicit **Domain services / aggregates / policies** that own:
  - Normalization rules (e.g., "how heterogeneous external data becomes a unified model").
  - Classification rules (e.g., "how categories/tags are derived and kept consistent across providers and time").
  - Calculation rules (e.g., "how statistics, trends, or KPIs are computed from events/logs and over which time windows").
  - Aggregation policies across providers (e.g., precedence rules when multiple sources disagree, deduplication and merge strategies).
  - Uniqueness and identity rules (e.g., how canonical IDs are derived, how duplicates are detected and resolved, how idempotency of domain operations is defined).
  - Consistency constraints (e.g., "timestamps per user/session are monotonic", "article IDs remain stable across re-ingestion").
- Describe Domain contracts in a **language-agnostic** way:
  - **Name** (e.g., `NewsAggregationService`, `StatisticsPolicy`).
  - **Role** (1 sentence).
  - **Operations** (name + input concepts + output concepts).
  - **Rules / invariants** (e.g., "no duplicate IDs", "no stale data beyond configured freshness window").
- Application layer should depend on these Domain contracts, not inline ad-hoc logic per screen.

### 3.1 Service Domain Invariants & Policies (Define Them Explicitly)
- System Design for service systems MUST explicitly name the **domain-level policies** (values come from PRD; System Design defines their existence and ownership):
  - **Data freshness**: how "fresh enough" is defined per data type (use conceptual descriptions like "bounded history" or "sliding window", avoid hard-coded numbers unless PRD requires them).
  - **Uniqueness & de-duplication**: how duplicates across providers or sources are detected (e.g., by URL, canonicalized title, content hash) and what to do when conflicts occur (merge, prefer primary source, drop, mark as conflicting).
  - **Sorting & ranking**: which primary and secondary sort keys are used for lists (e.g., recency vs relevance) and how ties are broken; express this as policy, not concrete algorithm or query.
  - **Fallbacks**: when required attributes (category, tags, segments) are missing or ambiguous, how defaults/fallbacks are chosen and which boundary applies them.
  - **Canonicalization**: how canonical representations (IDs, slugs, normalized titles) are derived and updated over time, and which component owns this responsibility.
  - **Event semantics**: what counts as a "view", "click", "conversion", "bookmark", "notification", etc. for statistics and reporting; list the key domain events and which boundary emits/consumes each.
- These invariants and policies live in Domain; Application and Infrastructure must not silently override them with ad-hoc rules per feature or screen.

### 4. Application Layer Responsibilities (Service)
- Focus on **orchestration, consistency boundaries, and state ownership**, not on concrete framework APIs:
  - Describe use-case flows: "On search command, Application layer invokes SearchService, normalizes results, updates SearchState, and notifies Presentation."
  - Describe state ownership: "Application layer owns article feed, bookmark collection, and analytics aggregates as separate read models/aggregates," rather than naming specific implementation types like `NewsState` or `StatsSlice`.
  - Describe persistence strategy at contract level: "Application layer persists state using `StorageAdapter` and `AnalyticsRepository` ports; concrete storage technologies are hidden behind adapters."
  - Clarify **consistency and transaction boundaries**: which operations must be all-or-nothing vs eventually consistent (per PRD), and which boundary coordinates multi-step workflows.
  - Clarify ownership of **aggregation across providers**: Application orchestrates multi-provider calls and delegates interpretation/merging to Domain policies.
  - Clarify ownership of **caching policies**: Application decides when to reuse vs invalidate cached domain read models, and which signals (time, explicit invalidation events) drive cache refresh.
  - If applicable, clarify whether **read models and write models** are separated (e.g., separate query/read side vs command/write side) and how they are synchronized conceptually (no implementation-level replication logic).
- Avoid:
  - Mentioning specific framework hooks, lifecycle methods, or state management library names.
  - Describing mount/unmount timing or view lifecycle mechanics.
  - Describing concrete internal state shapes that never cross layer boundaries.

### 5. Infrastructure Layer: Contracts & Failure Modes
- For each major external dependency (APIs, storage, queues), define:
  - **Port/Adapter name** and **role** (e.g., `NewsAPIClient`, `StorageAdapter`, `AnalyticsClient`).
  - **Operations** at a conceptual level ("fetch normalized articles", "persist bookmark collection", "append analytics event").
  - **Failure model and reliability policies** at a high level (policy level, not config values):
    - How timeouts, network errors, and invalid responses are represented (e.g., typed error results, domain-level error codes).
    - Which layer owns **retry decisions** (usually Application, based on Infrastructure error signals and PRD reliability requirements).
    - Whether **circuit breaker** behavior exists, and if so, which boundary is responsible for opening/closing it.
    - Which operations must be **idempotent** (safe to retry) and how that is enforced at the contract level.
    - How errors propagate: which errors are mapped to domain-level failures, which become user-visible messages, which are logged only.
- Do **not** specify:
  - Exact timeout values, retry counts, backoff formulas.
  - Concrete HTTP client libraries, SDK configuration, or monitoring/tooling setup.
- When PRD does **not** mention reliability/availability explicitly, you may keep this section brief but still state which boundary **would** own retries/timeouts/error mapping if added later.

### 6. UI / Presentation: Stay at System-Design Level
- You may describe:
  - **Screens / pages / views** and their responsibilities (e.g., "SearchView", "DashboardView", "BookmarksView").
  - High-level navigation / routing and how screens map to use cases.
  - Which **Application-level state** or read models each view consumes.
- Avoid turning System Design into a frontend implementation guide:
  - ❌ No detailed component trees or DOM structures.
  - ❌ No prop-level descriptions like "`NewsCard` passes `onClick` to parent".
  - ❌ No local vs global state mechanics ("this screen uses local state for X, global store for Y").
  - ❌ No storage keys, URL parameter shapes, or event handler names.
- When referring to visualization (charts, tables, widgets), describe:
  - **What metric or dimension** is shown.
  - **Which layer** prepares the data and owns the semantics.
  - Not the specific chart library or visualization algorithm.

### 7. What BELONGS Where (Service Projects)
- **PRD**:
  - Functional requirements, user journeys, UI examples.
  - Concrete UX details (exact component labels, chart types, "show last 10 items", etc.).
- **System Design (this document)**:
  - Architecture pattern and layer boundaries.
  - Domain model and business rules.
  - Contracts between Presentation, Application, Domain, and Infrastructure.
  - High-level data flow and error propagation patterns.
- **Implementation**:
  - Framework-specific hooks, state management setup, storage key names.
  - Concrete schema definitions, DTO/typing details.
  - Library choices and configuration.

### 8. Service Domain – Forbidden Implementation Details
- ❌ Do **not** hard-code:
  - Storage keys (`"recentSearches"`, `"statsData"`, `"bookmarks"`).
  - URL route/query formats or search parameter names.
  - Concrete DTO/record structures for internal UI state (unless they are cross-layer contracts).
  - Specific chart or table libraries and option objects.
  - Concrete state management library names and hook usage.
- ✅ Instead, express them as:
  - "Recent search terms are persisted by StorageAdapter and exposed as `RecentSearches` read model."
  - "Statistics module computes per-category counts and time-series trends from click and bookmark events."
  - "Dashboard view consumes `StatisticsViewModel` prepared by Application layer."

This guide is **service-domain specific** and MUST NOT be injected for game projects.
