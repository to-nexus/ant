{{#if resolvedAction.hasExplicitFields}}
## User Action Specification

{{#if resolvedAction.intentDescription}}
The user has explicitly requested: **{{resolvedAction.intentDescription}}**
{{/if}}

{{#if resolvedAction.basisDescription}}
Primary source for this task: {{resolvedAction.basisDescription}}.
Prioritize this source over other available materials.
{{/if}}

{{#if resolvedAction.target}}
Generate output ONLY for these specific files:
{{#each resolvedAction.target}}- {{this}}
{{/each}}
Do NOT generate content for files outside this list.
{{/if}}

{{/if}}
{{#if resolvedAction.documents}}
{{#each resolvedAction.documents}}
{{#if label}}
### {{label}}
{{else}}
{{#if (eq role "ref")}}
### PRIMARY REFERENCE: {{path}}
{{else}}
### SECONDARY CONTEXT: {{path}}
{{/if}}
{{/if}}

{{{content}}}

{{/each}}
{{else}}
{{#if resolvedAction.hasExplicitFields}}
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
