## ⚙️ BACKEND DESIGN DOCUMENT GUIDE

**Document Type**: `be-system-design.md`
**Role**: HOW Backend IMPLEMENTS api-contract.md
**Phase**: Written AFTER api-contract.md is finalized

### 🎯 What This Document IS

**Backend Implementation Architecture:**
- ✅ HOW to implement endpoints (controllers, services, business logic)
- ✅ Architecture layers (Controller → Service → Repository pattern, etc.)
- ✅ Database design (schema, relationships, indexes)
- ✅ Business logic placement (validation, authorization, calculations)
- ✅ Integration patterns (external APIs, message queues, caching)

**Characteristics:**
- PROVIDER perspective: How to implement APIs, not define them
- REFERENCE contract: "Implements LoginRequest → LoginResponse per api-contract.md §3.1"
- ARCHITECTURE focus: Layer boundaries, data flow, patterns

### 🚫 What This Document is NOT

- ❌ NO API definitions (already in api-contract.md)
- ❌ NO DTO redefinition (reference contract only!)
- ❌ NO full method implementations (only signatures + purpose)
- ❌ NO detailed SQL queries (only schema + relationships)

---

## 📐 REQUIRED SECTIONS

### 1. Overview & API Contract Compliance (mandatory)

**MUST acknowledge api-contract.md:**
```markdown
## 1. Overview

### System Purpose
[Backend capabilities and business domain]

### Architecture Pattern
[Layered, Hexagonal, Clean Architecture, etc.]

### API Contract Compliance
This backend implements the **provider side** of `api-contract.md` EXACTLY.
All endpoints, DTOs, and status codes match the contract specification.
NO deviations from the contract are permitted.

**Contract Implementation Checklist**:
- ✅ All endpoints from §3 implemented
- ✅ All request/response DTOs validated per contract
- ✅ All error codes from §6 implemented
- ✅ Authentication per §2 implemented
```

### 2. Architecture Layers

**Layer Definition:**
```markdown
### Layered Architecture (example)

**Controller Layer**:
- Handles HTTP requests/responses
- Input validation (matches contract DTOs)
- Delegates to Service layer
- Returns contract-compliant responses

**Service Layer**:
- Business logic implementation
- Authorization checks
- Transaction management
- Delegates to Repository layer

**Repository Layer**:
- Database access abstraction
- Query building
- Data mapping (DB entities ↔ Domain models)

**Data Flow**: Request → Controller validates → Service processes → Repository persists → Response
```

**Focus**: Clear boundaries and responsibilities per layer

### 3. Database Design

**Schema Design:**
```markdown
### Users Table
- `id`: UUID (PK)
- `email`: VARCHAR(255), unique, indexed
- `password_hash`: VARCHAR(255)
- `name`: VARCHAR(100)
- `role`: ENUM('user', 'admin')
- `created_at`: TIMESTAMP

**Relationships**:
- users (1) → (N) sessions
- users (1) → (N) posts

**Indexes**:
- email (unique)
- created_at (for pagination queries)
```

**Focus**: Table structure, relationships, and key indexes (NOT SQL DDL)

### 4. Endpoint Implementation Mapping ⚠️ MOST CRITICAL

**🚨 CRITICAL RULES:**
1. **NEVER redefine DTOs** - Reference api-contract.md only
2. **Reference contract explicitly**: "Implements LoginRequest → LoginResponse (api-contract.md §3.1)"
3. **Focus on HOW to implement**, not WHAT the interface is

**For EACH endpoint, specify:**

```markdown
### Authentication Endpoints

#### POST /api/auth/login
**Contract**: LoginRequest → LoginResponse (api-contract.md §3.1)

**Implementation Flow**:
1. Controller receives LoginRequest, validates DTO
2. AuthService.authenticate(email, password):
   - Query user by email from Repository
   - Verify password hash using bcrypt
   - If invalid: throw INVALID_CREDENTIALS error
3. AuthService.generateTokens(userId):
   - Sign JWT with 1h expiration (accessToken)
   - Sign JWT with 7d expiration (refreshToken)
4. Return LoginResponse with tokens and user data

**Error Handling**:
- 400: ValidationError if DTO validation fails
- 401: INVALID_CREDENTIALS if authentication fails
- 429: RATE_LIMIT if too many attempts (use Redis counter, 5/min)

**Business Rules**:
- Password must be hashed with bcrypt (cost factor 12)
- Failed attempts increment Redis counter with 1min TTL
- Successful login clears attempt counter

**Authorization**: Public endpoint (no auth required)

---

#### GET /api/users/profile
**Contract**: Returns User (api-contract.md §4.1)

**Implementation Flow**:
1. Controller extracts userId from JWT token
2. UserService.getProfile(userId):
   - Query user by id from Repository
   - If not found: throw NOT_FOUND error
3. Map DB entity to User DTO per contract
4. Return User response

**Error Handling**:
- 401: UNAUTHORIZED if token missing/invalid
- 404: NOT_FOUND if user doesn't exist

**Authorization**: Requires valid JWT token
```

**Focus**: Implementation strategy, business rules, error mapping

### 5. Authentication & Authorization Implementation

**Authentication Strategy:**
```markdown
### JWT Token Strategy
- Signing algorithm: HS256
- Secret: From environment variable
- Token payload: { userId, role, iat, exp }

### Token Validation Middleware
- Extract token from Authorization header
- Verify signature and expiration
- Attach userId to request context
- Reject invalid/expired tokens with 401

### Refresh Token Flow
- Store refresh tokens in database with expiry
- On refresh: Validate refresh token → Issue new access token
- Revoke refresh tokens on logout
```

