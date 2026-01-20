# Triage & Ask System 요약

> 이 문서는 04-triage-system.md와 05-ask-system.md의 핵심을 요약한 것입니다.

---

## 1. Triage System

### 1.1 입력

| 입력 | 설명 |
|------|------|
| **사용자 입력** | 채팅 메시지 (자연어) |
| **현재 Job** | design / code / learn |
| **Workspace 상태** | 파일 존재 여부 (PRD, screens, design docs 등) |

### 1.2 분류 (2단계)

```
사용자 입력
    │
    ▼
┌────────────────────────────────────┐
│ 1단계: Intent (의도)                │
│   ask  → 질문/도움 요청             │
│   work → 작업 요청                  │
└────────────────────────────────────┘
    │
    ├─── ask ────────────────────────────┐
    │                                    │
    │   ┌──────────────────────┐         │
    │   │ Ask System으로 위임    │         │
    │   │ (별도 문서화)          │         │
    │   └──────────────────────┘         │
    │                                    │
    └─── work ───────────────────────────┤
                   │                     │
                   ▼                     │
         ┌────────────────────────────┐  │
         │ 2단계: WorkStatus (시스템)  │  │
         │   proceed  → 진행 가능      │  │
         │   redirect → 다른 job 적합  │  │
         │   blocked  → 준비물 부족    │  │
         └────────────────────────────┘  │
```

### 1.3 Intent 분류 기준

| Intent | 조건 | 예시 |
|--------|------|------|
| **ask** | 질문형 표현, 도움 요청, 모호한 입력 | "뭐 준비해야 해?", "어떻게 하면 돼?" |
| **work** | 명령형 표현, 명확한 목표 | "로그인 페이지 만들어", "이거 수정해" |

**원칙**: 모호한 경우 `ask`로 분류 (확인보다 자연스러운 대화 흐름)

### 1.4 WorkStatus 결정 기준

| Status | 조건 | 후속 처리 |
|--------|------|-----------|
| **proceed** | 현재 job + 준비물 충족 | 바로 작업 진행 |
| **redirect** | 다른 job이 더 적합 | 사용자에게 전환 여부 확인 |
| **blocked** | 현재 job이지만 준비물 부족 | 부족한 것 안내 + 선택지 |

**redirect 판단**:
| 현재 Job | 요청 내용 | 제안 |
|----------|----------|------|
| code | "UI 기획해줘" | → design |
| design | "코드로 구현해" | → code |
| design/code | "프로젝트 분석해줘" | → learn |

**blocked 판단 (Required/Recommended)**:
| 구분 | 없으면 | canProceed |
|------|--------|-----------|
| **Required** | 진행 불가 | false |
| **Recommended** | 품질 저하 | true (선택 가능) |

### 1.5 사용자 확인 (Choice System)

| 상황 | 선택 필요? | 선택지 |
|------|-----------|--------|
| proceed (정상) | ❌ | 없음, 바로 진행 |
| redirect | ✅ | [전환] / [현재 job 유지 + 가이드] |
| blocked (canProceed: true) | ✅ | [그래도 진행] / [취소 + 가이드] |
| blocked (canProceed: false) | ❌ | 없음, 안내만 |

**핵심**: 부정 선택 = 항상 가이드 제공 (막다른 길 없음)

---

## 2. Ask System

### 2.1 Scope 정의

| 범위 | 질문 유형 | 처리 |
|------|----------|------|
| **In-scope** | Ant 시스템 질문 | LLM이 응답 생성 |
| **Out-of-scope (코드)** | 프로젝트 코드베이스 질문 | Code Job 안내 |
| **Out-of-scope (일반)** | Ant 무관 질문 | 범위 안내 |

### 2.2 In-scope 질문 유형

| 카테고리 | 예시 질문 | 참조 섹션 |
|----------|----------|----------|
| **개요** | "Ant가 뭐야?", "어떤 언어 지원해?" | SECTION 1: OVERVIEW |
| **Job** | "코드잡 하려면?", "prerequisites 뭐야?" | SECTION 2: JOB CAPABILITIES |
| **워크플로우** | "어떻게 시작해?", "다음 단계는?" | SECTION 3: WORKFLOW |
| **생성물** | "ui-spec이 뭐야?", "뭐가 생성돼?" | SECTION 4: OUTPUTS |
| **기능** | "PAT 어떻게 설정해?", "Push 방법?" | SECTION 5: FEATURES |

### 2.3 Out-of-scope 처리

| 유형 | 예시 | 응답 |
|------|------|------|
| **코드베이스 질문** | "로그인 로직 어디있어?" | "Code Job에서 질문하세요" |
| **일반 지식** | "React란 뭐야?", "날씨 어때?" | "Ant 사용 질문만 답변합니다" + 예시 |

### 2.4 응답 생성 방식

