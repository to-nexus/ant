## Conversation History
{{{conversationContext}}}

## Current Request
{{{currentDirective}}}

{{#if lastEngineeredPrompt}}

## Previous Generation

The following prompt was used in the most recent generation:

{{{lastEngineeredPrompt}}}

{{/if}}

{{#if sketchVariationList}}

## Sketch Variations

{{availableSketchCount}} sketch candidate(s) were generated from the base prompt above, each with a unique variation suffix:
{{#each sketchVariationList}}
- Sketch {{this.number}}: {{this.label}} — `{{this.prompt}}`
{{/each}}

{{/if}}

{{#if lastOutputPath}}

## Finalized Asset

A final rendered image exists at `{{{lastOutputPath}}}`. The render node can automatically use this as the visual reference for img2img refinement.

{{/if}}

{{#if safetyBlocked}}

## Safety Filter Alert

The previous generation prompt was **BLOCKED** by the image model's safety filter.

You MUST:
1. Identify which element likely triggered the block
2. Rewrite the prompt to avoid the trigger while preserving the user's core intent
3. In your `reasoning`, explain what was changed and why

Do NOT retry with the same or minimally modified prompt.

{{/if}}

{{#if visualError}}

## Previous Attempt Error

{{{visualError}}}

Adjust your prompt or routing strategy to avoid repeating this failure. If the error suggests a model limitation, consider an alternative route.

{{/if}}

## Settings
- Default aspect ratio: {{defaultAspectRatio}}
- Max candidates per round: {{candidateCount}}

{{#if availableSketchCount}}

## Available Sketches

{{availableSketchCount}} sketch image(s) from previous round(s) are available. You can inspect them visually via the provided tools to inform your prompt decisions.

{{/if}}

## Clarify Budget
- Used: {{clarifyCount}} / {{maxClarify}}
{{#if clarifyBudgetExhausted}}
- **BUDGET EXHAUSTED**: You MUST NOT route to `clarify`. Proceed with the best interpretation of the user's intent.
{{/if}}
