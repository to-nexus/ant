# Golden LLM-mock responses

Shared, canonical mock responses reused across multiple scenario fixtures.
Per-scenario `llm-mock/*.md` files typically **copy** these verbatim (not
symlink — `copyDirectory` in the runner dereferences symlinks inconsistently
across platforms).

| File | Used when | Router effect |
|---|---|---|
| `execute-verification-done.md` | verification task, Session already satisfies all required gates | Emits `<done>` with **no** `<file>` tags. With `Session.isComplete() === true` the verify-mode router returns `checkTaskStatus`. |

Do NOT write `<file path="...">…</file>` blocks into these golden fixtures —
that would cause `execute` to re-enter `plan` (reverify loop) and most
scenarios become non-deterministic.

Note: post-`urban-fronting-faith` (May 2026) the verify-mode router no
longer consults `_executeModifiedFiles` — that channel was retired. The
gate-completion check (`Session.isComplete()`) is the sole signal for
"verification finished, route to checkTaskStatus"; everything else routes
to `plan` for reverify, with `checkRetryTermination`'s plan-hash repeat
detector ensuring no-progress cycles terminate via `no_progress`.
