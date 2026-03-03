## ⚙️ BACKEND DESIGN DOCUMENT GUIDE

**Document Type**: `be-system-{name}.md` (e.g., `be-system-main.md`, `be-system-auth.md`)
**Role**: HOW Backend IMPLEMENTS the corresponding `api-contract-{name}.md`
**Phase**: Written AFTER the corresponding api-contract document is finalized

### 🎯 What This Document IS

**Backend Implementation Architecture:**
- ✅ HOW to implement endpoints at an architectural level (boundary responsibilities, data flow)
- ✅ Architecture pattern selection based on observed complexity (boundary separation level)
- ✅ Database design (conceptual schema, relationships, key constraints)
- ✅ Business logic placement (validation, authorization, domain rules location)
- ✅ Integration patterns (external APIs, message queues, caching)

**Characteristics:**
- PROVIDER perspective: How to implement APIs, not define them
- REFERENCE contract: "Implements LoginRequest → LoginResponse per api-contract-{name}.md §3.1"
- ARCHITECTURE focus: Layer boundaries, data flow, patterns

### 🚫 What This Document is NOT

- ❌ NO API definitions (already in the corresponding api-contract document)
- ❌ NO DTO redefinition (reference contract only!)
- ❌ NO full method implementations (only signatures + purpose)
- ❌ NO detailed SQL queries (only schema + relationships)
- ❌ NO implementation literals unless PRD explicitly specifies them (token TTLs, exact retry counts, exact cache keys, exact route strings)

---

## Section Catalog (CLOSED LIST)

**Constraint**: The sections below are the ONLY sections allowed in this document (`be-system-{name}.md`). Do NOT create sections outside this catalog. Decompose task descriptions are topic HINTS — the actual sections written MUST come from this catalog. Skip sections marked "conditional" when the condition is not met.

### § Overview & API Contract Compliance (mandatory)
- System purpose and business domain
- Selected architecture pattern with rationale (reference observation from §2)
- API contract compliance statement referencing the corresponding `api-contract-{name}.md`

### 2. Architecture Pattern Selection

#### 2.1 Internal Architecture Observation

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Domain complexity** | Are there business rules, invariants, or domain policies beyond data pass-through? |
| **Integration boundary count** | Does the system interact with multiple external systems that may change independently? |
| **Dependency direction concern** | Do core business rules need to be testable or replaceable independent of framework and persistence? |

#### 2.2 Architecture Selection Principle

| Complexity Observed | Pattern Direction |
|--------------------|--------------------|
| Thin domain logic, straightforward data flow | Framework-conventional layering sufficient |
| Non-trivial domain rules and invariants | Explicit domain boundary separated from infrastructure |
| Multiple external integration points with substitution needs | Port/adapter boundaries isolating external dependencies |

**Constraint**: Do NOT default to the most complex pattern. Observed complexity must justify the chosen separation level.
**Constraint**: Selected pattern MUST specify boundary responsibilities clearly in this document.

#### 2.3 Directory Structure Principle

**Constraint**: Each architecture boundary specified in this document MUST correspond to a directory-level boundary in the codebase.

**Principle**: Framework wiring mechanisms and architecture boundaries serve complementary purposes:
- Framework mechanisms handle dependency resolution, runtime wiring, and module lifecycle
- Architecture boundaries handle concern separation and dependency direction
- Both coexist; neither substitutes for the other

**Constraint**: Framework conventions alone do NOT satisfy architecture boundary separation when this document specifies explicit boundaries.

### § Database Design (conditional: if persistence needed)
- Entity relationships (conceptual schema, NOT SQL DDL)
- Key constraints and indexes
- Table/collection structure with field types

**Constraint**: Focus on structure and relationships — NOT on concrete SQL syntax, DDL, or ORM mappings.

### § Endpoint Implementation Mapping

**Constraint**: NEVER redefine DTOs — reference the corresponding api-contract document only.

