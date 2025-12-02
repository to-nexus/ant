## ⚙️ BACKEND DESIGN DOCUMENT GUIDE

**Purpose**: HOW BACKEND IMPLEMENTS api-contract.md

**⚠️ CRITICAL RULE: BACKEND MUST IMPLEMENT api-contract.md EXACTLY!**

**Your first section MUST verify API contract compliance:**

```markdown
## 1. Overview & API Contract Compliance
...

### API Contract Implementation Status
This backend implements the provider side of `api-contract.md`.

**Endpoint Implementation Checklist:**
- ✅ POST /api/auth/login - Implemented (see Section 3.1)
- ✅ GET /api/users/me - Implemented (see Section 3.2)
- ✅ POST /api/rooms/create - Implemented (see Section 3.3)

All request/response DTOs match api-contract.md field names and types.
```

════════════════════════════════════════════════════════════════════════════════

### REQUIRED SECTIONS

#### 1. Overview
- System purpose (technical description)
- High-level architecture (layers: controller/service/repository)
- Core responsibilities

#### 2. Architecture Layers
- **Controller Layer**: HTTP request handling, validation, serialization
- **Service Layer**: Business logic, orchestration, transactions
- **Repository Layer**: Data access, query building
- **Middleware**: Auth, error handling, logging

#### 3. API Endpoint Implementation ⚠️ MOST IMPORTANT

**Map to api-contract.md!**

**⚠️ CRITICAL: NO DTO DUPLICATION!**
- ❌ DO NOT copy-paste DTOs from api-contract.md
- ✅ ONLY mention: "See api-contract.md Section X"
- ✅ Focus on HOW to implement, not WHAT the interface is

**For EACH endpoint:**

```markdown
### 3.1 POST /api/auth/login
**Contract**: api-contract.md Section 3.1 (LoginRequest → LoginResponse)

**Implementation Flow:**
1. `AuthController.login(req)` validates request body
2. `AuthService.authenticate(email, password)` checks password hash
3. `AuthService.generateTokens(user)` creates JWT tokens
4. Controller returns response per contract

**Service Methods:**
- `AuthService.authenticate(email: string, password: string): Promise<User>`
  - Queries user by email
  - Verifies password with bcrypt.compare
  - Throws AuthenticationError if invalid
- `AuthService.generateTokens(user: User): { accessToken: string; refreshToken: string }`
  - Signs JWT with secret
  - Sets expiry per contract

**Error Handling:**
- ValidationError → 400 (per contract error format)
- AuthenticationError → 401 (per contract error format)
- RateLimitExceeded → 429 (per contract error format)
```

**KEY RULES:**
- ✅ Reference contract for DTOs: "LoginRequest → LoginResponse"
- ✅ Describe implementation: Service methods, error handling
- ✅ Database queries: "Queries user by email"
- ❌ NO DTO field list (that's in contract!)
- ❌ NO "Request: { email: string, ... }" (that's duplication!)

#### 4. Database Design
- Entity schemas (tables, collections)
- Relationships (1:1, 1:N, N:M with FK constraints)
- Indexes (for query optimization)

**Example:**
```sql
-- Users Table
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 5. Service Layer Design
- Service classes and responsibilities
- Business logic flows (algorithms, rules)
- Transaction boundaries
- External service integrations (if any)

#### 6. Authentication & Authorization
- JWT generation/validation
- Password hashing (bcrypt, argon2)
- Middleware implementation
- Session management (if using sessions)

#### 7. Technology Stack
- Framework (Express, Nest.js, Fastify) - per PRD
- Database (PostgreSQL, MongoDB, etc.) - per PRD
- ORM/Query Builder (Prisma, TypeORM, Sequelize)
- Key libraries (jsonwebtoken, bcrypt, validator)

════════════════════════════════════════════════════════════════════════════════

### WRITING RULES for Backend

**DO:**
- ✅ FIRST verify api-contract.md compliance (checklist!)
- ✅ Map EVERY endpoint to implementation details
- ✅ Show service method signatures (≤10 lines each)
- ✅ Database schemas: DDL or entity definitions (concise!)

**DON'T:**
- ❌ NO full implementations (only signatures and flow descriptions)
- ❌ NO API deviations (if deviation needed, document WHY!)
- ❌ NO assumptions about contract (reference it explicitly!)

