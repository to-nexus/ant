## 📋 API CONTRACT DOCUMENT GUIDE

**Document Type**: `api-contract-{name}.md` (e.g., `api-contract-main.md`, `api-contract-auth.md`)
**Role**: BINDING SPECIFICATION - Single Source of Truth for Frontend/Backend integration
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
{{> design/base/catalogs/api-contract-catalog}}
{{/if}}

---

## ⚠️ CRITICAL RULES

**Precision (Binding)**:
- This document may include exact URL paths, status codes, and field names; they are part of the contract.
- Do not write "TBD", "etc.", "…", or leave any shape implicit.

**Naming Consistency**:
- Pick ONE: camelCase OR snake_case
- NEVER mix!

**Completeness**:
- ✅ All endpoints documented
- ✅ All fields typed
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

## 🏗️ MSA STRUCTURE (if msa-contract-first)

**When multiple service boundaries exist, each service gets its own `api-contract-{service}.md`.**

### Per-Service Contract Document Structure

Each `api-contract-{service}.md` contains:

| Section | Content | Purpose |
|---------|---------|---------|
| **§ Provided API** | Endpoints THIS service implements | What this service offers |
| **§ Consumed API** | Endpoints THIS service calls from OTHER services | External dependencies |
| **§ Events Published** | Events THIS service emits | Async output |
| **§ Events Subscribed** | Events THIS service listens to | Async input |
| **§ Service DTOs** | Type definitions specific to this service | Data shapes |

### Provided API Section

```markdown
### Provided Endpoints

| Endpoint | Method | Description | Visibility |
|----------|--------|-------------|------------|
| /api/... | POST   | ...         | public / internal |

#### POST /api/{resource}
- **Purpose**: ...
- **Visibility**: public (client-facing) / internal (service-to-service)
- **Request**: {DTO} (§ Service DTOs)
- **Success**: 201 + {DTO}
- **Errors**: ...
```

### Consumed API Section

```markdown
### Consumed Endpoints (from other services)

| Endpoint | From Service | Purpose |
|----------|-------------|---------|
| GET /internal/users/{id} | auth | Resolve user info |
```

### Events Section

```markdown
### Events Published

| Event | Trigger | Payload |
|-------|---------|---------|
| OrderCreated | New order placed | OrderCreatedEvent (§ Service DTOs) |

### Events Subscribed

| Event | From Service | Handler |
|-------|-------------|---------|
| PaymentCompleted | payment | Update order status |
```

### ⚠️ Blind Spot Reminders

- ⚠️ **Consumed API section**: Easily forgotten, REQUIRED when service depends on other services
- ⚠️ **Service DTOs**: Define per-service; shared types should be cross-referenced by name
- ⚠️ **Event delivery guarantee**: MUST specify (at-least-once, at-most-once, exactly-once)
- ⚠️ **Visibility**: Mark each endpoint as `public` (client-facing) or `internal` (service-to-service)

---

**Purpose**: Pure interface specification that FE/BE implement independently.
