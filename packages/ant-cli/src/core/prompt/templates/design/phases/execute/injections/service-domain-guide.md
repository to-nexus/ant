## 🧩 SERVICE DOMAIN DESIGN GUIDE

**Purpose**: This injection is included **only** when the project design domain is classified as `service` (dashboards, CRUD apps, SaaS tools, content aggregators, internal tools, etc.).
It provides **service-domain-specific concerns** that the tier-specific guide (backend-guide or frontend-guide) does not cover.

**Mapping principle**: The architecture pattern is selected by the tier-specific guide (§1 Architecture Pattern Selection). Each concern below MUST be mapped to the appropriate boundary in that selected pattern — do NOT create boundaries beyond what the selected pattern defines.

---

### 1. Service Domain Abstraction Level

**Principle**: Service systems frequently deal with data aggregation, transformation, and visualization. System Design describes WHAT data flows between boundaries and WHO owns it — NOT the concrete shapes, keys, or library calls.

| Observation Target | What belongs in System Design | What does NOT belong |
|-------------------|-------------------------------|---------------------|
| **Data** | What data is persisted or visualized, which boundary owns it | Exact storage keys, array/object layouts, query parameter formats |
| **Collaboration** | How boundaries collaborate at conceptual level (commands, events, contracts) | Specific framework hooks, lifecycle methods, state management library names |
| **Visualization** | What metric or dimension is shown, which boundary prepares the data | Specific chart/table libraries, visualization algorithms, option objects |

---

### 2. Domain Rule Identification

**Observation target**: Does the project have domain logic beyond simple data pass-through?

| Checkpoint | What to observe |
|-----------|----------------|
| **Normalization rules** | Does heterogeneous external data need unified domain models? |
| **Classification rules** | Are categories, tags, or labels derived and maintained by the domain? |
| **Calculation rules** | Are statistics, trends, or KPIs computed from domain events? |
| **Aggregation policies** | Does the domain merge or prioritize data from multiple sources? |
| **Uniqueness and identity** | Does the domain define canonical IDs, deduplication, or idempotency? |
| **Consistency constraints** | Does the domain enforce ordering, freshness, or monotonicity invariants? |

**Principle**: When any of the above are observed, domain contracts MUST be defined explicitly — name, role, operations, and invariants — in language-agnostic terms. These contracts belong in whichever boundary the selected architecture pattern assigns to domain logic.

**Constraint**: Do NOT scatter ad-hoc business logic across orchestration or presentation concerns. Domain rules must be identifiable as a cohesive unit regardless of the structural mechanism.

- ⚠️ **Blind spot**: For thin-domain service systems (simple CRUD, data pass-through), the tier-specific guide may select framework-conventional structure without an explicit domain boundary. In that case, the checkpoints above may yield zero observations — that is a valid outcome. Do NOT force domain separation when no domain rules are observed.

#### 2.1 Domain Invariants & Policies

**Principle**: System Design for service systems MUST explicitly name domain-level policies whose values come from PRD. System Design defines their existence and boundary ownership — NOT the concrete values.

| Policy Type | What to document |
|------------|-----------------|
| **Data freshness** | How "fresh enough" is defined per data type, which boundary enforces it |
| **Uniqueness & de-duplication** | How duplicates are detected, what happens on conflict, which boundary owns the decision |
| **Sorting & ranking** | Which sort keys and tie-breaking policies apply, expressed as policy not algorithm |
| **Fallbacks** | When required attributes are missing, how defaults are chosen and which boundary applies them |
| **Canonicalization** | How canonical representations are derived and updated, which boundary owns this |
| **Event semantics** | What counts as a domain event, which boundary emits/consumes each |

**Constraint**: Domain policies MUST NOT be silently overridden by ad-hoc rules in orchestration, presentation, or infrastructure concerns.

---

### 3. Orchestration & State Ownership

**Observation target**: What coordination and state management concerns exist?

| Checkpoint | What to document |
|-----------|-----------------|
| **Use-case orchestration** | Which boundary receives commands, which domain policies are invoked, which state is updated |
| **State ownership** | Which read models/aggregates exist, how they relate to domain concepts, which boundary owns them |
| **Persistence strategy** | Which contracts abstract storage, which boundary coordinates persistence |
| **Consistency boundaries** | Which operations are all-or-nothing vs eventually consistent (per PRD) |
| **Multi-source coordination** | Which boundary orchestrates multi-provider calls, which delegates interpretation to domain rules |
| **Caching policies** | When to reuse vs invalidate cached domain read models, which signals drive cache refresh |
| **Read/write separation** | Whether read models and write models are separated (conditional: only if observed) |

**Constraint**: Describe coordination at boundary level. Do NOT mention specific framework hooks, lifecycle methods, state management library names, or mount/unmount timing.

---

### 4. External Dependency Contracts

**Observation target**: What external dependencies does the project have?

For each major external dependency (APIs, storage, queues), document:

| Aspect | What to document |
|--------|-----------------|
| **Contract name and role** | Language-agnostic contract name and its responsibility |
| **Operations** | What the contract exposes at conceptual level |
| **Failure representation** | How timeouts, network errors, and invalid responses are represented at contract level |
| **Retry ownership** | Which boundary owns retry decisions |
| **Circuit breaker** | Whether circuit breaker behavior exists and which boundary is responsible (conditional) |
| **Idempotency** | Which operations must be safe to retry and how this is enforced at contract level |
| **Error propagation** | Which errors map to domain failures, which become user-visible, which are logged only |

- **Development independence**: Each external-dependency contract MUST define production and development-mode implementation strategies per Infrastructure Independence Guardrail. State the contract name and two strategy labels — do NOT specify mock implementation details. Local infrastructure (DB, cache, queue via docker-compose) is NOT a mock target.

**Constraint**: Do NOT specify exact timeout values, retry counts, backoff formulas, concrete HTTP client libraries, SDK configuration, or monitoring/tooling setup.

---

### 5. Forbidden Implementation Details (Service-Specific)

❌ Storage keys, URL route/query formats, or search parameter names  
❌ Concrete DTO/record structures for internal state (unless they are cross-boundary contracts)  
❌ Specific chart, table, or visualization libraries and option objects  
❌ Concrete state management library names and hook usage  
❌ Mount/unmount timing or view lifecycle mechanics  

This guide is **service-domain specific** and MUST NOT be injected for game projects.