**Authorization Strategy:**
```markdown
### Role-Based Access Control (RBAC)
- Roles: 'user', 'admin'
- Middleware checks user.role against required role
- Admin endpoints require role: 'admin'
```

### 6. Business Logic Placement

**Service Layer Responsibilities:**
```markdown
### AuthService
- `authenticate(email, password): User` - Validates credentials
- `generateTokens(userId): { accessToken, refreshToken }` - Creates JWT tokens
- `refreshAccessToken(refreshToken): { accessToken }` - Issues new token

### UserService  
- `getProfile(userId): User` - Fetches user data
- `updateProfile(userId, updates): User` - Updates user with validation
```

**Focus**: Service method signatures and responsibilities (NOT full implementations)

### 7. External Integrations (if applicable)

- Third-party APIs (payment, email, etc.)
- Message queues (RabbitMQ, Kafka)
- Caching (Redis strategy)
- File storage (S3, local filesystem)

### 8. Technology Stack

**Framework & Version**: (per PRD, e.g., Express.js, NestJS, FastAPI, Spring Boot)
**Database**: (per PRD, e.g., PostgreSQL, MongoDB, MySQL)
**Key Libraries**:
- ORM/Query builder: Prisma, TypeORM, Sequelize, etc.
- Auth: JWT library, Passport, etc.
- Validation: class-validator, zod, joi, etc.

---

## ⚠️ CRITICAL RULES FOR BACKEND

### Rule 1: NO API Redefinition
**Backend NEVER redefines APIs, only implements them!**

**❌ WRONG**:
```markdown
### POST /api/auth/login
Request: { email, password }  ← This is API definition!
Response: { accessToken, user }
```

**✅ CORRECT**:
```markdown
### POST /api/auth/login
**Contract**: LoginRequest → LoginResponse (api-contract.md §3.1)
**Implementation**: AuthService validates credentials → JWT signing → Response mapping
```

### Rule 2: NO DTO Duplication

**❌ WRONG**:
```typescript
interface LoginRequest {  ← Duplicating contract!
  email: string;
  password: string;
}
```

**✅ CORRECT**:
```typescript
import { LoginRequest, LoginResponse } from 'api-contract-types';
// Or simply: "Validates LoginRequest per api-contract.md"
```

### Rule 3: Reference Contract Explicitly

**Every endpoint implementation must reference contract:**
```markdown
- POST /api/auth/login implements LoginRequest → LoginResponse (api-contract.md §3.1)
- GET /api/users/profile returns User (api-contract.md §4.1)
```

### Rule 4: Implementation Details ARE Allowed Here

**Unlike Frontend, Backend CAN include:**
- ✅ Database queries (high-level, not full SQL)
- ✅ Hashing algorithms (bcrypt, argon2)
- ✅ Business rule calculations (within reason)
- ✅ Validation logic (matching contract constraints)

**But NOT:**
- ❌ Full method bodies with all code
- ❌ Detailed SQL DDL statements
- ❌ Framework-specific boilerplate

---

## ✅ GOOD vs BAD Examples

**✅ GOOD (Backend HOW)**:
```markdown
## 4. Endpoint Implementation

### POST /api/auth/login
**Contract**: LoginRequest → LoginResponse (api-contract.md §3.1)

**Implementation**:
1. Validate DTO (email format, password min length)
2. Query users table by email
3. Compare password with bcrypt.compare()
4. Generate JWT tokens (access: 1h, refresh: 7d)
5. Return LoginResponse with tokens + user

**Error Mapping**:
- Email not found → 401 INVALID_CREDENTIALS
- Password mismatch → 401 INVALID_CREDENTIALS
- Rate limited → 429 RATE_LIMIT
```

**❌ BAD (API definition or full code)**:
```markdown
## 4. API Endpoints

### POST /api/auth/login  ← This is API definition, not Backend!
Request: { email, password }
Response: { accessToken, user }

async function login(req, res) {  ← This is full implementation code!
  const user = await User.findOne({ email: req.body.email });
  if (!user) return res.status(401).json({ error: 'Invalid' });
  // ... 20 more lines of code
}
```

---

## 🎮 Game-Specific Constraint

**If this is a game backend:**

**ALLOWED in Backend Design**:
- ✅ Game state management (server-authoritative game loop)
- ✅ Game logic (collision detection, score calculation, win conditions)
- ✅ State synchronization (broadcast strategy, tick rate)
- ✅ Matchmaking logic (room creation, player matching)

**FORBIDDEN**:
- ❌ Detailed physics formulas (high-level only: "detect collision → adjust position")
- ❌ Full state machine implementations (describe states, not every transition)

**Example:**
```markdown
### Game Room Management
- RoomService.createRoom(config): Creates room, initializes game state
- GameEngine.update(roomId, inputs): Applies inputs, updates state, detects collisions
- BroadcastService.syncState(roomId, state): Emits state to all clients via WebSocket

### Game Loop (Server-Authoritative)
- 60 tick/sec fixed update rate
- Accumulate player inputs per tick
- GameEngine processes inputs → new state
- Broadcast state to clients
```

---

**Purpose**: This guide ensures be-system-design.md focuses on HOW to build the backend architecture that implements the API contract, without duplicating interface definitions.
