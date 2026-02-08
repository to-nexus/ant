# 13. Token Usage Tracking — 현황 분석 및 리팩토링 설계

> **Status**: Phase 1~3 완료, Phase 4 진행중  
> **Created**: 2026-02-08  
> **Related Files**:
> - `packages/ant-shared/src/task.ts` — `TaskTokenUsage` 인터페이스
> - `packages/ant-ui/src/shared/utils/tokenUtils.ts` — 산식 및 포맷팅
> - `packages/ant-ui/src/presentation/components/kanban/KanbanHeader.tsx` — UI 표시
> - `packages/ant-cli/src/agents/architect/graph/common/llmHelpers.ts` — 누적 로직
> - `packages/ant-cli/src/periphery/adapters/llm/AnthropicLLMClient.ts` — API 응답 토큰 추출

---

## 1. 현재 상태 (AS-IS)

### 1.1 데이터 모델

```typescript
// ant-shared/src/task.ts
interface TaskTokenUsage {
  inputTokens: number;        // Anthropic input_tokens (cache 미포함 "새" 토큰)
  outputTokens: number;       // Anthropic output_tokens
  totalTokens: number;        // inputTokens + outputTokens
  cacheReadTokens?: number;   // Anthropic cache_read_input_tokens
  cacheCreationTokens?: number; // Anthropic cache_creation_input_tokens
}
```

### 1.2 산식 (tokenUtils.ts `getTokenUsageMetrics()`)

| 지표 | 산식 | 설명 |
|------|------|------|
| `rawTotalTokens` | `inputTokens + outputTokens` | 비캐시 토큰 합계 |
| `processedInputTokens` | `inputTokens + cacheRead + cacheCreation` | 전체 처리된 입력 토큰 |
| `billableInputTokens` | `inputTokens + ⌊cacheCreation × 1.25⌋ + ⌊cacheRead × 0.1⌋` | 비용 가중 입력 등가량 |
| `billableTotalTokens` | `billableInput + outputTokens` | 비용 가중 총 등가량 |
| `cacheSavedTokens` | `⌊cacheRead × 0.9⌋` | 캐시로 절약한 근사치 |

### 1.3 UI 표시 구조 (KanbanHeader.tsx `TokenUsageBadge`)

```
Badge: [132.3K]                    ← rawTotalTokens

Tooltip:
┌─────────────────────────────────────┐
│ Token Usage Breakdown               │
│                                     │
│ Total:                    132.3K    │  ← rawTotalTokens
│ "Total = Input(non-cache) + Output" │
│                                     │
│ ▎ Estimating Phase:        95.2K   │  ← job.rawTotal - tasks.rawTotal
│ ▎ Tasks (2):               37.1K   │  ← sum(task.rawTotal)
│   • Root Workspace Setup   37.1K   │
│                                     │
│ Input (new, non-cache):   116.3K   │  ← rawInputTokens
│ Output:                    16.0K   │  ← rawOutputTokens
│                                     │
│ ✓ Prompt Cache                      │
│   Processed input:        445.5K   │  ← processedInputTokens
│   Total Created:          146.3K   │  ← cacheCreationTokens
│   Cache Hit:              182.8K   │  ← cacheReadTokens
│   💰 Saved (approx.):    164.6K   │  ← cacheSavedTokens
│                                     │
│   Input (billable equiv.):317.5K   │  ← billableInputTokens
│   Total (billable equiv.):333.5K   │  ← billableTotalTokens
└─────────────────────────────────────┘
```

### 1.4 데이터 흐름

```
Anthropic API Response
  ├─ input_tokens              → inputTokens     (비캐시 새 입력)
  ├─ output_tokens             → outputTokens
  ├─ cache_read_input_tokens   → cacheReadTokens
  └─ cache_creation_input_tokens → cacheCreationTokens

  ↓ accumulateTokenUsage()

State (이중 누적)
  ├─ _currentTaskTokenUsage   (태스크 레벨)
  └─ tokenUsage               (잡 레벨, 모든 태스크 + estimating 포함)

  ↓ SSE broadcast (KanbanBroadcaster)

Frontend
  ├─ KanbanData.tokenUsage           (잡 레벨 전체)
  ├─ KanbanData.completed[].tokenUsage (태스크별)
  └─ KanbanData.inProgress.tokenUsage  (진행중 태스크)
```

---

## 2. 문제점 분석

### 🔴 P0: "Total"이 실제 Total이 아님 — 근본적 명명 오류

