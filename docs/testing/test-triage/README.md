# Triage Manual Test Kit

자동 테스트(vitest)는 parser/guard/prompt 구조를 커버한다.
이 키트는 **LLM 분류 품질**을 수동으로 검증하기 위한 것이다.

## 사전 준비

```bash
# 1. 빌드 (자동 테스트 통과 확인)
cd packages/ant-cli && pnpm build:cli

# 2. 로컬 서버 시작
pnpm dev
```

## 테스트 워크스페이스 셋업

테스트 시나리오별로 워크스페이스 상태를 달리해야 한다.
`workspace-fixtures/` 디렉토리의 fixture 파일들을 feature 디렉토리에 복사하여 사용한다.
파일명이 실제 워크스페이스 규칙과 동일하므로, 대상 디렉토리에 그대로 복사하면 된다.

```bash
FIXTURES="docs/testing/test-triage/workspace-fixtures"
FEATURE="<feature-path>"

# PRD 셋업
mkdir -p "$FEATURE/inputs/sources"
cp "$FIXTURES/prd.md" "$FEATURE/inputs/sources/prd.md"

# 시스템 설계문서 셋업 (system/ 서브디렉토리)
mkdir -p "$FEATURE/outputs/design/system"
cp "$FIXTURES/fe-system-main.md" "$FEATURE/outputs/design/system/"
cp "$FIXTURES/be-system-main.md" "$FEATURE/outputs/design/system/"
cp "$FIXTURES/api-contract-main.md" "$FEATURE/outputs/design/system/"

# UI 문서 셋업 (ui/ 서브디렉토리)
mkdir -p "$FEATURE/outputs/design/ui"
cp "$FIXTURES/ui-tokens.json" "$FEATURE/outputs/design/ui/"
cp "$FIXTURES/ui-assets.json" "$FEATURE/outputs/design/ui/"
cp "$FIXTURES/ui-spec.json" "$FEATURE/outputs/design/ui/"

# Spec 문서 셋업 (spec/ 서브디렉토리)
mkdir -p "$FEATURE/outputs/design/spec"
cp "$FIXTURES/spec-auth.md" "$FEATURE/outputs/design/spec/"
```

## Fixture 파일 목록

| 파일 | 트리거하는 플래그 | 복사 경로 |
|------|-----------------|----------|
| `prd.md` | `hasPrd` | `inputs/sources/prd.md` |
| `fe-system-main.md` | `hasSystemDesignDoc` | `outputs/design/system/` |
| `be-system-main.md` | `hasSystemDesignDoc` | `outputs/design/system/` |
| `api-contract-main.md` | `hasSystemDesignDoc` | `outputs/design/system/` |
| `ui-tokens.json` | `hasUiDocs` | `outputs/design/ui/` |
| `ui-assets.json` | `hasUiDocs` | `outputs/design/ui/` |
| `ui-spec.json` | `hasUiDocs` | `outputs/design/ui/` |
| `spec-auth.md` | `hasSpecDocs` | `outputs/design/spec/` |

## 워크스페이스 상태 조합

triage가 확인하는 핵심 상태와 감지 조건 (`workspaceAnalyzer.ts` 기준):

| 상태 플래그 | 감지 조건 |
|------------|----------|
| `hasPrd` | `inputs/sources/`에 비어있지 않은 텍스트 파일 존재 (.md, .txt, .json, .yaml 등) |
| `hasDirective` | `inputs/directives/{design,code}/directive.md` 존재, 또는 채팅 입력 시 `overrideDirective`로 true |
| `hasSystemDesignDoc` | `outputs/design/system/` 또는 `outputs/design/`에 `fe-system-*.md`, `be-system-*.md`, `api-contract-*.md` 패턴 파일 존재 |
| `hasUiDocs` | `outputs/design/ui/` 또는 `outputs/design/`에 `ui-tokens.json`, `ui-assets.json`, `ui-spec.json` 중 하나 이상 존재 |
| `hasSpecDocs` | `outputs/design/spec/` 또는 `outputs/design/`에 `spec-*.md` 패턴 파일 존재 |
| `hasDesignDoc` | `outputs/design/` 전체(system/, ui/, spec/, flat)에 `.md` 또는 `.json` 파일 하나 이상 존재 |
| `hasFigmaConfig` | `inputs/figma.json` 존재하고 `isFigmaDataPopulated` = true |
| `hasScreens` | `inputs/references/screens/`에 파일 존재 |
| `hasCodebase` | vector DB에 인덱스된 파일 존재 |

테스트 시나리오별 필요한 조합:

