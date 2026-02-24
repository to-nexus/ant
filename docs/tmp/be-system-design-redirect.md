# Backend System Design: redirect Service

## 1. Overview

**Service Name**: redirect
**Responsibility**: Resolve short codes to original URLs via HTTP redirect and track click statistics
**API Contract Reference**: api-contract.md

### Endpoints Implemented (from api-contract.md)

- §3.2.1 GET /:code (redirect)
- §3.2.2 GET /api/stats/:code (click statistics)

### Data Ownership

- Redis key space `url:{code}` (read-only; write ownership belongs to api service)
- Redis key space `clicks:{code}` (read/write; click counter)
- Redis key space `last_accessed:{code}` (read/write; last access timestamp)

### API Contract Compliance

This service implements the **provider side** of `api-contract.md` §3.2 EXACTLY.
All endpoints, response formats, and status codes match the contract specification.
NO deviations from the contract are permitted.

**Contract Implementation Checklist**:
- All endpoints from §3.2 implemented
- All response DTOs validated per contract
- All error codes from §6 implemented

---

## 2. Architecture Pattern Selection

### 2.1 Internal Architecture Observation

| Checkpoint | Observation |
|-----------|-------------|
| **Domain complexity** | Minimal. URL lookup and HTTP redirect. Click counting via atomic increment. No business rules or invariants. |
| **Integration boundary count** | One external dependency: Redis. No database, no external APIs. |
| **Dependency direction concern** | None. Simple pass-through data flow. No need for ports/adapters or dependency inversion. |

### 2.2 Architecture Selection

**Selected Pattern**: Minimal layered architecture (two layers)

This service has near-zero domain complexity. Its sole purpose is key lookup and redirect. Two layers provide sufficient separation without unnecessary abstractions.

**Boundary Responsibilities**:
- **Handler layer**: HTTP concern boundary. Route matching, path parameter extraction, redirect response (302), JSON response formatting for stats endpoint, error code translation.
- **Service layer**: Logic boundary. Redis key lookup, click counter increment, last-access timestamp update, cache miss handling.

### 2.3 Directory Structure

```
services/redirect/
├── cmd/
│   └── main.go
├── internal/
│   ├── handler/
│   ├── service/
│   └── config/
└── go.mod
```

No repository layer needed. Service layer interacts with Redis directly since there is no persistence abstraction required (Redis IS the data source for this service).

Shared domain models imported from `pkg/model/` via `go.work`.

---

## 3. Endpoint Implementation Mapping

### GET /:code

**Contract**: → 302 Found with Location header (api-contract.md §3.2.1)

**Mapping**:
- Handler: extracts `code` path parameter, returns 302 response with `Location` header set to resolved URL
- Service: reads `url:{code}` from Redis. If found, atomically increments `clicks:{code}` counter and updates `last_accessed:{code}` timestamp. Returns original URL.

**Error Mapping**:
- Key `url:{code}` not found in Redis → 404 NOT_FOUND

**Cache Miss Policy**: If `url:{code}` does not exist in Redis, return 404 immediately. No fallback to PostgreSQL. The api service is solely responsible for populating and invalidating Redis cache entries (api-contract.md §5.1).

### GET /api/stats/:code

**Contract**: → StatsResponse (api-contract.md §3.2.2)

**Mapping**:
- Handler: extracts `code` path parameter, returns JSON response with click statistics
- Service: reads `clicks:{code}` counter value and `last_accessed:{code}` timestamp from Redis. Returns zero count if counter key does not exist but URL key exists.

**Error Mapping**:
- Key `url:{code}` not found in Redis → 404 NOT_FOUND

---

## 4. Business Logic Placement

### RedirectService

- `Resolve(code) → originalURL` - Looks up URL from Redis, increments click counter, updates last access timestamp. Returns original URL for redirect.
- `GetStats(code) → Stats` - Reads click count and last access timestamp from Redis. Returns statistics for the given short code.

---

## 5. Data Storage Architecture

### 5.1 Storage Pattern Observation

| Checkpoint | Observation |
|-----------|-------------|
| **Schema structure** | Key-value pairs. Code maps to URL string, code maps to integer counter, code maps to timestamp. |
| **Query patterns** | Single key lookup only. No range queries, no joins, no aggregations. |
| **Consistency needs** | Eventual consistency acceptable. Click counts are best-effort metrics; minor inaccuracy is tolerable. |
| **Scale pattern** | Read-heavy. Every redirect request requires a key lookup. Low-latency requirement for redirect response. |

### 5.2 Storage Selection

**Primary and only store**: Redis

This service does not access PostgreSQL. All data comes from Redis:

| Key Pattern | Type | Purpose | Ownership |
|-------------|------|---------|-----------|
| `url:{code}` | STRING | Original URL for redirect | Read-only (written by api service) |
| `clicks:{code}` | STRING (integer) | Click counter via INCR | Read/write |
| `last_accessed:{code}` | STRING | ISO 8601 timestamp of last redirect | Read/write |

### 5.3 Data Lifecycle

- URL mappings (`url:{code}`): No TTL. Permanent until api service explicitly deletes them.
- Click counters (`clicks:{code}`): No TTL. Persist as long as URL mapping exists.
- Last access timestamps (`last_accessed:{code}`): No TTL. Updated on every redirect.

---

## 6. Caching Strategy

### 6.1 Cache Layer Observation

| Checkpoint | Observation |
|-----------|-------------|
| **Read frequency** | Every redirect request reads the same URL mapping. High read frequency per popular URL. |
| **Data freshness** | URL mappings are immutable once created. Always fresh until explicitly deleted. |
| **Invalidation triggers** | URL deletion by api service sends `DEL url:{code}` command. |
| **Scope** | Distributed. Redis instance shared between api and redirect services. |

### 6.2 Caching Principles

- URL mappings have no TTL. They are effectively permanent cache entries populated by api service on URL creation and removed on URL deletion.
- Click counters use Redis INCR for atomic, lock-free counting.
- Cache miss policy: return 404 immediately. No fallback or lazy-loading from PostgreSQL. This keeps the redirect service completely decoupled from PostgreSQL.

---

## 7. Technology Stack

**Language & Runtime**: Go 1.22+
**Framework**: Gin (HTTP web framework)
**Data Store**: Redis 7 (primary and only data source)
**Containerization**: Docker + Docker Compose

**Key Libraries**:
- `github.com/gin-gonic/gin` - HTTP routing
- `github.com/redis/go-redis/v9` - Redis client
- `github.com/caarlos0/env/v11` - Environment-based configuration
