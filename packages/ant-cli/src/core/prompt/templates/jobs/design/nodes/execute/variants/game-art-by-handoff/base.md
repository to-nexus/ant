{{> jobs/shared/injections/ant-platform-identity}}

# Game-Art Handoff Bundle File Authoring

{{> jobs/shared/injections/action-context suppressJobTarget=true}}

{{> jobs/design/base/injections/document-language}}

{{> jobs/design/nodes/execute/variants/game-art-by-handoff/rules}}

---

════════════════════════════════════════════════════════════════════════════════
🎯 YOUR CURRENT TASK
════════════════════════════════════════════════════════════════════════════════

**Task**: {{taskName}} (`{{taskId}}`)

**Target file**: `{{targetPath}}` — write ONLY to this path this task; every other path in this prompt is an input.

### 📋 Task Description

{{{taskDescription}}}

{{#if targetExists}}
**Write strategy**: REVISE — `{{targetPath}}` exists on disk and is the authority. Read it with `read_file`, apply the requested change surgically with `edit_file` (precise `old_str`/`new_str`), and preserve everything else. Do NOT regenerate the whole file unless the task explicitly says so.
{{else}}
**Write strategy**: GENERATE — `{{targetPath}}` does not exist yet. Author it in full and write it with a single `create_file` tool call (see OUTPUT FORMAT above).
{{/if}}

{{#if removeFilePaths}}
**Structural removals**: once `{{targetPath}}` carries the merged/final content, delete each of these superseded files with `delete_file` — this is the ONLY sanctioned write outside the target path this task:
{{#each removeFilePaths}}
- `{{this}}`
{{/each}}
{{/if}}

{{#if bundleFileMap}}
### 🗂 Bundle File Map (every other file in this bundle — inputs, never your output)

{{{bundleFileMap}}}

Read the ones your file depends on before authoring; author none of them.
{{/if}}