For EACH endpoint group, specify:
- **Contract reference**: exact endpoint/method from the corresponding api-contract document
- **Boundary responsibilities**: which architecture boundary handles request binding, orchestration, domain rules, persistence
- **Error mapping policy**: how domain/application errors flow to contract error codes
- **Idempotency / concurrency notes** (only if PRD requires or risk is obvious)

### § Authentication & Authorization (conditional: if PRD requires auth)
- Auth boundary placement (where enforcement happens in the architecture)
- Auth context propagation (how identity becomes available to inner boundaries)
- Token/session strategy at policy level (NOT algorithms, TTLs, or claims detail)
- Authorization model (role-based, permission-based, etc.)

### § Business Logic Placement
- Which architecture boundary owns domain rules vs orchestration vs data access
- Transactional boundary ownership
- Cross-cutting concern placement (logging, validation, error translation)

### § Data Storage Architecture (conditional: if persistence needed)

**Constraint**: Do NOT default to RDB. Observe actual requirements.

| Checkpoint | Observation Target |
|------------|-------------------|
| **Schema structure** | Fixed fields OR dynamic/flexible? |
| **Query patterns** | Complex joins/aggregations OR simple key-based access? |
| **Consistency needs** | ACID transactions required OR eventual consistency acceptable? |
| **Scale pattern** | Read-heavy? Write-heavy? Time-series? |

**Constraint**: If hybrid storage needed, document which data belongs where and why.

### § Caching Strategy (conditional: if PRD indicates performance requirements)

| Checkpoint | Observation Target |
|------------|-------------------|
| **Read frequency** | Same data read repeatedly? |
| **Data freshness** | How stale is acceptable? |
| **Invalidation triggers** | When does cached data become invalid? |
| **Scope** | Request-local, instance-local, or distributed? |

**Constraint**: If horizontal scaling expected, distributed cache strategy MUST be documented.

### § Async Processing & Message Queue (conditional: if PRD indicates background jobs or event-driven patterns)

| Checkpoint | Observation Target |
|------------|-------------------|
| **Long-running tasks** | Operations that take seconds/minutes? |
| **Decoupling needed** | Producer shouldn't wait for consumer? |
| **Reliability** | Must tasks survive server restart? |
| **Order guarantee** | Must messages be processed in order? |

**Constraint**: If message queue used, document queue/topic structure, message schema reference, retry/dead-letter policy, and consumer scaling — all at architectural level.

### § Real-time & Connection State (conditional: if the corresponding api-contract document defines WebSocket/SSE)

| Checkpoint | Observation Target |
|------------|-------------------|
| **Connection scope** | Per-user? Per-session? Per-room/channel? |
| **State persistence** | Connection state needs to survive reconnection? |
| **Scale model** | Single instance OR multiple instances? |

**Constraint**: If horizontal scaling expected with stateful connections, state externalization and broadcast strategy MUST be documented.

### § Architecture Style (conditional: if PRD indicates multi-domain complexity)

| Observation | Architecture Style |
|-------------|-------------------|
| Simple domain, single team, uniform scaling | Monolith |
| Clear domains, same deployment, code organization | Modular Monolith |
| Independent deployment + scaling per domain | Service-oriented / MSA |

**Constraint**: Do NOT default to MSA. Complexity must match requirements.

### § External Integrations (conditional: if applicable)
- Third-party APIs, file storage, external authentication providers

### § Technology Stack (mandatory)

**Constraint**: Technology stack MUST be specified. If PRD does not specify, default to TypeScript + Node.js + PostgreSQL. Include cache/queue/real-time technologies only when corresponding conditional sections are present.

### § Directory Structure & Boundary Mapping (conditional: if framework augmentation injected)
- Boundary-to-directory mapping principle
- Import direction enforcement rules
- Coding phase directives

---

## Scope Ceiling

**Constraint**: The following topics MUST NOT appear as sections in this document. They belong in coding phase or implementation — NOT in system design.

