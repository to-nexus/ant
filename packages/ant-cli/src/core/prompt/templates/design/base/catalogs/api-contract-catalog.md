### § Overview
- API purpose and scope
- Base URL
- Communication protocol(s) used (observe from PRD)

### § Authentication & Authorization (conditional: if PRD requires auth)
- Auth mechanism, token format, headers
- Refresh flow (if applicable), roles/permissions (if applicable)

### § API Endpoints
- Observe which communication protocol the PRD specifies; use ONE protocol consistently
- For EACH endpoint/method/operation, specify (binding; exact values): identifier, purpose, auth requirement, request schema, success response(s), error responses
- Request/response schemas: reference shared DTOs by name when reusable; inline minimal field list for endpoint-specific shapes
- Required: exact identifiers, field names, all types, response codes; no placeholders
- Documentation format naturally adapts to the observed protocol (endpoint-first, method-first, or schema-first)

### § Real-time Communication (conditional: if PRD indicates server push or bidirectional)
- Communication pattern selection: observe PRD requirements FIRST, do NOT add real-time if polling is sufficient
- Protocol selection: observe whether server push only or bidirectional is needed
- Scalability consideration: if stateful protocol chosen, connection state externalization strategy MUST be addressed
- Event schema: direction, event name, payload DTO (reference by name), ack/response, delivery guarantee

### § Shared Type Definitions
- Define common DTOs ONCE (language-neutral): headings + bullet lists, NOT code syntax
- For each DTO: name, fields (fieldName: type + validation), notes
- This section is the single source of truth for reusable data shapes referenced elsewhere

### § Error Handling Conventions
- Standard error format (DTO shape for error responses)
- Response code / error code mapping (protocol-appropriate)
- Error code naming taxonomy
