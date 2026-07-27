{{!-- suppressJobTarget: pass `suppressJobTarget=true` when the consuming
template carries its OWN per-task output contract (design ui/game-art execute
variants — their `targetPath` is the sole write target). The job-level
`resolvedAction.target` list (== refs under the revise contract) rendered
here as a per-turn write whitelist would contradict it. Unflagged renders are
byte-identical to the pre-flag behavior. --}}
{{#if resolvedAction.intentDescription}}
## User Action Specification

The user has requested: **{{resolvedAction.intentDescription}}**

{{/if}}
{{#if resolvedAction.documents}}

{{#unless suppressJobTarget}}
{{#if resolvedAction.target}}
## Output Target
Write ONLY to the following path(s) this turn. Provided Documents below are INPUTS, not edit targets.
{{#each resolvedAction.target}}- `{{this}}`
{{/each}}
{{/if}}
{{/unless}}

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
{{#unless suppressJobTarget}}
{{#if resolvedAction.target}}
## Output Target
Write ONLY to the following path(s) this turn.
{{#each resolvedAction.target}}- `{{this}}`
{{/each}}
{{/if}}
{{/unless}}

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