```
┌─────────────────────────────────────────────────┐
│ Ask Pipeline                                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  입력:                                          │
│  ├── 사용자 질문                                 │
│  ├── Workspace 상태 (Triage에서 수집)           │
│  └── 현재 Agent/Job                             │
│                                                 │
│  주입 지식:                                      │
│  ├── [SECTION 1] agent-overview.md              │
│  ├── [SECTION 2] Job Capabilities (YAML)        │
│  ├── [SECTION 3] workflow.md                    │
│  ├── [SECTION 4] outputs.md                     │
│  └── [SECTION 5] features.md                    │
│                                                 │
│  LLM 처리:                                       │
│  ├── 질문 유형에 맞는 섹션 참조                  │
│  ├── Workspace 상태와 교차 참조                  │
│  └── 사용자 언어로 응답                          │
│                                                 │
│  출력:                                          │
│  ├── inScope: boolean                           │
│  ├── content: 응답 내용                         │
│  └── suggestions: 후속 질문 제안                │
│                                                 │
└─────────────────────────────────────────────────┘
```

**특징**:
- LLM 1회 호출
- 모든 지식 한 번에 주입 (섹션별 구분)
- Workspace 상태 기반 맥락 응답

---

## 3. 전체 흐름

```
사용자 입력
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ TRIAGE NODE                                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Workspace 상태 수집                                  │
│     └── PRD, screens, design docs, codebase 등          │
│                                                         │
│  2. LLM 호출 (1회)                                       │
│     └── Intent + WorkStatus + Confidence 결정           │
│                                                         │
│  3. 결과에 따른 분기                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
          │
          ├─── intent: ask ─────────────────────────────────┐
          │                                                 │
          │     ┌────────────────────────────────────────┐  │
          │     │ ASK SYSTEM                              │  │
          │     ├────────────────────────────────────────┤  │
          │     │ • Static 지식 + Workspace 상태 주입     │  │
          │     │ • LLM이 질문에 맞는 응답 생성           │  │
          │     │ • inScope 여부 판단                     │  │
          │     └────────────────────────────────────────┘  │
          │                    │                            │
          │                    ▼                            │
          │              응답 전달 → __end__                 │
          │                                                 │
          └─── intent: work ────────────────────────────────┤
                             │                              │
               ┌─────────────┼─────────────┐                │
               │             │             │                │
           proceed       redirect       blocked             │
               │             │             │                │
               ▼             ▼             ▼                │
          기존 플로우    선택 요청     안내+선택지            │
               │             │             │                │
               ▼             │             │                │
          detectEnv          │             │                │
               │             │             │                │
               ▼             ▼             ▼                │
          작업 진행     __end__        __end__               │
```

---

## 4. 데이터 구조

### 4.1 Triage 데이터 (YAML)

위치: `src/core/data/triage/jobs/`

```yaml
# design.yaml 예시
id: design
capabilities:
  description: "Generate design documents from requirements"
  outputs:
    - ui-tokens.json
    - ui-assets.json
    - ui-spec.json
    - system-design.md

modes:
  - id: ui-design
    detection:
      any_of:
        - path: inputs/references/screens
          type: directory_not_empty
    prerequisites:
      required:
        - condition: inputs/references/screens
          description: "Screen captures required"
```

**용도**: LLM이 Job 역량, 모드 판단, Prerequisites 체크에 사용

### 4.2 Ask 지식 (Markdown)

위치: `src/core/prompt/templates/triage/guide/`

| 파일 | 내용 |
|------|------|
| `agent-overview.md` | Ant 소개, 지원 언어, 프로젝트 타입 |
| `workflow.md` | 워크플로우 가이드, 시나리오별 흐름 |
| `outputs.md` | 생성되는 문서 상세 설명 |
| `features.md` | 기능 사용법 (Git, 설정 등) |

**용도**: LLM이 Ask 응답 생성 시 참조

### 4.3 YAML vs Markdown 원칙

| 데이터 유형 | 형식 | 이유 |
|------------|------|------|
| **구조화된 로직** | YAML | 조건 체크, 모드 판단 등 프로그래밍적 처리 |
| **설명 텍스트** | Markdown | 긴 설명, 가이드, 블록 텍스트 |

---

## 5. 구현 파일

```
src/
├── core/
│   ├── data/triage/              # Triage 데이터
│   │   ├── jobs/
│   │   │   ├── design.yaml
│   │   │   ├── code.yaml
│   │   │   └── learn.yaml
│   │   ├── types.ts
│   │   ├── loader.ts
│   │   └── index.ts
│   │
│   ├── ask/                      # Ask 시스템
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── AskResponseGenerator.ts
│   │
│   └── prompt/templates/triage/
│       ├── base.md               # Triage 프롬프트
│       ├── rules.md
│       └── guide/                # Ask 지식
│           ├── agent-overview.md
│           ├── workflow.md
│           ├── outputs.md
│           └── features.md
│
└── agents/common/nodes/triage/
    ├── index.ts                  # Triage 노드 (Ask 호출 포함)
    ├── types.ts
    ├── AgentRegistry.ts          # Job 정의 로드, 역량 생성
    ├── workspaceAnalyzer.ts      # Workspace 상태 수집
    └── parser.ts                 # LLM 응답 파싱
```
