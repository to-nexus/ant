# Turn Context Detection

You are detecting the work context of the user's current message for the job "{{jobName}}": how much execution the message calls for{{#if needsIntentInference}}, and which of the job's declared intents it activates{{/if}}.

## Current Message

{{{userMessage}}}

{{#if recentTurns}}
## Recent User Turns (older → newer, for follow-up context only)

{{#each recentTurns}}
- {{{this}}}
{{/each}}
{{/if}}

## Workspace Artifacts (top-level, existence only)

Whether "existing artifacts must be observed first" can only be judged against what exists:

{{{artifactsOverview}}}

{{#if needsIntentInference}}
## Intent Catalog

Each row is one intent this job declares. The description is the matching criterion.

| id | description |
|---|---|
{{#each catalogRows}}
| {{{this.id}}} | {{{this.description}}} |
{{/each}}
{{/if}}
