# 32. Action Activation Policy

## Design Principles

1. **canBuild implies canStartChat** — if Build is possible, Chat must also be possible.
2. **Build requires refs/codebase (primary)** — context (supplementary reference) alone cannot enable Build. In prompt injection, ref = "implementation source" and context = "understanding only", so the basis for Build must be refs.
3. **Directive-required intents → buildDisabled** — intents that cannot produce meaningful output without a directive are `buildDisabled: true`. Two cases: (a) proceeding on user instruction alone without real refs (gen-visual-*, gen-code-directive), (b) refs are merely the revision target, not the generation basis (rev-plan/sys/ui/spec — the revision direction must come from the directive).

## 2-Layer Activation System

### Layer 1 — System Rules (derived automatically from slot structure)

| Rule | Condition | Effect |
|------|-----------|--------|
| Default chat gate | `chatRequiresRefs` not declared | `chatNeedsRefs = buildNeedsRefs` |
| Build disabled | `buildDisabled: true` | `canBuild = false` always |
| Chat-only + no refs | `target.kind = 'chat-only'` AND `hasRealRefSlots = false` | `canBuild = false` always |
| Revise target | `target.kind = 'revise'` | both chat/build require target selection |
| Real ref slots | `hasRealRefSlots = true` AND `buildRequiresRefs ≠ false` | build requires refs selection |

### Layer 2 — Override Flags (declared per intent)

| Flag | Effect |
|------|--------|
| `chatRequiresRefs: false` | chat possible without refs (directive-capable: gen-plan, gen-ui-desc, gen-spec) |
| `buildRequiresRefs: false` | build possible without refs even when real ref slots exist |
| `buildRequiresContext: true` | context selection required (no intent uses this today; reserved for extension) |
| `buildDisabled: true` | build never possible (gen-visual-*, gen-code-directive, rev-plan/sys/ui/spec) |

### Derive Functions

- `deriveChatNeedsRefs(slots)`: the `chatRequiresRefs` override takes precedence. Otherwise `deriveBuildNeedsRefs(slots)`.
- `deriveBuildNeedsRefs(slots)`: false if `buildRequiresRefs: false`. Otherwise `hasRealRefSlots(slots)`.
- `hasRealRefSlots(slots)`: whether a non-empty, non-directive (no emptyHint) slot exists among refs.

## Resolved Matrix (30 intents)

### Plan

| Intent | Chat | Build |
|--------|------|-------|
| gen-plan | always | refs |
| rev-plan | target | disabled |
| explain-plan | refs | refs |

### System Design

| Intent | Chat | Build |
|--------|------|-------|
| gen-sys-fe | refs | refs |
| gen-sys-be | refs | refs |
| gen-sys-full | refs | refs |
| rev-sys | target | disabled |
| explain-sys | refs | refs |

### UI Design

| Intent | Chat | Build |
|--------|------|-------|
| gen-ui-figma | refs | refs |
| gen-ui-desc | always | refs |
| rev-ui | target | disabled |
| explain-ui | refs | refs |

### Spec

| Intent | Chat | Build |
|--------|------|-------|
| gen-spec | always | refs |
| rev-spec | target | disabled |
| explain-spec | refs | refs |

### Code

| Intent | Chat | Build |
|--------|------|-------|
| gen-code-sys | refs | refs |
| gen-code-spec | refs | refs |
| gen-code-directive | always | disabled |
| explain-code | codebase | codebase |

### Visual

| Intent | Chat | Build |
|--------|------|-------|
| gen-visual-logo | always | disabled |
| gen-visual-icon | always | disabled |
| gen-visual-hero | always | disabled |
| gen-visual-illustration | always | disabled |
| explain-visual | refs | refs |

### Learn

| Intent | Chat | Build |
|--------|------|-------|
| gen-learn | codebase | codebase |

### Ask

| Intent | Chat | Build |
|--------|------|-------|
| ask-evaluate | always | disabled |
| ask-ant | always | disabled |
| ask-general | always | disabled |

## Key Patterns

- **"always" Chat**: intents with `chatRequiresRefs: false` or with no real refs at all. The user can chat immediately without selecting refs.
- **"refs" Chat/Build**: `hasRealRefSlots = true` with no override. Activated only after the primary reference documents are selected.
- **"disabled" Build**: `buildDisabled: true` or chat-only target + no real refs. The Build button is inactive. Revise intents must receive the revision direction as a directive, so they are always disabled.
- **"codebase"**: locked codebase ref. If the codebase is empty, both chat and build are disabled.
