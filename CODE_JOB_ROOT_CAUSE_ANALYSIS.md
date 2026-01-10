# Code Job 실행 결과 근본 원인 분석

**프로젝트**: ant-ogf/uidoc-test  
**Code Job 실행일**: 2026-01-10 15:34 (Job ID: mk7xjk2itt16ze)  
**분석일**: 2026-01-10  

---

## 📊 Executive Summary

ant-ogf/uidoc-test 프로젝트의 Code Job 실행 결과, **Plan 단계가 완전히 우회(bypass)되었으며**, LLM이 UI 문서를 읽지 않고 **태스크 description만 보고 즉시 코드를 작성**하는 심각한 문제가 발견되었습니다.

### 핵심 문제
1. ❌ **Plan 단계 부재**: 태스크별로 상세한 구현 계획(`planText`)을 생성하지 않음
2. ❌ **UI 문서 미참조**: `ui-spec.md`, `ui-assets.md` 등을 읽지 않고 태스크 description만 참조
3. ❌ **코드베이스 구조 일관성 부재**: 태스크마다 `components/`, `app/components/` 등 다른 구조 사용
4. ❌ **이미지 복사 불완전**: Technology 섹션 배경 이미지 3장 미복사

---

## 🔴 발견된 문제들

### 1. **이미지 로딩 실패 (Image Loading Failures)**

#### ❌ 문제 현황
- **Technology 카드 배경 이미지 (3장)**: `/bg/bg-technology-*.png` → **복사 안됨**
  - 원본: `inputs/assets/bg/bg-technology-{1,2,3}.png` 존재
  - 목적지: `public/bg/` 에 복사되지 않음
  - 코드는 `/bg/bg-technology-1.png` 참조 중 → **404 에러**

- **Token hero 이미지**: `/bg/token-hero-image.png` → ✅ 복사됨 (정상)
- **Social 섹션 배경 이미지**: 배경이 CSS gradient로만 처리됨 (`ui-assets.md`에는 배경 이미지 명시 없음)

#### 📋 UI 문서의 명세
`ui-assets.md` (Line 99-106):
```markdown
### Technology Section (Card Backgrounds)
| Asset ID | Source Path | Usage Context | Associated Card | Token Context |
|----------|-------------|---------------|-----------------|---------------|
| `bg.tech.mainnet` | `inputs/assets/bg/bg-technology-1.png` | CROSS Mainnet card background | Technology card 1 | ... |
| `bg.tech.protocol` | `inputs/assets/bg/bg-technology-2.png` | CROSS Protocol card background | Technology card 2 | ... |
| `bg.tech.dev` | `inputs/assets/bg/bg-technology-3.png` | Development Guide card background | Technology card 3 | ... |
```

#### 💻 실제 구현된 코드
`data/technology.ts`:
```typescript
backgroundPath: '/bg/bg-technology-1.png',  // ❌ 파일 존재하지 않음
backgroundPath: '/bg/bg-technology-2.png',  // ❌ 파일 존재하지 않음
backgroundPath: '/bg/bg-technology-3.png',  // ❌ 파일 존재하지 않음
```

`public/bg/` 실제 파일:
```
bg-discover-1.png       ✅ (Ecosystem 용)
bg-discover-2.png       ✅ (Ecosystem 용)
bg-discover-3.png       ✅ (Ecosystem 용)
token-hero-image.png    ✅ (Token 용)
```

#### 🔍 근본 원인
**Plan 단계에서 Asset Inventory를 생성하지 않았기 때문**:
- Ecosystem 섹션은 성공 → 해당 태스크에서 우연히 복사한 것으로 추정
- Technology 섹션은 실패 → **Asset 복사 누락**

---

### 2. **레이아웃 불일치 (Layout Discrepancies)**

