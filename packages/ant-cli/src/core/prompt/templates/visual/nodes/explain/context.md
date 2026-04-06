## Conversation History
{{{conversationContext}}}

## Current Question
{{{currentDirective}}}

{{#if lastEngineeredPrompt}}

## Previous Generation Context

The most recent generation used this prompt:
{{{lastEngineeredPrompt}}}

{{/if}}

{{#if sketchVariationList}}

## Sketch Variations

The following sketch candidates were generated:
{{#each sketchVariationList}}
- Sketch {{this.number}}: {{this.label}} — `{{this.prompt}}`
{{/each}}

{{/if}}

{{#if lastOutputPath}}

## Finalized Asset

A final rendered image exists at: `{{{lastOutputPath}}}`

{{/if}}

{{#if availableSketchCount}}

## Available Sketches

{{availableSketchCount}} sketch image(s) from previous round(s) are available.

{{/if}}