**현상**: 최상단 "Total: 132.3K"은 `inputTokens + outputTokens` (비캐시 토큰만 합산)

**문제**:
- Anthropic API가 실제 처리한 총 입력 토큰은 `processedInputTokens = 445.5K`
- 실제 총 처리량은 `445.5K + 16.0K = 461.5K`
- 그런데 "Total"이라고 부르는 값은 132.3K — 실제의 **28.7%**에 불과
- 사용자는 "Total"을 보고 자연스럽게 "내가 사용한 전체량"이라고 해석함

**핵심**: `rawTotalTokens`는 "비캐시 신규 토큰 합계"일 뿐인데, "Total"이라는 이름이 붙어 있음

---

### 🔴 P1: Billable > Total — 직관에 반하는 수치 관계

**현상**:
- Total: 132.3K
- Total (billable equiv.): 333.5K

**문제**:
- "Billable"이 "Total"보다 **2.5배** 크다
- 상식적으로 "청구 가능량"은 "전체량"보다 작거나 같아야 함 (할인이 적용되니까)
- 그러나 두 수치의 **비교 기준이 다름**:
  - Total → 캐시 토큰 **완전 제외**
  - Billable → 캐시 토큰 **가중 포함**
- 같은 화면에 나란히 표시되면서 비교 가능한 것처럼 보이지만, 실제로는 비교 불가

**근본 원인**: "Total"이 전체 처리량이 아니라 비캐시 부분집합이므로, 비교 대상이 없는 상태

---

### 🔴 P2: Anthropic `input_tokens`의 의미 혼동

**현상**: 코드 주석에 "cache 제외한 새로운 토큰"이라고 되어 있음

**문제**: Anthropic API의 `input_tokens` 필드 정의가 버전/상황에 따라 다를 수 있음
- 일부 문서: `input_tokens`는 전체 입력(캐시 포함)
- 일부 동작: `input_tokens`는 캐시 미스 토큰만
- 현재 코드는 **"캐시 제외"로 가정**하고 `processedInputTokens = input + cacheRead + cacheCreation`으로 계산

**위험**: 만약 Anthropic이 `input_tokens`에 이미 캐시를 포함한다면, `processedInputTokens`가 이중 계산됨

**검증 필요**: Anthropic API 공식 문서에서 `input_tokens`의 정확한 정의 확인 필수

---

### 🟡 P3: Estimating Phase 토큰이 뺄셈으로 계산됨

**현상**: `estimatingNodesTotal = job.rawTotal - tasks.rawTotal`

**문제**:
- 잡 레벨에서 태스크 합계를 빼서 추정 단계 토큰을 역산
- 만약 누적 과정에서 누락/중복이 있으면 이 차이값이 왜곡됨
- Estimating Phase는 캐시가 가장 많이 발생하는 구간인데, 비캐시 토큰만 표시하여 실제 규모를 과소 표현

---

### 🟡 P4: "Saved" 지표의 의미 불분명

**현상**: `cacheSavedTokens = cacheRead × 0.9`

**문제**:
- "164.6K 절약"이라는 수치가 무엇 대비 절약인지 불분명
- 토큰 수 ≠ 비용. 토큰 기반 "절약량"은 실제 비용 절약과 비례하지만, 단위가 모호
- 0.9라는 계수는 Anthropic의 현재 캐시 가격 할인율(캐시 히트 = 기본가의 10%)에서 온 것이나, 이 비율이 변경되면 하드코딩된 값이 틀려짐

---

### 🟡 P5: 개별 태스크가 rawTotalTokens만 표시

**현상**: 각 태스크 카드에 `rawTotalTokens`만 보임

**문제**: 캐시 혜택을 많이 받는 태스크는 실제 처리량이 rawTotal보다 훨씬 크지만, 이를 알 수 없음

---

### 🟡 P6: 가격 계수 하드코딩

**현상**:
```typescript
billableInput = rawInput + Math.floor(cacheCreation * 1.25) + Math.floor(cacheRead * 0.1)
```

**문제**:
- `1.25` (캐시 생성 비용), `0.1` (캐시 히트 비용)은 Anthropic 특정 모델의 가격 비율
- 모델별, 제공사별 가격이 다름 (Claude 3.5 vs Claude 4 등)
- OpenAI 사용 시에는 전혀 다른 가격 구조
- 현재는 `tokenUtils.ts`에 하드코딩되어 변경 시 코드 수정 필요

---

### 🟡 P7: 정보 계층 구조 혼란

**현상**: Tooltip 안에 운영 지표, 비용 지표, 성능 지표가 섞여 있음

