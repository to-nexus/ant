## 📋 API CONTRACT DOCUMENT GUIDE

**Document Type**: `api-contract-{name}.md` (e.g., `api-contract-main.md`, `api-contract-auth.md`)
**Role**: BINDING SPECIFICATION - Single Source of Truth for Frontend/Backend integration
**Phase**: Written FIRST, before FE and BE design documents

---

## 🎯 Purpose

**The CONTRACT between Frontend and Backend:**
- ✅ WHAT endpoints/events exist
- ✅ WHAT data is exchanged (DTOs with all fields, types, validations)
- ✅ WHAT errors can occur
- ❌ NO "how to call" (Frontend's job) or "how to implement" (Backend's job)

**Characteristics**: PRECISE, COMPLETE, IMMUTABLE

---

## 📐 REQUIRED SECTIONS

### 1. Overview (3-5 lines)
- API purpose and scope
- Base URL (e.g., `/api/v1`)
- Protocol(s): REST / JSON-RPC / GraphQL / Real-time (specify which)

### 2. Authentication & Authorization
**Only if PRD requires auth**. Specify:
- Auth mechanism (JWT, OAuth2, API keys, session)
- Token format and headers
- Refresh flow (if applicable)
- Roles/permissions (if applicable)

### 3. API Endpoints

**Choose ONE protocol per project:**

#### Option A: REST API
**For EACH endpoint, specify (binding; exact values):**
- **Method + Path**: exact HTTP method and path
- **Purpose**: 1 sentence
- **Auth**: required/optional + which scheme (reference §2)
- **Request**:
  - Body (if any): reference a DTO (defined in §6) OR inline minimal field list
  - Path/query params (if any): names + types + validation
- **Success Response(s)**:
  - Status code + response DTO (or empty)
- **Error Responses**:
  - Status code + error code(s) + error DTO shape (reference §6)

**Required**: Exact path, method, field names, all types, status codes; no placeholders.

#### Option B: JSON-RPC (for blockchain/RPC projects)
**Single endpoint** (e.g., `/rpc` or `/api`), method-based calls:

**For EACH method, specify (binding; exact values):**
- **Method name**
- **Purpose**
- **Params schema**: either positional list or named object (choose one style, be consistent)
- **Result schema** (or “no result”)
- **Error schema**: JSON-RPC standard errors + application errors (if any)

**JSON-RPC Standard**:
- `jsonrpc`: "2.0"
- `id`: Request identifier (number/string)
- `method`: RPC method name
- `params`: Array or object
- `result` (success) or `error` (failure)

**Required per method**: Method name, params schema, result schema, error codes

### 4. GraphQL API (alternative to REST/JSON-RPC)
**⚠️ ONLY if PRD specifies GraphQL**

Document schema, queries, mutations, subscriptions.

### 5. Real-time Communication (if applicable)

#### 5.1 Communication Pattern Selection ⚠️ OBSERVE FIRST

**Before choosing protocol, observe PRD requirements:**

| Observation | Pattern Indicator |
|-------------|-------------------|
| Client requests, server responds, done | → REST/GraphQL sufficient |
| Server needs to push updates to client | → SSE or WebSocket |
| Client and server both send messages anytime | → WebSocket |
| Long-running tasks with progress updates | → SSE or WebSocket + Job Queue |
| Multiple clients need synchronized state | → WebSocket + Pub/Sub backend |

**Constraint**: Do NOT add real-time protocol if REST polling is sufficient. Do NOT default to WebSocket when SSE (simpler) meets requirements.

#### 5.2 Protocol Selection Principles

| Protocol | When to Use | Connection Model |
|----------|-------------|------------------|
| **REST/GraphQL** | Request-response only, no server push | Stateless |
| **SSE** | Server→Client push only, no client messages | Stateful (simpler) |
| **WebSocket** | Bidirectional, low-latency, high-frequency | Stateful (complex) |
| **Long Polling** | Fallback when SSE/WS not available | Stateless (inefficient) |

#### 5.3 Scalability Consideration ⚠️ CRITICAL

**If stateful protocol (SSE/WebSocket) is chosen:**

| Checkpoint | Must Address |
|------------|--------------|
| **Single instance** | Connection state in memory is acceptable |
| **Multiple instances** | Connection state MUST be externalized (Redis Pub/Sub, etc.) |
| **Sticky sessions** | Load balancer affinity OR broadcast to all instances |

**Constraint**: If horizontal scaling is expected, stateful connection handling strategy MUST be documented in backend design.

#### 5.4 Event Schema Documentation

**If real-time protocol is needed, document for EACH event:**
- **Direction**: Client→Server or Server→Client
- **Event name**: exact string
- **Payload DTO**: reference §6 (or inline field list)
- **Ack/Response** (if any): DTO + error shapes
- **Delivery guarantee**: at-most-once, at-least-once, exactly-once

**❌ DO NOT create this section if:**
- PRD doesn't indicate server push or bidirectional communication
- Standard REST polling meets data freshness requirements

### 6. Shared Type Definitions
**Define common DTOs ONCE (language-neutral):**
- Use headings + bullet lists (NOT TypeScript/JSON syntax)
- For each DTO: **Name / Fields / Validation / Notes**
- Field format: `fieldName: type` + optional marker + validation

Example (language-neutral):
- **DTO**: User
  - **Fields**:
    - `id: string` - identifier
    - `email: string` - email format
    - `name: string` - display name
    - `createdAt: string` - ISO 8601 timestamp
- **DTO**: ErrorResponse
  - **Fields**:
    - `error.code: string` - stable machine-readable code
    - `error.message: string` - human-readable message

### 7. Error Handling Conventions

**For REST**:
- Standard error format
- HTTP status code mapping (400/401/403/404/500)
- Error code naming (e.g., `AUTH_*`, `VALIDATION_*`)

**For JSON-RPC**:
- Standard error codes: -32700 (Parse error), -32600 (Invalid Request), -32601 (Method not found), -32602 (Invalid params), -32603 (Internal error)
- Application error codes: -32000 to -32099 (custom)

---

## ⚠️ CRITICAL RULES

**Precision (Binding)**:
- This document may include exact URL paths, status codes, and field names; they are part of the contract.
- Do not write “TBD”, “etc.”, “…”, or leave any shape implicit.

**Naming Consistency**:
- Pick ONE: camelCase OR snake_case
- NEVER mix!

**Completeness**:
- ✅ All endpoints documented
- ✅ All fields typed
- ✅ All errors with status codes
- ✅ No "TODO", "etc.", "..." placeholders

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

## ✅ Example

### POST /api/rooms/create
- **Purpose**: Creates a room for a new session.
- **Auth**: Required (see §2)
- **Request Body DTO**: CreateRoomRequest
- **Success**: 201 + CreateRoomResponse
- **Errors**:
  - 400 + ErrorResponse (VALIDATION_*)
  - 401 + ErrorResponse (AUTH_UNAUTHORIZED)

---

**Purpose**: Pure interface specification that FE/BE implement independently.
