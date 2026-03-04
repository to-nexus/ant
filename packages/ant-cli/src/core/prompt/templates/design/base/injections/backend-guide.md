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

{{> design/base/catalogs/backend-catalog}}

---

### Architecture Pattern Selection (Core Principle)

#### Internal Architecture Observation

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Domain complexity** | Are there business rules, invariants, or domain policies beyond data pass-through? |
| **Integration boundary count** | Does the system interact with multiple external systems that may change independently? |
| **Dependency direction concern** | Do core business rules need to be testable or replaceable independent of framework and persistence? |

#### Architecture Selection Principle

| Complexity Observed | Pattern Direction |
|--------------------|--------------------|
| Thin domain logic, straightforward data flow | Framework-conventional layering sufficient |
| Non-trivial domain rules and invariants | Explicit domain boundary separated from infrastructure |
| Multiple external integration points with substitution needs | Port/adapter boundaries isolating external dependencies |

**Constraint**: Do NOT default to the most complex pattern. Observed complexity must justify the chosen separation level.
**Constraint**: Selected pattern MUST specify boundary responsibilities clearly in this document.

#### Directory Structure Principle

**Constraint**: Each architecture boundary specified in this document MUST correspond to a directory-level boundary in the codebase.

**Principle**: Framework wiring mechanisms and architecture boundaries serve complementary purposes:
- Framework mechanisms handle dependency resolution, runtime wiring, and module lifecycle
- Architecture boundaries handle concern separation and dependency direction
- Both coexist; neither substitutes for the other

**Constraint**: Framework conventions alone do NOT satisfy architecture boundary separation when this document specifies explicit boundaries.

---

### Section-Specific Writing Guidance

**§ Database Design**: Focus on structure and relationships — NOT on concrete SQL syntax, DDL, or ORM mappings.

**§ Endpoint Implementation Mapping**: NEVER redefine DTOs — reference the corresponding api-contract document only. For each endpoint group: contract reference, boundary responsibilities, error mapping policy, idempotency/concurrency notes (only if PRD requires).

**§ Data Storage Architecture**: Do NOT default to RDB. Observe actual requirements (schema structure, query patterns, consistency needs, scale pattern). If hybrid storage needed, document which data belongs where and why.

**§ Caching Strategy**: If horizontal scaling expected, distributed cache strategy MUST be documented.

**§ Async Processing & Message Queue**: If message queue used, document queue/topic structure, message schema reference, retry/dead-letter policy, and consumer scaling — all at architectural level.

**§ Real-time & Connection State**: If horizontal scaling expected with stateful connections, state externalization and broadcast strategy MUST be documented.

**§ External Integrations**: When external service adapters exist, each port's development-mode implementation strategy MUST be documented per Infrastructure Independence Guardrail. State the port name, role, and two strategy labels (production + development-mode). Do NOT specify implementation details (class names, data structures, environment variables). Local infrastructure (DB, cache, queue via docker-compose) is NOT a mock target.

**§ Architecture Style**: Do NOT default to MSA. Complexity must match requirements.

**§ Technology Stack**: Technology stack MUST be specified. If PRD does not specify, default to TypeScript + Node.js + PostgreSQL. Include cache/queue/real-time technologies only when corresponding conditional sections are present.

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