**문제**:
- 사용자가 알고 싶은 것: "얼마나 썼나?", "얼마나 비용이 드나?", "캐시 효과는?"
- 현재 레이아웃은 이 세 질문의 답을 분리하지 않고 뒤섞어 표시
- "Input (new, non-cache)"과 "Input (billable equiv.)"가 떨어져 있어 대조가 어려움

---

### ⚪ P8: OpenAI 프로바이더에서 캐시 미지원

**현상**: `OpenAILLMClient.ts`는 `cacheReadTokens`/`cacheCreationTokens`를 보고하지 않음

**문제**: OpenAI의 prompt caching이 내부적으로 동작하지만 토큰 추적에 반영되지 않음. OpenAI 사용 시 캐시 섹션이 비어 있어 비교 불가.

---

## 3. Anthropic API `input_tokens` 정의 검증

### Anthropic 공식 정의 (확인 완료 ✅)

> **출처**: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#tracking-cache-performance

Anthropic 공식 문서에 따르면:

> `input_tokens`: Number of input tokens which were **not read from or used to create a cache**
> (i.e., tokens **after the last cache breakpoint**).

```
total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens
```

**결론: 현재 코드의 가정 (B)가 정확하다.**

- `input_tokens` = 캐시 브레이크포인트 **이후**의 토큰 (캐시 미스 신규 토큰)
- `cache_creation_input_tokens` = 새로 캐시에 쓴 토큰
- `cache_read_input_tokens` = 캐시에서 읽은 토큰
- 전체 입력 = input + cache_read + cache_creation

따라서 `processedInputTokens = inputTokens + cacheRead + cacheCreation` 공식은 **이중 계산이 아니며 정확**하다.
P2 문제는 해소되었으며, 산식 자체는 신뢰할 수 있다.

---

## 4. 리팩토링 설계 (TO-BE)

### 4.1 설계 원칙

1. **Input과 Output을 절대 합산하지 않는다** — 단가가 5배 다른 것을 더하는 것은 원화와 달러를 더하는 것과 같음
2. **캐싱은 Input에만 적용된다** — savings 계산에 output을 포함하면 절감률이 희석됨
3. **비교 가능한 것만 나란히 배치** — 기준이 다른 수치를 병렬 배치하지 않음
4. **비용 계수를 설정 가능하게** — 하드코딩 제거
5. **프로바이더 중립적 기본 모델** + 프로바이더별 확장

### 4.2 새로운 데이터 모델

```typescript
// ant-shared/src/task.ts — 확장된 TaskTokenUsage
interface TaskTokenUsage {
  // === Raw API 응답값 (Anthropic 기준) ===
  inputTokens: number;          // API input_tokens (정확한 의미 검증 후 주석)
  outputTokens: number;         // API output_tokens  
  cacheReadTokens: number;      // API cache_read_input_tokens (default 0)
  cacheCreationTokens: number;  // API cache_creation_input_tokens (default 0)
  
  // === 삭제 ===
  // totalTokens 제거 — 파생값은 UI에서 계산
}
```

**변경 핵심**: `totalTokens` 필드를 제거하고, 모든 "합계" 값은 표시 시점에 계산. 이렇게 하면 "어떤 total인가?" 혼란을 원천 방지.

### 4.3 새로운 산식 체계

```typescript
// tokenUtils.ts — 리팩토링된 TokenUsageMetrics

interface TokenCostConfig {
  cacheCreationMultiplier: number;  // e.g., 1.25 (Anthropic)
  cacheReadMultiplier: number;      // e.g., 0.10 (Anthropic)  
  inputPricePerMToken?: number;     // e.g., 3.00 ($/M tokens)
  outputPricePerMToken?: number;    // e.g., 15.00 ($/M tokens)
  cacheReadPricePerMToken?: number; // e.g., 0.30 ($/M tokens)
  cacheCreatePricePerMToken?: number; // e.g., 3.75 ($/M tokens)
}

interface TokenUsageMetrics {
  // === 1단계: 실제 처리량 (Actual API Consumption) ===
  totalInputProcessed: number;    // 실제 API가 처리한 총 입력 토큰
  totalOutputTokens: number;      // 출력 토큰
  totalProcessed: number;         // totalInputProcessed + totalOutputTokens
  
  // === 2단계: 입력 토큰 분해 (Input Breakdown) ===
  newInputTokens: number;         // 캐시 미스, 새로 처리된 입력
  cacheReadTokens: number;        // 캐시 히트
  cacheCreationTokens: number;    // 캐시 생성 (처음 캐시에 쓴 것)
  
  // === 3단계: 비용 등가 (Cost Equivalent) ===
  billableInputTokens: number;    // 비용 가중 입력
  billableTotalTokens: number;    // 비용 가중 총량
  
  // === 4단계: 캐시 효율 ===
  cacheHitRate: number;           // cacheRead / totalInputProcessed (0~1)
  estimatedSavingsPercent: number; // 캐시 없었을 때 대비 절감률
  
  // === 5단계: 예상 비용 (선택) ===
  estimatedCostUSD?: number;      // 대략적 달러 비용
}
```