#### ❌ 문제 1: Ecosystem 3단 구성 실패?
- **UI 문서 명세**: 3-card 레이아웃 (OGF, CROSS, NEXUS)
- **실제 구현**: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` → ✅ **정상**
- **사용자 보고**: "2단 구성"으로 보임 → **반응형 breakpoint 오해 가능성**

#### ❌ 문제 2: Technology 카드 세로 배열 vs 가로 배열
- **UI 문서 명세**: 명확한 방향 지정 없음 (카드 3개만 명시)
- **실제 구현**: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (가로 3단)
- **사용자 기대**: 세로 배열 (1열 3행)?
- **원인**: **UI 문서에 레이아웃 방향 명시 부족** + Plan 단계 부재로 명확화 실패

#### ❌ 문제 3: Footer 요소 배치
- **실제 코드 확인 필요** (아직 확인 안함)
- **예상 원인**: Plan 부재 → UI spec의 footer 레이아웃 세부사항 누락

---

### 3. **코드베이스 구조 일관성 부재 (Inconsistent Structure)**

#### 🏗️ 문제 현황
```
codebase/
├── app/
│   ├── components/
│   │   └── sections/
│   │       └── Social.tsx       ← ❌ app/components에 Social만 존재
│   ├── layout.tsx
│   └── page.tsx
│
└── components/                   ← ❌ 루트 components에 나머지 모두 존재
    ├── Hero/
    │   └── Hero.tsx
    ├── Navigation/
    │   └── Header.tsx
    └── sections/
        ├── About.tsx
        ├── Ecosystem.tsx
        ├── Footer.tsx
        ├── Social.tsx            ← ❌ 중복! (app/components에도 존재)
        ├── Technology.tsx
        └── Token.tsx
```

#### 🔍 근본 원인
**각 태스크가 독립적으로 실행되면서 코드베이스 구조를 일관되게 인지하지 못함**:

1. **초기 태스크 (Hero, Navigation)**: `components/` 에 생성
2. **중간 태스크 (About, Ecosystem, Token, Technology, Footer)**: `components/sections/` 에 생성
3. **Social 섹션 태스크**: 
   - 로그 확인 결과: **`list_files` 툴로 `app/components` 조회 시도 → 디렉토리 존재하지 않음 에러**
   - LLM이 기존 구조를 파악하지 못하고 **`app/components/sections/Social.tsx` 생성 시도**
   - 결과적으로 `components/sections/Social.tsx`도 이미 존재 (중복)

#### 📋 로그 증거
```
[ERROR] [listFiles] ❌ Error: ENOENT: no such file or directory, scandir '/Users/probe/dev/ant-workspaces/to.nexus/probe/ant-ogf/codebase/app/components'
```
- Technology 섹션 구현 중 `app/components` 디렉토리 조회 시도 → **존재하지 않음**
- LLM이 코드베이스 구조를 정확히 파악하지 못함

---

### 4. **Social 섹션 아이콘 로딩 실패**

#### ❌ 문제 현황
`components/sections/Social.tsx`:
```typescript
icon: '/icons/telegram.svg',  // ❌ 잘못된 경로
icon: '/icons/x.svg',         // ❌ 잘못된 경로
icon: '/icons/medium.svg',    // ❌ 잘못된 경로
```

**실제 파일 위치**:
```
public/icons/icon-telegram.svg  ✅
public/icons/icon-x.svg         ✅
public/icons/icon-medium.svg    ✅
```

**올바른 경로**:
```typescript
icon: '/icons/icon-telegram.svg',  // ✅
icon: '/icons/icon-x.svg',         // ✅
icon: '/icons/icon-medium.svg',    // ✅
```

#### 📋 UI 문서의 명세
`ui-assets.md` (Line 60-66):
```markdown
### Social Icons (Social Section)
| Asset ID | Source Path | Usage Context | Link Target |
|----------|-------------|---------------|-------------|
| `icon.social.telegram` | `inputs/assets/icons/icon-telegram.svg` | ... |
| `icon.social.x` | `inputs/assets/icons/icon-x.svg` | ... |
| `icon.social.medium` | `inputs/assets/icons/icon-medium.svg` | ... |
```

#### 🔍 근본 원인
**LLM이 UI 문서를 읽지 않고 추측으로 경로 작성**:
- 문서에는 `icon-telegram.svg` 명시
- 코드에는 `telegram.svg` 로 작성 → **파일명 불일치**

---

## 🎯 근본 원인 (Root Cause)

### **Plan 단계는 실행되었으나, planText가 Execute 노드에 전달되지 않음**

#### 📋 정상 프로세스 (설계 의도)
```
Decompose (태스크 분해)
  ↓
  "Implement Technology Section" (high-level 지침만 제공)
  ↓
