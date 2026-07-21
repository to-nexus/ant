{{#if lens.exchanges.length}}
### Recent Exchanges

The most recent user↔assistant exchanges in this feature (oldest first).
Use them to resolve references in the current directive ("the second
option", "that file", "what you changed") — the user assumes this
conversation is remembered. If the current directive contradicts an
exchange below, the current directive wins.

{{#each lens.exchanges}}
**User{{#if this.jobType}} [{{this.jobType}}]{{/if}}**: {{this.userText}}
{{#if this.assistantFinalText}}
**Assistant**: {{this.assistantFinalText}}
{{/if}}
{{#if this.anchors}}
_produced: {{json this.anchors}}_
{{/if}}

{{/each}}
{{/if}}
{{#if lens.constraintLedger.length}}
### Standing Constraints (ledger)

User-stated rules accumulated across this feature's history, quoted
verbatim. They remain BINDING regardless of age — apply them to the current
work unless the current directive explicitly supersedes one.

{{#each lens.constraintLedger}}
- "{{this}}"
{{/each}}
{{/if}}
{{#if lens.digests.length}}
### Prior Exchange Digests

Structured records of older exchanges (oldest first). `constraints` quote
the user's own wording and remain binding until explicitly superseded —
do NOT drop them for being old. These are condensed: when a digest or the
rolling summary seems to omit detail the current work depends on, recall
the original wording via the `read_state` tool with `scope: "history"`
(if the tool is available) instead of guessing.

{{#each lens.digests}}
- outcome: {{this.digest.outcome}}
{{#if this.digest.decisions.length}}
  - decisions: {{#each this.digest.decisions}}{{this}}{{#unless @last}} · {{/unless}}{{/each}}
{{/if}}
{{#if this.digest.constraints.length}}
  - constraints: {{#each this.digest.constraints}}"{{this}}"{{#unless @last}} · {{/unless}}{{/each}}
{{/if}}
{{#if this.digest.openQuestions.length}}
  - open questions: {{#each this.digest.openQuestions}}{{this}}{{#unless @last}} · {{/unless}}{{/each}}
{{/if}}
{{/each}}
{{/if}}
