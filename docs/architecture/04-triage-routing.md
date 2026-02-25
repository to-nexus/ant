# Triage & Routing

## 개요

Triage는 사용자 입력을 분석하여 적절한 처리 경로로 라우팅하는 시스템이다. 2단계 분류(Intent → WorkStatus)로 동작하며, 워크스페이스 상태 기반으로 진행 가능 여부를 판단한다.

## 아키텍처: 3-Layer 분류 파이프라인

분류 결정은 3개 레이어를 순서대로 통과하며, 각 레이어는 명확히 다른 역할을 가진다.

```
User Input
    │
    ▼
┌─────────────────────────────────────────────┐
│  Layer 1: Prompt (LLM 분류)                 │
│  rules.md + base.md + YAML job data         │
│  역할: 모든 분류 결정의 단일 소스            │
│  출력: <triage> JSON (intent, workStatus,   │
│        suggestedJob, suggestedAgent, ...)    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Layer 2: Parser (대칭 보정)                │
│  parser.ts - parseTriageResponse()          │
│  역할: JSON 형식 검증 + hallucination 보정   │
│  규칙 (모든 boundary에 균일 적용):           │
│   1. redirect-to-same → proceed             │
│   2. explicit redirect → redirect           │
│   3. proceed + job/agent mismatch leak      │
│      + redirectReason → redirect (force)    │
│   4. 나머지 → LLM 판단 그대로               │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Layer 3: Guard (plan outbound only)        │
│  index.ts - hasTargetJobPrerequisites()     │
│  역할: plan→other redirect 시 target job    │
│        입력 자료 존재 확인                   │
│  설계 결정: directive 의도적 제외            │
│  (directive는 항상 true → 포함 시 무력화)    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
              TriageResult
```

### Layer별 설계 원칙

**Layer 1 (Prompt)**: LLM이 유일한 분류자. FPOP 원칙 준수. 모든 분류 규칙은 rules.md에 집중.

**Layer 2 (Parser)**: LLM 응답의 형식 검증과 hallucination 보정만 수행. 비즈니스 로직 판단은 하지 않음. 모든 boundary(job 전환 방향)에 동일한 로직을 균일 적용 — 특정 boundary만 예외 처리하지 않음.

**Layer 3 (Guard)**: plan outbound redirect에서만 적용. plan job은 PRD 생성 워크플로우를 강제하므로, target job에 입력 자료(PRD, screens 등)가 없으면 redirect를 차단. 다른 job에서는 chat directive만으로 충분하므로 guard를 적용하지 않음.

## 분류 체계

### 1단계: Intent

| Intent | 설명 | 라우팅 |
|--------|------|--------|
| `ask` | 질문, 도움 요청, 모호한 입력 | Ask 시스템으로 위임 |
| `work` | 명확한 작업 요청 | 2단계 Work Status 판정 |

모호한 경우 `ask`로 분류한다.

### 2단계: Work Status

| Status | 설명 | 처리 |
|--------|------|------|
| `proceed` | 현재 Job + 준비 완료 | 기존 흐름 진행 |
| `redirect` | 다른 Job이 더 적합 | 사용자 승인 후 전환 |
| `blocked` | 준비물 부족 | 안내 + 선택지 |

### 분류 규칙 (rules.md)

rules.md의 Classification Protocol 단계:

| Step | 역할 | 적용 조건 |
|------|------|----------|
| Step 1 | Intent 분류 (ask vs work) | 항상 |
| Step 2 | Job Match (request target → job) | work intent |
| Step 2.5 | Spec Suggestion | code job + work + Step 2가 code로 분류 |
| Step 2.7 | Agent Match (architect vs planner) | work intent |
| Step 3 | Status 결정 (proceed/redirect/blocked) | work intent |

**Design ↔ Plan Boundary**: Step 2에 canonical 정의. design/plan job에서는 상대 job의 artifact를 명시적으로 지명하지 않는 한 redirect하지 않으며, `suggestedJob`/`suggestedAgent` 필드를 응답에서 완전히 생략해야 한다.

## Parser 보정 규칙

`parseTriageResponse()`는 LLM 응답 JSON을 파싱하고 다음 보정을 균일 적용한다:

| 규칙 | 트리거 | 동작 | 의도 |
|------|--------|------|------|
| redirect-to-same | `workStatus=redirect` + target=current job | → `proceed` | LLM hallucination 방어 |
| force-redirect (job) | `workStatus=proceed` + `suggestedJob≠current` + `redirectReason` 존재 | → `redirect` | LLM 혼란 상태 포착 |
| force-redirect (agent) | `workStatus=proceed` + `suggestedAgent≠current` | → `redirect` | cross-agent 혼란 포착 |

