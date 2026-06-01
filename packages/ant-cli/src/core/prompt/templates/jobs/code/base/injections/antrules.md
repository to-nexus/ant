{{#if antrulesContent}}
## Project Settings (codebase/ANTRULES.md)

These rules are **codebase-specific deviations** recorded by prior tasks — they capture decisions that package.json / tsconfig / framework conventions do NOT already express. Trust an entry here ONLY when it passes the 3-condition filter below; otherwise the code itself (manifests, configs, existing files) is the SSOT and this block is stale noise to ignore.

```md
{{{antrulesContent}}}
```

If any rule seems stale or restates information already in the codebase, call `read_file codebase/ANTRULES.md` to confirm the live content — then trust the actual project files over this block if they disagree.

If the rendered block contains only the placeholder line `(no project-local deviations recorded yet — sibling tasks will append as they emerge)`, that means setup created an empty ledger and no deviation has been recorded YET — it is NOT stale noise. Treat the file as a valid empty ledger and `edit_file` the placeholder line into your first filter-passing entry when you discover one.

### Updating ANTRULES.md — 3-condition filter

Record a finding here ONLY when ALL three conditions hold:

1. **Codebase-local** — this project's choice, not a system-wide default or techTier standard
2. **Not auto-derivable as a one-off fact** — `package.json` / `tsconfig.json` / framework convention / a single defining file already carry it. A sibling file can "demonstrate" two very different things — distinguish them:
   - A **stable recurring convention** — a naming or structural PATTERN that every future sibling must repeat (file-naming case, hooks file prefix, directory organization, a repeated per-module shape pattern, a singular/plural naming decision). "Derivable by reading N siblings" is NOT the disqualifying kind of auto-derivable: there is no single authoritative statement, so each task re-discovers (or drifts from) it. RECORD it — one terse line anchors consistency across tasks.
   - A **specific symbol's shape** — a function's parameters, a type's fields, an exported class's signature. This IS auto-derivable from its one defining file, which is the SSOT. Do NOT record it.
3. **Cross-task invariant** — a sibling or future task must repeat this choice to preserve consistency

If any condition fails, the information belongs elsewhere (decompose reasoning, system prompt, config file, task description) — NOT in ANTRULES.

Legitimate entries typically fall into two classes:
- **Project-specific conventions** not encoded in any tool config — file-naming case (`kebab-case.tsx`), hooks prefix (`use-*`), export style preference, directory organization, custom domain glossary. (These recur across siblings, so they pass condition 2 as stable conventions even though existing files demonstrate them.)
- **Point-in-time package compatibility / pinning rationale** — "`shadcn X v0.4` breaks with `react@19` — pinned to 18 until upstream PR #NNN merges", "jest 30 migration pending, `.js` config maintained over `.ts` for now"

Do NOT record: framework / library / runner names that package.json already declares; alias / source-root paths that tsconfig already declares; config file locations that the filesystem already reveals; **a specific symbol's call shape / signature / type fields** — these are defined in their one source file (factory definition, interface declaration, exported class); execute verifies against the defining file at write-time, recording them here duplicates the SSOT and seeds drift when the defining file evolves. (Note the distinction from condition 2: a *naming/structure PATTERN that recurs* is a recordable convention; a *specific symbol's shape* is not.)

Update via `<file>` or `edit_file`. Keep under 1500 characters. Do NOT fabricate prohibitions or decisions — record only what you actually observed during this task.
{{else}}
## Project Settings (codebase/ANTRULES.md)

This project does not yet have a `codebase/ANTRULES.md`. Create one ONLY when you discover a fact that passes the 3-condition filter:

1. **Codebase-local** — this project's choice, not a techTier standard
2. **Not auto-derivable as a one-off fact** — `package.json` / `tsconfig.json` / framework convention / a single defining file already carry it. Distinguish what a sibling file "demonstrates": a **stable recurring convention** (a naming/structural PATTERN every future sibling must repeat — naming case, hooks prefix, directory organization) is RECORDABLE (no single authoritative statement exists, so tasks otherwise re-discover or drift); a **specific symbol's shape** (a function's parameters / a type's fields, defined in its one source file) is the SSOT and does NOT belong here.
3. **Cross-task invariant** — a sibling or future task must repeat this choice

Typical legitimate seeds: project-specific naming/structure conventions not encoded in tool configs (these recur across siblings, so they pass condition 2), or a point-in-time package pinning rationale (e.g. "`shadcn X v0.4` breaks with `react@19` — pinned to 18"). Do NOT seed framework / library / alias / source-root restatements — those live in `package.json` / `tsconfig.json` already and duplicating them creates drift.

If you create the file, use `# ANTRULES.md` heading + only the sections you are confident about. Keep under 1500 characters. Do NOT fabricate decisions — record only what you actually observed.
{{/if}}
