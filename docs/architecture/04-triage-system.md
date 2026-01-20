# Triage System

> 사용자 입력을 분석하여 적절한 처리 경로로 안내하는 시스템

---

## 1. 개요

### 1.1 문제

- 잘못된 Job 선택 시 안내 없음
- 준비물 부족해도 그냥 실패
- 도움 요청에 맥락 맞는 응답 불가

### 1.2 솔루션

의료 Triage 개념 차용: **분류 → 적절한 경로로 라우팅**

### 1.3 용어 정의

#### 시스템 구조
| 용어 | 의미 | 예시 |
|-----|-----|-----|
| Agent | 최상위 실행 단위 | architect, reviewer |
| Job | Agent 내 작업 유형 | design, code, learn |
| Node | Graph 내 실행 단위 | triage, detectEnv |

#### Triage 분류 (코드 변수명)
| 용어 | 타입 | 설명 |
|-----|-----|-----|
| `intent` | `'ask' \| 'work'` | 사용자 의도 분류 |
| `workStatus` | `'proceed' \| 'redirect' \| 'blocked'` | work일 때 실행 가능 여부 |
| `confidence` | `number` | intent 파악 확신도 (0.0-1.0) |

---

## 2. 분류 체계

### 2.1 2단계 분류

```
사용자 입력
    │
    ▼
┌─────────────────────────────────────┐
│ 1단계: Intent (사용자 의도)          │
│                                     │
│   ask  ─── 질문, 도움 요청           │
│   work ─── 작업 요청                 │
└─────────────────────────────────────┘
    │
    ├── ask ──────────────────────────────┐
    │                                     │
    │   ┌─────────────────────────────┐   │
    │   │ Guardrails 체크              │   │
    │   │                             │   │
    │   │ in-scope  → 응답 생성        │   │
    │   │ out-scope → 범위 안내        │   │
    │   └─────────────────────────────┘   │
    │                 │                   │
    │                 ▼                   │
    │              __end__                │
    │                                     │
    └── work ─────────────────────────────┤
                      │                   │
                      ▼                   │
        ┌─────────────────────────────┐   │
        │ 2단계: Status (시스템 진단)  │   │
        │                             │   │
        │ proceed  ─ 정상 진행 가능    │   │
        │ redirect ─ 다른 job 적합    │   │
        │ blocked  ─ 준비물 부족      │   │
        └─────────────────────────────┘   │
                      │                   │
          ┌───────────┼───────────┐       │
          ▼           ▼           ▼       │
      proceed     redirect     blocked    │
          │           │           │       │
          ▼           ▼           ▼       │
      기존플로우    승인요청    안내+선택지  │
```

### 2.2 Intent 정의

| Intent | 설명 | 예시 |
|--------|-----|-----|
| `ask` | 질문/도움 요청, 또는 모호한 입력 | "뭐 준비해야 해?", "어떻게 하면 돼?" |
| `work` | 명확한 작업 요청 | "로그인 페이지 만들어줘" |

> **원칙**: 모호한 경우 `ask`로 분류 (자연스러운 대화 흐름)

### 2.3 ask 응답 처리 (Ask System 위임)

| 개발 단계 | ask 응답 처리 |
|----------|-------------|
| **1단계** | 하드코딩된 기본 응답 (Triage 내) |
| **2단계** | **Ask System으로 위임** → [05-ask-system.md](./05-ask-system.md) |

> ⚠️ **ask 응답의 구체적 내용 (in-scope/out-scope, 지식 검색, LLM 응답)은 Ask System에서 다룸**

### 2.3 Work Status 정의

| Status | 설명 | 처리 |
|--------|-----|-----|
| `proceed` | 현재 job + 준비 완료 | 기존 플로우 진행 |
| `redirect` | 다른 job이 더 적합 | 승인 후 전환 |
| `blocked` | 현재 job 맞지만 준비 부족 | 안내 + 선택지 |

### 2.4 Guardrails (ask) → Ask System 위임

