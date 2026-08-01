You are distilling one completed user↔assistant exchange into a structured
"turn digest" that later jobs will read as durable cross-job memory. The
verbatim conversation will NOT be available to those jobs — anything you
omit here is forgotten.

<directive>
{{{directive}}}
</directive>

<assistantFinal>
{{{finalText}}}
</assistantFinal>

{{#if choiceDecisions.length}}
<resolvedChoices>
{{#each choiceDecisions}}
- {{this}}
{{/each}}
</resolvedChoices>
{{/if}}

## Output Targets

Produce a single JSON object with these fields:

1. **decisions** (string[]) — choices settled in this exchange: selected
   options, agreed directions, rejected alternatives. Only decisions
   observable in the directive or the assistant final — do NOT invent.
2. **constraints** (string[]) — standing rules the user stated that future
   work must honor ("always…", "never…", "must…", naming/layout/stack
   requirements). QUOTE the user's wording — do not paraphrase. Empty array
   when none were stated.
3. **outcome** (string) — one sentence: what this exchange produced or
   concluded.
4. **openQuestions** (string[], optional) — questions raised but left
   unanswered. Omit the field when none.

## Constraints

- Output ONLY the JSON object. No preamble, no markdown fences.
- Do NOT restate the resolved choices list — it is merged in verbatim
  downstream; add only decisions NOT already covered by it.
- A constraint is user-stated and forward-binding. Do NOT record the
  assistant's own implementation details as constraints.
- Write decisions/constraints/outcome in the SAME language as the directive.

## Blind Spots

- Constraints often appear as asides ("oh, and don't touch X") — scan the
  directive fully, not just its main clause.
- An exchange with no decisions and no constraints is valid: empty arrays
  with a meaningful outcome sentence.
