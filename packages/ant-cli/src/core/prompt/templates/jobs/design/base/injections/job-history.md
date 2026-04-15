## Previous Jobs in This Feature

The following jobs have been completed in this feature session.
Use this context to avoid redundant work and maintain consistency with prior decisions.

{{#each jobConversation}}
{{#if (eq this.role "system")}}
[Earlier Summary]
{{{this.content}}}

{{else if (eq this.role "user")}}
[Directive] {{{this.content}}}
{{else}}
[Result] {{{this.content}}}

{{/if}}
{{/each}}
