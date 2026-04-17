# Golden LLM-mock responses

Shared, canonical mock responses reused across multiple scenario fixtures.
Per-scenario `llm-mock/*.md` files typically **copy** these verbatim (not
symlink — `copyDirectory` in the runner dereferences symlinks inconsistently
across platforms).

| File | Used when | Router effect |
|---|---|---|
| `execute-verification-done.md` | verification task, tracker already satisfies completeness | Emits `<done>` with **no** `<file>` tags. `_executeModifiedFiles` stays `false` → router → `checkTaskStatus`. |

Do NOT write `<file path="...">…</file>` blocks into these golden fixtures —
that would cause `execute` to re-enter `plan` (reverify loop) and most
scenarios become non-deterministic.
