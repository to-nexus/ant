# 33. Visual Tier System

The Visual Tier is a visual design policy system composed of 6 layers. It follows the same **Explicit vs Infer symmetry** structure as techTier.

## Part 1: System Design

### 6-Layer Structure

| # | Layer | Role | Decision Mechanism |
|---|-------|------|----------|
| 1 | `visualLanguage` | Overall identity, colors, fonts, unique visual effects (Signature) | User selection or Auto (infer) |
| 2 | `surfaceSystem` | Panel/container surface treatment (depth, borders, shadows, transparency) | User selection or Auto (infer) |
| 3 | `spatialSystem` | Spacing rhythm, density, base unit | Always Auto (decompose LLM infer) |
| 4 | `interactionGrammar` | Micro-interactions + macro presentation motion | Auto-derived (VL → IG) |
| 5 | `componentSemantics` | Component role bias (metric/action/content/utility) | Auto-derived (screenContext → CS) |
| 6 | `visualHierarchyRules` | Visual hierarchy rules (what is seen first) | Auto-derived (VL + SS → VH) |

### Explicit vs Infer Symmetry

Same rules as techTier:

- If `Basis.visualTier.<layer>` has a value, it is **explicit** — decompose uses the value as-is.
- If there is no value, it is **infer** — the decompose LLM fills it by observing the RAC pool: directive + refs + contextArtifacts + PRD, etc.

`spatialSystem` always takes the infer path because the user-selection path was removed from the wizard. For `visualLanguage` / `surfaceSystem`, choosing the Auto card in the wizard clears the explicit value and switches them to the infer path.

### Auto-Derivation Matrix

Pure functions defined in `visual-tier-registry.ts` determine the derived layers:

- **`deriveInteractionGrammar(visualLanguage)`**: `INTERACTION_GRAMMAR_MAP` lookup. 1:1 mapping from VL variant → IG variant.
- **`deriveVisualHierarchyRules(visualLanguage, spatialSystem)`**: `VH_MAP` lookup. `"VL|SS"` composite key → VH variant mapping.
- **`deriveComponentSemantics(screenContext)`**: `CS_KEYWORDS` regex matching. Returns the first matched variant.

These functions live in `@ant/shared` and are used on both the FE (badge display) and the BE (prompt building).

### The `resolveVisualTier()` Function

Merges the user selection (`userSelection`) with auto-detection (`autoDetected`), computes the derived layers, and returns a complete `VisualTier` object.

```
resolveVisualTier(userSelection?, autoDetected?, screenContext?) → Partial<VisualTier>
```

Precedence: `userSelection > autoDetected > derive > undefined`

### Runtime Deactivation Gate (Phase 1 — Tier Matrix SSOT)

Starting with Phase 1, the activation state of every tier (`techTier` / `visualTier` / `gameArtTier`) is decided by the single predicate `isTierActive(tier, slot, domain, runtime)` in [`@ant/shared/tier-matrix.ts`](../../packages/ant-shared/src/tier-matrix.ts). The old `isVisualTierActive` helper is retired (D9). The same rule applies at five sites: FE wizard / FE summary / BE code decompose / BE design decompose / BE PromptBuilder.buildBasisSection.

```
isTierActive('visualTier', slot, domain, runtime) ⇔
   slot.tiers?.includes('visualTier')
   AND TIER_DOMAIN_MATRIX.visualTier.includes(domain)   // ['service', 'game']
   AND techTier.stack !== 'backend'
   AND !hasUiDoc
```

| Axis | Closing condition | Meaning |
|---|---|---|
| slot | `slot.tiers` does not include `'visualTier'` | The intent does not opt in to the visual tier at all |
| matrix | (In Phase 1, visualTier is always true) | Update the `TIER_DOMAIN_MATRIX.visualTier` row when adding a new domain |
| stack | `techTier.stack === 'backend'` | Pure backend deliverable — no visual policy |
| uiDoc | `hasUiDoc === true` | **A UI design document is included in the RAC** — the document itself is the design system |

