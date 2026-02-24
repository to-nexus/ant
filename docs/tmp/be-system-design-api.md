# Backend System Design: api Service

## 1. Overview

**Service Name**: api
**Responsibility**: URL shortening CRUD operations - create, read, list, and delete shortened URLs with persistent storage and cache synchronization
**API Contract Reference**: api-contract.md

### Endpoints Implemented (from api-contract.md)

- §3.1.1 POST /api/urls
- §3.1.2 GET /api/urls
- §3.1.3 GET /api/urls/:code
- §3.1.4 DELETE /api/urls/:code

### Data Ownership

- `urls` table (PostgreSQL)
- Redis key space `url:{code}` (write-only; read ownership belongs to redirect service)

### API Contract Compliance

This service implements the **provider side** of `api-contract.md` §3.1 EXACTLY.
All endpoints, DTOs, and status codes match the contract specification.
NO deviations from the contract are permitted.

**Contract Implementation Checklist**:
- All endpoints from §3.1 implemented
- All request/response DTOs validated per contract
- All error codes from §6 implemented
- Authentication per §2 implemented

---

## 2. Architecture Pattern Selection

### 2.1 Internal Architecture Observation

| Checkpoint | Observation |
|-----------|-------------|
| **Domain complexity** | Thin domain logic. URL validation, code generation, basic CRUD. No complex business invariants or policies. |
| **Integration boundary count** | Two external dependencies: PostgreSQL (persistence) and Redis (cache sync). Both are straightforward adapters. |
| **Dependency direction concern** | Low. Core logic does not need to be tested independent of framework. Straightforward data flow from HTTP to DB. |

### 2.2 Architecture Selection

**Selected Pattern**: Framework-conventional layered architecture

Observed complexity is low (CRUD with simple validation). Domain logic is thin and does not warrant explicit domain boundary separation. Conventional three-layer architecture provides sufficient separation without unnecessary indirection.

**Boundary Responsibilities**:
- **Handler layer**: HTTP concern boundary. Request binding, input validation against contract DTOs, response formatting, error code translation.
- **Service layer**: Business logic boundary. Orchestrates URL creation flow (code generation, uniqueness check, persist, cache sync). Owns transactional boundaries.
- **Repository layer**: Persistence boundary. PostgreSQL data access. Converts between domain models and database records.

### 2.3 Directory Structure

Each architecture boundary corresponds to a package-level boundary:

```
services/api/
├── cmd/
│   └── main.go
├── internal/
│   ├── handler/
│   ├── service/
│   ├── repository/
│   └── config/
└── go.mod
```

Shared domain models live in the monorepo's `pkg/model/` module, imported via `go.work`.

---

## 3. Database Design

### urls Table

| Column | Type | Constraints |
|--------|------|-------------|
| `code` | VARCHAR(20) | PK |
| `original_url` | VARCHAR(2048) | NOT NULL |
| `click_count` | INTEGER | NOT NULL, DEFAULT 0 |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**Indexes**:
- `code` (PK, unique) - primary lookup key for all operations
- `created_at DESC` - pagination ordering for list endpoint

**Relationships**: None. Single table, single service ownership. Click count is denormalized here for list/detail responses; authoritative real-time count lives in Redis (redirect service).

---

## 4. Endpoint Implementation Mapping

### POST /api/urls

**Contract**: CreateURLRequest → CreateURLResponse (api-contract.md §3.1.1)

**Mapping**:
- Handler: binds request body, validates `original_url` format and optional `custom_code` format per contract constraints, translates errors to contract ErrorResponse
- Service: generates unique short code (or validates custom code), checks code uniqueness against repository, persists URL record, writes cache entry to Redis
- Repository: inserts row into `urls` table

**Error Mapping**:
- URL format validation failure → 400 INVALID_URL
- Custom code format validation failure → 400 INVALID_CODE
- Code uniqueness violation → 409 CODE_CONFLICT

