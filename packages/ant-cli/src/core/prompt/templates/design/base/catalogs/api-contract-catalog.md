### § Overview
- API purpose and scope
- Base URL
- Protocol(s): REST / JSON-RPC / GraphQL / Real-time

### § Authentication & Authorization (conditional: if PRD requires auth)
- Auth mechanism, token format, headers, refresh flow, roles/permissions

### § API Endpoints
- Per-endpoint specification: method + path, purpose, auth, request/response DTOs, error responses
- Protocol-specific format (REST, JSON-RPC, or GraphQL)

### § GraphQL API (conditional: alternative to REST/JSON-RPC, only if PRD specifies)
- Schema, queries, mutations, subscriptions

### § Real-time Communication (conditional: if PRD indicates server push or bidirectional)
- Communication pattern selection, protocol selection, scalability consideration, event schema

### § Shared Type Definitions
- Common DTOs defined once (language-neutral): name, fields, validation, notes

### § Error Handling Conventions
- Standard error format, status code mapping, error code naming
