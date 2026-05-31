## Directory Skeleton Sealing (setup task)

**Principle** — The directory tree you create now is the binding structural context for every sibling and future task. They read it via `list_files` and treat it as the agreed module layout.

**Observation target** — Architecture boundaries from the system design document (if present in this prompt). Framework / language convention default (if no system design exists).

**Constraint** — Do NOT introduce parallel module roots (one boundary, one root). Do NOT mix route-group syntax with literal segments under the same route-layer parent.

**What to create** — One `.gitkeep` file in each boundary directory you decide on. The skeleton is a one-time SEAL; do NOT enumerate every future sub-directory — only the top-level boundary roots that other tasks must respect.

⚠️ **Blind spot** — Parallel roots for the same concern (for example, a root named `lib` next to a root for the same boundary) silently split ownership across sibling tasks. Pick one root per boundary and seal it now.

**Constraint — selector token ≠ directory leaf**: The `task.packages` selector tokens follow `fe-{name}` / `be-{name}` form — they identify which design documents to inject as task references, not directory paths. When sealing the skeleton, derive directory leaves from the `{name}` part alone (without the tier prefix) plus the design body's organizational decisions. Never carry the `fe-`/`be-`/tier prefix from the selector into a directory path or a `package.json` `name` field. Stack identity lives in `package.json` dependencies, not in directory names.
