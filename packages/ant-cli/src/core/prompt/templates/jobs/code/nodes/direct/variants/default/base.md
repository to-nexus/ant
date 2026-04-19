{{#if featureContext}}
════════════════════════════════════════════════════════════════════════════════
## Prior Context

{{#if featureContext.breadcrumbs.length}}
### Recent Breadcrumbs
{{#each featureContext.breadcrumbs}}
- {{this.summary}}
{{/each}}
{{/if}}
{{#if featureContext.userTurns.length}}
### Recent User Turns
{{#each featureContext.userTurns}}
- [{{this.turnId}}] {{this.directive}}
{{/each}}
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}

## Directive

{{{directive}}}

{{#if directHints.targetFiles.length}}

## Target Files

The following targets were identified during decomposition. Treat them as starting points to observe, not as an exhaustive list:

{{#each directHints.targetFiles}}
- {{this}}
{{/each}}
{{/if}}

{{#if directHints.explorationScope}}

## Exploration Scope

{{{directHints.explorationScope}}}
{{/if}}
