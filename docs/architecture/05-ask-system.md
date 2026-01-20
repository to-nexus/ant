# Ask System

> **Ant 시스템 자체**에 대한 질문에 응답하는 시스템
> 
> **상태**: 설계 진행 중 (2순위 개발)
> **의존성**: Triage System 완료 후 개발

---

## 1. 개요

### 1.1 Ask vs Code Job Explain

| 시스템 | 범위 | 지식 소스 |
|-------|-----|----------|
| **Ask System** | Ant 시스템 자체 | Ant 공통 지식 (Static) |
| **Code Job Explain** | 프로젝트 코드베이스 | 조직 VectorDB |

```
┌─────────────────────────────────────────────────────────────┐
│ 질문 라우팅                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  "디자인잡 하려면 뭐 필요해?"                                 │
│       └─→ Ask System (Ant 시스템 질문)                       │
│                                                             │
│  "로그인 로직 어디있어?"                                      │
│       └─→ Code Job Explain (코드베이스 질문)                 │
│                                                             │
│  "이 프로젝트 패턴 알려줘"                                    │
│       └─→ Code Job Explain (코드베이스 질문)                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Ask System 범위

| ✅ Ask 처리 | ⚠️ Triage Redirect | ❌ Out-of-Scope |
|------------|-------------------|----------------|
| Ant 사용법 | 코드베이스 질문 | 일반 지식 |
| Job별 역할/준비물 | 다른 Job 필요한 작업 | 날씨, 뉴스 등 |
| 워크플로우 안내 | | |
| 워크스페이스 상태 | | |
| 다음 단계 안내 | | |
| 에러 해결 (Ant 관련) | | |

### 1.3 지식 소스

```
┌─────────────────────────────────────────────────────────────┐
│ Ask System 지식 소스 (제한된 범위)                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 📖 Static Knowledge (Ant 공통 지식)                          │
│ ├── Agent 소개                                              │
│ ├── Job별 역할/준비물                                        │
│ ├── 워크플로우 설명                                          │
│ └── 에러 해결 가이드 (Ant 관련)                              │
│                                                             │
│ 📁 Workspace State (현재 상태)                               │
│ ├── inputs/ 존재 여부 (템플릿 마커 체크 포함)                │
│ ├── outputs/ 존재 여부                                      │
│ └── 작업 가능 여부 판단용                                    │
│                                                             │
│ ❌ 사용 안 함                                                │
│ ├── codebase VectorDB                                       │
│ ├── lessons VectorDB                                        │
│ ├── documents VectorDB                                      │
│ └── Reference Projects                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 응답 방식

### 2.1 카테고리 분류 없음

카테고리로 나누면 겹치는 질문이 많아 무의미:
- "코드 짜려면?" → usage? next_step? prerequisites? 다 겹침

**→ LLM에게 모든 컨텍스트를 주고 응답하게 함**

### 2.2 LLM에 주입되는 컨텍스트

| 컨텍스트 | 내용 | 용도 |
|---------|-----|-----|
| **Static 지식** | Agent/Job 역할, prerequisites, 워크플로우 | 모든 질문 |
| **Workspace 상태** | inputs/, outputs/ 존재 여부 | 맥락 기반 응답 |
| **사용자 질문** | 원문 그대로 | |

### 2.3 Ask vs Triage Redirect

| 질문 유형 | 처리 시스템 | 플로우 |
|----------|-----------|-------|
| **Ant 시스템 질문** | Ask | 응답 생성 |
| **다른 Job 필요** | Triage | redirect → Choice System |
| **일반 지식** | Ask | 범위 외 안내 |

```
"로그인 로직 어디있어?" (Design Job에서)
    ↓
Triage: work intent, redirect status (Code Job 필요)
    ↓
Choice System: "Code Job으로 전환할까요?"
```

> ⚠️ **코드베이스 질문은 Ask가 아닌 Triage redirect로 처리**

---

## 3. 응답 생성

### 3.1 파이프라인

```
┌─────────────────────────────────────────────────────────────┐
│ Ask Pipeline (단순화)                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 컨텍스트 수집 (시스템)                                   │
│     ├── Static 지식 (Ant 공통) - 전체 주입                   │
│     └── Workspace 상태 - inputs/, outputs/ 스캔             │
│                                                             │
│  2. 응답 생성 (LLM)                                          │
│     ├── In-scope: 컨텍스트 기반 응답                         │
│     └── Out-of-scope: 범위 외 안내                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 LLM 호출

| 단계 | LLM | 설명 |
|-----|-----|-----|
| 컨텍스트 수집 | ❌ | 시스템이 파일 스캔 |
| **응답 생성** | ✅ | Static + Workspace + 질문 → 응답 |

**LLM 1회 호출**: 다국어 지원, 맥락 기반 자연어 응답

---

## 4. 응답 예시

### 4.1 맥락 기반 응답

```
Q: "코드 짜려면 무슨 명령 넣어야 해?"

[LLM이 받는 컨텍스트]
- Static: Code Job = design doc 기반 코드 생성, 채팅으로 바로 요청도 가능
- Workspace: design doc ❌, PRD ✅

A: Code Job을 선택하고 원하는 작업을 채팅에 입력하면 됩니다.

현재 design doc이 없지만 두 가지 방법이 있어요:

1. **체계적 개발**: Design Job으로 먼저 설계 → Code Job
2. **바로 요청**: Code Job에서 채팅에 "로그인 페이지 만들어줘" 입력

→ 큰 기능은 1번, 간단한 수정은 2번 추천
```

### 4.2 상태 확인

```
Q: "지금 뭐가 있어?"

A: 📁 현재 워크스페이스 상태입니다.

**Inputs**
✅ PRD: inputs/prd.md
❌ References: 없음

**Outputs**
❌ Design docs: 없음

**가능한 작업**
→ Design Job (System Design): 바로 가능
→ Design Job (UI Design): references 필요
→ Code Job: design doc 있으면 자동 진행, 없으면 채팅에 원하는 작업 입력
```

### 4.3 Out-of-scope: 일반 지식

```
Q: "오늘 날씨 어때?"

A: 저는 Ant 시스템 사용을 도와드립니다.

**질문 예시**
- "코드 짜려면?" - 방법 안내
- "지금 뭐가 있어?" - 현재 상태
- "디자인잡 하려면?" - 준비물 안내
```

---

## 5. 타입 정의

```typescript
// ⚠️ Triage의 WorkspaceState 재사용 (04-triage-system.md 참조)
// - hasPrd, hasScreens, hasAssets, hasDesignDoc 등
// - 템플릿 마커(<!-- ant:template -->) 체크 포함

// 응답
interface AskResponse {
  inScope: boolean;        // Ant 관련 질문 여부
  content: string;         // 응답 내용
  suggestions?: string[];  // 후속 질문 제안
}
```

> **WorkspaceState**: Triage에서 이미 수집하므로, Ask는 이를 재사용

---

## 6. Static Knowledge

### 6.1 구조

```
src/core/prompt/templates/triage/guide/
├── agent-overview.md     # Agent 소개
├── job-guide.md          # Job별 역할, prerequisites, 사용법
└── workflow.md           # 전체 워크플로우
```

### 6.2 LLM 프롬프트 구성

```
┌─────────────────────────────────────────────────────────────┐
│ Ask 프롬프트                                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ## Ant System Knowledge                                     │
│ {agent-overview.md}                                         │
│ {job-guide.md}                                              │
│ {workflow.md}                                               │
│                                                             │
│ ## Current Workspace State                                  │
│ - PRD: ✅                                                   │
│ - References: ❌                                            │
│ - Design docs: ❌                                           │
│ ...                                                         │
│                                                             │
│ ## User Question                                            │
│ {userInput}                                                 │
│                                                             │
│ ## Instructions                                             │
│ - Ant 관련 질문: 위 지식과 상태를 참고해 응답                 │
│ - 코드베이스 질문: Code Job으로 안내                         │
│ - 범위 외 질문: Ant 관련 질문 예시 제공                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

> **빌드 시 프롬프트 엔진에 포함** (VectorDB 아님)

---

## 7. 파일 구조

```
src/
├── core/
│   ├── ask/                            # Ask 시스템
│   │   ├── index.ts                    # 메인 진입점
│   │   ├── types.ts                    # 타입 정의
│   │   ├── WorkspaceScanner.ts         # Workspace 상태 스캔
│   │   └── AskResponseGenerator.ts     # LLM 응답 생성
│   │
│   └── prompt/templates/triage/
│       └── guide/                      # Static 지식 (Ant 공통)
│           ├── agent-overview.md       # Agent 소개
│           ├── job-guide.md            # Job별 역할/prerequisites
│           └── workflow.md             # 워크플로우
│
└── agents/common/nodes/triage/
    └── index.ts                        # Ask 호출
```

---

## 8. 개발 계획

### Phase 0: 기존 코드 정리 (10분)
- [ ] `getFeatureInputsGuideMarkdown()` 제거 (하드코딩)
- [ ] 해당 내용을 `guide/job-guide.md`로 이동

### Phase 1: Static 지식 작성 (30분)
- [ ] guide/agent-overview.md
- [ ] guide/job-guide.md (prerequisites + 기존 가이드 통합)
- [ ] guide/workflow.md

### Phase 2: 시스템 구현 (40분)
- [ ] types.ts
- [ ] WorkspaceScanner.ts
- [ ] AskResponseGenerator.ts (LLM 프롬프트)

### Phase 3: Triage 연동 (20분)
- [ ] Triage에서 Ask 호출
- [ ] 채팅 UI 연동

**총 예상: 1.5-2시간**

---

## 9. Code Job Explain과의 비교

| 항목 | Ask System | Code Job Explain |
|-----|-----------|------------------|
| **범위** | Ant 시스템 | 프로젝트 코드베이스 |
| **지식 소스** | Static (Ant 공통) | VectorDB (조직별) |
| **복잡도** | 단순 (Static 지식) | 복잡 (RAG 검색) |
| **LLM 호출** | 1회 (응답 생성) | 다회 (검색 + 응답) |
| **예시** | "Ant 뭐야?" | "로그인 로직 어디있어?" |

---

## 10. 설계 결정

| 항목 | 결정 | 이유 |
|-----|-----|-----|
| 카테고리 분류 | ❌ 없음 | 질문이 겹침, LLM이 맥락으로 판단 |
| LLM 호출 | 1회 (응답 생성) | 다국어, 자연어 응답 |
| Out-of-scope | 안내 | Code Job으로 유도 |
| 향후 확장 | Ant 공통 VectorDB | 추후 검토 |