이 규칙들은 모든 job 전환 방향에 동일하게 적용된다 (비대칭 예외 없음).

## Prerequisites

### Required vs Recommended

| 구분 | 없으면 | canProceed |
|------|--------|-----------|
| Required | 진행 불가 | false |
| Recommended | 품질 저하 | true (선택) |

### Job별 Prerequisites

**Design Job (ui-design 모드)**
- Required: `inputs/references/screens/` (화면 캡처)
- Recommended: `inputs/references/components/`, `inputs/assets/`

**Design Job (system-design 모드)**
- Required: PRD 또는 directive
- Recommended: 기존 코드베이스

**Code Job (신규 개발)**
- Required: design documents (`outputs/design/`) 또는 directive
- Recommended: indexed codebase

**Code Job (수정)**
- directive만으로 진행 가능

**Learn Job**
- Required: git repository

### Plan Outbound Prerequisite Guard

plan job에서 다른 job으로 redirect 시 `hasTargetJobPrerequisites()` 함수로 target job에 입력 자료가 있는지 검사한다.

| Target Job | 필요 조건 |
|------------|----------|
| design | hasPrd \|\| hasScreens \|\| hasComponents \|\| hasAssets |
| code | hasPrd \|\| hasDesignDoc \|\| hasCodebase |
| learn | hasCodebase |
| plan | 항상 true |

**설계 결정**: `hasDirective`는 의도적으로 제외. directive는 채팅 입력 시 항상 true이므로 포함하면 guard가 무력화된다. 이 guard는 plan outbound에서만 적용하며, 다른 job에서는 directive만으로 충분한 입력이 된다.

## 워크스페이스 상태

Triage 노드는 `workspaceAnalyzer`를 통해 현재 워크스페이스 상태를 수집한다.

| 상태 필드 | 검사 대상 |
|-----------|----------|
| `hasPrd` | `inputs/sources/prd.md` 존재 및 실질 콘텐츠 유무 |
| `hasDirective` | directive 또는 채팅 입력 존재 |
| `hasScreens` | `inputs/references/screens/` 파일 존재 |
| `hasDesignDoc` | `outputs/design/` 내 설계 문서 존재 |
| `hasCodebase` | 벡터 DB 인덱스 존재 |
| `hasSpecDocs` | `outputs/design/spec-*.md` 파일 존재 |
| `hasSystemDesignDoc` | `outputs/design/*system-design*.md` 파일 존재 |

### 템플릿 마커 감지

Feature 초기화 시 빈 입력 파일에 `ant:template` 마커가 삽입된다. HTML 주석을 제거한 후 남은 실질 콘텐츠가 200자 미만이면 템플릿(빈 파일)으로 취급한다. 200자 이상이면 마커만 strip하고 실제 문서로 사용한다.

## Choice 시스템

### 선택이 필요한 케이스

| 상황 | needsChoice | 선택지 |
|------|-------------|--------|
| proceed | false | 없음 |
| redirect | true | 전환 확인 |
| blocked (canProceed: true) | true | 진행 여부 |
| blocked (canProceed: false) | false | 안내만 |

### ChoiceAction

| Action | 의미 |
|--------|------|
| `proceed` | 정상 진행 |
| `proceedAnyway` | 경고 무시 진행 |
| `redirect` | 다른 Job으로 전환 |
| `guide` | 가이드 제공 (부정 선택 시 항상) |
| `dismiss` | 작업 취소 |

부정 선택은 항상 `guide`를 반환한다. 막다른 길이 없다.

### 처리 흐름

1. Triage 노드에서 `needsChoice = true` 판정
2. ChoiceCard를 채팅으로 전송 + Redis에 pending choice 등록
3. Job을 `__end__`로 라우팅하여 일시 중단
4. 사용자 선택 시 `POST /chat/triage-choice` 호출
5. ChoiceService가 Redis에서 pending choice를 조회하여 처리
6. `redirect` → 새 Job 시작, `proceed` → 현재 Job 재시작 (skipTriage=true), `dismiss` → 취소

## LLM 호출

Triage는 1회 LLM 호출로 분류와 응답을 동시에 생성한다. 프롬프트는 WHAT/HOW 분리 구조를 따른다:
- `templates/triage/base.md`: 세션 정보, 사용자 입력, 워크스페이스 상태
- `templates/triage/rules.md`: 분류 규칙, guardrails, 응답 형식

