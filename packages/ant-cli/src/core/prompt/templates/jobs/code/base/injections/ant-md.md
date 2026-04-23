{{#if antrulesContent}}
## Project Settings (codebase/ANTRULES.md)

These rules govern file creation and modification decisions in this codebase. Treat them as authoritative. If any rule seems stale or incomplete, call `read_file codebase/ANTRULES.md` to confirm the live content.

```md
{{{antrulesContent}}}
```

**Updating ANTRULES.md — when you discover a cross-task invariant during this task**: a library version incompatibility, a decided test runner, a lint rule status, an anti-pattern to avoid, or any rule that sibling or future tasks must follow — update `codebase/ANTRULES.md` via `<file>` or `edit_file` so the finding persists. Add a new section or modify an existing one, whichever fits. Keep the file under 1500 characters. Do NOT fabricate prohibitions or decisions you are not confident about — record only what you actually observed.
{{else}}
## Project Settings (codebase/ANTRULES.md)

This project does not yet have a `codebase/ANTRULES.md`. If during this task you discover a cross-task invariant that sibling or future tasks must follow (library compatibility, decided test runner, naming convention, etc), create `codebase/ANTRULES.md` with a minimal skeleton (`# ANTRULES.md` heading + only the sections you are confident about). Keep it under 1500 characters. Do NOT fabricate decisions — record only what you actually observed.
{{/if}}
