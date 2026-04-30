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
- Request/response schemas: reference shared DTOs by name; inline field list ONLY for shapes unique to a single endpoint and not reused anywhere
- Required: exact identifiers, field names, all types, response codes; no placeholders
- Documentation format naturally adapts to the observed protocol (endpoint-first, method-first, or schema-first)
- ⚠️ Blind spot: multiple protocols belong in ONE § API Endpoints chapter — use ### sub-headings per protocol, do NOT create separate ## chapters

### § Real-time Communication (conditional: if PRD indicates server push or bidirectional)
- Communication pattern selection: observe PRD requirements FIRST, do NOT add real-time if polling is sufficient
- Protocol selection: observe whether server push only or bidirectional is needed
- Scalability consideration: if stateful protocol chosen, connection state externalization strategy MUST be addressed
- Event schema: direction, event name, payload DTO (reference by name only), ack/response, delivery guarantee

### § Shared Type Definitions
- This section is the ONLY place where DTO field definitions appear — all other sections reference DTOs by name only
- Define common DTOs ONCE (language-neutral): headings + bullet lists, NOT code syntax
- For each DTO: name, fields (`<field>: <type>` + validation), notes
- Field identifier convention: see the "Field Identifier Convention" rule in api-contract-guide — do NOT default to a particular case style

### § Error Handling Conventions
- Standard error format (DTO shape for error responses)
- Response code / error code mapping (protocol-appropriate)
- Error code naming taxonomy