Plan (상세 계획 수립)  ← ✅ 실행됨! (3962 chars planText 생성)
  ↓
  - ui-spec.md 읽기
  - ui-assets.md 읽기
  - Asset Inventory 작성 (bg-technology-1.png, bg-technology-2.png, ...)
  - 레이아웃 구조 명세 (3-column grid, vertical/horizontal)
  - Component 명세 (TechnologyCard props)
  - Implementation Steps (1. 파일 복사, 2. 컴포넌트 작성, ...)
  ↓
Execute (planText 기반 코드 작성)
  ↓
  planText의 Asset Inventory → public/bg/ 에 파일 복사
  planText의 Component 명세 → data/technology.ts 작성
```

#### ❌ 실제 실행된 프로세스
```
Decompose (태스크 분해)
  ↓
  "Implement Technology Section with external link cards..." (태스크 description)
  ↓
Plan 단계 실행!  ← ✅ 실행됨
  ↓
  - ui-spec.md, ui-assets.md 읽음
  - planText 생성 (3962 chars)
  - Asset Inventory 포함 (추정)
  ↓
❌ STATE 전파 실패!  ← 여기서 문제 발생!
  ↓
Execute (planText 없이 실행)
  ↓
  - state.planText === undefined
  - promptBuilder.ts의 조건문 (if state.planText) 실패
  - 태스크 description만 사용
  - ui-spec.md, ui-assets.md는 프롬프트에 주입되지만 LLM이 우선적으로 참조 안함
  - Asset 복사 누락
  - 경로 추측으로 작성 (/bg/bg-technology-1.png)
  - 파일 없음 → 404 에러
```

#### 📊 로그 증거

**Plan 단계 로그**:
```
📋 [Plan] Next task: Implement Technology Section
   ↓
🔑 [Plan] Generating search keywords...
   ↓
📝 [Plan] Generating implementation plan...
🔥 [API CALL] provider=anthropic model=claude-sonnet-4-5-20250929 method=invoke messages=1 cacheable=0
   ✅ Plan generated (3962 chars)  ← ✅ Plan 생성 성공!
   ↓
💭 [CodeGen] Starting reasoning...  ← ❌ planText가 Execute에 없음!
```

**Execute 프롬프트에 planText 부재**:
```
# 로그에서 "🚨 IMPLEMENTATION PLAN" 섹션 검색 결과: 0건
→ state.planText가 Execute 노드에 전달되지 않음!
```

**Execute 단계에서 UI 문서 주입은 됨**:
```
   ✅ [loadUiContext] ui-spec.md: loaded (42131 chars)
   ✅ [loadUiContext] ui-tokens.md: loaded (7350 chars)
   ✅ [loadUiContext] ui-assets.md: loaded (10408 chars)
