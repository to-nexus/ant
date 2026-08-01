# Visual Job (Creator Agent)

## Overview

The Visual Job is the Creator agent's first job type. It uses an AI image generation model (Gemini Nano Banana) to produce the visual assets a project needs. The Creator agent is responsible for asset production in general (visual, audible, animation, etc.), and the visual job covers the image/SVG area within that. It supports Progressive Refinement through a conversational workflow.

## What Users Can Do

| Capability | Description |
|------|------|
| Image generation | Generate image assets in PNG, WebP, or JPEG format |
| SVG code generation | Generate simple shapes, icons, etc. as SVG code |
| Sketch exploration | Generate multiple candidates, compare/select, then render at high quality |
| Direct rendering | Clear requests skip the sketch stage and go straight to the final image |
| Conversational iteration | Request further edits/regeneration based on previous results |

## Workflow

```
__start__ → resolve → triage → classify → direct → (conditional)
                         │                   │
                         │     ┌─────────────┼─────────────┬──────────────┬──────────────┐
                         │     ▼             ▼             ▼              ▼              ▼
                         │   sketch        render        engrave       explain        __end__
                         │     │             │             │              │          (clarify/end)
                         │     ▼             ▼             ▼              ▼
                         │   deliver       deliver       deliver       __end__
                         │     │             │             │
                         │     ▼             ▼             ▼
                         │   __end__       __end__       __end__
                         │
                         └── explain (mode=explain, classify branch) → __end__

Safety blocked (sketch/render) → loop back to direct (no classify re-run needed)
```

## Node Roles

| Node | Model | Role |
|------|------|------|
| resolve | - | Load session, restore conversation |
| triage | gemini-3-flash-preview | Intent classification (shared node) |
| classify | deps.llm (Flash) | Asset type classification → VisualAssetType (logo/icon/hero/illustration/general), mode=explain branch |
| direct | deps.directLLM (Pro) | Art direction: injects assetType-based guides, prompt engineering, routing decision |
| sketch | gemini-3.1-flash-image-preview | Generate sketch candidate images (fast and cheap) |
| render | gemini-3-pro-image-preview | Final high-quality image rendering |
| engrave | gemini-3.1-pro-preview | SVG code generation (text model) |
| explain | deps.explainLLM | Asset explanation/analysis (conversational reply without image generation) |
| deliver | - | Save files, generate thumbnails, chat notification, reset state |

## Direct Node Routing

The direct node (the art director) analyzes the request and routes to one of the following:

| Route | Condition | Description |
|-------|------|------|
| `sketch` | Complex/creative request | Generate N candidates with the Flash model |
| `render` | Clear request | Generate the final image directly with the Pro model |
| `engrave` | Simple shape/icon SVG request | Generate SVG code with the text model |
| `clarify` | Subject is unclear | Ask a question and end (restart on the next turn) |
| `end` | Not a visual generation request | End |

> If the classify node determines `mode=explain`, the flow goes straight to the explain node, bypassing direct.

## LLM Model Strategy

| Role | Model | Purpose |
|------|------|------|
| Logic (Opus-class) | gemini-3.1-pro-preview | Complex reasoning, prompt engineering |
| Logic (Sonnet-class) | gemini-3-flash-preview | Fast processing, triage decisions |
| Visual (Pro-class) | gemini-3-pro-image-preview | Highest-quality image rendering |
| Visual (Mainstream) | gemini-3.1-flash-image-preview | High-speed draft generation |

All nodes in the visual job use Gemini models exclusively.

## Format Decision Matrix

| Use case | Format |
|------|------|
| Transparency required (logos, icons, UI elements) | PNG |
| Hero images, backgrounds | WebP |
| Reference use, drafts | JPEG |
| Simple shapes, icons | SVG |

If the user explicitly specifies a format, the matrix is ignored.

## Error Handling

| Error | Handling |
|------|------|
| Safety filter block | `safetyBlocked=true` → loop back to direct, prompting a prompt revision |
| Image generation failure | Record `visualError` → direct informs the user |
| LLM JSON parse failure | Recover via the clarify path in direct |
| Whole-graph failure | throw → handled by the orchestrator |

## Output

### Save Locations

| Kind | Path |
|------|------|
| Final image | `{featurePath}/assets/gen/gen-{timestamp}.{ext}` |
| Thumbnail | `{featurePath}/assets/gen/gen-{timestamp}-thumb.jpeg` |
| Sketch image | `{featurePath}/assets/gen/sketches/sketch-{timestamp}-{index}.{ext}` |
| SVG | `{featurePath}/assets/gen/gen-{timestamp}.svg` |

### Chat Notifications

| Situation | Mechanism | UI Component |
|------|------|-------------|
| Final image/SVG saved | `showChatStatus('downloaded', ...)` | WorkingCard (image preview) |
| Sketch candidates generated | `sendClarifyCards([{options: ImageOption[], allowRegenerate}])` → `choice_card(clarifying)` | ChoiceCard > ClarifyingVariant |

#### Sketch Selection UI

When the sketch node generates multiple sketches, the deliver node generates a thumbnail for each sketch and sends a `choice_card(clarifying)` state. Sketch selection is integrated as the image-option extension of the Clarify system.

