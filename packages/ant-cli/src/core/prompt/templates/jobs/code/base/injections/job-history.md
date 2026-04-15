## Previous Jobs in This Feature

The following jobs have been completed in this feature session.
Each `[Result]` entry shows what was built, which spec/docs were consumed, and which files were written.
This history defines the boundary of completed work — see Scope Determination rules.

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