| 범위 | 설명 |
|-----|-----|
| **In-scope** | Ant 사용법, 워크플로우, 준비물, 현재 상태, 코드 질문 등 |
| **Out-of-scope** | 날씨, 일반 지식, Ant와 무관한 질문 |

> ⚠️ **Guardrails 상세 구현은 [Ask System](./05-ask-system.md)에서 처리**
> - 질문 카테고리 분류
> - In-scope/Out-scope 판단
> - 카테고리별 응답 생성

---

## 3. 분류 케이스

### 3.1 ask 케이스

| 입력 | Guardrails | 응답 |
|-----|-----------|-----|
| "뭐 준비해야 해?" | in-scope | 현재 상태 + 필요한 것 안내 |
| "디자인잡 하려면?" | in-scope | design job 준비물 안내 |
| "오늘 날씨 어때?" | out-scope | 범위 안내 |
| "React란 뭐야?" | out-scope | 범위 안내 |

### 3.2 work → proceed 케이스

| 입력 | 현재 Job | 상태 | 결과 |
|-----|---------|-----|-----|
| "로그인 페이지 기획해줘" | design | PRD ✅ | proceed |
| "버튼 색상 바꿔줘" | code | design ✅ codebase ✅ | proceed |

### 3.3 work → redirect 케이스

| 입력 | 현재 Job | 제안 |
|-----|---------|-----|
| "UI 기획해줘" | code | → design |
| "이거 코드로 구현해" | design | → code |
| "프로젝트 분석해줘" | design | → learn |

### 3.4 work → blocked 케이스

#### design job

| 입력 | 모드 | 부족한 것 | canProceed |
|-----|-----|----------|-----------|
| "UI 기획해줘" | ui-design | screens ❌ | false |
| "UI 기획해줘" | ui-design | components ❌, assets ❌ (screens ✅) | true |
| "시스템 설계해줘" | system-design | PRD ❌, directive ❌ | false |

#### code job

| 입력 | 상황 | 부족한 것 | canProceed |
|-----|-----|----------|-----------|
| "코드 구현해줘" | 신규 | design doc ❌, directive ❌ | false |
| "버튼 색상 바꿔줘" | 수정 | directive만으로 가능 | proceed |
| "코드 구현해줘" | 신규 | codebase ❌ (design ✅) | true |

---

## 4. Prerequisites

### 4.1 Required vs Recommended

| 구분 | 없으면 | canProceed |
|-----|-------|-----------|
| **Required** | 진행 불가 | false |
| **Recommended** | 품질 저하 | true (선택) |

### 4.2 Job별 Prerequisites

#### design job (2가지 모드)

| 모드 | Required | Recommended |
|-----|----------|-------------|
| **ui-design** | `inputs/references/screens/` (피그마 캡처) | `inputs/references/components/`, `inputs/assets/` |
| **system-design** | PRD 또는 directive | 기존 코드베이스 (evolution 시) |

> **ui-design 판단 기준**: `inputs/references/` 또는 `inputs/assets/`에 파일이 있으면 ui-design  
> **system-design 판단 기준**: PRD/directive만 있고 참조 이미지가 없으면 system-design

#### code job

| 조건 | Required | Recommended |
|-----|----------|-------------|
| **신규 개발** | design documents (`outputs/design/`) | indexed codebase |
| **수정/개선** | directive만으로 가능 | indexed codebase |

> **핵심**: `design doc` OR `directive` 중 **하나만** 있으면 진행 가능

#### learn job

| Required | Recommended |
|----------|-------------|
| git repository | - |

### 4.3 blocked 응답 예시

**ui-design + Required 부족** (canProceed: false):
> (confidence: 0.92) UI 문서 생성을 위한 레퍼런스 이미지가 없습니다.  
> `inputs/references/screens/` 폴더에 피그마 화면 캡처 이미지를 추가해주세요.

**ui-design + Recommended 부족** (canProceed: true):
> (confidence: 0.88) 참고 이미지는 있지만 에셋 파일이 없습니다. 없이 진행하면 에셋 매핑이 생략됩니다.
> - [진행] 그래도 진행
> - [취소] 에셋 추가 후 다시 시작