```
deliver → generate sharp thumbnails → chatAPI.sendClarifyCards([{options: ImageOption[]}])
  → SSE → ChoiceCard(variant='clarifying')
    → SketchRow × N (vertical list, each row with thumbnail + "Select" button)
    → thumbnail click → DraftLightbox (left/right arrow navigation + "Select Sketch N" button)
    → on selection: runJob(directive="[SKETCH_FINALIZE:N]")
    → free-form input: runJob(directive="[SKETCH_FEEDBACK] user text")
    → regenerate: runJob(directive="[SKETCH_REGENERATE]")
```

Sketch save paths:
- Original: `sketches/sketch-{ts}-{index}.{ext}`
- Thumbnail: `sketches/sketch-{ts}-{index}-thumb.jpeg`

The lightbox uses `BaseLightbox` as a shared base, split into the existing `ImageLightbox` for Figma screenshots and `DraftLightbox` for drafts.

## Context Management

| Persistent | Transient (cleared after deliver) |
|------|------------------------|
| `conversation` (dialogue history) | `sketchImages` |
| `directive` | `svgSketches` |
| `tokenUsage` | `engineeredPrompt` |
| | `finalImage`, `selectedSketchIndex` |
| | `routeDecision`, `needsSketches`, `isSvgRequest` |

When the deliver node completes, it resets the transient state and appends a `ConversationEntry` (role='system') chapter marker to the conversation. `ConversationEntry` uses the same unified type as Plan (`core/types/session.ts`) and records the asset path and summary in the `savedAsset` and `chapterSummary` metadata.

## Session

Saved to `{featurePath}/sessions/creator/visual.json`. The `conversation` array is the core state; on interruption/resume, the conversation context is restored. The `compactJob` LLM summarization result is applied via `applyCompactionToConversation` when the session is saved, preventing unbounded conversation growth.

## Prompt System

The visual job uses the direct `promptPort.render()` call pattern rather than the PromptEngine 6-phase pipeline. All prompts are managed as Handlebars templates; no prompt strings are hardcoded in TypeScript source code.

### Template Structure

```
core/prompt/templates/
├── agents/creator/
│   ├── base.md                        # Creator agent shared identity
│   └── rules.md                       # Creator agent shared rules
└── visual/
    └── nodes/
        ├── direct/
        │   ├── base.md                # System prompt (art direction, 2nd call)
        │   ├── rules.md               # Routing/format/conditional asset guide/response rules
        │   ├── context.md             # User prompt (dialogue history, current request, errors)
        │   └── classify.md            # Asset type classification prompt (1st call)
        └── engrave/
            ├── base.md                # System prompt (SVG generation)
            └── rules.md               # SVG code rules
```

### Prompt Assembly Flow

**Classify node** (separate LangGraph node, uses deps.llm):

```
classify.md → { conversationContext, currentDirective }
→ LLM response: <classify>{ "assetType": "logo", "reasoning": "..." }</classify>
→ classifyParser.ts → state.assetType (VisualAssetType)
```

- Same normalized-response pattern as the code job's `detect` node
- Falls back to `'general'` on failure

**Direct node** (separate LangGraph node, uses deps.directLLM):

```
base.md → { isLogo, isIcon, isHero, isIllustration } (derived from state.assetType)
  ├── agents/creator/base (partial)
  ├── agents/creator/rules (partial)
  └── visual/nodes/direct/rules (partial, conditional asset guides)
context.md → { conversationContext, currentDirective, safetyBlocked, ... }
```

- Reads `state.assetType` and selectively injects only that type's guide via Handlebars `{{#if}}` blocks
- `rules.md` embeds logo/icon/hero/illustration guides conditionally; for `general`, only the 4-axis methodology operates, without any guide

**Engrave node**:
- System prompt: `visual/nodes/engrave/base.md` → internally includes the `visual/nodes/engrave/rules` partial

## File Structure

```
packages/ant-cli/src/agents/creator/
├── index.ts                          # Creator agent entry point
└── graph/visual/
    ├── graph.ts                      # LangGraph definition, runVisualGraph
    ├── types.ts                      # VisualGraphState, SketchImage, SvgSketch, VisualAssetType
    └── nodes/
        ├── resolve.ts                # Load session, restore conversation
        ├── classify.ts               # Asset type classification node (deps.llm)
        ├── classifyParser.ts         # Asset type classification response parser
        ├── direct.ts                 # Art direction (deps.directLLM, reads state.assetType)
        ├── sketch.ts                 # Draft candidate generation (Flash model)
        ├── render.ts                 # Final high-quality rendering (Pro model)
        ├── engrave.ts                # SVG code generation (uses promptPort.render)
        ├── explain.ts                # Asset explanation/analysis (text-only response)
        └── deliver.ts                # File save, thumbnails, notifications, state reset
```

## Boundaries

- Visual Processor (background-removal sidecar): [27-visual-processor.md](27-visual-processor.md)
- Agent architecture: [11-agent-architecture.md](11-agent-architecture.md)
- Job lifecycle: [10-job-lifecycle.md](10-job-lifecycle.md)
- Triage routing: [12-triage-routing.md](12-triage-routing.md)
- Prompt system: [13-prompt-system.md](13-prompt-system.md)
- Chat system: [31-chat-system.md](31-chat-system.md)
