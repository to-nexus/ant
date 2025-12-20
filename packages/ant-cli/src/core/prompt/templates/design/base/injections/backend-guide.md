## ⚙️ BACKEND DESIGN DOCUMENT GUIDE

**Document Type**: `be-system-design.md`
**Role**: HOW Backend IMPLEMENTS api-contract.md
**Phase**: Written AFTER api-contract.md is finalized

### 🎯 What This Document IS

**Backend Implementation Architecture:**
- ✅ HOW to implement endpoints at an architectural level (controllers, services, domain/application boundaries)
- ✅ Architecture layers (Controller → Service → Repository pattern, etc.)
- ✅ Database design (conceptual schema, relationships, key constraints)
- ✅ Business logic placement (validation, authorization, domain rules location)
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
- ❌ NO implementation literals unless PRD explicitly specifies them (token TTLs, exact retry counts, exact cache keys, exact route strings)

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
3. **Focus on architecture-level mapping**, not step-by-step algorithms or library calls

**For EACH endpoint group, specify (repeatable template):**
- **Contract reference**: exact endpoint/method from `api-contract.md` section
- **Controller responsibility**: request binding + DTO validation + auth context extraction + error translation
- **Application/Service responsibility**: orchestration of use case; transactional boundary (if any)
- **Domain responsibility** (if applicable): pure business rules / invariants
- **Persistence responsibility**: repositories/DAOs used and what they own
- **Error mapping policy**: how domain/application errors map to contract error codes/status codes
- **Idempotency / concurrency notes** (only if PRD requires or risk is obvious from contract)

### 5. Authentication & Authorization Implementation

**Only if PRD requires auth**:
- **Auth boundary**: where authentication is enforced (middleware/filter vs controller vs gateway)
- **Auth context propagation**: how user identity/roles become available to application layer
- **Token/session strategy**: name the approach at a high level; leave algorithms/TTL/claims to implementation unless PRD mandates them
- **Refresh/revocation policy**: describe responsibilities and persistence needs, not exact mechanics

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

**Backend may include implementation *boundaries* (what lives where), but should avoid implementation *recipes*:**
- ✅ Allowed: where validation/auth/domain rules/persistence live; transactions; error mapping; consistency model
- ❌ Forbidden (unless PRD mandates): concrete libraries/algorithms, numeric constants, retry/backoff math, TTLs, exact cache keys

---

## ✅ GOOD vs BAD Examples

**✅ GOOD (Backend HOW)**:
```markdown
## 4. Endpoint Implementation

### POST /api/auth/login
**Contract**: LoginRequest → LoginResponse (api-contract.md §3.1)

**Mapping**:
- Controller: binds LoginRequest, validates per contract, translates errors to contract ErrorResponse
- AuthService (application): orchestrates authentication use case; returns domain result or domain error
- UserRepository: reads user credential record; mapping boundary converts persistence record to domain model

**Error Mapping**:
- Email not found → 401 INVALID_CREDENTIALS
- Password mismatch → 401 INVALID_CREDENTIALS
- Rate limited → contract-defined error (only if PRD/contract specifies)
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

**Purpose**: This guide ensures be-system-design.md focuses on HOW to build the backend architecture that implements the API contract, without duplicating interface definitions.
