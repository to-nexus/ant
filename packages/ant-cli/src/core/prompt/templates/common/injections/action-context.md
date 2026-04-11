{{#if resolvedAction.hasExplicitFields}}
## User Action Specification

{{#if resolvedAction.intentDescription}}
The user has explicitly requested: **{{resolvedAction.intentDescription}}**
{{/if}}

{{/if}}
{{#if resolvedAction.documents}}

{{#if resolvedAction.target}}
## Output Target
Generate output ONLY for:
{{#each resolvedAction.target}}- `{{this}}`
{{/each}}
Do NOT generate content for files outside this list.
{{/if}}

## Primary References
Follow these documents as the implementation source.
{{#each resolvedAction.documents}}
{{#if (eq role "ref")}}
### {{#if label}}{{label}}{{else}}{{path}}{{/if}}

{{{content}}}

{{/if}}
{{/each}}

## Background Context
Use these for understanding only. Do NOT treat as implementation source.
{{#each resolvedAction.documents}}
{{#if (eq role "context")}}
### {{#if label}}{{label}}{{else}}{{path}}{{/if}}

{{{content}}}

{{/if}}
{{/each}}

{{else}}
{{#if resolvedAction.hasExplicitFields}}
{{#if resolvedAction.target}}
## Output Target
Generate output ONLY for:
{{#each resolvedAction.target}}- `{{this}}`
{{/each}}
Do NOT generate content for files outside this list.
{{/if}}

{{#if resolvedAction.refs}}
The following files were explicitly selected as primary references:
{{#each resolvedAction.refs}}- {{this}}
{{/each}}
{{/if}}

{{#if resolvedAction.context}}
Additional context files (secondary, for reference only):
{{#each resolvedAction.context}}- {{this}}
{{/each}}
{{/if}}
{{/if}}
{{/if}}