**code + Required 부족** (canProceed: false):
> (confidence: 0.85) 디자인 문서가 없습니다.  
> 신규 개발: Design Job으로 먼저 설계하세요.  
> 간단한 수정: Code Job에서 바로 요청을 입력하세요.

**code + Recommended 부족** (canProceed: true):
> (confidence: 0.91) 디자인 문서는 있지만 코드베이스가 인덱싱되지 않았습니다.  
> learn job을 먼저 실행하면 더 정확한 코드를 생성할 수 있습니다.
> - [진행] 인덱싱 없이 진행
> - [learn 실행] 인덱싱 후 다시 시작

---

## 5. 동적 응답

### 5.1 워크스페이스 상태 주입

```
## WORKSPACE STATE

### Inputs
{{#if hasPrd}}✅ PRD: {{prdPath}}{{else}}❌ No PRD{{/if}}
{{#if hasDirective}}✅ Directive: {{directivePath}}{{else}}ℹ️ No directive{{/if}}

### References (for ui-design)
{{#if hasScreens}}✅ Screens: {{screenCount}} files{{else}}❌ No screen captures{{/if}}
{{#if hasComponents}}✅ Components: {{componentCount}} files{{else}}ℹ️ No component snapshots{{/if}}
{{#if hasAssets}}✅ Assets: {{assetCount}} files{{else}}ℹ️ No asset files{{/if}}

### Design Documents
{{#if hasUiDocs}}✅ UI docs complete (ui-tokens, ui-assets, ui-spec){{else}}❌ No UI docs{{/if}}
{{#if hasSystemDesignDoc}}✅ System design exists{{else}}❌ No system design{{/if}}

### Codebase
{{#if hasCodebase}}✅ Indexed ({{indexedFileCount}} files){{else}}❌ Not indexed{{/if}}
```

### 5.2 응답은 상태 기반

#### design job 예시

| 질문 | 상태 | 응답 |
|-----|-----|-----|
| "UI 기획해줘" | screens ✅ | proceed (ui-design 모드) |
| "UI 기획해줘" | screens ❌ assets ❌ | blocked: "피그마 캡처 이미지를 추가해주세요" |
| "시스템 설계해줘" | PRD ✅ | proceed (system-design 모드) |
| "시스템 설계해줘" | PRD ❌ | blocked: "PRD가 필요합니다" |

#### code job 예시

| 질문 | 상태 | 응답 |
|-----|-----|-----|
| "코드 구현해줘" | design ✅ codebase ✅ | proceed |
| "코드 구현해줘" | design ✅ codebase ❌ | blocked (canProceed: true): "인덱싱 없이 진행할까요?" |
| "코드 구현해줘" | design ❌ | blocked: "디자인 문서가 필요합니다. Design Job을 먼저 실행하거나 원하는 작업을 채팅에 입력하세요." |
| "버튼 색상 바꿔줘" | (채팅 입력) | proceed |

---

## 6. 타입 정의

