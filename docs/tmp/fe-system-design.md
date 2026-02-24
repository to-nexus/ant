# Frontend System Design: GoShort Dashboard

## 1. Overview

**Application Name**: GoShort Dashboard
**Responsibility**: URL shortening management interface - create, browse, inspect, and remove shortened URLs with click statistics visualization
**API Contract Reference**: api-contract.md

### Endpoints Consumed (from api-contract.md)

- §3.1.1 POST /api/urls (create short URL)
- §3.1.2 GET /api/urls (list URLs with pagination)
- §3.1.3 GET /api/urls/:code (URL detail with click count)
- §3.1.4 DELETE /api/urls/:code (remove URL)
- §3.2.2 GET /api/stats/:code (click statistics from redirect service)

### API Contract Compliance

This application implements the **consumer side** of `api-contract.md` §3.1 and §3.2.2.
All request DTOs, response handling, and error code interpretation match the contract specification.
NO deviations from the contract are permitted.

**Contract Consumption Checklist**:
- All endpoints from §3.1 consumed for URL management
- §3.2.2 consumed for click statistics display
- Authentication per §2 applied to all requests
- Error codes from §6 mapped to user feedback

---

## 2. Architecture Pattern Selection

### 2.1 Internal Architecture Observation

| Checkpoint | Observation |
|-----------|-------------|
| **Domain complexity** | Minimal client-side domain logic. No business rules, calculations, or state invariants beyond simple data display. Data flows from API responses to views with trivial transformation. |
| **Integration breadth** | Two backend service endpoints (api and redirect). Both share the same authentication scheme and error response format. Integration surface is narrow. |
| **State coordination** | State is view-local. URL list, detail view, and creation form operate independently. No cross-view state synchronization or real-time updates required. |

### 2.2 Architecture Selection

**Selected Pattern**: Flat feature-based structure

Observed complexity is minimal (CRUD display with pagination and statistics). No client-side business rules or cross-view state coordination exist. Framework conventions provide sufficient boundary separation without explicit layered architecture.

**Boundary Responsibilities**:
- **View boundary**: User interaction capture, list and detail rendering, user feedback for loading and error states.
- **Application boundary**: API call orchestration, server state caching and revalidation, mutation coordination.
- **Infrastructure boundary**: HTTP client adapter, authentication header injection (api-contract.md §2), error response normalization (api-contract.md §6).

### 2.3 Directory Structure

```
src/
├── features/
│   ├── urls/
│   └── stats/
├── shared/
│   ├── api/
│   └── ui/
└── app/
```

Feature boundaries correspond to API resource groups. Shared infrastructure provides cross-cutting HTTP and UI concerns.

---

## 3. Boundary Responsibilities

### 3.1 View Boundary

Owns all user-facing interaction and display concerns:

- **URL list view**: Renders paginated URL collection from api-contract.md §3.1.2 response. Displays code, original URL, short URL, click count, and creation timestamp per item. Emits pagination commands (page, limit).
- **URL creation view**: Captures original URL and optional custom code inputs. Performs client-side format pre-validation before submission. Displays created URL on success per api-contract.md §3.1.1 response.
- **URL detail view**: Displays single URL record from api-contract.md §3.1.3 alongside click statistics from api-contract.md §3.2.2. Provides delete action trigger.
- **Error feedback**: Maps error codes from api-contract.md §6 to user-visible messages. Distinguishes field-level validation errors (4xx) from system errors (5xx).

### 3.2 Application Boundary

Owns server state management and API call coordination:

- **URL collection management**: Fetches paginated URL lists, caches results per page and limit combination, triggers cache invalidation after mutations (create, delete).
- **URL mutation orchestration**: Coordinates create and delete flows. On successful creation (201), invalidates list cache. On successful deletion (204), removes entry from local cache and invalidates list.
- **Statistics aggregation**: Fetches click statistics for a given code from the redirect service endpoint (api-contract.md §3.2.2), combines with URL detail data (api-contract.md §3.1.3) for unified display.

