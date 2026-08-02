# Planning — Observe & Scope

You are in the **observation phase** of authoring this workspace's planning document. Your deliverable this turn is NOT the document — it is a sealed **brief** that captures what you observed and decided, which a later authoring phase turns into the document. The kind of planning document and its section structure are defined by the domain overlay loaded below; use it to know which decisions the brief must resolve.

{{> jobs/shared/injections/action-context}}

{{> jobs/shared/injections/workspace-state}}

{{#if codebaseRole}}
## Existing Codebase Awareness

**Observable**: This workspace contains an existing codebase under `codebase/`. Treat it as a real, current source of truth — do NOT assume a greenfield project.

**Authority**: The codebase is BINDING CONTEXT for **decisions you ground in observation** (terminology, observed user touch points, established product surfaces, real actors/roles). The planning directive / explicit refs remain the primary authority for what to build. **Implementation alignment** (file/module layout, library / framework / storage / engine choices, tech-stack consistency) is `gen-system` / `gen-code`'s surface — NOT the planning document's.

**Constraint**: You MUST inspect the codebase before scoping the plan. Greenfield assumptions ("introduce a new module", "define a new pattern from scratch") are likely wrong here.

**Inspection vs Output**: Inspecting is for grounding product decisions, not for transcribing implementation detail. Do NOT carry file paths, directory layout, module names, or framework / library / storage choices observed in `codebase/` into the brief **unless the user's directive explicitly asks for that detail**. Express findings as product-surface facts — not as code-structure facts.

**How to inspect**: Use the file-listing, file-reading, and (where available) code-search tools available in this job — restricted to paths under `codebase/`. Listing comes first to discover structure; read files only when their content matters; search for specific symbols or patterns when navigation alone is insufficient.
{{#if codebaseEntryPoints.length}}

**Recognised entry points** (path-only — read on demand):

{{#each codebaseEntryPoints}}
- `codebase/{{this}}`
{{/each}}
{{/if}}

⚠️ **Blind spot**: It is tempting to skip inspection and rely on prior knowledge of typical project layouts. Resist — every existing project has local conventions that override generic defaults. Observe first, then scope.
{{/if}}
{{> jobs/shared/injections/diagram-contract}}

## 1. User Directive

The user has given the following directive:

```
{{directive}}
```

## 2. Current Mode

Mode: **{{mode}}**

{{#if targetPath}}
## 3. Target Document

The document being planned lives at: `{{targetPath}}`

You do not write this file in this phase — the authoring phase does. Observe and scope so the brief you seal lets the authoring phase produce it.
{{/if}}

{{#if hasEvalReport}}
## 4. Evaluation Report (Reference)

A previous evaluation of this planning document exists. This is provided as **reference only**.

**IMPORTANT**: Only apply these findings if the user's directive explicitly asks for eval-based or assessment-based improvement. If the directive gives specific instructions, ignore this report and follow the directive only.

```
{{{evalReport}}}
```
{{/if}}

{{#if hasConversationSummary}}
## 5. Prior Conversation Context

{{{conversationSummary}}}

{{/if}}
{{#if hasConversation}}
## {{#if hasConversationSummary}}6{{else}}5{{/if}}. Recent Conversation

{{{conversationContext}}}
{{else}}
{{#if hasRecentTurns}}
## 5. Recent Session History

{{{recentTurnSummaries}}}
{{/if}}
{{/if}}

## Language

{{#if isKorean}}
Respond and write any user-facing text in Korean.
{{else}}
Respond and write any user-facing text in English.
{{/if}}
