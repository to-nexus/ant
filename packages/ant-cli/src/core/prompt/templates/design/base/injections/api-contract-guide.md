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
**For EACH endpoint**:

```markdown
### POST /api/auth/login
**Request Body**: `{ email: string, password: string }`
**Success (200)**: `{ accessToken: string, user: User }`
**Errors**: 
- 400: Invalid input
- 401: Invalid credentials
```

**Required**: Exact path, method, field names, all types, status codes

#### Option B: JSON-RPC (for blockchain/RPC projects)
**Single endpoint** (e.g., `/rpc` or `/api`), method-based calls:

```markdown
### Method: `eth_getBalance`
**Request**: 
```json
{ "jsonrpc": "2.0", "method": "eth_getBalance", "params": ["0x407d73...", "latest"], "id": 1 }
```
**Success**: 
```json
{ "jsonrpc": "2.0", "result": "0x0234c8a3397aab58", "id": 1 }
```
**Error**: 
```json
{ "jsonrpc": "2.0", "error": { "code": -32602, "message": "Invalid params" }, "id": 1 }
```

### Method: `user.login`
**Params**: `{ email: string, password: string }`
**Result**: `{ accessToken: string, user: User }`
**Error codes**: -32600 (Invalid Request), -32601 (Method not found), -32602 (Invalid params)
```

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
```markdown
### WebSocket Events (or SSE, etc.)

#### Client → Server: `room:join`
**Payload**: `{ roomId: string }`
**Ack**: `{ success: boolean }`

#### Server → Client: `room:updated`
**Payload**: `{ roomId: string, players: Player[] }`
```

### 6. Shared Type Definitions
**Define common DTOs ONCE**:
```typescript
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string; // ISO 8601
}

interface ErrorResponse {
  error: { code: string; message: string; }
}
```

### 6. Error Handling Conventions

**For REST**:
- Standard error format
- HTTP status code mapping (400/401/403/404/500)
- Error code naming (e.g., `AUTH_*`, `VALIDATION_*`)

**For JSON-RPC**:
- Standard error codes: -32700 (Parse error), -32600 (Invalid Request), -32601 (Method not found), -32602 (Invalid params), -32603 (Internal error)
- Application error codes: -32000 to -32099 (custom)

---

## ⚠️ CRITICAL RULES

**DTO Standards**:
- Exact TypeScript types
- Inline validation (e.g., `// Min 8 chars`)
- Mark optional with `?`

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

```markdown
### POST /api/rooms/create
**Request**: `{ name: string (1-50 chars), maxPlayers: number (2-8) }`
**Response (201)**: `{ roomId: string, name: string, createdAt: string }`
**Errors**: 400 (validation), 401 (unauthorized)
```

---

**Purpose**: Pure interface specification that FE/BE implement independently.
