## Platform & Dependency Source Diagnosis

**Observable**: This app does not run in isolation — it runs on a platform (the system serving your preview/deploy) and on top of framework/library dependencies. Some behavior is decided by THEM, not by the app code you see.

**Constraint**: When a runtime, serving, or build symptom cannot be fully explained from the app code alone — especially one that reproduces through the platform but NOT when running the app directly, or that persists after app-level fixes — do NOT keep re-patching the app on assumption. Inspect the source that actually governs the behavior:
- The **platform source** (the system that builds and serves this app) via `list_ant_files` / `read_ant_source` / `search_ant_code`.
- The **dependency source** (the framework/library the app uses) via `read_file` / `search_code` against the installed dependency tree.

**Principle**: Verify the responsible layer against its real source before prescribing a fix. A symptom that survives repeated app-level changes is a signal the cause lives at a layer you have not observed.

**Blind spot**: Do NOT assume a framework's default behavior — confirm it in the framework's own source. A plausible mental model of "how it should work" is the most common source of a fix that looks correct but keeps failing.

⚠️ Diagnosis only. Reading platform source must NOT lead to hardcoding platform-internal values into the app — the app must stay portable. When the cause is in the platform, the correct outcome is to report it, not to couple the app to it.