| 조합 | 셋업 방법 | 트리거되는 플래그 | 사용 시나리오 |
|------|----------|-----------------|-------------|
| **풀 셋업** | PRD + system + ui + spec | hasPrd, hasSystemDesignDoc, hasUiDocs, hasSpecDocs, hasDesignDoc | 1-3, 2-5~2-7 |
| **PRD만** | PRD만 복사 | hasPrd | 1-1, 1-2, 2-3~2-4, 3-1, 3-3 |
| **PRD + spec** | PRD + spec 복사 | hasPrd, hasSpecDocs, hasDesignDoc | 1-5, 3-2 |
| **빈 상태** | 아무것도 없음 (새 feature 생성) | (없음) | 1-4, 2-1~2-2 |

---

## 테스트 매트릭스

### Phase 1: 모드 전환 감지 (핵심 — 원래 버그)

이 테스트가 가장 중요하다. code job에서 design 의도를 올바르게 감지하는지 확인.

| # | Job | 워크스페이스 | 입력 | 기대 결과 | 검증 포인트 |
|---|-----|------------|------|----------|-----------|
| 1-1 | code | PRD만 | "시스템기획을 시작해라" | redirect → design | 모드 전환 clarify 표시 |
| 1-2 | code | PRD만 | "API 설계 문서를 작성해줘" | redirect → design | 설계 artifact 감지 |
| 1-3 | code | 풀 셋업 | "로그인 버그를 고쳐줘" | proceed (code) | 코드 작업으로 유지 |
| 1-4 | code | 빈 상태 | "시스템 아키텍처를 설계해줘" | redirect → design | 빈 워크스페이스에서도 감지 |
| 1-5 | code | PRD+spec | "인증 시스템을 구현해줘" | proceed (code) | spec 있으면 바로 진행 |

### Phase 2: Design ↔ Plan Boundary

design/plan 사이에서 잘못된 redirect가 발생하지 않는지 확인.

| # | Job | 워크스페이스 | 입력 | 기대 결과 | 검증 포인트 |
|---|-----|------------|------|----------|-----------|
| 2-1 | plan | 빈 상태 | "시작해" | proceed (plan) | 모호한 명령 → 현재 job 유지 |
| 2-2 | plan | 빈 상태 | "기획을 시작하자" | proceed (plan) | "기획" 언급해도 plan 유지 |
| 2-3 | plan | PRD만 | "시스템 설계 문서를 만들어줘" | redirect → design | 명시적 design artifact 지명 |
| 2-4 | plan | 빈 상태 | "아키텍처를 설계하자" | proceed (plan) | PRD 없으면 redirect 차단 (guard) |
| 2-5 | design | 풀 셋업 | "요구사항을 정리해줘" | proceed (design) | plan으로 redirect 안 됨 |
| 2-6 | design | 풀 셋업 | "PRD를 작성해줘" | redirect → plan | 명시적 PRD artifact 지명 |
| 2-7 | design | 풀 셋업 | "시작해" | proceed (design) | 모호한 명령 → 현재 job 유지 |

### Phase 3: Spec Suggestion (code job)

대규모 기능 요청 시 spec 작성을 제안하는지 확인.

| # | Job | 워크스페이스 | 입력 | 기대 결과 | 검증 포인트 |
|---|-----|------------|------|----------|-----------|
| 3-1 | code | PRD만 | "소셜 로그인, 결제, 알림 시스템을 구현해줘" | redirect → design (spec 제안) | "spec부터 짜기" 선택지 |
| 3-2 | code | PRD+spec | "인증 시스템을 구현해줘" | proceed (code) | spec 있으면 제안 안 함 |
| 3-3 | code | PRD만 | "버튼 색상 변경해줘" | proceed (code) | 작은 변경은 제안 안 함 |

### Phase 4: Agent Mismatch

cross-agent redirect가 올바르게 동작하는지 확인.

| # | Job | Agent | 입력 | 기대 결과 | 검증 포인트 |
|---|-----|-------|------|----------|-----------|
| 4-1 | code | architect | "PRD를 작성해줘" | redirect → plan (planner) | agent + job 전환 |
| 4-2 | design | architect | "PRD를 수정해줘" | redirect → plan (planner) | agent 전환 |

### Phase 5: Ask vs Work 분류

질문과 작업 요청을 올바르게 구분하는지 확인.

| # | Job | 입력 | 기대 결과 | 검증 포인트 |
|---|-----|------|----------|-----------|
| 5-1 | code | "triage 시스템이 뭐야?" | ask (inScope) | 작업이 아닌 질문 |
| 5-2 | code | "이 설계문서 품질 평가해줘" | ask (inScope) | 평가 = ask |
| 5-3 | code | "평가 결과를 바탕으로 코드 수정해줘" | work (proceed) | 평가 참조 ≠ ask |
| 5-4 | code | "(아무 코드 붙여넣기만)" | ask (outOfScope) | 불완전 입력 |

