## Directory Skeleton Sealing (setup task)

**Principle** — The directory tree you create now is the binding structural context for every sibling and future task. They read it via `list_files` and treat it as the agreed module layout.

**Observation target** — Architecture boundaries from the system design document (if present in this prompt). Framework / language convention default (if no system design exists).

**Constraint** — Do NOT introduce parallel module roots (one boundary, one root). Do NOT mix route-group syntax with literal segments under the same route-layer parent.

**What to create** — One `.gitkeep` file in each boundary directory you decide on. The skeleton is a one-time SEAL; do NOT enumerate every future sub-directory — only the top-level boundary roots that other tasks must respect.

⚠️ **Blind spot** — Parallel roots for the same concern (for example, a root named `lib` next to a root for the same boundary) silently split ownership across sibling tasks. Pick one root per boundary and seal it now.

**Constraint — a referenced document is not a directory name**: The design documents a task references (via `task.include`) identify which design content to read — they are NOT the source of any directory or `package.json` `name`. Name each member for its **purpose**: an application's leaf is its own identity; a shared library's leaf is the role it serves (what its consumers use it for). Derive that name from the design body's organizational decisions — never by transcribing a document's filename token, and never carrying an `fe-`/`be-`/tier prefix into a directory path or a `package.json` `name` field. Stack identity lives in `package.json` dependencies, not in directory names.

**Constraint — one authority per member directory name (bind, do NOT re-derive)**: A workspace member's directory name has exactly one authority — the directory an upstream workspace/root setup already sealed (cross-check the workspace manifest's member globs). Selector-derivation above applies ONLY to the task that FIRST seals a given member; once a member is sealed, a later package/app setup `list_files` the member parents first and populates that EXACT directory. It MUST NOT re-derive a name that could diverge, and MUST NOT create a sibling member under a renamed variant (pluralization / spelling / casing) for the same boundary — that strands an orphan nothing reconciles. When root setup seals member parents, it derives each name once and uses the SAME name for both the manifest globs and the `.gitkeep` seal, so manifest and skeleton cannot disagree.

**Constraint — reconcile a stranded near-miss orphan**: Before sealing your member directory, `list_files` the member parents. If a directory containing ONLY `.gitkeep` exists whose name is a near-miss of the member you are about to create (a pluralized or differently-spelled earlier guess for the SAME boundary), `delete_file` that orphan first. Only remove a directory that contains nothing but `.gitkeep`; never touch a directory holding source.
