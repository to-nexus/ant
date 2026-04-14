# 32. Action Activation Policy

## Design Principles

1. **canBuild implies canStartChat** — Build이 가능하면 Chat도 반드시 가능.
2. **Build requires refs/codebase (primary)** — context(보조 참고)만으로는 Build 불가. 프롬프트 주입에서 ref = "implementation source", context = "understanding only"이므로 Build의 근거는 refs여야 한다.
3. **Directive 필수 intents → buildDisabled** — directive 없이 의미 있는 산출물이 불가한 intent는 `buildDisabled: true`. 두 가지 경우: (a) real refs 없이 사용자 지시로만 진행 (gen-visual-*, gen-code-directive), (b) refs가 수정 대상일 뿐 생성 근거가 아닌 경우 (rev-plan/sys/ui/spec — 수정 방향은 directive가 제공해야 함).

## 2-Layer Activation System

### Layer 1 — System Rules (slot 구조에서 자동 도출)

| Rule | Condition | Effect |
|------|-----------|--------|
| Default chat gate | `chatRequiresRefs` 미선언 | `chatNeedsRefs = buildNeedsRefs` |
| Build disabled | `buildDisabled: true` | `canBuild = false` 항상 |
| Chat-only + no refs | `target.kind = 'chat-only'` AND `hasRealRefSlots = false` | `canBuild = false` 항상 |
| Revise target | `target.kind = 'revise'` | chat/build 모두 target 선택 필요 |
| Real ref slots | `hasRealRefSlots = true` AND `buildRequiresRefs ≠ false` | build에 refs 선택 필요 |

### Layer 2 — Override Flags (intent별 선언)

| Flag | Effect |
|------|--------|
| `chatRequiresRefs: false` | refs 없이 chat 가능 (directive-capable: gen-plan, gen-ui-desc, gen-spec) |
| `buildRequiresRefs: false` | real ref slots 있어도 refs 없이 build 가능 |
| `buildRequiresContext: true` | context 선택 필수 (현재 사용하는 intent 없음, 확장용) |
| `buildDisabled: true` | build 항상 불가 (gen-visual-*, gen-code-directive, rev-plan/sys/ui/spec) |

### Derive Functions

- `deriveChatNeedsRefs(slots)`: `chatRequiresRefs` 오버라이드 우선. 없으면 `deriveBuildNeedsRefs(slots)`.
- `deriveBuildNeedsRefs(slots)`: `buildRequiresRefs: false`이면 false. 아니면 `hasRealRefSlots(slots)`.
- `hasRealRefSlots(slots)`: refs 중 non-empty, non-directive(emptyHint 없음) 슬롯 존재 여부.

## Resolved Matrix (30 intents)

### Plan

| Intent | Chat | Build |
|--------|------|-------|
| gen-plan | 무조건 | refs |
| rev-plan | target | 불가 |
| explain-plan | refs | refs |

### System Design

| Intent | Chat | Build |
|--------|------|-------|
| gen-sys-fe | refs | refs |
| gen-sys-be | refs | refs |
| gen-sys-full | refs | refs |
| rev-sys | target | 불가 |
| explain-sys | refs | refs |

### UI Design

| Intent | Chat | Build |
|--------|------|-------|
| gen-ui-figma | refs | refs |
| gen-ui-ref | refs | refs |
| gen-ui-desc | 무조건 | refs |
| rev-ui | target | 불가 |
| explain-ui | refs | refs |

### Spec

| Intent | Chat | Build |
|--------|------|-------|
| gen-spec | 무조건 | refs |
| rev-spec | target | 불가 |
| explain-spec | refs | refs |

### Code

| Intent | Chat | Build |
|--------|------|-------|
| gen-code-sys | refs | refs |
| gen-code-spec | refs | refs |
| gen-code-directive | 무조건 | 불가 |
| rev-code | codebase | codebase + refs |
| explain-code | codebase | codebase |

### Visual

| Intent | Chat | Build |
|--------|------|-------|
| gen-visual-logo | 무조건 | 불가 |
| gen-visual-icon | 무조건 | 불가 |
| gen-visual-hero | 무조건 | 불가 |
| gen-visual-illustration | 무조건 | 불가 |
| explain-visual | refs | refs |

### Learn

| Intent | Chat | Build |
|--------|------|-------|
| gen-learn | codebase | codebase |

### Ask

| Intent | Chat | Build |
|--------|------|-------|
| ask-evaluate | 무조건 | 불가 |
| ask-ant | 무조건 | 불가 |
| ask-general | 무조건 | 불가 |

## Key Patterns

- **"무조건" Chat**: `chatRequiresRefs: false`이거나 real refs 자체가 없는 intent. 사용자가 refs 선택 없이 바로 채팅 가능.
- **"refs" Chat/Build**: `hasRealRefSlots = true`이고 오버라이드 없음. 주요 참고 문서를 선택해야 활성화.
- **"불가" Build**: `buildDisabled: true`이거나 chat-only target + no real refs. Build 버튼 비활성. revise intent는 수정 방향을 directive로 받아야 하므로 항상 불가.
- **"codebase"**: locked codebase ref. codebase가 비어있으면 chat/build 모두 불가.
