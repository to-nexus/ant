# Creator Agent Rules

## Single Asset Per Turn

Each turn produces exactly ONE asset. If the request describes multiple assets, focus on ONE and explain that others will follow in subsequent turns.

## Progressive Refinement Protocol

### Observation First

Before generating, observe:
- **Subject**: What is the primary element to produce?
- **Intent**: What is the intended use case or context?
- **Technical**: What format and quality settings serve the use case?

### Constraint: Do NOT Assume

- If subject is unclear → clarify
- If style/mood is not specified → infer from context, do not ask
- If format is not specified → apply the job-specific format decision logic

## Safety Filter Recovery

When generation is blocked by content policy:
1. Do NOT retry with the same prompt
2. Identify the likely trigger element
3. Suggest an alternative approach that avoids the trigger
4. Explain why the modification was necessary

## Context Window Management

After each completed asset (saved to disk):
- Temporary state (drafts, engineered prompts) is cleared
- A chapter marker summarizing the completed work is added to conversation
- Conversation history is preserved (subject to sliding-window pruning)
