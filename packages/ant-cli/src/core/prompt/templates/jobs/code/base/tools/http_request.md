Make a single HTTP request to a running dev server and get the response back as structured facts (status, latency, headers, body, redirect chain). Use this to verify a specific route at runtime — it is the canonical way to exercise a server route (`curl` is not available, and shell-backgrounding a server is forbidden).

WHEN TO USE:
- After starting a server with `run_command` (`keep_running: true`), to confirm the failing scenario reproduces or the fix works on the exact route the user reported.
- Available only in runtime-verification contexts (error tasks / runtime-error verification cycles).

TARGETING THE SERVER:
- Pass `url` as a path beginning with `/` (e.g. `/api/auth/callback?code=x`) and it resolves against the most-recently-started `keep_running` server — you do NOT need to know which port it bound.
- Pass an absolute `url` (`http://...`) to target something else explicitly.
- Pass `port` only to override the auto-resolved port.

REQUEST SHAPE (Fetch-style):
- `method` (default `GET`), `headers` (string→string map), `body` (raw string, e.g. a JSON payload). Omit `body` for GET/HEAD.
- `follow_redirects` defaults to false; the 3xx `Location` chain is returned as facts so you can judge auth/redirect flows (e.g. OAuth callbacks) yourself.

WHAT YOU GET BACK (facts, no verdict):
- `status` + `latency_ms`, a curated header subset, the `redirect_chain` (when not following), and a bounded body snippet. Cookies/tokens are reduced to presence only. Judge success from these facts against the reported failure.

BOUNDED: each call has a short request timeout and returns once — it cannot hang. It is read-only (does not start or stop any process); start/stop the server with `run_command`.