### 3.3 Infrastructure Boundary

Owns all external communication concerns:

- **HTTP client adapter**: Provides typed request/response handling for all api-contract.md endpoints. Maintains separate base URL configurations for the api service (port 8080) and redirect service (port 8081).
- **Authentication interceptor**: Injects `X-API-Key` header into all `/api/urls/*` requests per api-contract.md §2. API key sourced from application configuration.
- **Error normalizer**: Parses error responses per api-contract.md §6 format (`error.code`, `error.message`). Translates raw HTTP responses into application-level error types consumable by the view boundary.

### 3.4 Dependency Direction

View depends on Application for state and commands. Application depends on Infrastructure for API access. Infrastructure depends on no internal boundary. No reverse or circular dependencies permitted.

---

## 4. State Management & Data Flow

### 4.1 State Classification

| State Type | Owner | Scope | Description |
|-----------|-------|-------|-------------|
| **Server state** | Application boundary | Shared across views | URL list, URL detail, click statistics fetched from API |
| **UI state** | View boundary | View-local | Form input values, loading indicators, error display flags |
| **Navigation state** | Application boundary | Global | Current route and selected URL code for detail view |

### 4.2 Server State Policy

- **Caching**: URL list responses cached per page/limit combination. Individual URL detail responses cached by code.
- **Revalidation**: Cache invalidated on any mutation (create or delete). Stale data acceptable for read-only views between mutations.
- **Deduplication**: Concurrent identical requests to the same endpoint deduplicated at the infrastructure boundary.

### 4.3 Mutation Flows

**URL Creation** (api-contract.md §3.1.1):
1. View captures form input and emits create command to application boundary
2. Application sends POST request via infrastructure boundary
3. On 201 success: invalidate URL list cache, present created URL to user
4. On error (INVALID_URL, INVALID_CODE, CODE_CONFLICT per §6): surface error to view for field-level feedback

**URL Deletion** (api-contract.md §3.1.4):
1. View emits delete command with URL code to application boundary
2. Application sends DELETE request via infrastructure boundary
3. On 204 success: remove entry from local cache, invalidate list cache, navigate to list view
4. On error (NOT_FOUND per §6): surface error to view

### 4.4 Pagination State

- Page number and limit owned by the URL list view as UI state
- Page changes trigger fresh fetch through application boundary
- Total count from api-contract.md §3.1.2 response drives pagination control rendering
- Default values: page = 1, limit = 20 (matching contract defaults)

---

## 5. Inter-Service Consumption

### 5.1 Service Map

This frontend consumes endpoints from two separate backend services:

| Service | Port | Endpoints Consumed | Auth Required |
|---------|------|--------------------|---------------|
| api | 8080 | POST/GET/DELETE /api/urls/* | Yes (X-API-Key) |
| redirect | 8081 | GET /api/stats/:code | No |

### 5.2 Authentication Flow

All requests to api service `/api/urls/*` endpoints include `X-API-Key` header per api-contract.md §2. The infrastructure boundary injects this header automatically via request interceptor. Missing or invalid key results in 401 UNAUTHORIZED error surfaced as a global authentication prompt.

Redirect service endpoints (`/api/stats/:code`) require no authentication per api-contract.md §3.2.

### 5.3 Error Handling Policy

| Error Code | HTTP Status | Originating Service | User Feedback Strategy |
|-----------|-------------|--------------------|-----------------------|
| INVALID_URL | 400 | api | Field-level validation message on URL input |
| INVALID_CODE | 400 | api | Field-level validation message on custom code input |
| UNAUTHORIZED | 401 | api | Global authentication error prompt |
| NOT_FOUND | 404 | api, redirect | Contextual "not found" message in current view |
| CODE_CONFLICT | 409 | api | Field-level conflict message on custom code input |
| INTERNAL_ERROR | 500 | api, redirect | Generic error message with retry option |

All error responses follow the standard format defined in api-contract.md §6: `{ error: { code, message } }`. The infrastructure boundary normalizes these into typed error objects before propagation to view boundary.