📄 [Resolve] uiDoc loaded (60490 chars)
```
→ **UI 문서가 Execute 프롬프트에 주입되었지만**, LLM이 **태스크 description만 우선적으로 참조**하고 UI 문서는 제대로 읽지 않음.

---

### **왜 planText가 Execute 노드에 전달되지 않았는가?**

#### ✅ 검증 완료 사항
1. **Plan 노드 실행**: ✅ 정상 실행됨 (로그 확인)
2. **planText 생성**: ✅ 정상 생성됨 (3962 chars)
3. **Plan 노드의 state 업데이트**: ✅ 코드상 정상 (`updatedState.planText = planText`)
4. **Graph 연결**: ✅ `graph.addEdge("plan" as any, "codeGen" as any)` 존재
5. **State 인터페이스 정의**: ✅ `planText: string;` 정의됨
6. **State channels 정의**: ✅ `planText: null as any,` 정의됨
7. **Execute promptBuilder**: ✅ `if (state.planText)` 조건문 존재

#### ❌ 근본 원인: **LangGraph State Channels의 Reducer 부재**

**문제**: `planText` channel이 `null as any`로만 정의되어 있어, **기본 동작이 "마지막 값으로 덮어쓰기"가 아닌 "null 유지"일 수 있음**.

LangGraph v0.2+에서는 channel에 reducer가 정의되지 않으면, state 업데이트가 제대로 전파되지 않을 수 있습니다.

#### 🔍 가설: LangGraph의 State 전파 버그

**가능성 1**: `null as any`로 정의된 channel은 업데이트가 무시됨
- LangGraph가 `null` 타입을 "변경 불가" 또는 "무시"로 해석할 수 있음

**가능성 2**: Spread operator (`...state`)의 shallow copy 문제
- Plan 노드: `const updatedState = { ...state, planText, ... };`
- LangGraph가 이를 인식하지 못하고 기존 state를 재사용

**가능성 3**: LangGraph 버전 이슈
- 사용 중인 `@langchain/langgraph` 버전이 특정 state 전파 버그를 가지고 있을 수 있음

---

## 📐 프롬프트 리팩토링의 효과 부재

### 이전 작업 내역
1. **Plan 프롬프트 강화** (`plan/base.md`):
   - 🚨 CRITICAL PRINCIPLE 추가
   - UI Implementation Checklist (Asset Inventory, Layout, Component Specs)
   - "태스크 description은 가이드일 뿐, 모든 문서를 읽고 완전한 계획 수립" 강조

2. **Execute 프롬프트 강화** (`common/injections/ui-doc.md`):
   - 🚨 IMPLEMENTATION MANDATE
   - "Plan의 Asset Inventory를 SSOT로 사용"

### ❌ 왜 효과가 없었는가?
**Plan 단계 자체가 실행되지 않았기 때문에, 아무리 프롬프트를 강화해도 소용없음.**

---

## 🔧 해결 방안

### 1. **LangGraph State Channel Reducer 추가 (CRITICAL)**

#### 현재 문제점
```typescript
const graph = new StateGraph<ArchitectGraphState>({
  channels: {
    planText: null as any,  // ❌ Reducer 없음 → state 전파 실패 가능성
    // ...
  }
});
```

#### 해결 방법 A: Explicit Reducer 추가
```typescript
const graph = new StateGraph<ArchitectGraphState>({
  channels: {
    planText: {
      value: (x: string, y?: string) => y ?? x,  // ✅ 새 값이 있으면 덮어쓰기
      default: () => '',
    },
    // ...
  }
});
```

#### 해결 방법 B: 모든 channel에 간단한 reducer 추가
```typescript
import { StateGraph } from "@langchain/langgraph";

// Helper function for simple overwrite reducer
const createChannel = <T>(defaultValue: T) => ({
  value: (x: T, y?: T) => y ?? x,
  default: () => defaultValue,
});

const graph = new StateGraph<ArchitectGraphState>({
  channels: {
    planText: createChannel(''),
    projectCodeContext: createChannel(undefined),
    uiDoc: createChannel(undefined),
    // ... (모든 channel에 적용)
  }
});
```

#### 해결 방법 C: LangGraph 버전 업그레이드
```bash
# 최신 버전으로 업데이트 (state 전파 버그 수정 가능성)
npm update @langchain/langgraph @langchain/core
```

---

### 2. **디버깅 로그 추가 (Immediate Action)**

Plan 노드와 Execute 노드에서 planText 전파를 명시적으로 로그:

#### Plan 노드 (`plan/index.ts`)
```typescript
const updatedState = { 
  ...state,
  planText,
  // ...
};

// ✅ 디버깅 로그 추가
console.log(`🔍 [Plan] Returning state with planText: ${planText ? planText.length : 0} chars`);
console.log(`   planText preview: ${planText?.substring(0, 100)}...`);

