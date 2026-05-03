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

**Field Identifier Convention (Priority Order)**:
1. **External contract source observable** (consumer perspective; swagger / OpenAPI / Protobuf / GraphQL SDL / etc.) → Use the source's field identifiers VERBATIM. Identifier-level transformation (e.g., `snake_case` → `camelCase`, dropping prefixes, pluralization changes) is FORBIDDEN.
2. **Directive / refs / context specifies a DTO convention** → Follow that convention exactly.
3. **Neither (1) nor (2) applies** → Pick ONE convention (camelCase OR snake_case) and apply it consistently. Do NOT default to a particular case style based on language or framework — the choice is the document's, not the implementation's.
- NEVER mix conventions within the same document.
- The convention applies to ALL wire-facing identifiers: DTO field names, query parameter names, event payload keys, header names.
- Identifier preservation is independent of the C2 "no verbatim" rule under the "External Contract Discovery" section below (which targets retrieved descriptions / examples, not identifiers).

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
| Backend INTERNAL flow diagrams (server-side processing sequence, internal service-to-service calls, internal data-flow between layers) | Backend system design (be-system) |
| Database schemas or internal state management | Backend system design (be-system) |
| Enumeration/constant definitions as standalone sections | Subsection within Shared Type Definitions |
| Access control mechanisms as standalone sections | Subsection within Authentication & Authorization |
| Implementation details (signing algorithms, hashing, caching) | Backend system design or coding phase |
| Step-by-step numbered procedures | Describe WHAT the endpoint accepts/returns, not HOW the server processes it |

Endpoint-surface diagrams that depict the API boundary itself (resource grouping, auth gateway, public/internal partitioning, MSA service-to-service contract topology) ARE allowed in this document under diagram-contract — they describe the contract surface, not internal flow.

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

**Scope**: This section governs CONSUMER-perspective tasks only (per the Role declaration above — `consumedApis`-derived). Provider-perspective tasks (`services`-derived) author DTO shapes from PRD and architectural decisions; this section (Observation Target / Constraints C1-C4 / Retrieve Toolset / gap statement) does NOT apply, and authoring DTO field lists from PRD-grounded design IS NOT fabrication when no upstream contract exists — that is the provider's job.

**Observation Target**
- The reference, context, or directive materials provided for this task may name an external API contract by a reachable source (a URL, a repository path, a command that emits it, or another addressable handle). Observe those injected materials; do NOT rely on a particular source file name.

**Constraints**
- C1 — When a reachable contract source is observable in the injected materials, retrieve it with the available tools before describing endpoints, payloads, or status codes.

  **Retrieve Toolset (handle type → tool)**:

  | Handle type | Tool | Example invocation |
  |-------------|------|-------------------|
  | Local file in codebase | `read_file` | `read_file({ path: "apis/openapi.yaml" })` |
  | File in source documents | `read_source_doc` | `read_source_doc({ path: "swagger.json", startLine, endLine })` |
  | Code surface (types / route handlers / client call sites) | `search_code` | `search_code({ query: "FooResponse\|/v1/foo", path: "codebase/" })` |
  | Remote URL / shell-emitting handle | — | **NOT retrievable from design phase.** Shell execution is reserved for the code job's execute phase. Re-derive the handle from codebase / source-doc reads, or emit the C3 gap statement when no in-repo evidence exists. |

  `search_web` is for handle DISCOVERY (when no source provides a handle) — NOT for retrieving a known handle. C4 already prohibits overlap.

- C2 — Retrieved content is evidence, not output. NEVER paste it verbatim.
  - **Carve-out (identifier surface)**: Field IDENTIFIERS are NOT subject to C2 — they are the contract. Preserve verbatim: DTO field names, endpoint paths, query / path parameter names, header names, status codes, event names, enum literals. C2 forbids copying retrieved DESCRIPTIONS, examples, vendor commentary, narrative text — NOT the identifier surface. Per the "Field Identifier Convention" priority (1) above, identifier-level transformation (`snake_case` → `camelCase`, prefix removal, etc.) is FORBIDDEN when an external source exists.
- C3 — If retrieval fails (no handle observable, network error, HTTP 4xx/5xx, content not parseable), the document MUST emit a gap statement matching this template, and MUST omit DTO field shapes from § Shared Type Definitions:

  (Translate the prose to the document's detected language; preserve placeholder tokens like `<reason>` / `<handle>` and the warning sigil verbatim.)

  > ⚠️ Contract source unreachable: <reason — e.g., 'no handle observable in PRD/refs', 'network timeout against <handle>', 'HTTP 401 from <handle>'>.
  > § Shared Type Definitions deferred until contract becomes retrievable (e.g., service brought online, codegen output committed, contract document obtained). Payload field shapes are NOT specified in this document.

  - Allowed under gap (PRD-derivable, not contract-derivable):
    - Endpoint paths and HTTP methods cited verbatim in PRD
    - Enum values explicitly enumerated in PRD
    - Status code → FE error boundary policy (FE-side, not server-side)
  - Forbidden under gap:
    - Inventing DTO type names with field lists (i.e., declaring any `<TypeName>` with arbitrary field set when the contract was never retrieved — regardless of how plausible the field names look)
    - Guessing field identifiers from PRD wording in ANY case style — turning "company name" into `companyName`, `company_name`, `CompanyName`, or any variant is equally fabrication if not contract-derived
    - Type annotations on never-observed fields
- C4 — `search_web` only when source is unknown; retrieval tools only when source is identified. Do NOT overlap.

**Blind Spots**
- Partial retrieval looking complete.
- External contract vs directive disagreement.
- If no reachable source is observable, do NOT attempt retrieval.

---

**Purpose**: Pure interface specification that FE/BE implement independently.
