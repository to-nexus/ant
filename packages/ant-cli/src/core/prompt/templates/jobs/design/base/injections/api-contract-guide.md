## 📋 API CONTRACT DOCUMENT GUIDE

**Document Type**: `api-contract-{name}.md` (e.g., `api-contract-main.md`, `api-contract-auth.md`)
**Role**: BINDING SPECIFICATION
- **Provider perspective** (this project owns the boundary — derived from `services` in decompose): the SSOT this project exposes; written independently from PRD.
- **Consumer perspective** (this project consumes an external boundary — derived from `consumedApis` in decompose): a captured snapshot of an EXTERNAL contract. Retrieve via the **External Contract Discovery** section below before describing shapes; do NOT fabricate.

**Phase**: Written independently from PRD

---

## 🎯 Purpose

**The CONTRACT between Frontend and Backend:**
- ✅ WHAT endpoints/events exist
- ✅ WHAT data is exchanged (DTOs with all fields, types, validations)
- ✅ WHAT errors can occur
- ❌ NO "how to call" (Frontend's job) or "how to implement" (Backend's job)

**Characteristics**: PRECISE, COMPLETE, IMMUTABLE

---

## Section Catalog (CLOSED LIST)

**Constraint**: The sections below are the ONLY sections allowed in this document (`api-contract-{name}.md`). Do NOT create sections outside this catalog. Decompose task descriptions are topic HINTS — the actual sections written MUST come from this catalog.

{{#if filteredCatalog}}
{{{filteredCatalog}}}
{{else}}
{{> jobs/design/base/catalogs/api-contract-catalog}}
{{/if}}

---

## ⚠️ CRITICAL RULES

**Precision (Binding)**:
- This document may include exact URL paths, status codes, and field names; they are part of the contract.
- Do not write "TBD", "etc.", "…", or leave any shape implicit.

**Naming Consistency**:
- Pick ONE: camelCase OR snake_case
- NEVER mix!

**Completeness (scoped to your assigned sections)**:
- ✅ All endpoints documented
- ✅ All fields typed **within the section that owns them** — in all sections except § Shared Type Definitions, referencing a DTO by name IS complete; field definitions belong exclusively in § Shared Type Definitions
- ✅ All errors with status codes
- ✅ No "TODO", "etc.", "..." placeholders

**DTO Reference Policy**:
- Reference shared DTOs by name only (e.g., "CreateRoomRequest")
- If a DTO is reusable, it belongs in the Shared Type Definitions section — do NOT define it inline within endpoints
- If a DTO is endpoint-specific and not reused, inline a minimal field list

**What NOT to include**:
- ❌ Database schemas (Backend's job)
- ❌ Component architecture (Frontend's job)
- ❌ Implementation details (JWT signing, hashing, etc.)
- ❌ "How to call" or "How to implement"

---

## Scope Ceiling

**Constraint**: The following topics MUST NOT appear as standalone sections in this document. They belong in other documents or as subsections within catalog sections above.

| Forbidden Topic | Where It Belongs |
|----------------|-----------------|
| Server-side processing flows or implementation steps | Backend system design (be-system) |
| Backend internal architecture diagrams or data flows | Backend system design (be-system) |
| Database schemas or internal state management | Backend system design (be-system) |
| Enumeration/constant definitions as standalone sections | Subsection within Shared Type Definitions |
| Access control mechanisms as standalone sections | Subsection within Authentication & Authorization |
| Implementation details (signing algorithms, hashing, caching) | Backend system design or coding phase |
| Step-by-step numbered procedures | Describe WHAT the endpoint accepts/returns, not HOW the server processes it |

---

## 🏗️ MSA STRUCTURE (if msa-contract-first)

**When multiple service boundaries exist, each service gets its own `api-contract-{service}.md`.**

### Principle: Direction Separation

Each per-service document uses the **same catalog sections** (§ API Endpoints, § Real-time Communication, § Shared Type Definitions, etc.) but organizes content within those sections by **communication direction**:

| Catalog Section | Sub-structure by Direction |
|----------------|--------------------------|
| § API Endpoints | **Provided** (endpoints THIS service implements) vs **Consumed** (endpoints THIS service calls FROM other services) |
| § Real-time Communication | **Published** (events THIS service emits) vs **Subscribed** (events THIS service listens to) |
| § Shared Type Definitions | Type definitions scoped to THIS service; cross-reference shared types by name |

**Constraint**: These direction sub-headings live INSIDE catalog sections — they are NOT separate top-level sections.

### Observation Checkpoints

For each per-service document, observe:

| Checkpoint | What to observe |
|-----------|----------------|
| **Provided vs Consumed** | ⚠️ REQUIRED: separate endpoints THIS service offers from endpoints it depends on |
| **Visibility** | Each provided endpoint: `public` (client-facing) or `internal` (service-to-service) |
| **Cross-service reference** | Each consumed endpoint: which service provides it |
| **Event direction** | Each event: published by THIS service or subscribed from ANOTHER service |
| **Delivery guarantee** | ⚠️ REQUIRED for events: at-least-once, at-most-once, or exactly-once |

### ⚠️ Blind Spot Reminders

- ⚠️ **Consumed endpoints**: Easily forgotten — REQUIRED when service depends on other services
- ⚠️ **Event delivery guarantee**: MUST specify per event
- ⚠️ **Shared types**: Define per-service; cross-reference shared types by name only

---

## External Contract Discovery

**Observation Target**
- The reference, context, or directive materials provided for this task may name an external API contract by a reachable source (a URL, a repository path, a command that emits it, or another addressable handle). Observe those injected materials; do NOT rely on a particular source file name.

**Constraints**
- C1 — When a reachable contract source is observable in the injected materials, retrieve it with the available tools before describing endpoints, payloads, or status codes.
- C2 — Retrieved content is evidence, not output. NEVER paste it verbatim.
- C3 — If retrieval fails, state the gap; do NOT fabricate shapes.
- C4 — `search_web` only when source is unknown; retrieval tools only when source is identified. Do NOT overlap.

**Blind Spots**
- Partial retrieval looking complete.
- External contract vs directive disagreement.
- If no reachable source is observable, do NOT attempt retrieval.

---

**Purpose**: Pure interface specification that FE/BE implement independently.
