# Intent Classification

You are classifying the user's current message for the job "{{jobName}}".

## Current Message

{{{userMessage}}}

{{#if recentTurns}}
## Recent User Turns (older → newer, for follow-up context only)

{{#each recentTurns}}
- {{{this}}}
{{/each}}
{{/if}}

## Intent Catalog

Each row is one intent this job declares. The description is the matching criterion.

| id | description |
|---|---|
{{#each catalogRows}}
| {{{this.id}}} | {{{this.description}}} |
{{/each}}