`BasisSlotConfig.tiers: ReadonlyArray<TierKey>` is the static gate, the matrix row is domain compatibility, and the runtime suppressors are the backend-stack / hasUiDoc checks — the activation state is decided by composing these three stages.

**Definition of `hasUiDoc` — "does the user-selected RAC contain a UI document?"**

The mere existence of a UI artifact on the filesystem is not sufficient. "The document is included in the RAC" means the user decided to put it into a ref or context slot. It is true if any of the three UiSources (`ant` / `figma` / `handoff`) is included.

- **FE** — `pathsContainUiDoc([...actionMetadata.refs, ...actionMetadata.context])` (`@ant/shared/canonical.ts`).
- **BE** — `ArtifactPoolView.hasUi()` makes the same determination over the post-RAC pool (`ArtifactPipeline.ts`).

Why the gate closes when a UI document is present: a UI design document (ant/figma/handoff) is itself the **design system authority**. Injecting a visual tier prompt in parallel would be redundant and potentially conflicting. The FE may keep showing the user's preset value on screen, but the BE decompose clears `resolvedAction.basis.visualTier` to `undefined` as soon as a UI doc is detected, so downstream prompts cannot reference a stale preset.

### Authority Hierarchy

Precedence of visual policy in prompts:

1. **UI artifacts** (concrete directions from the design document) — highest priority. When present, they are the basis for closing the Visual Tier gate.
2. **VL tokens** (concrete values in Palette, Typography)
3. **VL principles** (directional guidance in Identity, Signature)
4. **Framework defaults** — lowest priority

### The `designSystem` Slot

`VisualTier.designSystem` is a separate slot for specifying an external design system (shadcn, Ant Design, etc.). It operates independently of the 6-layer system, and design-system templates live under the `basis/visualTier/design-system/{name}` path.

### `supportedModes`

The `BasisOption.supportedModes` field indicates the color modes a VL variant supports:
- `'light'`: Light Mode only
- `'dark'`: Dark Mode only
- `'both'`: Supports both Light + Dark

A VL template's Palette section includes only the subsections for the modes indicated by `supportedModes`.

---

## Part 2: Template Authoring Principles (Common to All Layers)

Rules that must be followed when authoring templates for any Visual Tier layer.

### FPOP Compliance Principles

- Tokens (color values, font names, radius values) are **specification data**, not examples.
- Never describe **how to apply** a token (the How). That is territory the LLM already knows.
- State constraints as "do NOT" — not as "do".

### Role Boundaries Between Layers

Each layer template **describes only its own role**. It must not encroach on other layers' territory.

| Layer | Jurisdiction | Must not encroach on |
|-------|------|----------|
| visualLanguage | Identity, colors, fonts, unique visual effects | hover effects, panel depth, spacing values |
| surfaceSystem | Panel/container surface treatment | color tokens, interactions |
| spatialSystem | Spacing rhythm, density | surface treatment, colors |
| interactionGrammar | Micro + macro motion | colors, layout, surfaces |
| componentSemantics | Component role bias | concrete styling values |
| visualHierarchyRules | Visual hierarchy rules | concrete styling values |

### Common Structural Rules

- Every layer template starts with a `## {Layer}: {Variant}` heading
- Constraint statements start with the `Constraint:` prefix (parseable)
- Maximum 60 lines per template (prompt token efficiency)
- English only (FPOP: Universal over Specific — visual tier templates are activated cross-DS and therefore fall on the always-on axis, so the SBS gated-specifics obligation does not apply)

---

## Part 3: Visual Language Template Authoring Rules

Additional rules that apply only to the VL layer.

### 5 Required Sections (Fixed Order)

