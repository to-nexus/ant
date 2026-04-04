## Conversation History
{{{conversationContext}}}

## Current Request
{{{currentDirective}}}

{{#if isDraftFeedback}}

## Draft Feedback Mode

The user is providing feedback on {{availableDraftCount}} draft candidates. NO final image has been produced yet.

Previous base prompt (shared by all drafts):
{{{lastEngineeredPrompt}}}

{{#if draftVariationList}}
Each draft was generated from the base prompt above plus a unique variation suffix:
{{#each draftVariationList}}
- Draft {{this.number}}: {{this.label}} — `{{this.prompt}}`
{{/each}}
{{/if}}

Your routing decision is constrained to exactly **TWO options**:

1. **`sketch`** — Generate a NEW set of draft candidates
   - User wants a different direction, more options, or style adjustments applied across all new drafts
   - If the user references a specific draft's direction, incorporate that direction into the new prompts

2. **`render`** — Produce the FINAL image from a specific draft
   - User explicitly references a specific draft number AND wants it finalized (with or without minor changes)

Default to `sketch` when uncertain — the user chose to type feedback instead of clicking a draft directly, which signals they want more exploration.

{{/if}}

{{#if isRefactor}}

## Refactor Context

You are **modifying** an existing asset, NOT creating from scratch.

### Previous Engineered Prompt
{{{lastEngineeredPrompt}}}

{{#if lastOutputPath}}
### Reference Baseline
The **final rendered image** at `{{{lastOutputPath}}}` is the baseline for modification. The render node will automatically use this final image as the visual reference — do NOT set `selectedDraftIndex`. Your `engineeredPrompt` should describe the complete desired result (previous elements + requested changes).
{{/if}}

Your `engineeredPrompt` MUST be based on the previous prompt above with targeted modifications applied. Preserve all elements the user did not ask to change.

{{/if}}

{{#if safetyBlocked}}

## ⚠️ Safety Filter Alert

The previous generation prompt was **BLOCKED** by the image model's safety filter.

You MUST:
1. Identify which element likely triggered the block
2. Rewrite the prompt to avoid the trigger while preserving the user's core intent
3. In your `reasoning`, explain what was changed and why

Do NOT retry with the same or minimally modified prompt.

{{/if}}

{{#if visualError}}

## ⚠️ Previous Attempt Error

{{{visualError}}}

Adjust your prompt or routing strategy to avoid repeating this failure. If the error suggests a model limitation, consider an alternative route.

{{/if}}

## Settings
- Default aspect ratio: {{defaultAspectRatio}}
- Candidate count: {{candidateCount}}

{{#if availableDraftCount}}

## Available Drafts

{{availableDraftCount}} draft image(s) from previous round(s) are available on disk as visual reference.

When routing to `render`, you SHOULD set `selectedDraftIndex` (0-based) to use one as visual reference — especially during refinement.
If the user did not explicitly pick a draft, select the most recent one (index {{lastDraftIndex}}).

{{/if}}

## Clarify Budget
- Used: {{clarifyCount}} / {{maxClarify}}
{{#if clarifyBudgetExhausted}}
- **⚠️ BUDGET EXHAUSTED**: You MUST NOT route to `clarify`. Proceed with the best interpretation of the user's intent.
{{/if}}
