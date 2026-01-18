# Triage System 개발 계획

> **목적**: 사용자 입력의 의도를 분류하여 적절한 처리 경로로 안내하는 시스템
> 
> **작성일**: 2026-01-18
> **상태**: 계획 수립 완료

---

## 1. 개요

### 1.1 문제 정의

현재 ant 시스템은 사용자가 규칙을 모르면 사용하기 어렵다:
- 잘못된 작업(job) 선택 시 처리 방법 없음
- 사용자가 도움을 요청해도 맥락에 맞는 안내 불가
- 에이전트 간 전환 메커니즘 부재

### 1.2 솔루션: Triage System

의료 분야의 "Triage"(환자 분류 → 적절한 치료로 연결) 개념을 차용:
- 사용자 입력 분석 → 의도(intent) 분류 → 적절한 처리 경로로 라우팅

### 1.3 핵심 설계 결정

| 항목 | 결정 |
|-----|-----|
| **위치** | LangGraph 내부 (공통 노드) |
| **판단 주체** | LLM (시스템 규칙 기반 아님) |
| **토큰 추적** | 기존 시스템 그대로 사용 |
| **Workflow UI** | 기존 시스템 그대로 사용 |
| **Guide 처리** | 1회 LLM 호출로 분류 + 응답 동시 생성 |
| **Redirect 처리** | 모두 승인 필요 |
| **전환 시** | `skipTriage` 플래그로 bypass |

---

## 2. 아키텍처

### 2.1 전체 플로우

```
┌─────────────────────────────────────────────────────────────────────┐
│  orchestrator                                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Agent Graph (code / design / learn / ...)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  __start__                                                          │
│      │                                                              │
│      ▼                                                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  🏥 triage (공통 노드)                                        │   │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │   │
│  │  - skipTriage=true → 즉시 work 반환                          │   │
│  │  - LLM 호출 → intent 분류                                    │   │
│  │  - 토큰 추적 (기존 패턴)                                      │   │
│  │  - Workflow UI 업데이트 (기존 패턴)                           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          │                                          │
│           ┌──────────────┼──────────────┐                           │
│           │              │              │                           │
│       work           guide         redirect                         │
│           │              │              │                           │
│           ▼              ▼              ▼                           │
│       resolve      guideResponse   requestApproval                  │
│       (기존)         (NEW)           (NEW)                          │
│           │              │              │                           │
│           ▼              ▼              ▼                           │
│       detectEnv      __end__       __end__                          │
│       (기존)                     (승인 시스템으로)                   │
│           │                                                         │
│           ▼                                                         │
│       ... (기존 플로우)                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Intent 분류

| Intent | 설명 | 처리 |
|--------|-----|-----|
| `work` | 실제 작업 요청 | 기존 플로우 진행 (resolve → ...) |
| `guide` | 도움/정보 요청 | 가이드 템플릿 + LLM 응답 → 종료 |
| `redirect` | 작업 불일치 감지 | 승인 요청 → 에이전트/작업 전환 |

### 2.3 파일 구조

```
src/
├── core/
│   └── prompt/
│       └── templates/
│           └── triage/                 # 🆕 Triage 프롬프트 템플릿
│               ├── base.md             # 컨텍스트 + guide 지식 포함
│               └── rules.md            # 분류 규칙 + guide 응답 규칙
│
├── agents/
│   └── common/
│       └── nodes/
│           └── triage/                 # 🆕 Triage 노드 (모든 로직 여기에)
│               ├── index.ts            # 노드 함수 (export default)
│               ├── types.ts            # TriageResult, TriageableState
│               ├── AgentRegistry.ts    # 에이전트 역량 정의
│               └── parser.ts           # LLM 응답 파싱
│
├── composition/
│   └── orchestrator.ts                 # 수정: redirect 결과 처리
│
└── infrastructure/
    └── approval/                       # 🆕 승인 시스템
        ├── ApprovalService.ts          # 승인 관리
        ├── types.ts                    # 승인 타입
        └── handlers/
            └── RedirectApprovalHandler.ts