```typescript
// agents/common/nodes/triage/types.ts

export type Intent = 'ask' | 'work';
export type WorkStatus = 'proceed' | 'redirect' | 'blocked';

export interface TriageResult {
  intent: Intent;
  
  // ask
  inScope?: boolean;           // guardrails 통과 여부
  askResponse?: string;        // 응답 (in-scope일 때)
  
  // work
  workStatus?: WorkStatus;
  
  // work → redirect
  suggestedAgent?: string;
  suggestedJob?: string;
  redirectReason?: string;
  
  // work → blocked
  missingPrerequisites?: {
    required: string[];
    recommended: string[];
  };
  canProceed?: boolean;
  blockedMessage?: string;
  proceedAnywayOption?: string;
  
  // 사용자에게 보여줄 메시지
  displayMessage?: string;
  
  // 선택 필요 여부
  needsChoice?: boolean;
  choiceOptions?: ChoiceOptions;
}

// 선택 시스템
export type ChoiceAction = 
  | 'proceed'        // 정상 진행 (조건 충족)
  | 'proceedAnyway'  // 권장 조건 부족하지만 진행
  | 'redirect'       // 다른 job으로 전환
  | 'guide';         // 가이드 제공 (부정 선택 시 항상)

export interface ChoiceOptions {
  positive: {
    label: string;      // "예", "전환", "그래도 진행"
    action: ChoiceAction;
  };
  negative: {
    label: string;      // "아니오", "현재 job 유지", "취소"
    action: 'guide';    // 항상 가이드 제공
  };
  fallbackGuide: string;  // 부정 선택 시 보여줄 가이드
}

export interface WorkspaceState {
  // Common
  hasPrd: boolean;               // ⚠️ 템플릿이 아닌 실제 내용이 있는지 체크
  hasDirective: boolean;         // ⚠️ 채팅 입력 시 true
  prdPath?: string;
  directivePath?: string;
  
  // Design job - ui-design mode
  hasScreens: boolean;           // inputs/references/screens/
  hasComponents: boolean;        // inputs/references/components/
  hasAssets: boolean;            // inputs/assets/
  screenCount?: number;
  componentCount?: number;
  assetCount?: number;
  
  // Design job - system-design mode
  hasSystemDesignDoc: boolean;   // outputs/design/system-design.md
  hasUiDocs: boolean;            // outputs/design/ui-*.json
  
  // Code job
  hasDesignDoc: boolean;         // Any design doc in outputs/design/
  hasCodebase: boolean;          // Indexed in vector DB
  indexedFileCount?: number;
}

// ⚠️ 중요: 파일 존재 여부 체크 시 템플릿 마커 확인 필요!
// - 피처 생성 시 boilerplate 파일에 `<!-- ant:template -->` 마커가 포함됨
// - 이 마커가 있으면 "비어있는 입력"으로 취급
// - FileJobPrerequisitesAdapter.hasContent() 재사용 권장

export interface TriageableState {
  // 기존
  context: ProjectContext;
  spec: string;
  deps?: { llm?: LLMClient; workflowUpdate?: WorkflowStateUpdatePort };
  _httpJobId?: string;
  tokenUsage?: TokenUsage;
  
  // Triage
  skipTriage?: boolean;
  triageResult?: TriageResult;
  workspaceState?: WorkspaceState;
  currentAgent?: string;
  currentJob?: string;
}
```

---

## 7. 플로우

```
┌─────────────────────────────────────────────────────────────────────┐
│  orchestrator                                                       │
│  - skipTriage 전달                                                  │
│  - redirect 승인 처리                                               │
│  - blocked 선택 처리                                                │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Agent Graph                                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  __start__                                                          │
│      │                                                              │
│      ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  🏥 triage                                                    │   │
│  │                                                              │   │
│  │  IF skipTriage → proceed                                     │   │
│  │                                                              │   │
│  │  1. 워크스페이스 상태 수집                                    │   │
│  │  2. LLM 호출 (intent + status + response)                    │   │
│  │  3. 토큰 추적                                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          │                                          │
│       ┌──────────────────┼──────────────────┐                       │
│       │                  │                  │                       │
│   ask:inScope      ask:outScope          work                       │
│       │                  │                  │                       │
│       ▼                  ▼                  │                       │
│   응답전달           범위안내               │                       │
│       │                  │       ┌──────────┼──────────┐            │
│       ▼                  ▼       │          │          │            │
│   __end__            __end__  proceed   redirect   blocked          │
│                                  │          │          │            │
│                                  ▼          ▼          ▼            │
│                              detectEnv   승인요청   선택지요청       │
│                                  │          │          │            │
│                                  ▼          ▼          ▼            │
│                              기존플로우   __end__    __end__         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. 파일 구조

```
src/
├── core/prompt/templates/triage/
│   ├── base.md              # 컨텍스트, 상태, 지식
│   └── rules.md             # 분류 규칙, guardrails
│
├── agents/common/nodes/triage/
│   ├── index.ts             # 노드 함수
│   ├── types.ts             # 타입
│   ├── AgentRegistry.ts     # agent/job 역량
│   ├── workspaceAnalyzer.ts # 상태 수집
│   └── parser.ts            # LLM 응답 파싱
│
├── composition/
│   └── orchestrator.ts      # redirect/blocked 처리
│
├── infrastructure/
│   └── choice/              # 🆕 선택 시스템
│       ├── types.ts
│       ├── ChoiceService.ts
│       └── handlers/
│           ├── AskChoiceHandler.ts
│           ├── RedirectChoiceHandler.ts
│           └── BlockedChoiceHandler.ts
│
└── periphery/adapters/http/
    └── routes/
        └── chat.routes.ts   # 🆕 POST /chat/triage-choice
