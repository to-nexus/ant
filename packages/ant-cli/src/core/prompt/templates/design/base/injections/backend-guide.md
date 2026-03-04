## BACKEND DESIGN DOCUMENT GUIDE

**Document**: `be-system-{name}.md`  
**Role**: Backend internal architecture derived from PRD requirements  
**Focus**: Internal system structure — boundary responsibilities, data flow, domain placement, infrastructure decisions

---

## Core Principles

### 1. Architecture Pattern Selection

#### 1.1 Architecture Observation

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Domain complexity** | Are there business rules, invariants, or domain policies beyond data pass-through? |
| **Integration boundary count** | Does the system interact with multiple external systems that may change independently? |
| **Dependency direction concern** | Do core business rules need to be testable or replaceable independent of framework and persistence? |

#### 1.2 Architecture Selection Principle

| Complexity Observed | Pattern Direction |
|--------------------|--------------------|
| Thin domain logic, straightforward data flow | Framework-conventional layering sufficient |
| Non-trivial domain rules and invariants | Explicit domain boundary separated from infrastructure |
| Multiple external integration points with substitution needs | Port/adapter boundaries isolating external dependencies |

**Constraint**: Do NOT default to the most complex pattern. Observed complexity must justify the chosen separation level.  
**Constraint**: Selected pattern MUST be stated in the design document with explicit boundary responsibilities.

#### 1.3 Directory Structure Principle

**Constraint**: Each architecture boundary specified in this document MUST correspond to a directory-level boundary in the codebase.

**Principle**: Framework wiring mechanisms and architecture boundaries serve complementary purposes:
- Framework mechanisms handle dependency resolution, runtime wiring, and module lifecycle
- Architecture boundaries handle concern separation and dependency direction
- Both coexist; neither substitutes for the other

**Constraint**: Framework conventions alone do NOT satisfy architecture boundary separation when this document specifies explicit boundaries.

---

### 2. API Interface Scope

**Principle**: This document describes internal backend architecture — NOT the API interface specification (endpoints, DTOs, schemas). Interface details are defined in a separate api-contract document and consumed during the coding phase.

- Describe boundary responsibilities for request processing (which boundary owns validation, orchestration, domain rules, persistence)
- Error handling: describe how domain/application errors propagate across boundaries at policy level
- External services: list only if PRD explicitly requires (with PRD reference)

**Constraint**: Do NOT define or reproduce endpoint specifications, DTO schemas, or request/response formats. These belong in the api-contract document (separate concern).

---

### 3. Infrastructure Independence

**Observation target**: Does the project depend on external services (third-party APIs, cross-project dependencies) that may be unavailable during development?

| Checkpoint | What to observe |
|-----------|----------------|
| **External service adapters** | Does PRD specify third-party APIs or cross-project service dependencies? |
| **Local infrastructure** | Does the project use databases, caches, or queues provisioned locally (e.g., via docker-compose)? |

**Principle**: When the implementing service is unavailable, each infrastructure port consuming that service MUST define production and development-mode implementation strategies in the catalog section where that adapter is introduced.

**Constraint**: State ONLY the port name, its role, and the two strategy labels (production + development-mode). Do NOT specify implementation details (class names, in-memory data structures, environment variable names, mock libraries).

**Constraint**: Local infrastructure (databases, caches, queues managed by docker-compose) is NOT a mock target — they run as real local instances.

---

## Section Catalog (CLOSED LIST)

**Constraint**: The sections below are the ONLY sections allowed in this document (`be-system-{name}.md`). Do NOT create sections outside this catalog. Decompose task descriptions are topic HINTS — the actual sections written MUST come from this catalog. Skip sections marked "conditional" when the condition is not met.