### Phase 6: Design Job 문서/코드 모호성

design job에서 문서 vs 코드 구분을 올바르게 하는지 확인.

| # | Job | 입력 | 기대 결과 | 검증 포인트 |
|---|-----|------|----------|-----------|
| 6-1 | design | "시스템 설계 문서를 작성해줘" | proceed (design) | 문서 = design |
| 6-2 | design | "로그인 페이지를 만들어줘" | redirect → code | 코드 = code |
| 6-3 | design | "로그인 시스템을 개발해줘" | ask (clarify) 또는 redirect → code | 모호 → clarify |

---

## 테스트 절차

### Step 1: 워크스페이스 준비

위 "워크스페이스 상태 조합" 표를 참고하여 Phase별로 필요한 상태를 셋업한다.

```bash
FIXTURES="docs/testing/test-triage/workspace-fixtures"

# === 풀 셋업 (Phase 1: 1-3, Phase 2: 2-5~2-7) ===
mkdir -p "$FEATURE/inputs/sources" \
         "$FEATURE/outputs/design/system" \
         "$FEATURE/outputs/design/ui" \
         "$FEATURE/outputs/design/spec"
cp "$FIXTURES/prd.md"                "$FEATURE/inputs/sources/"
cp "$FIXTURES/fe-system-main.md"     "$FEATURE/outputs/design/system/"
cp "$FIXTURES/be-system-main.md"     "$FEATURE/outputs/design/system/"
cp "$FIXTURES/api-contract-main.md"  "$FEATURE/outputs/design/system/"
cp "$FIXTURES/ui-tokens.json"        "$FEATURE/outputs/design/ui/"
cp "$FIXTURES/ui-assets.json"        "$FEATURE/outputs/design/ui/"
cp "$FIXTURES/ui-spec.json"          "$FEATURE/outputs/design/ui/"
cp "$FIXTURES/spec-auth.md"          "$FEATURE/outputs/design/spec/"

# === PRD만 (Phase 1: 1-1~1-2, Phase 2: 2-3~2-4, Phase 3: 3-1, 3-3) ===
mkdir -p "$FEATURE/inputs/sources"
cp "$FIXTURES/prd.md" "$FEATURE/inputs/sources/"

# === PRD+spec (Phase 1: 1-5, Phase 3: 3-2) ===
mkdir -p "$FEATURE/inputs/sources" "$FEATURE/outputs/design/spec"
cp "$FIXTURES/prd.md"       "$FEATURE/inputs/sources/"
cp "$FIXTURES/spec-auth.md" "$FEATURE/outputs/design/spec/"

# === 빈 상태 (Phase 1: 1-4, Phase 2: 2-1~2-2) ===
# 새 feature 생성하거나 기존 feature의 inputs/outputs 삭제
```

### Step 2: Job 시작 및 입력

1. UI에서 해당 Job Type 선택 (code/design/plan)
2. Agent 선택 필요 시 변경 (Phase 4의 architect 테스트)
3. 채팅 입력창에 테스트 입력을 타이핑
4. 응답 확인:
   - **proceed** → 바로 작업 시작됨
   - **redirect** → ChoiceCard 표시 (전환 / 현재모드진행 / 취소)
   - **ask** → 답변 또는 clarify 메시지 표시
   - **blocked** → 준비물 안내 표시

### Step 3: 결과 기록

각 시나리오의 결과를 아래 형식으로 기록:

```
[1-1] code + 풀셋업 + "시스템기획을 시작해라"
  기대: redirect → design
  실제: ________
  PASS / FAIL
  비고: ________
```

### Step 4: 실패 시 디버깅

Triage 로그는 worker 프로세스의 stdout에 출력된다:

```
🏥 TRIAGE
📋 Analyzing workspace state...
📊 Triage Result:
   Intent: work
   Work Status: redirect
   Suggested Job: design
```

`📊 Triage Result` 섹션에서 LLM의 실제 분류 결과를 확인할 수 있다.
intent, workStatus, suggestedJob, suggestedAgent, redirectReason 등 전체 JSON을 파악하면 원인 추적이 빠르다.

---

## 회귀 테스트 우선순위

시간이 부족할 때는 이 순서로:

1. **1-1, 1-2** (원래 버그 — 모드 전환 감지)
2. **2-1, 2-7** (Design↔Plan boundary — false redirect 방지)
3. **3-1** (Spec suggestion — 대규모 기능 요청)
4. **나머지** (시간 있을 때)