Job 역량 정보는 YAML 데이터 (`core/data/triage/jobs/*.yaml`)에서 로드되어 프롬프트의 `## AVAILABLE JOBS` 섹션으로 주입된다. YAML의 `redirect_signals`는 FPOP 관찰 기반으로 기술된다 (keyword 매칭이 아닌 request target 관찰).

`skipTriage` 플래그가 설정되면 Triage를 건너뛰고 바로 proceed한다. 이 플래그는 사용자가 ChoiceCard에서 선택한 후 재시작할 때만 설정된다.

## 테스트

### 테스트 구조

| 파일 | 케이스 | 역할 |
|------|--------|------|
| `tests/triage-parser.test.ts` | 25 | Parser 보정 로직 전체 커버 |
| `tests/triage-guard.test.ts` | 15 | Prerequisite guard 함수 |
| `tests/triage-prompt.test.ts` | 3 | Prompt 구조 검증 + 스냅샷 |

모든 테스트는 **결정론적** (LLM 불필요, vitest로 실행).

### 실행 방법

```bash
# 전체 테스트
cd packages/ant-cli && pnpm test

# triage 테스트만
npx vitest run tests/triage-parser.test.ts tests/triage-guard.test.ts tests/triage-prompt.test.ts

# 프롬프트 변경 후 스냅샷 업데이트
npx vitest run tests/triage-prompt.test.ts --update
```

### Parser 테스트 커버리지

| 카테고리 | 검증 내용 |
|----------|----------|
| Format validation | triage block 없음, 잘못된 JSON, intent 누락 → null |
| Ask intent | inScope true/false 분기 |
| Work proceed | 정상 proceed |
| Explicit redirect | code→design (spec labels), design→code (normal labels) |
| Redirect-to-same (M1) | 같은 job으로 redirect → proceed 보정 |
| Force-redirect (M3) | proceed + suggestedJob mismatch + redirectReason → redirect |
| Force-redirect (M4) | proceed + suggestedAgent mismatch → redirect |
| Symmetry | plan outbound, design→plan 모두 동일 로직 적용 확인 |
| Blocked | canProceed true/false, proceedAnywayOption 조합 |

### Guard 테스트 커버리지

| 검증 내용 |
|----------|
| design: PRD/screens/components/assets 각각 true |
| design: all false → false |
| code: PRD/designDoc/codebase 각각 true |
| code: all false → false |
| learn: codebase true/false |
| plan: always true |
| directive 제외 확인 (design, code에서 directive only → false) |

### 프롬프트 변경 시 주의사항

1. rules.md 수정 후 `npx vitest run tests/triage-prompt.test.ts`으로 스냅샷 diff 확인
2. 의도한 변경이면 `--update`로 스냅샷 갱신
3. YAML redirect_signals 수정 시에도 스냅샷에 반영됨 (YAML → prompt에 주입)

## 파일 구조

```
packages/ant-cli/src/
├── agents/common/nodes/triage/
│   ├── index.ts              # Triage 노드 + guard + 라우터
│   ├── parser.ts             # LLM 응답 파싱 + 대칭 보정
│   ├── types.ts              # TriageResult, WorkspaceState 등
│   ├── workspaceAnalyzer.ts  # 워크스페이스 상태 수집
│   └── AgentRegistry.ts      # YAML job 데이터 로드 + 프롬프트 생성
├── core/
│   ├── prompt/templates/triage/
│   │   ├── base.md           # WHAT: 세션, 입력, 상태
│   │   └── rules.md          # HOW: 분류 규칙, reminders
│   └── data/triage/jobs/
│       ├── code.yaml         # Code job 정의
│       ├── design.yaml       # Design job 정의
│       ├── learn.yaml        # Learn job 정의
│       └── plan.yaml         # Plan job 정의
└── infrastructure/choice/
    └── ChoiceService.ts      # 사용자 선택 관리 (Redis)

tests/
├── triage-parser.test.ts     # Parser 보정 로직
├── triage-guard.test.ts      # Prerequisite guard
└── triage-prompt.test.ts     # 프롬프트 구조 스냅샷
```

## 경계

- Ask 의도 처리: [08-ask-system.md](08-ask-system.md)
- Choice Card UI: [12-chat-system.md](12-chat-system.md)
- 프롬프트 템플릿 구조: [13-prompt-system.md](13-prompt-system.md)