{{#if filteredCatalog}}
{{{filteredCatalog}}}
{{else}}
{{> design/base/catalogs/backend-catalog}}
{{/if}}

---

## Section-Specific Writing Guidance

**§ Database Design**: Focus on structure and relationships — NOT on concrete SQL syntax, DDL, or ORM mappings. ALL schema content (entities, relationships, field types, indexes) belongs in this ONE chapter. Do NOT create a separate "detailed schema" chapter. Use generic types (integer, string, decimal), NOT database-engine-specific types.

**§ Data Storage Architecture**: Do NOT default to a single storage type. Observe actual requirements (schema structure, query patterns, consistency needs, scale pattern). If hybrid storage needed, document which data belongs where and why.

**§ Caching Strategy**: If horizontal scaling expected, distributed cache strategy MUST be documented.

**§ Async Processing & Message Queue**: If message queue used, document queue/topic structure, message schema reference, retry/dead-letter policy, and consumer scaling — all at architectural level. If the system both produces AND consumes messages, document the FULL message queue topology here. The Real-time section should REFERENCE this topology, not redefine or contradict it.

**§ Real-time & Connection State**: If horizontal scaling expected with stateful connections, state externalization and broadcast strategy MUST be documented.

**§ External Integrations**: When external service adapters exist, each port's development-mode implementation strategy MUST be documented per Infrastructure Independence Guardrail. Do NOT specify implementation details. Local infrastructure is NOT a mock target.

**§ Architecture Style**: Do NOT default to MSA. Complexity must match requirements.

**§ Technology Stack**: Technology stack MUST be specified. If PRD does not specify, observe the existing project codebase for technology signals. If greenfield, state the selection rationale. Include cache/queue/real-time technologies only when corresponding conditional sections are present.

---

## Scope Ceiling

**Constraint**: The following topics MUST NOT appear as sections in this document. They belong in api-contract, coding phase, or implementation — NOT in system design.

| Forbidden Topic | Reason |
|----------------|--------|
| API endpoint definitions (request/response schemas) | Defined in api-contract document (separate concern) |
| DTO type definitions or interface declarations | Defined in api-contract document (separate concern) |
| Full function/method implementations | Implementation detail |
| SQL DDL or ORM model definitions | Implementation detail |
| Concrete library API calls or syntax | Implementation detail |
| Numeric constants (TTLs, retry counts, cache keys) | Implementation detail (unless PRD mandates) |
| Step-by-step procedural algorithms | System design describes POLICY, not STEPS |
| Named service classes with method signatures | LLM-invented identifiers forbidden in system design |

---

## MSA Service Scope (conditional: if multiple `be-system-{service}.md` documents)

**Principle**: Each service document follows the same Section Catalog (CLOSED LIST), scoped to THIS service only. Sections that reference content from other services MUST cross-reference, not duplicate.

| Constraint | What to observe |
|-----------|----------------|
| **Service isolation** | Does THIS document describe only THIS service's architecture, schema, and boundary responsibilities? |
| **Cross-service leakage** | Does THIS document describe other services' internals, schemas, or boundary responsibilities? |
| **Shared infrastructure** | Gateway, shared message bus, or cross-cutting infrastructure belongs in a shared foundation — NOT in individual service documents |

**Constraint**: Do NOT describe other services' implementation details.

---

## Anti-Patterns

- Defining API endpoints or DTO schemas — belongs in api-contract and coding phase
- Including full method implementations or SQL DDL
- Specifying concrete numeric constants (TTLs, retry counts, cache keys) unless PRD mandates
- Step-by-step procedural algorithms (describe POLICY instead)
- Naming specific service classes with method signatures
- Framework-specific details (lifecycle hooks, DI configuration, middleware chains)
- Defaulting to the most complex architecture pattern without observed justification

---

## Key Reminders

- **Describe architecture boundaries, not implementation recipes**
- **Keep abstractions framework-agnostic**
- **API interface details are defined separately and consumed during the coding phase**
- **Decompose task descriptions are HINTS — this section catalog is the scope ceiling**
- **Conditional sections should be skipped when their condition is not met**
