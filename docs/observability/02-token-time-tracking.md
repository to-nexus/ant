# Token & Time Tracking

토큰 사용량과 실행 시간 데이터를 해석하고 활용하는 방법.

> 설계/구현 문서가 아니라 **관측/해석** 문서다.
> - 토큰 예산 설계 → [28-context-management.md](../architecture/28-context-management.md)
> - 데이터 기록 방식 → [29-debug-logging.md](../architecture/29-debug-logging.md)
> - 판정 기준값 → [01-baseline-metrics.md](01-baseline-metrics.md)

## 비용 모델

### Anthropic Pricing Tier

| 구간 | Input (per MTok) | Cache Read (per MTok) | Cache Write (per MTok) | Output (per MTok) |
|------|------------------|-----------------------|------------------------|-------------------|
| <= 200K prompt tokens | $3.00 | $0.30 | $3.75 | $15.00 |
| > 200K prompt tokens | $6.00 | $0.60 | $7.50 | $15.00 |

200K를 넘으면 입력 단가가 2배가 된다. `AnthropicLLMClient`가 160K/200K 임계에서 콘솔 경고를 출력한다.

### billableInputTokens 가중치

TokenLogger가 기록하는 `billableInputTokens`는 실제 청구 비중을 근사한 가중합이다:

```
billableInput = input * 1.0 + cacheCreation * 1.25 + cacheRead * 0.1
```

| 항목 | 가중치 | 이유 |
|------|--------|------|
| `inputTokens` | 1.0 | 기본 입력 단가 |
| `cacheCreationTokens` | 1.25 | 캐시 쓰기 단가 (input 대비 1.25배) |
| `cacheReadTokens` | 0.1 | 캐시 읽기 단가 (input 대비 10분의 1) |

cacheHitRatio가 높을수록 billableInput이 낮아진다. 이것이 캐시 효율을 추적하는 핵심 이유다.

### Job당 예상 비용 범위

| Job Type | 태스크 수 기준 | billableInput 정상 범위 | 대략적 비용 |
|----------|--------------|----------------------|------------|
| code | 5 태스크 | 100K - 500K | $0.3 - $1.5 |
| design | 3 챕터 | 80K - 300K | $0.25 - $0.9 |
| plan | 1 | 30K - 100K | $0.1 - $0.3 |
| learn | 1 | 10K - 50K | $0.03 - $0.15 |

## 토큰 예산 체계

### Context Window 영역 할당

TokenBudgetManager는 모델의 실제 context window (Opus 4.8 / Sonnet 4.6 = 1M, Haiku 4.5 = 200K) 를 영역별로 분배한다. 절대값은 모델에 따라 자동 스케일링되며, 비율은 다음과 같다 (200K 모델 기준 예시):

```
200K context window (예시 — 1M 모델은 5배로 자연 스케일)
├── System Prompt       30K (15%)    base.md + rules.md + profile
├── Project Context     30K (15%)    PRD, design docs, codebase
├── Task Context        25K (12.5%)  task plan, file tree, violations
├── Conversation Hist   75K (37.5%)  tool call/result history (TurnPruner)
├── Tool Definitions     2K (1%)     tool schemas overhead
├── Safety Margin       20K (10%)    buffer
└── Output Budget       18K (9%)     LLM response space
```

`buildMessages.ts` 의 `execHistoryBudget = min(execWindow * 0.7, execWindow − 105K)` 가 model context 에 따라 history 영역을 자동 확장 — 1M 모델은 ~700K 까지 history 보전 가능.

관측 시 중요한 포인트:
- `estimatedPromptChars`가 180K chars(~51K tokens)를 넘으면 window 압박
- `conversationHistoryLength`가 50 이상이면 pruning이 활발히 동작 중
- `projectCodeContextFiles`가 0이면 코드베이스 컨텍스트 주입 실패

### 예산 초과 징후

`tokens/{jobId}.jsonl`에서 다음 패턴이 보이면 예산 압박이다:

| 징후 | 데이터 | 의미 |
|------|--------|------|
| `inputTokens` 급증 (> 150K) | 단일 call의 inputTokens | 200K tier 진입 위험 |
| `cacheCreationTokens` 반복 발생 | callIndex > 0인데 creation > 0 | prefix가 변경되어 캐시 재생성 |
| `cacheHitRatio` 급락 | 이전 call 대비 0.3 이상 하락 | 프롬프트 구조가 변경됨 |
| `conversationHistoryLength` 정체 | 증가하다 갑자기 감소 | pruneTurns가 발동함 |

## 시간 추적

### 시간 측정 지점

`logs/{jobId}.jsonl`의 이벤트에서 시간 정보를 추출한다:

