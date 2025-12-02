## 📋 API CONTRACT DOCUMENT GUIDE

**Purpose**: BINDING SPECIFICATION - Single Source of Truth for FE/BE integration

**This document is:**
- ✅ The CONTRACT between Frontend and Backend
- ✅ Written BEFORE FE and BE design documents
- ✅ Must be PRECISE, COMPLETE, UNAMBIGUOUS

════════════════════════════════════════════════════════════════════════════════

### REQUIRED SECTIONS (prioritize based on project)

#### 1. Overview
- API purpose and scope (2-3 sentences)
- Base URL structure (e.g., `/api/v1`)
- Protocol details (REST/GraphQL/WebSocket)

#### 2. Authentication & Authorization
- Auth mechanism (JWT, OAuth2, API keys)
- Token format and headers (e.g., `Authorization: Bearer <token>`)
- Refresh token flow (if applicable)
- Permission levels/roles (if applicable)

#### 3. REST API Endpoints

**For EACH endpoint, specify:**

```markdown
### POST /api/auth/login
- **Description**: Authenticate user and issue access token
- **Request Headers**: `Content-Type: application/json`
- **Request Body**:
  ```typescript
  {
    email: string;      // Valid email format
    password: string;   // Min 8 chars
  }
  ```
- **Success Response** (200):
  ```typescript
  {
    accessToken: string;   // JWT, expires 1h
    refreshToken: string;  // JWT, expires 7d
    user: { id: string; email: string; name: string; }
  }
  ```
- **Error Responses**:
  - 400: Invalid email/password format
  - 401: Invalid credentials
  - 429: Too many attempts
```

**⚠️ CRITICAL for Endpoints:**
- EXACT field names (camelCase/snake_case consistency!)
- EXACT types (string, number, boolean, Date ISO string)
- Required vs optional fields (use `field?:` for optional)
- Validation rules (min/max length, format, enum values)
- All possible status codes

#### 4. WebSocket Events (if applicable)

**For EACH event:**

```markdown
### Event: room:joined (server → client)
- **Trigger**: User successfully joins a game room
- **Payload**:
  ```typescript
  {
    roomId: string;
    players: Array<{ id: string; name: string; ready: boolean; }>;
  }
  ```
```

#### 5. Shared Type Definitions

**Define ONCE, reference everywhere:**

```typescript
// User
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;  // ISO 8601
}

// Error Response (standard format)
interface ErrorResponse {
  error: {
    code: string;      // e.g., "INVALID_INPUT"
    message: string;   // Human-readable
    details?: any;     // Optional validation errors
  }
}
```

#### 6. Error Handling Conventions
- Standard error response format (use shared type)
- HTTP status code mapping
- Error code conventions (e.g., `AUTH_*`, `VALIDATION_*`)

════════════════════════════════════════════════════════════════════════════════

### WRITING RULES for API Contract

**DO:**
- ✅ Use TypeScript interface syntax (even if project uses JS)
- ✅ Be EXPLICIT: no "...other fields", no "etc."
- ✅ Include validation constraints inline (e.g., `// Min 8 chars`)
- ✅ Use consistent naming (camelCase or snake_case, pick ONE)

**DON'T:**
- ❌ NO implementation details (no "stored in database", no "hashed with bcrypt")
- ❌ NO handler code (only interface definitions)
- ❌ NO assumptions (if optional, mark with `?`)

