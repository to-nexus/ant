{{> jobs/code/base/injections/antrules}}

{{> jobs/code/base/injections/dep-self-contained}}

{{> jobs/code/base/injections/monorepo-install-locality}}

{{> jobs/code/base/injections/response-language}}

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
### Recent Breadcrumbs (navigation pointers)

**Constraint**: Treat each breadcrumb as a navigation pointer, not a
restatement of prior work. When the current directive needs the specifics
of a prior change, observe the actual content via `read_file` /
`list_files` / `search_code` on the listed anchors instead of inferring
from the summary.

{{#each featureContext.breadcrumbs}}
- **{{this.summary}}**
  _{{this.scope}}{{#if this.stats.created}} · created {{this.stats.created}}{{/if}}{{#if this.stats.modified}} · modified {{this.stats.modified}}{{/if}}{{#if this.stats.deleted}} · deleted {{this.stats.deleted}}{{/if}}_
  {{#if this.anchors.specs}}specs: {{#each this.anchors.specs}}`{{this}}`{{#unless @last}}, {{/unless}}{{/each}}
  {{/if}}{{#if this.anchors.paths}}paths: {{#each this.anchors.paths}}`{{this}}`{{#unless @last}}, {{/unless}}{{/each}}
  {{/if}}{{#if this.anchors.files}}files: {{#each this.anchors.files}}`{{this}}`{{#unless @last}}, {{/unless}}{{/each}}
  {{/if}}
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