### 4.4 새로운 UI 레이아웃

**핵심 원칙**: Input($3/MTok)과 Output($15/MTok)은 5배 가격 차이 — 절대 합산하지 않음.

```
Badge: [445K in · 16K out]        ← Input/Output 분리 표시

Tooltip:
┌──────────────────────────────────────────────┐
│ Token Usage                                   │
│                                               │
│ Input                               445.5K   │
│   New (cache-miss):                 116.3K   │
│   Cache hit:                        182.8K   │
│   Cache created:                    146.3K   │
│   ─────────────────────────────────          │
│   Cache hit rate:                    41.0%   │  ← 182.8K/445.5K
│   Billable input:                   317.5K   │
│   Input savings:                    ~28.7%   │  ← 1-(317.5/445.5)
│                                               │
│ Output                                16.0K  │
│   Not cacheable · 5x input price             │
│                                               │
│ By Phase                                      │
│ ▎ Estimating:        ???K in · ???K out       │
│ ▎ Tasks (2):         ???K in · ???K out       │
│   • Root Workspace   ???K / ???K              │
└──────────────────────────────────────────────┘
```

**이전 "Total Processed"에서 변경된 이유**:
- `savingsPercent`가 `1-(billableTotal/totalProcessed)`로 계산되면 output이 분모·분자에 동시 포함되어 절감률 희석
- 올바른 계산: `inputSavingsPercent = 1-(billableInput/totalInputProcessed)` — input만 비교
- 스크린샷 기준: 27.7% (잘못된 방식) → **28.7% (올바른 방식)**

### 4.5 Estimating Phase 토큰 추적 개선

**현재**: `estimating = job.rawTotal - sum(tasks.rawTotal)` (뺄셈)

**개선**: Estimating Phase 전용 필드를 `TaskTokenUsage` 구조로 별도 추적

```typescript
interface KanbanData {
  tokenUsage?: TaskTokenUsage;              // 잡 레벨 전체
  estimatingTokenUsage?: TaskTokenUsage;    // Estimating 단계 전용 (신규)
  // ...
}
```

**백엔드 변경**: decompose 노드에서 `estimatingTokenUsage`를 별도로 저장하여 뺄셈 없이 직접 전달

---

## 5. 리팩토링 단계별 계획

> **P2(input_tokens 정의)는 검증 완료 — 현재 산식이 정확함을 확인.**

### Phase 1: tokenUtils.ts 산식 리팩토링 [ant-ui만 변경]

**목표**: 새 `TokenUsageMetrics` 인터페이스 + 산식 체계. 기존 `TaskTokenUsage` 데이터 모델은 유지.

변경 파일:
- `packages/ant-ui/src/shared/utils/tokenUtils.ts`

작업:
1. `TokenUsageMetrics` 인터페이스를 새 구조로 교체 (totalProcessed 중심)
2. `getTokenUsageMetrics()` 산식 업데이트 — `cacheHitRate`, `savingsPercent` 추가
3. 가격 계수(`1.25`, `0.1`)를 상수로 추출 (향후 설정 가능하도록)
4. `sumTokenUsages()`, `formatTokenUsage()` 등 유틸 함수 업데이트

> **$ Cost 계산 판단**: 
> - 모델별 가격 테이블 유지 필요 (Claude Opus 4 $15/MTok vs Sonnet 4 $3/MTok 등)
> - 현재 `TokenUsageBadge`가 모델 정보를 받지 않으므로 데이터 파이프라인 확장 필요
> - **결론: Phase 1에서는 billable 등가 토큰(가중 토큰)까지만 표시. $ 환산은 별도 Phase로 분리.**
> - 캐시 효율(hitRate, savingsPercent)은 모델 가격 없이도 계산 가능하므로 Phase 1에 포함.

### Phase 2: UI Tooltip 리팩토링 [ant-ui만 변경]

