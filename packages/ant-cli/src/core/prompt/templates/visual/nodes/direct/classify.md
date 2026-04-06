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
| `generate` | Asset creation or modification — the user wants to produce or refine a visual output |
| `explain` | Question, analysis, or consultation — the user wants information, not an image |

### Mode Determination

- Observe the **expected output**: does the user want a visual asset produced, or a text response?
- Any request whose outcome is an image or asset (new, modified, refined, regenerated) → `generate`
- Any request whose outcome is information, advice, analysis, or consultation about visual design → `explain`
- This includes general visual knowledge questions with no existing work context
- If the user explicitly asks for a new or different asset unrelated to prior output → `generate`
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

## Response

Respond inside `<classify>` tags with valid JSON:

<classify>
{
  "assetType": "logo" or "icon" or "hero" or "illustration" or "general",
  "jobMode": "generate" or "explain",
  "reasoning": "one sentence explaining the classification and mode decision"
}
</classify>