```

### ant-ui 추가 파일

```
src/presentation/components/chat/
└── ChoiceCard.tsx           # 🆕 선택 버튼 카드
```

---

## 9. 선택 시스템 (Choice System)

### 9.1 선택이 필요한 케이스

| 상황 | needsChoice | 선택지 |
|-----|-------------|-------|
| `proceed` (정상) | false | 없음 (바로 진행) |
| `redirect` | true | 전환 확인 |
| `blocked` (canProceed: true) | true | 진행 여부 |
| `blocked` (canProceed: false) | false | 없음 (안내만) |

### 9.2 선택지 정규화

| 상황 | 긍정 (action) | 부정 (action) |
|-----|--------------|--------------|
| redirect | 전환 (`redirect`) | 가이드 (`guide`) |
| blocked (canProceed) | 그래도 진행 (`proceedAnyway`) | 가이드 (`guide`) |

> **핵심**: 부정 선택 = 항상 `guide` (막다른 길 없음)

### 9.3 Action 차이

| Action | 의미 | 조건 |
|--------|-----|-----|
| `proceed` | 정상 진행 | 모든 조건 충족 |
| `proceedAnyway` | 경고 무시하고 진행 | required ✅, recommended ❌ |
| `redirect` | 다른 job으로 전환 | 사용자 승인 |
| `guide` | 가이드 제공 | 부정 선택 시 항상 |

### 9.4 구현 상세

#### API

```
POST /projects/:projectId/features/:featureName/chat/triage-choice

Request:
{
  "jobId": "xxx",
  "choice": "proceed" | "proceedAnyway" | "redirect" | "guide"
}

Response (guide):
{
  "type": "guide",
  "message": "현재 design job에서 가능한 작업:\n- UI 기획해줘\n- 시스템 설계해줘"
}

Response (proceed/proceedAnyway/redirect):
{
  "type": "continue",
  "action": "proceed" | "proceedAnyway" | "redirect"
}
```

#### UI 컴포넌트 (ChoiceCard.tsx)

```tsx
interface ChoiceCardProps {
  message: string;           // "(confidence: 0.52) UI 기획을 시작할까요?"
  options: {
    positive: { label: string; action: string };
    negative: { label: string; action: string };
  };
  onSelect: (action: string) => void;
  disabled?: boolean;
}

export function ChoiceCard({ message, options, onSelect, disabled }: ChoiceCardProps) {
  return (
    <div className="choice-card">
      <p className="message">{message}</p>
      <div className="buttons">
        <button onClick={() => onSelect(options.positive.action)}>
          {options.positive.label}
        </button>
        <button onClick={() => onSelect(options.negative.action)}>
          {options.negative.label}
        </button>
      </div>
    </div>
  );
}
```

#### 백엔드 플로우

```typescript
// triage 노드에서 선택 필요 시
if (triageResult.needsChoice) {
  // 1. 선택 카드 전송 (채팅 SSE)
  await chatService.sendChoiceCard(jobId, {
    message: triageResult.displayMessage,
    options: triageResult.choiceOptions
  });
  
  // 2. 작업 일시 중단 (interruption 패턴 재활용)
  return {
    ...state,
    interruption: {
      reason: 'awaiting_choice',
      canResume: true,
      metadata: { triageResult }
    }
  };
}

