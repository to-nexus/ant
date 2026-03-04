### § Overview
- System purpose, selected architecture pattern with rationale (reference observation from §1.1)
- PRD constraints relevant to architecture (platform, integrations, prohibitions)
- API contract compliance statement (reference the corresponding `api-contract-{name}.md`)

### § Architecture Boundaries
- For each boundary: name, responsibility, what it owns
- Dependency direction between boundaries
- What crosses each boundary (data types, commands, events)
- Rendering strategy per route category (SSR/CSR/hybrid) if applicable
- Route access policy: which boundary owns auth state, how protected routes behave on auth failure (do NOT create a separate Routing section)

### § API Integration & Error Strategy
- Infrastructure adapter role (single adapter wrapping external communication)
- Adapter isolation & development independence (which contracts have external dependencies, production + development-mode implementation strategies, switching mechanism per Infrastructure Independence Guardrail)
- Auth lifecycle POLICY (which boundary owns each auth phase; NOT step-by-step procedure like "get X → call Y → store Z")
- Error propagation POLICY (how errors flow across boundaries; NOT HTTP status code enumerations like 401/400/500)

### § State Management & Data Flow
- State ownership per boundary (global vs route-scoped vs view-local)
- Server state caching POLICY (invalidation triggers, staleness handling)
- Optimistic update POLICY (when to apply, reconciliation principle)
- Real-time data strategy if applicable (polling vs push, coordination ownership)

### § Domain Rules (conditional: if explicit domain boundary selected)
- Calculation ownership (state which boundary owns calculations and REFERENCE the PRD section that defines them; do NOT reproduce formulas or expressions)
- View-model derivation PRINCIPLES (what domain concepts each view-model aggregates; NOT individual field names or property listings)
- Format policy REFERENCE (point to PRD section numbers; do NOT reproduce formatting rules or expressions)
- Client-side validation invariants (domain-level rules referencing PRD sections; NOT implementation-ready expressions with concrete value ranges or comparison operators)

### § External Integrations (conditional: if PRD specifies third-party SDKs or external service adapters)
- Each external service adapter: which boundary owns it, what it exposes inward
- Connection lifecycle policy (initialization, reconnection, teardown ownership)
- Adapter isolation principle (external SDK details do not leak into domain/orchestration boundaries)

### § Directory Structure & Boundary Mapping (conditional: if framework augmentation injected)
- Boundary-to-directory mapping principle
- Import direction enforcement rules
- Coding phase directives
