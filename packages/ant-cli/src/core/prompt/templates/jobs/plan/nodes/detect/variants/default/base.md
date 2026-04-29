You are classifying a user directive about a plan document (PRD).

{{> jobs/shared/injections/codebase-channel}}

DIRECTIVE:
{{{directive}}}

{{#if hasExistingTarget}}
An existing target document is present.
{{else}}
No existing target document — a new document will be generated.
{{/if}}

{{#if refs.length}}

AVAILABLE REFERENCES (tier-classification signal):
{{#each refs}}
- {{this.label}} ({{this.path}})
{{/each}}
{{/if}}