// 선택 API 호출 시 (chat.routes.ts)
router.post('/chat/triage-choice', async (req, res) => {
  const { jobId, choice } = req.body;
  
  if (choice === 'guide') {
    // 가이드 응답 전송
    await chatService.sendGuide(jobId, triageResult.choiceOptions.fallbackGuide);
    return res.json({ type: 'guide' });
  }
  
  // 작업 재개 (선택된 action으로)
  await resumeJob(jobId, { triageAction: choice });
  return res.json({ type: 'continue', action: choice });
});
```

### 9.5 응답 예시

#### redirect

```
┌─────────────────────────────────────────────────────────────┐
│ 코드 작업은 **code job**에서 진행해야 합니다.               │
│                                                             │
│ code job으로 전환하시겠습니까?                               │
│                                                             │
│ [전환]                  [현재 job 유지]                      │
│  ↓                       ↓                                  │
│ redirect                guide                               │
│ (code job 시작)         (design job 가능 작업 안내)          │
└─────────────────────────────────────────────────────────────┘
```

#### blocked (canProceed: true)

```
┌─────────────────────────────────────────────────────────────┐
│ 코드베이스가 인덱싱되지 않았습니다.                          │
│ 인덱싱 없이 진행하면 정확도가 떨어질 수 있습니다.            │
│                                                             │
│ [그래도 진행]           [취소]                               │
│  ↓                       ↓                                  │
│ proceedAnyway           guide                               │
│ (인덱싱 없이 시작)       (인덱싱 방법 안내)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. 프롬프트 (FPOP)

### 9.1 base.md

```markdown
# TRIAGE

## SESSION
| Field | Value |
|-------|-------|
| Agent | {{currentAgent}} |
| Job | {{currentJob}} |

## USER INPUT
{{{userInput}}}

## WORKSPACE STATE

### Inputs
{{#if hasPrd}}✅ PRD: {{prdPath}}{{else}}❌ No PRD{{/if}}
{{#if hasDirective}}✅ Directive{{else}}ℹ️ No directive{{/if}}

### References (ui-design)
{{#if hasScreens}}✅ Screens: {{screenCount}}{{else}}❌ No screens{{/if}}
{{#if hasComponents}}✅ Components: {{componentCount}}{{else}}ℹ️ No components{{/if}}
{{#if hasAssets}}✅ Assets: {{assetCount}}{{else}}ℹ️ No assets{{/if}}

### Design Documents
{{#if hasUiDocs}}✅ UI docs{{else}}❌ No UI docs{{/if}}
{{#if hasSystemDesignDoc}}✅ System design{{else}}❌ No system design{{/if}}

### Codebase
{{#if hasCodebase}}✅ Indexed ({{indexedFileCount}}){{else}}❌ Not indexed{{/if}}

## PREREQUISITES

### design job
**ui-design mode** (screens/assets 존재 시)
- Required: inputs/references/screens/
- Recommended: inputs/references/components/, inputs/assets/

**system-design mode** (PRD/directive만 있을 시)
- Required: PRD OR directive
- Recommended: existing codebase (for evolution)

### code job
- Required: design documents OR directive (하나만 있으면 됨)
- Recommended: indexed codebase

### learn job
- Required: git repository

## SCOPE (for ask intent)
**In-scope**: Ant usage, workflow, prerequisites, current state
**Out-of-scope**: General knowledge, unrelated topics

## RESPONSE FORMAT
<triage>
{
  "intent": "ask" | "work",
  
  // ask
  "inScope": true | false,
  "askResponse": "...",
  
  // work
  "workStatus": "proceed" | "redirect" | "blocked",
  "suggestedJob": "...",
  "redirectReason": "...",
  "missingPrerequisites": { "required": [], "recommended": [] },
  "canProceed": true | false,
  "blockedMessage": "...",
  "proceedAnywayOption": "..."
}
</triage>
```

### 9.2 rules.md

