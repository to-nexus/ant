────────────────────────────────────────────────────────────────────────────────
### Secure coding principles (universal, language- and stack-neutral)
────────────────────────────────────────────────────────────────────────────────

**Principle**: All data originating outside the application boundary is untrusted. Validate and sanitize external input before passing it to queries, file-system operations, shell commands, or rendered output.

**Constraint**: Never construct data-store queries by concatenating or interpolating external input. Use the parameterized query mechanism provided by the data-access library.

**Constraint**: Credentials, API keys, tokens, and other secrets MUST be loaded from environment variables or a dedicated secret store. Never embed secret values in source code or committed configuration files.

**Constraint**: Client-facing error responses MUST NOT expose internal state — no stack traces, internal file paths, schema details, or debug information in production responses. Return generic error messages only.

**Constraint**: Security-sensitive operations (token generation, session identifiers, password hashing) MUST use cryptographically secure functions. Never use non-cryptographic randomness or obsolete algorithms for security purposes.

**Constraint**: When the application accesses the file system using a path derived from external input, resolve the canonical path and verify it remains within the intended base directory before proceeding.

**Constraint**: Every protected resource MUST verify identity and permissions server-side on each request. Never rely solely on client-side checks to guard server resources.

**Constraint**: Logs MUST NOT contain secrets, credentials, tokens, or personally identifiable information. Be cautious with structured logging that serializes entire request or response objects — sensitive fields are easily captured.

**Constraint**: Encode user-supplied data before rendering it into any output context (HTML, URL, script). Never bypass the framework's default escaping to inject raw user content.

**Constraint**: Do not introduce dependencies with known security vulnerabilities. Prefer well-maintained packages and avoid deprecated or unmaintained libraries.

⚠️ **Blind spot**: Test fixtures and seed scripts easily leak real credentials — treat them with the same secrets policy as production code.

⚠️ **Blind spot**: Structured logging that serializes full request/response objects can silently capture tokens, passwords, or personal data. Verify log output does not contain sensitive fields.
