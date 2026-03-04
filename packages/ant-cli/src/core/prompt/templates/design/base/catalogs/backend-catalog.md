### § Overview (mandatory)
- System purpose and business domain
- Selected architecture pattern with rationale (reference observation from §1.1)

### § Database Design (conditional: if persistence needed)
- Entity relationships (conceptual schema, NOT SQL DDL)
- Key constraints and indexes
- Table/collection structure with field types

### § Authentication & Authorization (conditional: if PRD requires auth)
- Auth boundary placement, context propagation, token/session strategy, authorization model

### § Business Logic Placement
- Domain rules vs orchestration vs data access ownership
- Transactional boundary ownership
- Cross-cutting concern placement

### § Data Storage Architecture (conditional: if persistence needed)
- Storage type observation (schema structure, query patterns, consistency, scale)
- Hybrid storage documentation when multiple storage types needed

### § Caching Strategy (conditional: if PRD indicates performance requirements)
- Read frequency, data freshness, invalidation triggers, scope (request/instance/distributed)

### § Async Processing & Message Queue (conditional: if PRD indicates background jobs or event-driven patterns)
- Queue/topic structure, message schema reference, retry/dead-letter policy, consumer scaling

### § Real-time & Connection State (conditional: if PRD indicates real-time requirements)
- Connection scope, state persistence, scale model

### § Architecture Style (conditional: if PRD indicates multi-domain complexity)
- Monolith vs modular monolith vs service-oriented selection

### § External Integrations (conditional: if applicable)
- Third-party APIs, file storage, external authentication providers
- Adapter isolation & development independence (which contracts have external dependencies, production + development-mode implementation strategies per Infrastructure Independence Guardrail)

### § Technology Stack (mandatory)
- Framework, database, cache/queue/real-time technologies

### § Directory Structure & Boundary Mapping (conditional: if framework augmentation injected)
- Boundary-to-directory mapping principle
- Import direction enforcement rules
- Coding phase directives
