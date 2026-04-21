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

## Intent Selection

| intentId | When to select |
|----------|---------------|
| `gen-visual-logo` | Brand mark, symbol, monogram, app icon as brand identity |
| `gen-visual-icon` | UI icon, action icon, status indicator, system icon |
| `gen-visual-hero` | Hero image, background, banner, cover, splash screen |
| `gen-visual-illustration` | Scene illustration, character art, diagram, infographic, decorative art, or any visual that does not match logo/icon/hero |
| `explain-visual` | Question, analysis, or consultation — the user wants information, not an image |

## ExecutionTier Classification

Emit a `<executionTier>N</executionTier>` tag BEFORE the `<classify>` block. `N` is a single digit `0`–`4`.

| Tier | Label | Principle |
|---|---|---|
| `0` | Reflex        | Read-only answer; no asset produced. `explain-visual` requests that can be answered without observing anything external fall here. |
| `1` | OneShot       | Single concrete asset, target known from the directive (most `logo` / `icon` / `hero` single-variant requests). |
| `2` | Exploratory   | Must observe the conversation history or prior assets before producing the new one. |
| `3` | Task          | Multiple independent assets driven by the directive alone (e.g. "generate 5 icons for the following actions"), without systematic grounding on brand reference refs. |
| `4` | RefsGrounded  | Multiple assets systematically grounded in brand reference documents or reference images supplied in this prompt. |

**Constraint**: The presence of reference images alone does NOT force Tier 4. Tier 4 applies when the generation is systematically derived from those references (brand refs → full icon set).

⚠️ **Blind spot**: Asset importance does NOT determine tier. A single hero image for a landing page is tier `1`; a sprite sheet of many icons derived from brand refs is tier `4`. Observe the count of independent deliverables and the grounding source, not the asset's visibility.

## Response

Respond with the `<executionTier>` tag first, then the `<classify>` block:

<executionTier>1</executionTier>

<classify>
{
  "assetType": "logo" or "icon" or "hero" or "illustration" or "general",
  "intentId": "gen-visual-logo" or "gen-visual-icon" or "gen-visual-hero" or "gen-visual-illustration" or "explain-visual",
  "jobMode": "generate" or "explain",
  "reasoning": "one sentence explaining the classification and mode decision"
}
</classify>
