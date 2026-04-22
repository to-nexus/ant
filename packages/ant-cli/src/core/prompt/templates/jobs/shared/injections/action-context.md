{{#if resolvedAction.hasExplicitFields}}
## User Action Specification

{{#if resolvedAction.intentDescription}}
The user has explicitly requested: **{{resolvedAction.intentDescription}}**
{{/if}}

{{/if}}
{{#if resolvedAction.documents}}

{{#if resolvedAction.target}}
## Output Target
Write ONLY to the following path(s) this turn. Provided Documents below are INPUTS, not edit targets.
{{#each resolvedAction.target}}- `{{this}}`
{{/each}}
{{/if}}

## Provided Documents

{{> jobs/shared/injections/role-guide}}

{{#each resolvedAction.documents}}{{#if (eq role "ref")}}
### [ref] {{#if label}}{{label}}{{else}}{{path}}{{/if}}

{{{content}}}

{{/if}}{{/each}}{{#each resolvedAction.documents}}{{#if (eq role "context")}}
### [context] {{#if label}}{{label}}{{else}}{{path}}{{/if}}

{{{content}}}

{{/if}}{{/each}}

{{else}}
{{#if resolvedAction.hasExplicitFields}}
{{#if resolvedAction.target}}
## Output Target
Write ONLY to the following path(s) this turn.
{{#each resolvedAction.target}}- `{{this}}`
{{/each}}
{{/if}}

{{#if resolvedAction.refs}}
The following files were explicitly selected as `ref` inputs (original source material):
{{#each resolvedAction.refs}}- {{this}}
{{/each}}
{{/if}}

{{#if resolvedAction.context}}
The following files were explicitly selected as `context` inputs (additional authority; `ref` wins on conflict):
{{#each resolvedAction.context}}- {{this}}
{{/each}}
{{/if}}
{{/if}}
{{/if}}