return updatedState;
```

#### Execute 노드 (`codeGen/promptBuilder.ts`)
```typescript
export async function buildMessages(state: ArchitectGraphState) {
  // ✅ 디버깅 로그 추가
  console.log(`🔍 [CodeGen] Received planText: ${state.planText ? state.planText.length : 0} chars`);
  
  if (state.planText) {
    console.log(`   ✅ planText exists, will inject to prompt`);
  } else {
    console.log(`   ❌ planText missing! Using task.description only`);
  }
  
  // ...
}
```

---

### 3. **State Checkpoint 검증**

State가 제대로 저장/복원되는지 확인:

#### `checkTaskStatus` 노드에서 planText 로그
```typescript
export async function checkTaskStatus(state: ArchitectGraphState) {
  console.log(`🔍 [checkTaskStatus] Current task: ${state.currentTask?.name}`);
  console.log(`   planText available: ${state.planText ? 'YES' : 'NO'}`);
  console.log(`   planText length: ${state.planText?.length || 0} chars`);
  
  // ...
}
```

---

### 4. **Alternative: planText를 currentTask에 저장**

LangGraph state 전파 문제를 우회하기 위해, planText를 `currentTask` 객체에 포함:

#### Plan 노드 수정
```typescript
const updatedState = { 
  ...state,
  currentTask: {
    ...nextTask,
    planText: planText,  // ✅ task 객체에 포함
  },
  planText,  // state에도 저장 (기존 로직 유지)
  // ...
};
```

#### Execute promptBuilder 수정
```typescript
// Fallback: task.planText 사용
const planTextToUse = state.planText || (state.currentTask as any).planText;

if (planTextToUse) {
  lines.push(`🚨 IMPLEMENTATION PLAN (FOLLOW THIS)`);
  lines.push(planTextToUse);
}
```

---

### 5. **코드베이스 구조 일관성 확보**

#### 방법 A: 초기 태스크에서 디렉토리 구조 확정
```typescript
// project-setup 태스크 Plan에서
**Directory Structure Convention**:
- `app/`: Next.js App Router pages (layout.tsx, page.tsx)
- `components/sections/`: 모든 섹션 컴포넌트 (Hero, About, Ecosystem, ...)
- `components/ui/`: 공통 UI 컴포넌트 (Button, Card, ...)
- `data/`: 정적 데이터 파일
- `public/`: 정적 에셋 (이미지, 아이콘)
```

#### 방법 B: Execute 노드에서 기존 구조 자동 감지
```typescript
// Execute 시작 전
const existingStructure = await analyzeCodebaseStructure();
// 예: { componentsDir: 'components/', sectionsDir: 'components/sections/' }

// 프롬프트에 주입
`**Existing Structure**: All section components are located in \`${sectionsDir}\`. 
Create new components in the same directory.`
```

---

### 4. **Asset 복사 자동화**

#### 방법 A: Plan 단계에서 Asset 목록 명시
Plan의 Asset Inventory를 파싱하여 Execute 전에 자동 복사:

```typescript
// Plan 출력 예시
## Asset Inventory
1. bg-technology-1.png: inputs/assets/bg/ → public/bg/
2. bg-technology-2.png: inputs/assets/bg/ → public/bg/
3. bg-technology-3.png: inputs/assets/bg/ → public/bg/

