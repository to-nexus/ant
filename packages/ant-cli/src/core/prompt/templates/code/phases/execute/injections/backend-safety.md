## Backend Safety Principles

### Input Safety

**Principle**: Every value that crosses a trust boundary (user input, external API response, URL parameter) must be validated before use.

**Observation target**: Does the code pass trust-boundary values directly to downstream operations without validation?

| Checkpoint | What to observe |
|-----------|----------------|
| **Route parameters** | Are URL path/query parameters validated (type, length, format) before being used in logic or persistence? |
| **Request body** | Is the request body validated against a schema or explicit field checks before processing? |
| **Outbound requests** | Does the code construct outbound URLs or file paths from user-controlled input? If so, is the target constrained to an allowlist or validated pattern? |

**Constraint**: Do NOT pass user-controlled values directly into URL construction, file path resolution, or system command arguments without validation.

⚠️ **Blind spot**: URL shortener-style services or redirect handlers commonly accept user-provided URLs. Without validation, these become open proxies.

---

### Store Atomicity

**Principle**: When a single logical operation involves multiple write statements to a store, those writes must either all succeed or all fail.

**Observation target**: Does the code perform multiple store writes for a single logical operation?

| Checkpoint | What to observe |
|-----------|----------------|
| **Multi-write operations** | Are multiple store mutations (insert + update, cache + persist) wrapped in the store's native atomic mechanism? |
| **Error between writes** | If the first write succeeds but the second fails, is the first write rolled back? |

**Constraint**: Use the store's native atomic mechanism (transaction, pipeline, multi-exec) for multi-write operations. Do NOT rely on application-level retry to achieve consistency.

---

### Error Classification

**Principle**: Error responses to clients must not leak internal implementation details.

| Checkpoint | What to observe |
|-----------|----------------|
| **Error messages** | Do error responses include stack traces, internal paths, or store error details? |
| **Status codes** | Are error status codes appropriate (client error vs server error distinction)? |

**Constraint**: Internal error details (stack traces, query text, connection strings) must be logged server-side, not returned to the client.

---

### Resource Lifetime

**Principle**: Resources acquired during request processing (connections, handles, temporary allocations) must be released when the request completes or fails.

| Checkpoint | What to observe |
|-----------|----------------|
| **Connection lifecycle** | Are store connections returned to the pool after use? |
| **Timeout propagation** | Do long-running operations respect request context/timeout? |
| **Graceful shutdown** | Does the server drain in-flight requests before closing connections? |

**Constraint**: Do NOT hold store connections across request boundaries. Acquire per-request, release on completion.