| Forbidden Topic | Reason |
|----------------|--------|
| API endpoint definitions (request/response schemas) | Already in the corresponding api-contract document |
| DTO type definitions or interface declarations | Already in the corresponding api-contract document |
| Full function/method implementations | Implementation detail |
| SQL DDL or ORM model definitions | Implementation detail |
| Concrete library API calls or syntax | Implementation detail |
| Numeric constants (TTLs, retry counts, cache keys) | Implementation detail (unless PRD mandates) |
| Step-by-step procedural algorithms | System design describes POLICY, not STEPS |
| Named service classes with method signatures | LLM-invented identifiers forbidden in system design |

---

## Critical Rules

### Rule 1: NO API Redefinition
**Constraint**: Backend NEVER redefines APIs. Always reference the corresponding api-contract document sections.

### Rule 2: NO DTO Duplication
**Constraint**: Never duplicate DTO definitions. Reference contract types only.

### Rule 3: Reference Contract Explicitly
**Constraint**: Every endpoint implementation mapping must reference the specific section of the corresponding api-contract document.

### Rule 4: Boundaries, Not Recipes
**Constraint**: Backend may describe implementation BOUNDARIES (what lives where) but must avoid implementation RECIPES (step-by-step algorithms, concrete library calls, numeric constants).

---

## 🏗️ SERVICE-SPECIFIC DOCUMENT (if MSA / msa-contract-first)

**When writing `be-system-{service}.md`, follow these additional rules.**

### Document Scope Principle

| ✅ Include (THIS service only) | ❌ Exclude (belongs elsewhere) |
|-------------------------------|-------------------------------|
| THIS service's architecture layers | Other services' internals |
| THIS service's database schema | Other services' schemas |
| THIS service's endpoint implementations | Endpoints other services provide |
| Events THIS service publishes/subscribes | Event implementations in other services |
| THIS service's technology stack | Gateway/infrastructure shared by all |

### Required Sections (per service document)

1. **Overview**: Service name, responsibility, corresponding api-contract document reference
2. **Architecture**: THIS service's internal layers (Controller → Service → Repository)
3. **Database Schema**: Tables/collections THIS service owns
4. **Endpoint Implementation Mapping**: Endpoints from the corresponding api-contract document that THIS service implements
5. **Event Integration**: Events published/subscribed with corresponding api-contract document reference

### Cross-Reference Principle

**⚠️ CRITICAL**: Do NOT duplicate API Contract content. Reference only.

| Content Type | Location | Reference Method |
|--------------|----------|------------------|
| Endpoint definitions | api-contract-{name}.md | "Implements api-contract-{name}.md §X" |
| DTO definitions | api-contract-{name}.md | "Uses {DTOName} from api-contract-{name}.md §Y" |
| Event payloads | api-contract-{name}.md | "Publishes {EventName} per api-contract-{name}.md §Z" |
| Inter-service calls | api-contract-{name}.md | "Calls {Service} endpoint per api-contract-{name}.md §W" |

### Template for Service Document Header

```markdown
# Backend System Design: {Service Name} Service

## 1. Overview

**Service Name**: {service}
**Responsibility**: {1-2 sentences from PRD}
**API Contract Reference**: api-contract-{name}.md

### Endpoints Implemented (from api-contract-{name}.md)
- § Internal API → {service} section
- § Async Events → {service} as Publisher/Subscriber

### Data Ownership
- {table1}, {table2}, ...
```

### ⚠️ Constraint

- Each service document focuses on **HOW** (implementation architecture)
- The corresponding api-contract document defines **WHAT** (interfaces, DTOs, events)
- **Do NOT redefine DTOs or endpoint schemas in service documents**
- **Do NOT describe other services' implementation details**

---

## Key Reminders

- **Describe architecture boundaries, not implementation recipes**
- **Reference the corresponding api-contract document — never duplicate it**
- **Decompose task descriptions are HINTS — this section catalog is the scope ceiling**
- **Conditional sections should be skipped when their condition is not met**
