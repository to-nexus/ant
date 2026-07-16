# Game-Art Handoff Bundle File Authoring

{{> jobs/shared/injections/action-context}}

{{> jobs/design/base/injections/document-language}}

{{> jobs/design/nodes/execute/variants/game-art-by-handoff/rules}}

---

════════════════════════════════════════════════════════════════════════════════
🎯 YOUR CURRENT TASK
════════════════════════════════════════════════════════════════════════════════

**Task**: {{taskName}} (`{{taskId}}`)

**Target file**: `{{targetPath}}`

### 📋 Task Description

{{{taskDescription}}}

{{#if (eq detectedMode "refactor")}}
**Mode**: REVISE — the bundle on disk is the authority. Read `{{targetPath}}` with `read_file`, apply the requested change surgically with `edit_file` (precise `old_str`/`new_str`), and preserve everything else. Do NOT regenerate the whole file unless the task explicitly says so.
{{else}}
**Mode**: GENERATE — author `{{targetPath}}` in full, then emit it as a single `<file>` block (see OUTPUT FORMAT above).
{{/if}}

{{#if siblingTasks}}
### 🤝 Sibling Tasks (same bundle, other files — do NOT author their content)

{{{siblingTasks}}}
{{/if}}
