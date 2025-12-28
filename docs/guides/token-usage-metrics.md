# 토큰 사용량 지표(Design/Code 공통) – 정의/공식/해석 가이드

이 문서는 ANT의 **Design job / Code job에서 동일하게 적용되는 토큰 사용량 지표 정의**를 정리합니다.  
UI(태스크보드 뱃지/툴팁)에서 보이는 숫자들이 서로 **왜 다르게 보이는지**, 그리고 **어떤 값끼리 비교해야 “맞는지”**를 명확히 합니다.

---

## 핵심 결론(한 줄 요약)

- **Total = Input(new, non-cache) + Output** 이다.  
- **Prompt Cache 관련 값(cache hit/create)은 Total에 포함되지 않는 별도 지표**다.  
- 비용 관점(“billable equiv.”) 수치는 **Total과 같은 축이 아니므로 Total과 직접 비교하면 안 된다.**

---

## 데이터 스키마(공통)

세션/칸반 API에서 내려오는 토큰 사용량은 다음 구조를 사용합니다.

```ts
interface TaskTokenUsage {
  inputTokens: number;          // "새 토큰" 입력(캐시 제외)
  outputTokens: number;         // 출력 토큰
  totalTokens: number;          // inputTokens + outputTokens (캐시 제외)
  cacheReadTokens?: number;     // 프롬프트 캐시 히트(읽기) 토큰
  cacheCreationTokens?: number; // 프롬프트 캐시 생성(쓰기) 토큰
}
```

> **중요:** 여기서 `totalTokens`는 **캐시 제외** 총합입니다.

---

## UI에 보이는 항목별 의미(문자 그대로 해석)

### 1) Total

- **의미:** “새로 사용한 토큰(non-cache) 총합”
- **정의:**  
  \[
  \textbf{Total} = \textbf{Input(new, non-cache)} + \textbf{Output}
  \]
- **포인트:** cacheRead/cacheCreation은 Total에 포함되지 않습니다.

---

### 2) Estimating Phase (non-cache)

- **의미:** 태스크 실행 전에 수행되는 노드들의 “새 토큰(non-cache) 사용량”
- **구성 예시(Design):** `detectEnvironment + decompose`
- **UI 계산 방식(개념):**
  \[
  \textbf{Estimating} = \textbf{Job Total(non-cache)} - \textbf{Tasks Total(non-cache)}
  \]

---

### 3) Tasks (N) + 태스크별 숫자

- **의미:** 각 태스크 실행에서 발생한 “새 토큰(non-cache)” 사용량
- **태스크별 숫자 정의:**  
  \[
  \textbf{Task Total} = \textbf{Task Input(new)} + \textbf{Task Output}
  \]

---

## Input/Output 섹션(= Total과 같은 축)

### 4) Input (new, non-cache)

- **의미:** 모델이 **새로 처리한 입력 토큰**(캐시 제외)
- **정의:** `inputTokens`
- **주의:** 캐시 히트로 처리된 입력은 여기로 안 들어옵니다.

### 5) Output

- **의미:** 모델이 생성한 출력 토큰
- **정의:** `outputTokens`

✅ 따라서 아래는 항상 성립해야 합니다:

\[
\textbf{Total} = \textbf{Input(new)} + \textbf{Output}
\]

---

## Prompt Cache 섹션(= Total과 다른 축)

Prompt Cache는 “총합”이 아니라 **캐시가 얼마나 쓰였는지/얼마나 절약됐는지**를 보여주는 지표입니다.

### 6) Cache Hit

- **의미:** 캐시에서 읽어 재사용한 입력 토큰량
- **정의:** `cacheReadTokens`

### 7) Total Created

- **의미:** 캐시를 생성(저장)하기 위해 기록된 입력 토큰량
- **정의:** `cacheCreationTokens`

### 8) Processed input

- **의미:** 입력 “처리량” 관점의 총합(새 입력 + 캐시 히트 + 캐시 생성)
- **정의:**
  \[
  \textbf{Processed input} = \textbf{Input(new)} + \textbf{Cache Hit} + \textbf{Total Created}
  \]
- **주의:** Processed input은 Total과 같은 축이 아닙니다(따라서 **Total과 비교하면 안 됨**).

### 9) Saved (approx.)

- **의미:** 캐시 히트 덕분에 “대략 절약된 입력 토큰량”
- **정의(근사):**
  \[
  \textbf{Saved} \approx 0.9 \times \textbf{Cache Hit}
  \]
- **왜 0.9?** cache read가 (대략) 10% 비용이므로 “대략 90% 절약”으로 보여줍니다.

---

## Billable(비용/과금) 섹션(= Total과 다른 축)

### 10) Input (billable equiv.)

- **의미:** 입력 토큰을 **비용 등가(과금 관점)**로 환산한 값
- **정의(Anthropic 가중치 근사, UI에서 정수 내림 적용):**
  \[
  \textbf{billableInput}
  =
  \textbf{Input(new)}
  +
  1.25 \times \textbf{Total Created}
  +
  0.1 \times \textbf{Cache Hit}
  \]

### 11) Total (billable equiv.)

- **의미:** “비용 등가” 총합
- **정의:**
  \[
  \textbf{billableTotal} = \textbf{billableInput} + \textbf{Output}
  \]

> **중요:** billable 수치는 **Total(non-cache)과 같은 축이 아니므로** 직접 비교하면 “안 맞는 것처럼” 보이는 것이 정상입니다.

---

## 흔한 오해 Q/A

### Q1. “Input + Output이 Total과 왜 안 맞죠?”

- **Input (billable equiv.)**를 Input으로 착각하면 그렇게 보입니다.
- **Total과 맞춰 비교해야 하는 Input은 반드시** `Input (new, non-cache)` 입니다.

### Q2. “estimating이 0이면 버그 아닌가요?”

- 네, **LLM 호출이 있는데 0이면 누락 가능성이 큽니다.**  
  특히 구조화 호출(`invokeStructured`)은 provider에 따라 usage를 못 받는 경우가 있었고, 이를 피하기 위해 **usage를 얻을 수 있는 경로로 통일**해야 합니다.

---

## 구현 위치(코드 레퍼런스)

- **UI 계산/표기**
  - `packages/ant-ui/src/presentation/components/kanban/KanbanHeader.tsx`
  - `packages/ant-ui/src/shared/utils/tokenUtils.ts` (`getTokenUsageMetrics`)
- **세션/칸반에서 내려오는 값 예시**
  - `ant-workspaces/.../features/.../sessions/design.json`
- **LLM usage 누적(Design/Code 공통)**
  - `packages/ant-cli/src/agents/architect/graph/common/llmHelpers.ts` (`accumulateTokenUsage`)

---

## 교정 포인트(향후 개선 아이디어)

- Provider별 과금 정책이 바뀌면 billable 계수(1.25/0.1)는 업데이트되어야 합니다.
- 가능하다면 “provider 공식 비용(USD)”로 환산한 별도 지표를 추가하는 것이 더 직관적일 수 있습니다.