```

> 💡 **1회 LLM 호출 원칙**:
> - Triage는 **1회 LLM 호출**로 의도 분류 + guide 응답까지 처리
> - guide 지식은 `base.md`에 포함 (별도 파일 분리 없음)
> - 레이턴시 최소화, 로직 단순화

---

## 3. 상세 설계

### 3.1 Triage State 인터페이스

```typescript
// agents/common/nodes/triage/types.ts

export interface TriageResult {
  intent: 'work' | 'guide' | 'redirect';
  confidence: number;
  
  // guide인 경우
  guideResponse?: string;
  
  // redirect인 경우
  suggestedAgent?: string;
  suggestedTask?: string;
  mismatchReason?: string;
}

export interface TriageableState {
  // 기존 필수 필드
  context: ProjectContext;
  spec: string;
  deps?: {
    llm?: LLMClient;
    workflowUpdate?: WorkflowStateUpdatePort;
  };
  _httpJobId?: string;
  tokenUsage?: TokenUsage;
  
  // Triage 전용
  skipTriage?: boolean;
  triageResult?: TriageResult;
  
  // 현재 작업 정보 (Triage 판단용)
  currentAgent?: string;
  currentTask?: string;
}
```

### 3.2 Agent Registry

```typescript
// agents/common/nodes/triage/AgentRegistry.ts

/**
 * LLM이 선택할 수 있는 정규화된 응답 목록
 * 
 * ⚠️ 주의: keywords는 의도적으로 제외됨
 * - LLM은 다국어를 이해하므로 키워드 매칭 불필요
 * - 키워드 기반 분류는 시스템 판단 → LLM 판단 원칙 위배
 * - LLM이 description과 context를 보고 스스로 판단
 */
export const AGENT_REGISTRY = {
  agents: ['architect', 'reviewer', 'planner', 'doc'] as const,
  
  tasks: {
    architect: ['design', 'code', 'learn'] as const,
    reviewer: ['review'] as const,
    planner: ['plan'] as const,
    doc: ['doc'] as const,
  },
  
  // LLM 프롬프트에 주입될 역량 설명 (영어 only - 프롬프트 규칙)
  capabilities: {
    architect: {
      design: {
        description: 'Generate system design documents, UI specification documents',
        prerequisites: ['PRD or directive file'],
        produces: ['system-design.md', 'ui-spec.json'],
      },
      code: {
        description: 'Generate, modify, or fix code based on design documents',
        prerequisites: ['Design document', 'Git repository'],
        produces: ['Source code files'],
      },
      learn: {
        description: 'Analyze and index codebase for knowledge extraction',
        prerequisites: ['Git repository'],
        produces: ['Lessons in vector DB'],
      },
    },
    reviewer: {
      review: {
        description: 'Review code changes and provide feedback',
        prerequisites: ['PR diff or code changes'],
        produces: ['Review comments'],
      },
    },
    planner: {
      plan: {
        description: 'Create sprint plans from issues and commits',
        prerequisites: ['Issue list', 'Commit history'],
        produces: ['Sprint plan'],
      },
    },
    doc: {
      doc: {
        description: 'Generate documentation from codebase',
        prerequisites: ['Codebase'],
        produces: ['README, API docs'],
      },
    },
  },
  
} as const;

export type AgentName = typeof AGENT_REGISTRY.agents[number];
export type TaskName<A extends AgentName> = typeof AGENT_REGISTRY.tasks[A][number];
```

### 3.3 Triage 노드

```typescript
// agents/common/nodes/triage/index.ts

import { TriageableState, TriageResult } from './types';
import { AGENT_REGISTRY } from './AgentRegistry';
import { parseTriageResponse } from './parser';
import { accumulateTokenUsage, extractTokenUsageFromStreamEvent } from '../../architect/graph/common/llmHelpers';

