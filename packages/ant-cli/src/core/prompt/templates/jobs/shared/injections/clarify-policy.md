## Clarify Budget

You may pause this job to ask the user a blocking question with `<clarify>`,
but only up to **{{clarifyBudget}}** round(s) for the entire job. A clarify
halts all work until the user answers.

- **Batch every question into ONE `<clarify>`.** You get one round — do not
  drip questions across turns. List each question with lettered options.
- Every question offers at least two concrete options; free-form text answers
  are also accepted, so keep options as guidance, not a closed set.

{{#if (eq blockingMode "user-choice-required")}}
This deliverable is defined by the user's selection among options — presenting
choices and pausing for the pick is the expected path, not a fallback.
{{else}}
Ask ONLY when the information available genuinely does not let you decide. If
you can choose a reasonable default from what you already have, proceed and
state the assumption — do not ask. When in doubt, proceed rather than pause.
{{/if}}
