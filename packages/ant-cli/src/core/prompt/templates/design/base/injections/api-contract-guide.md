## 📋 API CONTRACT DOCUMENT GUIDE

**Document Type**: `api-contract.md`
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
**⚠️ ONLY if PRD explicitly requires real-time features (chat, live updates, multiplayer, etc.)**

**If PRD says "real-time", choose appropriate protocol:**
- WebSocket (bidirectional, low latency)
- SSE (Server-Sent Events, server → client only)
- Long polling (fallback)
- GraphQL Subscriptions (if using GraphQL)

**❌ DO NOT create this section if:**
- PRD doesn't mention real-time
- Standard REST polling is sufficient
- No bidirectional communication needed

**If needed, document event schemas:**
For EACH event:
- **Direction**: Client→Server or Server→Client
- **Event name**: exact string
- **Payload DTO**: reference §6 (or inline field list)
- **Ack/Response** (if any): DTO + error shapes

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