```markdown
# RULES

## INTENT CLASSIFICATION
| Signal | intent |
|--------|--------|
| Question words, uncertainty | `ask` |
| Action verbs, clear target | `work` |
| Ambiguous | `ask` (default) |

## GUARDRAILS (ask)
- In-scope: Ant system, current workspace, workflow
- Out-of-scope: Everything else
- Out-of-scope response: "저는 Ant 사용을 도와드립니다. 워크스페이스나 작업 방법에 대해 질문해주세요."

## WORK STATUS DETERMINATION

### design job
| 조건 | Status |
|-----|--------|
| ui-design 요청 + screens ✅ | proceed |
| ui-design 요청 + screens ❌ | blocked (canProceed: false) |
| system-design 요청 + PRD/directive ✅ | proceed |
| system-design 요청 + PRD/directive ❌ | blocked (canProceed: false) |

### code job
| 조건 | Status |
|-----|--------|
| design doc ✅ OR directive ✅ | proceed 또는 blocked (codebase에 따라) |
| design doc ❌ AND directive ❌ | blocked (canProceed: false) |
| codebase ❌ (나머지 ✅) | blocked (canProceed: true) |

### redirect 판단
| 상황 | 제안 |
|-----|-----|
| code job에서 UI 기획 요청 | → design job |
| design job에서 코드 구현 요청 | → code job |
| 분석/학습 요청 | → learn job |

## RESPONSE LANGUAGE
Respond in the same language as user input.
```

---

## 11. 개발 계획

### Phase 1: 기반 (20분)
- [ ] types.ts
- [ ] AgentRegistry.ts

### Phase 2: Triage 노드 (40분)
- [ ] base.md, rules.md
- [ ] workspaceAnalyzer.ts
- [ ] index.ts, parser.ts

### Phase 3: 그래프 통합 (30분)
- [ ] code/graph.ts, state.ts
- [ ] design/graph.ts, state.ts

### Phase 4: 선택 시스템 (60분)
- [ ] infrastructure/choice/types.ts
- [ ] infrastructure/choice/ChoiceService.ts
- [ ] infrastructure/choice/handlers/*
- [ ] chat.routes.ts (POST /chat/triage-choice)

### Phase 5: UI 컴포넌트 (40분)
- [ ] ChoiceCard.tsx
- [ ] 채팅 메시지 렌더링 수정
- [ ] 선택 결과 전송 로직

### Phase 6: 테스트 (30분)
- [ ] 분류 테스트
- [ ] 선택 플로우 테스트
- [ ] E2E 테스트

**총 예상: 4-5시간**

---

### 2순위: Ask System

> Triage 완료 후 개발. [05-ask-system.md](./05-ask-system.md) 참조

- [ ] Phase A1: Static 지식 작성 (guide/*.md)
- [ ] Phase A2: WorkspaceScanner 구현
- [ ] Phase A3: AskResponseGenerator (LLM 프롬프트)
- [ ] Phase A4: Triage 연동

**Ask System 예상: 1.5-2시간** (Triage 후)

---

## 12. 설계 결정 요약

| 항목 | 결정 |
|-----|-----|
| 분류 체계 | 2단계: Intent → WorkStatus |
| Intent | ask, work (모호하면 ask) |
| WorkStatus | proceed, redirect, blocked |
| Guardrails | ask에 적용, out-of-scope 거부 |
| Prerequisites | Job별 + 모드별 구분 |
| design job | ui-design (screens 필수), system-design (PRD/directive 필수) |
| code job | design doc OR directive (하나만 있으면 됨) |
| LLM 호출 | 1회 (분류 + 응답 동시) |
| 응답 언어 | 사용자 입력 언어 따름 |
| Redirect | 선택 필요 (전환/유지) |
| Blocked | canProceed=true면 선택지 (진행/취소) |
| 선택 시스템 | ChoiceCard UI + API + interruption 패턴 |
| 부정 선택 | 항상 `guide` (막다른 길 없음) |
| Action 종류 | proceed, proceedAnyway, redirect, guide |