export async function triage<T extends TriageableState>(
  state: T
): Promise<Partial<T>> {
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. Bypass 체크
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.skipTriage) {
    console.log('🏥 [Triage] Bypassed (redirect transfer)');
    return { 
      triageResult: { intent: 'work', confidence: 1.0 } 
    } as Partial<T>;
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏥 TRIAGE: Analyzing user intent');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. Workflow UI 진입
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'triage');
  }
  
  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. 프롬프트 구성 (guide 지식 포함)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const prompt = buildTriagePrompt(state);  // guide 지식이 이미 포함됨
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. LLM 호출 (1회로 분류 + guide 응답까지)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const llm = state.deps?.llm;
    if (!llm) {
      throw new Error('[Triage] LLM not available');
    }
    
    let response = '';
    let capturedUsage: any;
    
    for await (const event of llm.stream([
      { role: 'user', content: prompt }
    ], {
      temperature: 0.2,
      maxTokens: 4000,
    })) {
      if (event.text) {
        response += event.text;
      }
      const usage = extractTokenUsageFromStreamEvent(event);
      if (usage) capturedUsage = usage;
    }
    
    // 토큰 누적
    if (capturedUsage) {
      accumulateTokenUsage(state as any, capturedUsage, { jobLevel: true });
      console.log(`   Tokens: ${capturedUsage.totalTokens} total`);
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. 응답 파싱 (intent + guideResponse 동시 추출)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const triageResult = parseTriageResponse(response);
    // guide인 경우 guideResponse가 이미 포함되어 있음
    
    console.log(`✅ Intent: ${triageResult.intent} (confidence: ${triageResult.confidence})`);
    if (triageResult.intent === 'guide') {
      console.log(`   Guide response generated`);
    }
    if (triageResult.intent === 'redirect') {
      console.log(`   Suggested: ${triageResult.suggestedAgent}/${triageResult.suggestedTask}`);
      console.log(`   Reason: ${triageResult.mismatchReason}`);
    }
    
    return { triageResult } as Partial<T>;
    
  } finally {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 6. Workflow UI 종료
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'triage');
    }
  }
}
```

### 3.4 User Interaction System (승인 시스템)

```typescript
// infrastructure/approval/types.ts

export type ApprovalType = 'redirect' | 'destructive' | 'confirm';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface ApprovalRequest {
  id: string;
  jobId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  
  // redirect 전용
  redirect?: {
    fromAgent: string;
    fromTask: string;
    toAgent: string;
    toTask: string;
    reason: string;
  };
  
  // 메시지
  message: string;
  options: {
    approve: string;  // "예, 디자인 잡으로 전환"
    reject: string;   // "아니오, 코드 잡 유지"
  };
}