**목표**: 직관적이고 오해 없는 토큰 정보 표시

변경 파일:
- `packages/ant-ui/src/presentation/components/kanban/KanbanHeader.tsx`

작업:
1. Badge에 `totalProcessed` 표시 (실제 처리량)
2. Tooltip을 3개 섹션으로 재구성:
   - **Actual Consumption** — 총 처리량, Input/Output 분해
   - **Cache Efficiency** — 히트율, Input 구성(New/Hit/Created)
   - **Cost (billable equiv.)** — 가중 토큰, 절감률
3. Phase Breakdown (Estimating/Tasks)은 유지하되 위치 조정
4. 혼란을 주는 "Total" 명명 제거 → "Total Processed"로 변경

### Phase 3: 백엔드 Estimating Phase 별도 추적 [ant-cli + ant-shared]

**목표**: 뺄셈 기반 추정 → 직접 추적으로 전환

변경 파일:
- `packages/ant-shared/src/task.ts` — `KanbanData`에 `estimatingTokenUsage` 추가
- `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts`
- `packages/ant-cli/src/agents/architect/graph/design/nodes/decompose/index.ts`
- `packages/ant-cli/src/core/realtime/KanbanBroadcaster.ts`
- `packages/ant-cli/src/agents/architect/graph/common/llmHelpers.ts`

작업:
1. `KanbanData`에 `estimatingTokenUsage?: TaskTokenUsage` 필드 추가
2. decompose 노드에서 estimating 단계 토큰을 별도로 저장
3. KanbanBroadcaster에서 estimating 토큰 전달
4. UI에서 뺄셈 로직 제거 → 전달받은 값 직접 사용

### Phase 4: `totalTokens` 필드 정리 [전체]

**목표**: 파생 필드 제거로 혼란 원천 차단

변경 파일: `totalTokens`를 사용하는 50+ 위치 (별도 마이그레이션)

작업:
1. `TaskTokenUsage.totalTokens` deprecated 처리 (optional + JSDoc @deprecated)
2. 모든 읽기 위치를 `inputTokens + outputTokens` 계산으로 전환
3. 모든 쓰기 위치에서 `totalTokens` 할당 제거
4. 최종적으로 인터페이스에서 필드 제거

### Phase 5 (향후): $ Cost 표시 + 프로바이더 확장

**전제 조건**: 모델 정보가 토큰 데이터와 함께 전달되어야 함

작업:
1. `KanbanData`에 `modelName` 필드 추가
2. 모델별 가격 테이블 (`TokenCostConfig`) 정의
3. UI에서 예상 비용 계산 및 표시
4. OpenAI prompt caching 지원 (가능한 경우)

---

## 6. 현재 스크린샷 수치 검산

참고용으로, 현재 산식이 맞는지 스크린샷의 수치를 역으로 검증한다.

| 지표 | 공식 | 계산 | 표시 | 일치 |
|------|------|------|------|------|
| Total | input + output | 116.3K + 16.0K | 132.3K | ✅ |
| Estimating + Tasks | | 95.2K + 37.1K | 132.3K | ✅ |
| Processed input | input + cacheRead + cacheCreate | 116.3K + 182.8K + 146.3K | 445.4K ≈ 445.5K | ✅ |
| Saved | cacheRead × 0.9 | 182.8K × 0.9 | 164.5K ≈ 164.6K | ✅ |
| Billable input | input + create×1.25 + read×0.1 | 116.3K + 182.9K + 18.3K | 317.5K | ✅ |
| Billable total | billableInput + output | 317.5K + 16.0K | 333.5K | ✅ |

> **결론**: 산식 자체는 내부적으로 일관되지만, **명명과 표현이 오해를 유발**하는 것이 핵심 문제.
> "Total"이라 부르는 값이 실제 전체가 아니어서, 나머지 모든 비교가 직관에 어긋남.

---

## 7. 참고: Anthropic Prompt Caching 가격 체계

| 항목 | 기본가 대비 비율 | 설명 |
|------|-----------------|------|
| 일반 입력 | 1.00× | cache miss — 새로 처리 |
| 캐시 생성 | 1.25× | 처음 캐시에 쓸 때 25% 추가 비용 |
| 캐시 히트 | 0.10× | 캐시에서 읽을 때 90% 할인 |
| 출력 | 별도 단가 | 모델에 따라 입력의 3~5배 |

> 이 비율은 Claude 3.5 Sonnet/Haiku 기준이며, 모델 변경 시 달라질 수 있음.