// Execute 전처리
const assetsToCopy = parseAssetInventory(planText);
await copyAssets(assetsToCopy);
```

#### 방법 B: Execute 노드의 툴에 `copy_asset` 추가
LLM이 명시적으로 Asset을 복사하도록:

```typescript
// Tool definition
{
  name: 'copy_asset',
  description: 'Copy asset file from inputs/assets to public/',
  parameters: {
    source: 'inputs/assets/bg/bg-technology-1.png',
    destination: 'public/bg/bg-technology-1.png'
  }
}
```

---

## 📊 영향 범위

### 직접 영향받은 태스크
1. ✅ **project-setup**: Plan 없이도 정상 (boilerplate 생성)
2. ✅ **navigation-header**: 로고만 사용 → 정상
3. ✅ **hero-section**: bg-main.png 복사 성공 → 정상
4. ✅ **about-section**: Asset 없음 → 정상
5. ✅ **ecosystem-section**: 3개 bg 모두 복사 성공 → 정상
6. ⚠️ **token-section**: token-hero-image.png 복사 성공 (운 좋음)
7. ❌ **technology-section**: 3개 bg 복사 실패 → **이미지 404**
8. ❌ **social-section**: 아이콘 경로 오류 (`telegram.svg` vs `icon-telegram.svg`) → **이미지 404**
9. ⚠️ **footer-section**: 레이아웃 불일치 (미확인)

### 태스크별 성공/실패 패턴
- **Asset 복사 성공**: 해당 태스크에서 우연히 복사한 경우 (Ecosystem, Token)
- **Asset 복사 실패**: Plan 부재로 Asset Inventory 없음 (Technology, Social)

---

## 🎯 우선순위

### P0 (Critical - 즉시 수정 필요)
1. **planText State 전파 수정**: LangGraph state channel reducer 추가
2. **디버깅 로그 추가**: Plan과 Execute 노드에서 planText 전파 확인

### P1 (High - 근본 원인 확인)
3. **Alternative 구현**: planText를 currentTask 객체에 포함 (우회 방법)
4. **LangGraph 버전 확인**: 버전 업그레이드로 문제 해결 가능성 검토

### P2 (Medium - 품질 개선)
5. **Plan 출력 검증**: Asset Inventory 필수 체크
6. **코드베이스 구조 일관성**: 기존 구조 자동 감지 또는 초기 확정

### P3 (Low - 편의성)
7. **Asset 복사 자동화**: Plan의 Asset Inventory 파싱 → 자동 복사
8. **UI 문서 Asset 명세 개선**: 레이아웃 방향 등 세부사항 추가

---

## 🔬 추가 검증 필요 사항

1. **LangGraph 버전**:
   - 확인: `package.json`의 `@langchain/langgraph` 버전
   - 테스트: 최신 버전으로 업그레이드 시 문제 해결 여부

2. **State channels reducer 정의**:
   - 파일: `/packages/ant-cli/src/agents/architect/graph/code/graph.ts`
   - 확인: 다른 channel들의 reducer 정의 방식
   - 테스트: `planText` channel에 reducer 추가 후 재실행

3. **Plan 노드 출력 확인**:
   - 로그: Plan 노드의 `return updatedState` 직전 로그 추가
   - 확인: `updatedState.planText` 값 존재 여부

4. **Execute 노드 입력 확인**:
   - 로그: Execute 노드의 `buildMessages` 시작 시 로그 추가
   - 확인: `state.planText` 값 존재 여부

5. **생성된 planText 내용 확인**:
   - 방법: 디버깅 로그로 planText 전체 출력
   - 목적: Asset Inventory가 제대로 생성되었는지 확인
   - 예상: Technology 섹션의 `bg-technology-*.png` 복사 지시사항 포함 여부

---

## 📖 참고 문서

- `/Users/probe/dev/ant/PLAN_PROMPT_REFACTORING.md` - Plan 프롬프트 리팩토링 히스토리
- `/Users/probe/dev/ant/PIPELINE_ROLES.md` - Code Job 파이프라인 역할 정의
- `/Users/probe/dev/ant/DOCUMENT_FLOW_AND_PRIORITY.md` - 문서 흐름 및 우선순위
- `/Users/probe/dev/ant/packages/ant-cli/src/core/prompt/templates/code/phases/plan/base.md` - Plan 프롬프트
- `/Users/probe/dev/ant/packages/ant-cli/src/core/prompt/templates/common/injections/ui-doc.md` - Execute UI 문서 처리

---

## ✅ 결론

**Plan 노드는 정상적으로 실행되어 planText(3962 chars)를 생성했으나, LangGraph의 state 전파 문제로 Execute 노드에 전달되지 않았습니다.**

핵심 문제:
1. **LangGraph State Channels의 Reducer 부재**: `planText: null as any` 정의만으로는 state 업데이트가 전파되지 않을 수 있음
2. **디버깅 로그 부재**: Plan과 Execute 사이의 state 전파를 확인할 로그가 없음

즉시 조치사항:
1. **디버깅 로그 추가**: Plan 노드의 `return updatedState` 전, Execute 노드의 `buildMessages` 시작 시 planText 존재 여부 로그
2. **State Channel Reducer 추가**: `planText` channel에 명시적 reducer 정의
3. **Alternative 구현**: `currentTask.planText`에 값 저장하여 LangGraph state 문제 우회

이 수정이 완료되면:
- Execute 노드가 planText를 올바르게 받음
- `🚨 IMPLEMENTATION PLAN` 섹션이 프롬프트에 주입됨
- LLM이 Asset Inventory를 읽고 정확한 파일 복사 수행
- 이미지 로딩 문제, 레이아웃 문제 모두 해결