export interface ApprovalResult {
  requestId: string;
  status: 'approved' | 'rejected';
  resolvedAt: string;
}
```

---

## 4. 구현 계획

### Phase 1: 기반 구조 (15-20분)

| Task | 파일 | 설명 |
|------|-----|-----|
| 1.1 | `agents/common/nodes/triage/types.ts` | 타입 정의 |
| 1.2 | `agents/common/nodes/triage/AgentRegistry.ts` | 에이전트 역량 정의 |
| 1.3 | `agents/common/nodes/triage/index.ts` | 노드 함수 + exports |

### Phase 2: Triage 노드 (30-45분)

| Task | 파일 | 설명 |
|------|-----|-----|
| 2.1 | `core/prompt/templates/triage/base.md` | Triage 프롬프트 (FPOP) |
| 2.2 | `core/prompt/templates/triage/rules.md` | 분류 규칙 |
| 2.3 | `agents/common/nodes/triage/index.ts` | Triage 노드 구현 |
| 2.4 | `agents/common/nodes/triage/parser.ts` | LLM 응답 파싱 |

### Phase 3: 그래프 통합 (20-30분)

| Task | 파일 | 설명 |
|------|-----|-----|
| 3.1 | `architect/graph/code/graph.ts` | Code 그래프에 triage 추가 |
| 3.2 | `architect/graph/code/state.ts` | State에 Triage 필드 추가 |
| 3.3 | `architect/graph/design/graph.ts` | Design 그래프에 triage 추가 |
| 3.4 | `architect/graph/design/state.ts` | State에 Triage 필드 추가 |

### Phase 4: Guide 지식 작성 (15-20분)

| Task | 파일 | 설명 |
|------|-----|-----|
| 4.1 | `core/prompt/templates/triage/base.md` 확장 | guide 지식 섹션 추가 |
| 4.2 | `core/prompt/templates/triage/rules.md` 확장 | guide 응답 규칙 추가 |

### Phase 5: 승인 시스템 (45-60분)

| Task | 파일 | 설명 |
|------|-----|-----|
| 5.1 | `infrastructure/approval/types.ts` | 타입 정의 |
| 5.2 | `infrastructure/approval/ApprovalService.ts` | 승인 관리 |
| 5.3 | `infrastructure/approval/handlers/RedirectApprovalHandler.ts` | Redirect 처리 |
| 5.4 | `composition/orchestrator.ts` | Redirect 결과 처리 수정 |
| 5.5 | HTTP Routes | 승인 API 엔드포인트 |
| 5.6 | UI 컴포넌트 | 승인 UI (ant-ui) |

### Phase 6: 테스트 및 마무리 (20-30분)

| Task | 설명 |
|------|-----|
| 6.1 | E2E 테스트 |
| 6.2 | 문서화 |
| 6.3 | 기존 기능 회귀 테스트 |

---

## 5. 프롬프트 설계 (FPOP 원칙 준수)

> ⚠️ **FPOP 원칙**: First-Principles Observation Prompting
> - 모든 프롬프트는 **영어로만** 작성
> - **WHAT/HOW 분리**: base.md (데이터/컨텍스트) / rules.md (규칙/제약)
> - 구체적 예시 ❌ → 관찰 대상과 원칙만 ✅

### 5.1 base.md (WHAT: 컨텍스트와 데이터)

```markdown
# core/prompt/templates/triage/base.md
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# WHAT: Context, data, current state (NO rules here)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## CURRENT SESSION

| Field | Value |
|-------|-------|
| Agent | {{currentAgent}} |
| Task | {{currentTask}} |

## USER INPUT

{{{userInput}}}

## PROJECT STATE

