# API Contract: GoShort Link Shortener

## 1. Overview

**Project**: GoShort - URL Shortener Service
**Architecture**: MSA (2 services: api, redirect)
**Protocol**: REST over HTTP/JSON
**Monorepo**: Go workspace (`go.work`) with shared `pkg/` module

---

## 2. Authentication

**Scheme**: API Key via `X-API-Key` header
**Scope**: Required for `api` service endpoints only. `redirect` service public endpoints require no authentication.

| Header | Type | Required | Description |
|--------|------|----------|-------------|
| `X-API-Key` | string | Conditional | Required for all `/api/urls/*` endpoints |

---

## 3. Endpoints

### 3.1 api Service

#### 3.1.1 POST /api/urls

Create a new short URL.

**Request Body**:

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `original_url` | string | Yes | Valid URL, max 2048 chars |
| `custom_code` | string | No | 3-20 alphanumeric characters |

**Response** `201 Created`:

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Generated or custom short code |
| `original_url` | string | Original URL |
| `short_url` | string | Full shortened URL |
| `created_at` | string | ISO 8601 datetime |

#### 3.1.2 GET /api/urls

List URLs with pagination.

**Query Parameters**:

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `page` | integer | 1 | >= 1 |
| `limit` | integer | 20 | 1-100 |

**Response** `200 OK`:

| Field | Type | Description |
|-------|------|-------------|
| `items` | array | Array of URL objects |
| `items[].code` | string | Short code |
| `items[].original_url` | string | Original URL |
| `items[].short_url` | string | Full shortened URL |
| `items[].click_count` | integer | Total clicks |
| `items[].created_at` | string | ISO 8601 datetime |
| `total` | integer | Total URL count |
| `page` | integer | Current page |
| `limit` | integer | Items per page |

#### 3.1.3 GET /api/urls/:code

Get URL details by short code.

**Path Parameters**: `code` (string, required)

**Response** `200 OK`:

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Short code |
| `original_url` | string | Original URL |
| `short_url` | string | Full shortened URL |
| `click_count` | integer | Total clicks |
| `created_at` | string | ISO 8601 datetime |

#### 3.1.4 DELETE /api/urls/:code

Delete a short URL.

**Path Parameters**: `code` (string, required)

**Response** `204 No Content`: Empty body

---

### 3.2 redirect Service

#### 3.2.1 GET /:code

Redirect to original URL.

**Path Parameters**: `code` (string, required)

**Response** `302 Found`: Redirect with `Location` header set to original URL.

#### 3.2.2 GET /api/stats/:code

Get click statistics for a short URL.

**Path Parameters**: `code` (string, required)

**Response** `200 OK`:

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Short code |
| `click_count` | integer | Total click count |
| `last_accessed_at` | string | ISO 8601 datetime, nullable |

---

## 4. Data Models

### 4.1 URL

| Field | Type | Constraints |
|-------|------|-------------|
| `code` | string | PK, 3-20 chars, alphanumeric |
| `original_url` | string | Required, valid URL, max 2048 chars |
| `short_url` | string | Derived (read-only) |
| `click_count` | integer | Default 0 |
| `created_at` | datetime | Auto-generated, UTC |

---

## 5. Inter-Service Communication

### 5.1 Cache Synchronization (api → redirect)

**Pattern**: Shared Redis instance (write by api, read by redirect)

| Event | Operation | Key Pattern | Value |
|-------|-----------|-------------|-------|
| URL Created | `SET` | `url:{code}` | original_url string |
| URL Deleted | `DEL` | `url:{code}` | - |

The `api` service is the sole writer. The `redirect` service is a read-only consumer.

---

## 6. Error Format

**Standard Error Response**:

| Field | Type | Description |
|-------|------|-------------|
| `error.code` | string | Machine-readable error code |
| `error.message` | string | Human-readable description |

### Error Codes

| HTTP Status | Error Code | Description | Used By |
|-------------|------------|-------------|---------|
| 400 | `INVALID_URL` | URL format is invalid | api |
| 400 | `INVALID_CODE` | Custom code format is invalid | api |
| 401 | `UNAUTHORIZED` | Missing or invalid API key | api |
| 404 | `NOT_FOUND` | URL code does not exist | api, redirect |
| 409 | `CODE_CONFLICT` | Custom code already in use | api |
| 500 | `INTERNAL_ERROR` | Unexpected server error | api, redirect |

---

## 7. Infrastructure

### 7.1 Services

| Service | Port | Description |
|---------|------|-------------|
| api | 8080 | CRUD API server |
| redirect | 8081 | Redirect + stats server |

### 7.2 Dependencies

| Dependency | Version | Used By | Purpose |
|------------|---------|---------|---------|
| PostgreSQL | 16 | api | URL persistence |
| Redis | 7 | api (write), redirect (read) | URL cache + click counters |

### 7.3 Docker Compose Topology

All services and dependencies run in a single Docker Compose network.

| Container | Image | Ports |
|-----------|-------|-------|
| api | Built from `services/api/` | 8080 |
| redirect | Built from `services/redirect/` | 8081 |
| postgres | postgres:16-alpine | 5432 |
| redis | redis:7-alpine | 6379 |
