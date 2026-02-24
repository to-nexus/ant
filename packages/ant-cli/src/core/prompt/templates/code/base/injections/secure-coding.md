────────────────────────────────────────────────────────────────────────────────
### Secure Coding Observation Protocol
────────────────────────────────────────────────────────────────────────────────

**Principle**: All data originating outside the application boundary is untrusted. Validate and sanitize before passing to queries, file-system operations, shell commands, or rendered output.

**Observation target**: Does the code handle each security-sensitive surface safely?

| Checkpoint | What to observe |
|-----------|----------------|
| **Secret comparison** | Are authentication tokens, API keys, or passwords compared using a constant-time comparison function? A plain `==` or `!=` on secrets is a timing-attack vulnerability. |
| **Query construction** | Are data-store queries built exclusively with parameterized mechanisms? Any string concatenation or interpolation of external input into a query is a vulnerability. |
| **Secret storage** | Are credentials loaded from environment variables or a secret store? Any secret literal in source code or committed config is a vulnerability. |
| **Error exposure** | Do client-facing error responses omit internal details (stack traces, file paths, schema names, connection strings)? |
| **Cryptographic safety** | Do security operations (token generation, session IDs, password hashing) use crypto-grade functions? Non-cryptographic randomness for security purposes is a vulnerability. |
| **Path traversal** | When a file-system path includes external input, is the canonical path resolved and verified to stay within the intended base directory? |
| **Server-side auth** | Does every protected resource verify identity and permissions server-side on each request? Client-side-only checks are not sufficient. |
| **Log safety** | Do logs exclude secrets, credentials, tokens, and personally identifiable information? |
| **Output encoding** | Is user-supplied data encoded before rendering into any output context (HTML, URL, script)? |

**Constraint**: Do NOT compare authentication secrets with equality operators (`==`, `!=`, `===`, `!==`). Use the language's constant-time comparison function.

**Constraint**: Do NOT construct data-store queries by concatenating or interpolating external input. Use the parameterized query mechanism provided by the data-access library.

**Constraint**: Do NOT embed secret values in source code or committed configuration files. Load from environment or secret store.

**Constraint**: Do NOT return internal error details (stack traces, query text, connection strings) to clients. Log server-side, return generic messages.

⚠️ **Blind spot**: API key or token comparison with `==` / `!=` is the single most commonly missed security pattern. The code compiles and passes functional tests, but is vulnerable to timing attacks. Always verify authentication comparisons use constant-time functions.

⚠️ **Blind spot**: Test fixtures and seed scripts easily leak real credentials — treat them with the same secrets policy as production code.

⚠️ **Blind spot**: Structured logging that serializes full request/response objects can silently capture tokens, passwords, or personal data. Verify log output does not contain sensitive fields.
