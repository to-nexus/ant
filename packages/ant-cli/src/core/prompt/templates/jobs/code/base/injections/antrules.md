{{#if antrulesContent}}
## Project Settings (codebase/ANTRULES.md)

These rules are **codebase-specific deviations** recorded by prior tasks — they capture decisions that package.json / tsconfig / framework conventions do NOT already express. Trust an entry here ONLY when it passes the 3-condition filter below; otherwise the code itself (manifests, configs, existing files) is the SSOT and this block is stale noise to ignore.

```md
{{{antrulesContent}}}
```

If any rule seems stale or restates information already in the codebase, call `read_file codebase/ANTRULES.md` to confirm the live content — then trust the actual project files over this block if they disagree.

### Updating ANTRULES.md — 3-condition filter

Record a finding here ONLY when ALL three conditions hold:

1. **Codebase-local** — this project's choice, not a system-wide default or techTier standard
2. **Not auto-derivable** — `package.json` / `tsconfig.json` / framework convention / existing files do NOT already carry this fact
3. **Cross-task invariant** — a sibling or future task must repeat this choice to preserve consistency

If any condition fails, the information belongs elsewhere (decompose reasoning, system prompt, config file, task description) — NOT in ANTRULES.

Legitimate entries typically fall into two classes:
- **Project-specific conventions** not encoded in any tool config — file-naming case (`kebab-case.tsx`), hooks prefix (`use-*`), export style preference, directory organization, custom domain glossary
- **Point-in-time package compatibility / pinning rationale** — "`shadcn X v0.4` breaks with `react@19` — pinned to 18 until upstream PR #NNN merges", "jest 30 migration pending, `.js` config maintained over `.ts` for now"

Do NOT record: framework / library / runner names that package.json already declares; alias / source-root paths that tsconfig already declares; config file locations that the filesystem already reveals; convention restatements the codebase already demonstrates. These are redundant and seed drift.

Update via `<file>` or `edit_file`. Keep under 1500 characters. Do NOT fabricate prohibitions or decisions — record only what you actually observed during this task.
{{else}}
## Project Settings (codebase/ANTRULES.md)

This project does not yet have a `codebase/ANTRULES.md`. Create one ONLY when you discover a fact that passes the 3-condition filter:

1. **Codebase-local** — this project's choice, not a techTier standard
2. **Not auto-derivable** — `package.json` / `tsconfig.json` / framework convention / existing files do NOT already carry it
3. **Cross-task invariant** — a sibling or future task must repeat this choice

Typical legitimate seeds: project-specific naming conventions not encoded in tool configs, or a point-in-time package pinning rationale (e.g. "`shadcn X v0.4` breaks with `react@19` — pinned to 18"). Do NOT seed framework / library / alias / source-root restatements — those live in `package.json` / `tsconfig.json` already and duplicating them creates drift.

If you create the file, use `# ANTRULES.md` heading + only the sections you are confident about. Keep under 1500 characters. Do NOT fabricate decisions — record only what you actually observed.
{{/if}}
