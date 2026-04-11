# Actions Panel Session Context

## 이 문서의 목적

이전 세션에서 수행한 ActionsPanel 재설계 작업의 전체 맥락을 요약한다. 새 탭에서 이 문서를 참조하면 기존 작업을 이해하고 후속 작업을 진행할 수 있다.

---

## 수행된 작업 (커밋 5개)

### 커밋 1-3: ActionMetadata 파이프라인 기초 (이전 세션)
- `@ant/shared/actions.ts`: ActionMetadata, INTENT_DEFINITIONS, deriveFromIntent
- API → worker → orchestrator → agent state로 actionMetadata 관통
- triage bypass, resolve/detect 분기

### 커밋 4: `e0a5d33f` — ActionsPanel 전면 재설계
- **action-config-matrix.ts** 신규: (intent, basis) → (refs, context, target) 선언적 매트릭스
- **ActionDefinition을 Intent Group으로 재정의**: jobType/agent/hasSubModes 제거
- **Explicit pipeline**: @explicit badge, useActionFooterPolicy, 양방향 badge-panel 계단식 동기화
- **ActionConfigView 전면 재작성**: 매트릭스 기반 동적 refs/context/target
- **ActionStepHeader 공통 컴포넌트**, CSS Grid 카드 높이 통일
- revise-plan, refactor-code intent 추가

### 커밋 5: `dcae5202` — 패턴 수정 및 동기화 강화
- 모든 revise intent: basis=directive only, buildRequiresContext
- agent/job 동기화를 selectIntent/updateActionMetadata에 단일화
- 양방향 ref/context 상호 배제
- formatExpectedFile 유틸, isPattern 플래그
- directive basis면 BUILD 비활성화
- basis-guidance 프롬프트 (spec, design-doc 추가)

---

## 현재 아키텍처

### 핵심 모듈

| 파일 | 역할 |
|------|------|
| `@ant/shared/action-config-matrix.ts` | (intent, basis) → ConfigSlots 매트릭스. getConfigSlots, getAvailableBases, formatExpectedFile |
| `@ant/shared/actions.ts` | ActionDefinition (Intent Group), INTENT_DEFINITIONS, deriveFromIntent, ActionMetadata, Basis 타입 |
| `useActionFooterPolicy.ts` | 채팅으로시작/BUILD 버튼 정책. 매트릭스 기반 refs/target/context 검증 |
| `ActionConfigView.tsx` | Config 화면. 매트릭스 → SlotEntryList (refs/context) + TargetDisplay (target) |
| `ActionMetadataBadges.tsx` | 채팅 입력 위 badge 렌더링 + 계단식 제거 |
| `ActionStepHeader.tsx` | 공통 뒤로가기 + 아이콘 + 제목 헤더 |

### 매트릭스 구조

```typescript
interface ConfigSlots {
  refs: SlotDef[];           // 주요 참조 (default ON)
  context: SlotDef[];        // 보조 컨텍스트 (default OFF)
  target: TargetDef;         // 산출물
  buildRequiresContext?: boolean;  // BUILD 시 context 필수 여부
}

interface SlotDef {
  path: string;              // 디렉터리 또는 파일 경로
  type: 'dir' | 'file';
  defaultSelected: boolean;
  locked?: boolean;          // 해제 불가 (revise refs)
  emptyHint?: {...};         // 빈 슬롯 안내
  excludeSelectedRefs?: boolean;  // ref/context 상호 배제
}

interface TargetDef {
  dir?: string;
  expectedFiles?: ExpectedFile[];  // 예상 파일명 패턴
  codebase?: boolean;
  mirrorRefs?: boolean;      // target = selectedRefs (revise)
}
```

### 버튼 정책 (useActionFooterPolicy)

- workspace + intent + basis 필수
- explicit 활성이면 둘 다 비활성
- directive basis면 BUILD 비활성 (채팅만 가능)
- refs 필수인데 선택 안 됨 → 둘 다 비활성
- mirrorRefs인데 target 없음 → 둘 다 비활성
- buildRequiresContext인데 context 선택 없음 → BUILD만 비활성

### 파이프라인 흐름

```
ActionsPanel: pick-action → pick-intent → config (basis + refs + context + target)
                                              ↓
                                     [채팅으로 시작] → explicit=true + badge 주입
                                     [BUILD] → 직접 실행
```

### agent/job 동기화

selectIntent/updateActionMetadata에서 intent 변경 시 deriveFromIntent로 자동 설정. ActionFooter에서 중복 호출 없음.

---

## 알려진 제약/미구현

1. **BE가 actionMetadata.target을 소비하지 않음**: target은 FE 전용 정보. resolve/decompose에서 target 기반 태스크 범위 제한은 향후 작업.
2. **채팅 워터마크 간헐적 미갱신**: ChatPanel이 selectedAgent를 props로 받는 구조에서 React batching 지연 가능. 기존 버그.

---

## 다음 작업: 빈 슬롯 "만들기/업로드" 액션 시스템

### 유저 요구사항

참조나 컨텍스트에 후보 파일이 없을 때:
- 상단: 휴먼 리더블한 이름 ("기획서가 없습니다", "시스템 설계 문서가 없습니다" 등)
- 하단: 해당 파일이 있어야 할 경로 (파일명 제외, 디렉터리까지만)
- 우측 버튼 2개:
  - **만들기**: 해당 아티팩트를 생성할 수 있는 intent로 이동 (예: 시스템설계에서 PRD 없으면 → 기획서 작성 intent로 이동)
  - **업로드**: 파일 업로드 UI 또는 아티팩트 패널 해당 디렉터리로 이동

### 설계 방향

이건 파편화가 아닌 **통합 규칙**이어야 한다:
- 매트릭스의 각 SlotDef에 "이 슬롯이 비었을 때 어떤 intent로 만들 수 있는가" 메타데이터 추가
- `SlotDef.createIntent?: string` — 만들기 버튼이 이동할 intent ID
- `SlotDef.humanLabel?: { en: string; ko: string }` — "기획서", "시스템 설계 문서" 등 (현재 label과 다를 수 있음)
- SlotEntryList에서 hasFiles=false일 때 "만들기" + "업로드" 버튼 렌더링
- 만들기 클릭 → openActionsPanel(actionId) + selectIntent(createIntent) 호출

### 관련 파일

- `packages/ant-shared/src/action-config-matrix.ts` — SlotDef 확장
- `packages/ant-ui/src/presentation/components/Actions/ActionConfigView.tsx` — SlotEntryList의 빈 슬롯 렌더링
- `packages/ant-ui/src/domain/store/slices/uiSlice.ts` — openActionsPanel + selectIntent 연동