{{#if hasDesignDoc}}
✅ Design documents exist in outputs/
{{else}}
❌ No design documents found
{{/if}}

{{#if hasCodebase}}
✅ Codebase is indexed in vector DB
{{else}}
❌ Codebase not indexed
{{/if}}

{{#if hasPrd}}
✅ PRD/Directive exists in inputs/
{{else}}
❌ No PRD/Directive found
{{/if}}

## AVAILABLE OPTIONS

### Intents
- `work`: Proceed with actual task execution
- `guide`: Provide help/information response
- `redirect`: Suggest switching to different agent/task

### Agents and Tasks
{{#each capabilities}}
**{{@key}}**
{{#each this}}
- `{{@key}}`: {{description}}
  - Prerequisites: {{prerequisites}}
  - Produces: {{produces}}
{{/each}}
{{/each}}

---

## GUIDE KNOWLEDGE

Use this information when intent is `guide`:

### Workflow
Ant follows a design-first workflow:
1. Prepare PRD/directive in inputs/ directory
2. Run design job → generates system-design.md, ui-spec.json
3. Run code job → generates code based on design documents

### Prerequisites
- **Design Task**: PRD or directive file in inputs/
- **Code Task**: Design documents in outputs/design/, indexed codebase

### Troubleshooting
- "Missing PRD" → Create directive file in inputs/
- "No design document" → Run design task first
- "No codebase context" → Run learn task first

## RESPONSE FORMAT

<triage>
{
  "intent": "work" | "guide" | "redirect",
  "confidence": 0.0-1.0,
  "reasoning": "...",
  
  // For guide intent only:
  "guideResponse": "...",
  
  // For redirect intent only:
  "suggestedAgent": "...",
  "suggestedTask": "...",
  "mismatchReason": "..."
}
</triage>
```

### 5.2 rules.md (HOW: 규칙과 제약)

```markdown
# core/prompt/templates/triage/rules.md
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# HOW: Rules, constraints, classification principles (NO data here)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## OBSERVATION PROTOCOL

### Step 1: Observe User Intent

| Observation Target | What to Look For |
|-------------------|------------------|
| **Request Type** | Action request vs. Question vs. Confusion |
| **Specificity** | Clear target vs. Vague/exploratory |
| **Context Match** | Does request align with current agent/task? |

### Step 2: Observe Project State

| Observation Target | Implication |
|-------------------|-------------|
| **Missing Prerequisites** | May need `guide` to explain what's needed |
| **Wrong Task Selected** | May need `redirect` to appropriate task |

## CLASSIFICATION PRINCIPLES

### Principle 1: Observable Over Assumed

> "Classify based on what is explicitly stated, not inferred."

- ⚠️ **Blind Spot**: Tendency to assume `work` when user is actually confused
- **Constraint**: If intent is ambiguous, classify as `guide`

### Principle 2: Safety Over Efficiency

> "When uncertain, provide help rather than execute potentially wrong action."

- **Constraint**: DO NOT classify as `work` with confidence < 0.7
- **Constraint**: DO NOT classify as `redirect` with confidence < 0.8

### Principle 3: Context-Aware Matching

> "Consider current agent/task when evaluating intent."

- **Observe**: Does the request match current task's capabilities?
- **Constraint**: If clear mismatch observed, classify as `redirect`
- **Constraint**: If mismatch is subtle, classify as `guide` to clarify

## CONFIDENCE SCORING

| Score | Meaning | Action |
|-------|---------|--------|
| 0.9-1.0 | Unambiguous, explicit intent | Proceed with classification |
| 0.7-0.9 | Clear intent, minor ambiguity | Proceed with caution |
| 0.5-0.7 | Moderate ambiguity | ⚠️ Prefer `guide` |
| < 0.5 | High ambiguity | **MUST be `guide`** |

## RESPONSE CONSTRAINTS

### For `work` intent:
- ONLY when user clearly requests an action within current task scope
- MUST have confidence ≥ 0.7

### For `guide` intent:
- Include `guideResponse` with helpful answer based on GUIDE KNOWLEDGE
- Respond in the **same language as user input**
- Be concise but complete

### For `redirect` intent:
- Include `suggestedAgent` and `suggestedTask`
- Include `mismatchReason` explaining why current task doesn't fit
- MUST have confidence ≥ 0.8
```

### 5.3 FPOP 체크리스트 (프롬프트 작성 시 검증)

| ❌ NEVER | ✅ ALWAYS |
|---------|----------|
| 구체적 예시 (Footer, Hero 등) | 관찰 대상 명시 |
| 메서드 설명 (LLM이 이미 앎) | 제약 조건 명시 |
| Edge case 나열 (If A→X, B→Y) | 원칙 명시 |
| 플랫폼 특화 용어 | 범용 언어 사용 |
| 값 매핑 (Top=flex-start) | 맹점 리마인더 (⚠️) |

---

## 6. Guide Knowledge 구조

> ⚠️ **핵심 원칙**: **1회 LLM 호출**로 의도 분류 + guide 응답까지 처리
> - Guide 지식은 `base.md`에 포함 (별도 파일 없음)
> - LLM이 사용자 입력 언어를 감지하여 해당 언어로 응답 생성

### 6.1 프롬프트 구조

```
core/prompt/templates/triage/
├── base.md     # 컨텍스트 + Guide 지식 포함
└── rules.md    # 분류 규칙 + Guide 응답 규칙
```

### 6.2 base.md에 Guide 지식 포함

```markdown
## GUIDE KNOWLEDGE

### Workflow
Ant follows a design-first workflow:
1. Prepare PRD/directive in inputs/ directory
2. Run design job → generates system-design.md, ui-spec.json
3. Run code job → generates code based on design documents

### Prerequisites

#### Design Task
- PRD or directive file in inputs/
- (Optional) Reference screenshots in inputs/references/

#### Code Task
- Design documents must exist in outputs/design/
- Codebase should be indexed (run learn task first)

### Capabilities
- Design: System design documents, UI specifications
- Code: Generate, modify, fix code based on design
- Learn: Analyze and index codebase

### Troubleshooting
- "Missing PRD" → Create directive file in inputs/
- "No design document" → Run design task first
- "No codebase context" → Run learn task first
```

### 6.3 동작 방식 (1회 호출)

```
Triage 노드 (1회 LLM 호출)
    │
    ├── 프롬프트: base.md + rules.md (guide 지식 포함)
    │
    ▼
LLM 응답:
{
  "intent": "guide",
  "confidence": 0.9,
  "guideResponse": "Ant는 design-first 워크플로우를 따릅니다..."
}
    │
    ▼
파싱 후 바로 사용자에게 전달 (추가 LLM 호출 없음)
```

### 6.4 장점

| 항목 | 2회 호출 (이전) | 1회 호출 (현재) |
|-----|---------------|---------------|
| **레이턴시** | 높음 | 낮음 ✅ |
| **복잡도** | 높음 | 낮음 ✅ |
| **파일 수** | 많음 (guide/*.md) | 적음 (base.md만) ✅ |
| **토큰** | 분리됨 | 약간 증가 (무시 가능) |

---

## 7. 의존성 및 영향 분석

### 7.1 수정되는 기존 파일

| 파일 | 수정 내용 |
|-----|----------|
| `architect/graph/code/graph.ts` | triage 노드 추가, 엣지 수정 |
| `architect/graph/code/state.ts` | TriageableState 확장 |
| `architect/graph/design/graph.ts` | triage 노드 추가, 엣지 수정 |
| `architect/graph/design/state.ts` | TriageableState 확장 |
| `composition/orchestrator.ts` | skipTriage 전달, redirect 처리 |

### 7.2 새로 생성되는 파일

| 경로 | 설명 |
|-----|-----|
| `agents/common/nodes/triage/*` | Triage 노드 전체 (타입, 로직, 파싱) |
| `core/prompt/templates/triage/*` | Triage 프롬프트 템플릿 |
| `infrastructure/approval/*` | 승인 시스템 |

### 7.3 UI 변경 (ant-ui)

| 컴포넌트 | 변경 |
|---------|-----|
| 채팅 UI | 승인 요청 메시지 표시 |
| 승인 버튼 | 승인/거부 액션 |
| Workflow UI | triage 노드 표시 |

---

## 8. 체크리스트

### Phase 1 완료 조건
- [ ] `agents/common/nodes/triage/types.ts` 작성 완료
- [ ] `agents/common/nodes/triage/AgentRegistry.ts` 작성 완료
- [ ] 타입 검사 통과

### Phase 2 완료 조건
- [ ] Triage 프롬프트 FPOP 원칙 준수
- [ ] Triage 노드 구현 완료
- [ ] 단위 테스트 통과

### Phase 3 완료 조건
- [ ] Code 그래프 통합 완료
- [ ] Design 그래프 통합 완료
- [ ] 기존 테스트 회귀 없음

### Phase 4 완료 조건
- [ ] base.md에 Guide 지식 섹션 추가
- [ ] rules.md에 Guide 응답 규칙 추가
- [ ] Guide 응답 품질 확인

### Phase 5 완료 조건
- [ ] 승인 API 동작 확인
- [ ] UI 통합 완료
- [ ] Redirect 전환 동작 확인

### Phase 6 완료 조건
- [ ] E2E 테스트 통과
- [ ] 문서화 완료
- [ ] 코드 리뷰 완료

---

## 9. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|-------|-----|-----|
| Triage LLM 호출 추가로 인한 비용 증가 | 중 | 경량 프롬프트, 캐싱 고려 |
| Guide 템플릿 내용 부족 | 중 | 가이드 문서 품질 관리, 피드백 반영 |
| 기존 플로우 회귀 | 상 | 충분한 테스트 |
| UI 승인 UX 복잡도 | 중 | 단순한 UI 설계 |

---

## 10. 참고 자료

### 코드 참조
- [기존 detectEnvironment 구현](/packages/ant-cli/src/agents/architect/graph/code/nodes/detectEnvironment)
- [토큰 추적 시스템](/packages/ant-cli/src/agents/architect/graph/common/llmHelpers.ts)
- [Workflow UI 시스템](/packages/ant-cli/src/periphery/adapters/http/services/WorkflowStateService.ts)

### 프롬프트 작성 규칙
- [FPOP 원칙 및 프롬프트 규칙](/.cursorrules)
  - WHAT/HOW 분리 (base.md / rules.md)
  - 영어로만 작성
  - 구체적 예시 ❌ → 원칙과 관찰 대상 ✅
  - 플랫폼 중립적 표현

### FPOP 6가지 원칙 요약

| 원칙 | 의미 |
|-----|-----|
| Principles over Examples | 구체적 예시 대신 보편적 규칙 |
| What over How | 방법이 아닌 관찰 대상 명시 |
| Observable over Assumed | 추론 금지, 관찰만 |
| Universal over Specific | 플랫폼/언어 중립 |
| Constraints over Instructions | 지시보다 제약 |
| Reminders for Blind Spots | 맹점 리마인더 (⚠️) |

---

## 11. AI 코드 생성 예상 시간

> 아래는 AI(Claude)가 코드를 생성하는 데 걸리는 예상 시간입니다.
> 실제 시간은 리뷰, 디버깅, 테스트에 따라 달라질 수 있습니다.

### 11.1 Phase별 예상 소요 시간

| Phase | 작업 | AI 생성 시간 | 비고 |
|-------|------|------------|------|
| **Phase 1** | 기반 구조 (types, registry) | 15-20분 | 타입 정의, 단순 |
| **Phase 2** | Triage 노드 + 프롬프트 | 30-45분 | 핵심 로직, FPOP 준수 필요 |
| **Phase 3** | 그래프 통합 | 20-30분 | 기존 코드 수정, 주의 필요 |
| **Phase 4** | Guide 지식 추가 | 15-20분 | base.md 확장만 |
| **Phase 5** | 승인 시스템 | 45-60분 | UI 포함, 가장 복잡 |
| **Phase 6** | 테스트 및 마무리 | 20-30분 | 통합 테스트 |

### 11.2 총 예상 시간

| 구분 | 시간 |
|-----|-----|
| **AI 코드 생성** | 2 - 3 시간 |
| **리뷰 및 수정** | +1 - 1.5 시간 |
| **디버깅** | +0.5 - 1 시간 |
| **총 예상** | **3.5 - 5.5 시간** |

### 11.3 토큰 사용량 예측

| Phase | 예상 토큰 (입력+출력) |
|-------|---------------------|
| Phase 1 | ~10,000 |
| Phase 2 | ~25,000 |
| Phase 3 | ~15,000 |
| Phase 4 | ~10,000 |
| Phase 5 | ~35,000 |
| Phase 6 | ~10,000 |
| **총합** | **~105,000 토큰** |

### 11.4 권장 진행 방식

```
1. Phase 1-4를 한 세션에서 진행 (1.5시간)
   - 기반 구조 + Triage 노드 + 그래프 통합 + Guide 지식
   - 여기까지 완료하면 'work' + 'guide' intent 동작 확인 가능

2. Phase 5를 별도 세션 (1시간)
   - 승인 시스템 (가장 복잡)
   - 'redirect' intent 동작 확인 가능

3. Phase 6 마무리 (30분)
   - 통합 테스트, 문서화
```

> 💡 **팁**: Phase 1-4까지 완료하면 Triage의 핵심 기능이 동작합니다.
> 승인 시스템은 이후 점진적으로 추가 가능합니다.
