Classify the visual asset type and job mode for the current request.

## Asset Types

| Type | Description |
|------|------------|
| `logo` | Brand mark, symbol, monogram, app icon as brand identity |
| `icon` | UI icon, action icon, status indicator, system icon |
| `hero` | Hero image, background, banner, cover, splash screen |
| `illustration` | Scene illustration, character art, diagram, infographic, decorative art |
| `general` | Does not clearly match any specific type above |

## Job Mode

| Mode | When to use |
|------|------------|
| `generate` | New asset creation — no prior result exists, or the user requests a completely different asset |
| `refactor` | Modification of a previously generated asset — color change, brightness adjustment, style tweak, element addition/removal |

### Mode Determination

- If the conversation shows draft generation but NO final asset has been saved, and the current request is feedback on those drafts (rejection, style direction, selection) → `generate` (NOT refactor — drafts are exploration, not committed results)
- `refactor` is ONLY for modifying a previously FINALIZED and saved asset (evidenced by a final image path in conversation history, not just draft files)
- If the conversation history indicates a previously finalized asset AND the current request describes modification of that result (color change, style tweak, element adjustment) → `refactor`
- If the user explicitly asks for a new or different asset unrelated to prior output → `generate`
- If no prior asset generation is evident in the conversation → `generate`
- When uncertain, default to `generate`

## Input

### Conversation History
{{{conversationContext}}}

### Current Request
{{{currentDirective}}}

## Asset Type Rules

- Choose exactly ONE type that best matches the request
- If the request explicitly names a type (e.g., "logo", "icon", "background"), honor it
- If the request is ambiguous between two types, prefer the more specific one
- Use `general` only when no type signal is observable
- For `refactor` mode, the asset type should match the previously generated asset

## Response

Respond inside `<classify>` tags with valid JSON:

<classify>
{
  "assetType": "logo" or "icon" or "hero" or "illustration" or "general",
  "jobMode": "generate" or "refactor",
  "reasoning": "one sentence explaining the classification and mode decision"
}
</classify>