1. **`### Identity`** — 1-2 sentences. This style's core philosophy and recognition points.
2. **`### Palette`** — oklch color-space tokens. Light/Dark subsections per `supportedModes`.
3. **`### Typography`** — Google Fonts CDN only. The 3 tokens `--font-heading`, `--font-body`, `--font-mono` are required. 1-2 sentences of typographic character.
4. **`### Signature`** — 2-4 items of visual DNA unique to this VL. Only things no other layer covers.
5. **`### Constraints`** — 3-5 prohibitions.

### Required Palette Tokens

`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--accent`, `--muted`, `--muted-foreground`, `--destructive`, `--border`, `--radius`

### Signature Authoring Rules

- Describe only WHAT (which effect), never HOW (concrete CSS properties)
- Do not encroach on other layers' territory (hover effects, panel depth, spacing values)

### supportedModes Rules

- `light`: Light Mode tokens only. No Dark Mode subsection.
- `dark`: Dark Mode tokens only. No Light Mode subsection.
- `both`: Both Light + Dark subsections are required.

### Font Rules

- Use only fonts loadable from the Google Fonts CDN
- System fonts (SF Pro, Segoe UI, etc.) are prohibited
- npm-package-only fonts (Geist, etc.) are prohibited
- Specify font names only. For weight/line-height, give direction only via the Typography character sentence

---

## Part 4: Non-VL Layer Template Authoring Rules

Applies to surfaceSystem, spatialSystem, interactionGrammar, componentSemantics, visualHierarchyRules.

### Common Structure

- `## {Layer}: {Variant}` heading
- 1 sentence of description
- Items listed per concern using the `**Bold Label**:` pattern
- 2-3 constraints with the `Constraint:` prefix
- Principle-based (direction/constraints instead of concrete values). No tokens.

### Additional interactionGrammar Rules

- 2 required sections: `### Micro-interaction` + `### Presentation Motion`
- Micro: Hover, Focus, Active, Loading, Empty, Error states
- Macro: Page entrance, Section reveal, Parallax, Hero staging, Duration/stagger
- Must include `Constraint: All motion MUST respect prefers-reduced-motion.`

---

## Prompt Loading Order

In `PromptBuilder.buildBasisSection()`, Visual Tier templates are loaded in this order:

1. `_preamble.md` (common preamble)
2. `visualLanguage/_token-rules.md` (token constraint rules)
3. Per-layer variant templates (in `VISUAL_TIER_LAYER_KEYS` order)
4. Job-specific preamble (if any)

---

## File Structure

```
packages/ant-shared/src/
├── rac.ts                        # Type definitions (6 variant types + VisualTier interface)
├── visual-tier-registry.ts       # Registry (variants, options, derive functions, template paths)
└── tech-tier-registry.ts         # BasisOption interface

packages/ant-cli/src/core/prompt/
├── builder/PromptBuilder.ts      # Visual Tier template loading
└── templates/basis/visualTier/
    ├── _preamble.md
    ├── visualLanguage/
    │   ├── _token-rules.md       # Shared token constraint partial
    │   ├── cleanBright.md        # 14 VL variants
    │   └── ...
    ├── surfaceSystem/
    ├── spatialSystem/
    ├── interactionGrammar/
    │   ├── restrained.md
    │   ├── subtleProduct.md
    │   ├── calmPremium.md
    │   ├── expressivePlayful.md
    │   ├── cinematicReveal.md
    │   └── rawInstant.md
    ├── componentSemantics/
    └── visualHierarchyRules/

packages/ant-ui/src/presentation/components/Actions/basis/
├── BasisSummaryBar.tsx           # Per-layer badge display (Explicit=selected value, Infer=Auto)
├── BasisWizard.tsx               # Wizard shell (2 steps: VL/surface; spatial is always Auto)
├── DecidedLayersBreadcrumb.tsx   # interactionGrammar pill display (VHR exists only after decompose)
└── useBasisWizard.ts             # State management + hasVisualTier runtime gate
```
