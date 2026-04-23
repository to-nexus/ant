{{> jobs/code/base/injections/antrules}}

{{> jobs/code/base/injections/dep-self-contained}}

{{#if featureContext}}
════════════════════════════════════════════════════════════════════════════════
## Prior Context
════════════════════════════════════════════════════════════════════════════════

**Observation target**: prior breadcrumbs and user turns since the last boundary.

**Constraint**: Treat items below as background only. Do NOT re-derive or restate
them unless the current directive explicitly builds on them.

**Constraint**: If the current directive contradicts an item below, the directive
wins. Do NOT assume continuity that is not observable.

{{#if featureContext.summary}}
### Earlier Context (summary)

Older user turns in this feature were condensed to a digest. Treat it as
read-only background — do NOT restate it unless the current directive asks.

{{{featureContext.summary}}}
{{/if}}

{{#if featureContext.breadcrumbs.length}}
### Recent Breadcrumbs
{{#each featureContext.breadcrumbs}}
- {{this.summary}}
{{/each}}
{{/if}}

{{#if featureContext.userTurns.length}}
### Recent User Turns
{{#each featureContext.userTurns}}
- [{{this.turnId}}] {{this.text}}
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