### GET /api/urls

**Contract**: → URLListResponse (api-contract.md §3.1.2)

**Mapping**:
- Handler: extracts `page` and `limit` query parameters, validates bounds (page >= 1, limit 1-100)
- Service: delegates paginated query to repository, assembles list response with total count
- Repository: offset-based pagination query on `urls` table ordered by `created_at DESC`

### GET /api/urls/:code

**Contract**: → URLDetailResponse (api-contract.md §3.1.3)

**Mapping**:
- Handler: extracts `code` path parameter
- Service: fetches URL record by code from repository
- Repository: single row lookup by PK

**Error Mapping**:
- Code not found → 404 NOT_FOUND

### DELETE /api/urls/:code

**Contract**: → 204 No Content (api-contract.md §3.1.4)

**Mapping**:
- Handler: extracts `code` path parameter
- Service: deletes URL from repository, removes `url:{code}` key from Redis
- Repository: deletes row by PK

**Error Mapping**:
- Code not found → 404 NOT_FOUND

---

## 5. Authentication & Authorization

**Auth boundary**: HTTP middleware applied to all `/api/*` routes

**Mechanism**: API key validation via `X-API-Key` header (api-contract.md §2). Middleware extracts header value and validates against configured key(s).

**Auth context propagation**: No user identity context needed. This is a single-tenant API key model. Valid key grants full access; invalid or missing key results in 401 UNAUTHORIZED.

**Authorization**: No role-based access control. All authenticated requests have equal access to all CRUD operations.

---

## 6. Business Logic Placement

### URLService

- `CreateURL(originalURL, customCode?) → URL` - Validates URL format, generates or validates short code, ensures uniqueness, persists to repository, syncs to Redis cache
- `GetURL(code) → URL` - Fetches single URL record by code
- `ListURLs(page, limit) → ([]URL, total)` - Retrieves paginated URL list with total count
- `DeleteURL(code)` - Removes URL from repository and invalidates Redis cache entry

### CodeGenerator

- `Generate() → string` - Produces unique short code
- `Validate(code) → error` - Checks custom code against format constraints (length, character set)

---

## 7. Data Storage Architecture

### 7.1 Storage Pattern Observation

| Checkpoint | Observation |
|-----------|-------------|
| **Schema structure** | Fixed fields (code, URL, timestamps). Well-defined, stable schema. |
| **Query patterns** | PK lookups (GET, DELETE) + paginated listing (LIST). No complex joins or aggregations. |
| **Consistency needs** | ACID required for URL creation (code uniqueness must be guaranteed). |
| **Scale pattern** | Write-light (URL creation is infrequent). Read-moderate (listing and detail lookups). |

### 7.2 Storage Selection

**Primary Store**: PostgreSQL
- Persistent URL storage with ACID guarantees
- Code uniqueness enforced at database level via PK constraint
- Pagination via standard offset queries

**Cache Layer**: Redis (write-through from this service)
- On URL creation: `SET url:{code} {original_url}`
- On URL deletion: `DEL url:{code}`
- This service writes only. Read ownership belongs to redirect service.

### 7.3 Cache Sync Policy

Cache writes are best-effort. If Redis write fails during URL creation, the URL is still persisted in PostgreSQL. The redirect service will return 404 for that code until cache is repopulated (acceptable trade-off for simplicity).

---

## 8. Technology Stack

**Language & Runtime**: Go 1.22+
**Framework**: Gin (HTTP web framework with middleware support)
**Database**: PostgreSQL 16
**Cache**: Redis 7 (write-only from this service)
**Containerization**: Docker + Docker Compose

**Key Libraries**:
- `github.com/gin-gonic/gin` - HTTP routing and middleware
- `github.com/jackc/pgx/v5` - PostgreSQL driver with connection pooling
- `github.com/redis/go-redis/v9` - Redis client
- `github.com/caarlos0/env/v11` - Environment-based configuration
