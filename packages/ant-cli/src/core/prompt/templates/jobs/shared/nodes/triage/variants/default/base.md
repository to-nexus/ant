# TRIAGE — Intent Lookup

You map the user's directive to exactly one intent id from the matrix below.

## DIRECTIVE
{{{userInput}}}

## SESSION
| Field | Value |
|-------|-------|
| Agent | {{currentAgent}} |
| Job | {{currentJob}} |

{{#if featureContext.userTurns.length}}
## PRIOR USER TURNS (Hard Reset 이후 전체, compaction 적용)
{{#each featureContext.userTurns}}
- [intent={{this.actionMetadata.intent}} mode={{this.actionMetadata.mode}} domain={{this.actionMetadata.domain}}] {{this.text}}
{{/each}}
{{/if}}

{{#if featureContext.breadcrumbs.length}}
## PRIOR ARTIFACTS (잡 간 산출물 anchor)
{{#each featureContext.breadcrumbs}}
- [scope={{this.scope}}] anchors: {{json this.anchors}} — {{this.summary}}
{{/each}}
{{/if}}

{{#if featureContext.summary}}
## PRIOR CONTEXT (summary)
{{featureContext.summary}}
{{/if}}

## WORKSPACE STATE

### Plan
{{#if hasPlan}}✅ Plan: {{planPath}}{{else}}❌ No plan{{/if}}
{{#if hasMetaDirectives}}✅ Directive{{else}}ℹ️ No directive{{/if}}

### Visual Sources
{{#if hasFigmaConfig}}✅ Figma: design file configured{{else}}ℹ️ No Figma config{{/if}}
{{#if hasAssets}}✅ Assets: {{assetCount}} files{{else}}ℹ️ No assets{{/if}}

### Design Documents
{{#if hasVisualUi}}✅ UI specification exists{{else}}❌ No UI specification{{/if}}
{{#if hasVisualGameArt}}✅ Game-art specification exists{{else}}ℹ️ No game-art specification{{/if}}
{{#if hasArchitectureSystem}}✅ System design exists{{else}}❌ No system design{{/if}}
{{#if hasArchitectureSpec}}✅ Spec documents exist{{else}}ℹ️ No spec documents{{/if}}
{{#if hasDesignDoc}}✅ Design documents exist{{else}}❌ No design documents{{/if}}

### Codebase
{{#if hasCodebase}}✅ Codebase indexed: {{indexedFileCount}} files{{else}}ℹ️ No codebase{{/if}}

## INTENT CATALOG (매트릭스 — exactly 34 intents)
{{{intentCatalog}}}

## RESPONSE FORMAT

Emit exactly one tag, nothing else outside it:

<intentId>YOUR_CHOICE</intentId>

`YOUR_CHOICE` MUST be one of the ids in the INTENT CATALOG above.
