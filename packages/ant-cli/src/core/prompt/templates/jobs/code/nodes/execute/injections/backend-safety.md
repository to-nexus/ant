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
| **Cleanup registration** | Is every opened connection/client paired with a deferred cleanup at the point of creation? |
| **Timeout propagation** | Do long-running operations respect request context/timeout? |
| **Graceful shutdown** | Does the server drain in-flight requests before closing connections? |

**Constraint**: Do NOT hold store connections across request boundaries. Acquire per-request, release on completion.

⚠️ **Blind spot**: Opened connections (store clients, database pools, file handles) that are NOT registered for deferred cleanup at creation time will leak on shutdown or panic. Observe whether every connection acquisition has a corresponding cleanup registration.

---

### Request Rate Control

**Principle**: Public-facing endpoints must limit the rate of incoming requests to prevent resource exhaustion and abuse.

**Observation target**: Can a single client send unlimited requests to any endpoint without throttling?

| Checkpoint | What to observe |
|-----------|----------------|
| **Unauthenticated endpoints** | Do endpoints that require no authentication (health, redirect, public reads) have any rate constraint? These are the easiest abuse targets. |
| **Authenticated endpoints** | Do authenticated endpoints enforce per-key or per-client rate boundaries? Authentication alone does not prevent a valid client from exhausting resources. |
| **Write operations** | Are create/update/delete endpoints rate-constrained independently of read endpoints? Write operations are typically more expensive. |

**Constraint**: Do NOT deploy an API server that accepts unlimited requests per client. Apply rate control as middleware at the router level — not inside individual handlers.

⚠️ **Blind spot**: Developers often assume authentication is sufficient protection. A compromised or malicious API key can still exhaust database connections, fill storage, or inflate costs without rate control.

---

### Response Hardening

**Principle**: HTTP responses must include security-relevant headers that instruct clients to apply protective behaviors.

**Observation target**: Does the server set security headers on every response?

| Checkpoint | What to observe |
|-----------|----------------|
| **Content-type enforcement** | Does the server prevent clients from guessing response content types? (MIME sniffing protection) |
| **Framing protection** | Does the server prevent its responses from being embedded in frames on other origins? |
| **Transport security** | For production deployments, does the server instruct clients to use encrypted connections only? |

**Constraint**: Security headers MUST be applied as middleware at the router level so they cover ALL responses — including error responses. Do NOT set headers inside individual handlers.

⚠️ **Blind spot — Error responses**: Error responses (4xx, 5xx) are commonly returned without security headers because they bypass normal handler logic. Router-level middleware ensures headers are present on every response path.

⚠️ **Blind spot — Scope**: Response Hardening applies to the custom backend server you build. Apply the security headers at the server's router-level middleware so every response path is covered.