| 구간 | 시작 이벤트 | 종료 이벤트 | elapsedMs 위치 |
|------|-----------|-----------|---------------|
| Job 전체 | `job_start` | `job_complete` | `job_complete.data.elapsedMs` |
| 태스크 단위 | `task_start` | `task_complete` | `task_complete.data.elapsedMs` |
| 병렬 배치 | `parallel_start` | `parallel_complete` | `parallel_complete.data.elapsedMs` |
| 페이즈 단위 | - | `phase_complete` | `phase_complete.data.elapsedMs` |

### 시간 정상 범위

| 구간 | 정상 | 경고 | 비정상 |
|------|------|------|--------|
| 태스크 1건 (code execute) | < 120s | 120-300s | > 300s |
| 태스크 1건 (design execute) | < 90s | 90-180s | > 180s |
| 페이즈: decompose | < 30s | 30-60s | > 60s |
| 페이즈: planGeneration | < 45s | 45-90s | > 90s |
| Job 전체 (code, 5 태스크) | < 10min | 10-20min | > 20min |
| Job 전체 (design, 3 챕터) | < 5min | 5-10min | > 10min |

### 시간 이상의 원인 추적

시간이 비정상적으로 길 때, 토큰 데이터와 교차하여 원인을 분류한다:

| 증상 | tokens/ 확인 | logs/ 확인 | 가능한 원인 |
|------|-------------|-----------|------------|
| 태스크가 느림 + callIndex 높음 | callIndex >= 15 | violation_detected 다수 | 수렴 실패 — 검증 위반 반복 |
| 태스크가 느림 + callIndex 정상 | inputTokens 높음 | tool_call 다수 | 대형 컨텍스트 + 많은 도구 호출 |
| Job 전체가 느림 + 태스크별 정상 | - | parallel_start/complete 없음 | 병렬 실행 실패 (직렬 fallback) |
| Job 전체가 느림 + 태스크 하나만 극단적 | 해당 태스크의 cumulativeBillable 확인 | task_fail + task_retry | 단일 태스크가 병목 |

## 캐시 효율 분석

프롬프트 캐시는 비용의 핵심 레버이다. cacheHitRatio가 0.9에서 0.3으로 떨어지면 billableInput이 약 8배 증가한다.

### 캐시 동작 원리

Anthropic prompt caching은 **prefix match**로 동작한다. 이전 호출과 프롬프트의 앞부분(prefix)이 동일하면 캐시를 재사용한다.

```
호출 1: [system] [project context] [task context] [history turn 1]
호출 2: [system] [project context] [task context] [history turn 1] [history turn 2]
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 이 부분이 동일하면 캐시 히트
```

### 캐시 불안정 원인

| 원인 | 어떻게 감지 | 어떻게 개선 |
|------|-----------|-----------|
| system prompt 변경 | `prompts/`에서 같은 taskId의 연속 호출에서 `templatePath` 변경 | 프롬프트 구조를 호출 간 고정 |
| project context 재정렬 | `cacheCreationTokens`가 매 호출 높음 | context 주입 순서 고정 |
| task context 삽입 위치 변경 | `cacheHitRatio`가 callIndex 0에서 1로 갈 때 급락 | task context를 prefix 뒤에 배치 |
| conversation history 재구성 | `logs/`에서 `conversationHistoryLength` 감소 직후 `cacheHitRatio` 하락 | pruning이 prefix를 변경 — pruning 전략 점검 |

### 캐시 효율 리포트 읽기

`tokens/{jobId}.jsonl`에서 같은 `taskId`의 행을 순서대로 보면:

```
callIndex=0  cacheHitRatio=0.000  ← 첫 호출은 항상 0 (정상)
callIndex=1  cacheHitRatio=0.850  ← prefix 캐시 시작 (양호)
callIndex=2  cacheHitRatio=0.920  ← 안정적 (우수)
callIndex=3  cacheHitRatio=0.310  ← 급락! prefix 변경 발생
callIndex=4  cacheHitRatio=0.880  ← 새 prefix로 캐시 재구축 (복구)
```

callIndex 3에서 무슨 일이 일어났는지 확인하려면:
1. `correlationKey`로 `prompts/`에서 해당 호출의 프롬프트 메타데이터 확인
2. `correlationKey`로 `logs/`에서 해당 호출 전후의 이벤트 확인 (violation_detected → 재시도 시 프롬프트 변경 가능)

## 경계

- 토큰 예산 설계: [28-context-management.md](../architecture/28-context-management.md) (TokenBudgetManager, area budgets, pruning 전략)
- 데이터 레이어: [29-debug-logging.md](../architecture/29-debug-logging.md) (TokenLogger, ExecutionLogger 구현)
- 판정 기준값: [01-baseline-metrics.md](01-baseline-metrics.md) (PASS/WARN/FAIL 임계값)
- 검증 프로토콜: [29-debug-logging.md § Job 검증 프로토콜](../architecture/29-debug-logging.md#job-검증-프로토콜) (Step 4: 토큰, Step 5: 시간)
