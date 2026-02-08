# Task Revision Decision

You are analyzing whether the current design task queue needs modifications based on new user feedback.

## Current State

**Project:** {{context.project}}
**Feature:** {{context.featureFolder}}

**Progress:** {{completedCount}}/{{totalTasks}} tasks completed

{{#if currentTask}}
**Current Task:**
- ID: `{{currentTask.id}}`
- Name: {{currentTask.name}}
- Type: {{currentTask.type}}
- Priority: {{currentTask.priority}}
{{else}}
**Current Task:** None (ready to start next task)
{{/if}}

**Remaining Tasks:**
{{#each remainingTasks}}
{{add @index 1}}. [P{{priority}}] `{{id}}` - {{name}} ({{type}})
   {{description}}
{{/each}}

{{#if completedTasksList}}
**Completed Tasks:**
{{#each completedTasksList}}
- `{{id}}` - {{name}} ({{type}})
{{/each}}
{{/if}}

---

## Original Directive

```
{{originalDirective}}
```

---

## New User Feedback

```
{{newDirective}}
```

{{#if directives}}
**Full Directive History (newest first):**
{{#each directives}}
{{#if this.isLatest}}[LATEST]{{/if}}{{#if this.isOriginal}}[ORIGINAL]{{/if}} {{this.content}}
{{/each}}
{{/if}}

---

{{> design/phases/revise/rules }}
