# Token Management System Refactoring

## 📋 문제 정의

**근본 원인**: Tool 결과 및 대화 히스토리 무제한 누적으로 인한 토큰 초과 (204,670 > 200,000)

### 실제 발생 사례 (ant-landing 프로젝트)
```
Task: Add Wallet Info and Disconnect Components
├─ Turn 1: Write WalletInfo.tsx (성공)
├─ Turn 2: Write DisconnectButton.tsx (성공)
├─ Turn 3: Read GNB.tsx (성공)
├─ Turn 4: Read WalletContext.tsx (실패 - 파일 없음)
├─ Turn 5: Search WalletContext → 216개 매치! (대량 결과)
└─ Turn 6: 💥 토큰 한계 초과 (204,670 tokens > 200,000)
```

**핵심 문제**:
1. ❌ Tool 결과가 대량이어도 전체를 history에 저장
2. ❌ Conversation history가 무제한 누적
3. ❌ 토큰 예산 체크 및 관리 부재

---

## 🎯 설계 원칙

### 1. **관심사의 분리 (Separation of Concerns)**
- **TokenBudgetManager**: 토큰 추정 및 예산 관리
- **HistoryManager**: 대화 히스토리 압축 및 pruning
- **ToolResultManager**: Tool 결과 truncation 및 요약

### 2. **보수적 추정 (Conservative Estimation)**
- `1 token ≈ 3.5 chars` (실제 ~4, 안전 마진 포함)
- Safety margin: 10% (180K effective limit)
- Warning threshold: 80% (160K)

### 3. **Intelligent Pruning**
- Tool call/result 쌍은 항상 함께 보존 (분리 불가)
- 최신 N개 turn은 무조건 보존 (기본: 3 turns)
- 에러 및 setup 메시지 우선순위 부여
- 대량 tool result는 낮은 우선순위

### 4. **Tool-Specific Truncation**
- `search_code`: 상위 N개 결과만 (기본: 20개)
- `read_file`: 헤더/푸터 보존, 중간 생략
- `list_files`: 파일 수 제한 (기본: 50개)
- Generic: JSON compact 포맷 + 길이 제한

---

## 🏗️ 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                        CodeGen Node                         │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ buildMessages()                                       │  │
│  │                                                       │  │
│  │  1. Build fresh prompt (PromptEngine)                │  │
│  │  2. Filter initial user prompts                      │  │
│  │  3. ✅ Prune history (HistoryManager)                │  │
│  │  4. ✅ Check token budget (TokenBudgetManager)       │  │
│  │  5. Return messages                                  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                         Tool Node                           │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ tool()                                                │  │
│  │                                                       │  │
│  │  1. Execute tool                                     │  │
│  │  2. ✅ Truncate result (ToolResultManager)           │  │
│  │  3. Build tool_result message                        │  │
│  │  4. Update conversation history                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 구현 상세

### 1. TokenBudgetManager
**경로**: `packages/ant-cli/src/core/utils/tokenBudget.ts`

**책임**:
- 문자열 → 토큰 수 추정
- Anthropic 메시지 포맷 지원 (string | any[])
- 토큰 예산 체크 및 로깅

**핵심 API**:
```typescript
class TokenBudgetManager {
  estimateTokens(text: string): number
  estimateMessageContent(content: string | any[]): number
  estimateMessages(messages: Message[]): TokenEstimation
  checkBudget(messages: Message[]): TokenEstimation
}
```

**출력 예시**:
```
📊 [TokenBudget] Estimation:
   System Prompt: 45,230 tokens
   Conversation History: 102,450 tokens
   Current Message: 3,120 tokens
   Total: 150,800 / 200,000 tokens (75.4%)
✅ [TokenBudget] Within safe limits.
```

---

### 2. HistoryManager
**경로**: `packages/ant-cli/src/core/utils/historyManager.ts`

**책임**:
- 대화 히스토리를 turn 단위로 그룹화
- 토큰 예산 내에서 최대 컨텍스트 유지
- 중요 메시지 우선순위 부여

**알고리즘**:
1. Turn 단위로 그룹화 (assistant + user pair)
2. 각 turn의 토큰 및 우선순위 계산
3. 최신 N개 turn 무조건 보존
4. 나머지는 우선순위 순으로 포함 (예산 내)

**우선순위 계산**:
```typescript
priority += 10  // 에러 메시지
priority += 5   // Setup task
priority -= 5   // 매우 큰 결과 (>10K tokens)
priority -= 2   // 큰 결과 (>5K tokens)
```

**출력 예시**:
```
🗜️  [HistoryManager] Pruned conversation history:
   Removed: 8 messages
   Saved: 45,320 tokens
   Kept: 12 messages (57,180 tokens)
```

---

### 3. ToolResultManager
**경로**: `packages/ant-cli/src/core/utils/toolResultManager.ts`

**책임**:
- Tool별 맞춤형 truncation 로직
- 토큰 예산 초과 방지
- 에러는 truncate 안함 (보존)

**Tool별 전략**:

#### `search_code` (가장 문제가 많음!)
```typescript
전략: 상위 N개 파일 + 파일당 최대 2개 매치
기본: 20개 파일, 40개 매치
결과: "... (truncated: 176 more lines)"
```

#### `read_file`
```typescript
전략: 시작 40% + 끝 40% 보존, 중간 20% 생략
결과: "... (500 lines omitted) ..."
```

#### `list_files`
```typescript
전략: 상위 N개 파일만
기본: 50개 파일
결과: "... (123 more files)"
```

**출력 예시**:
```
✂️  [ToolResult] Truncated search_code:
   Original: 42,350 tokens (216 lines)
   Truncated: 4,820 tokens (47 lines)
   Kept: Top 20 files, 40 matches
```

---

## 🔗 통합 포인트

### Code Job (packages/ant-cli/src/agents/architect/graph/code)

#### 1. **codeGen.ts**
```typescript
// buildMessages() 내부
const tokenManager = new TokenBudgetManager();
const historyManager = new HistoryManager(tokenManager);

// Prune history
const { prunedHistory } = historyManager.pruneHistory(filteredHistory);
messages.push(...prunedHistory);

// Check budget
const estimation = tokenManager.checkBudget(messages);
if (estimation.isOverBudget) {
  throw new Error(`Token budget exceeded!`);
}
```

#### 2. **tool.ts**
```typescript
// Tool 실행 후
const truncation = toolResultManager.truncateResult(name, result, error);
const toolResultContent = truncation.content;

if (truncation.wasTruncated) {
  console.log(`📏 [Tool] Result truncated: ${truncation.originalTokens} → ${truncation.truncatedTokens} tokens`);
}
```

### Design Job (packages/ant-cli/src/agents/architect/graph/design)
- **docGen.ts**: 동일한 history pruning 로직 적용
- **tool.ts**: 동일한 tool result truncation 로직 적용

---

## 📊 효과 분석

### Before (문제 발생 케이스)
```
Turn 5: search_code → 216개 매치
  └─ Tool result: ~42,000 tokens (전체 저장)
  
Turn 6: 204,670 tokens → 💥 FAILED
  ├─ System Prompt: 45,230 tokens
  ├─ History (Turns 1-5): 156,320 tokens
  └─ Current: 3,120 tokens
```

### After (예상 결과)
```
Turn 5: search_code → 216개 매치
  └─ Tool result: ~4,800 tokens (truncated: top 20 files)
  
Turn 6: 118,450 tokens → ✅ SUCCESS
  ├─ System Prompt: 45,230 tokens
  ├─ History (pruned): 70,100 tokens
  └─ Current: 3,120 tokens

📊 [TokenBudget] Total: 118,450 / 200,000 tokens (59.2%)
✅ [TokenBudget] Within safe limits.
```

**절약**:
- Tool result truncation: ~37,200 tokens 절약
- History pruning: ~86,220 tokens 절약
- **총 절약**: ~123,420 tokens (60% 감소)

---

## 🧪 테스트 시나리오

### 1. **대량 search_code 결과**
```bash
# Test: search_code with 200+ matches
ant code --project ant-landing --feature cross-sdk
```

**예상 동작**:
- ✅ Tool result가 상위 20개로 제한됨
- ✅ 토큰 예산 내로 유지
- ✅ 6번 이상 turn 진행 가능

### 2. **긴 대화 히스토리**
```bash
# Test: Job with 10+ turns
ant code --project ant-landing --feature fix-complex-bug
```

**예상 동작**:
- ✅ 최신 3개 turn 무조건 보존
- ✅ 오래된 turn은 우선순위에 따라 제거
- ✅ 에러 메시지는 보존됨

### 3. **대용량 파일 read**
```bash
# Test: read_file on large file (>10K lines)
```

**예상 동작**:
- ✅ 파일의 시작/끝 보존, 중간 생략
- ✅ 토큰 3000개 이하로 제한
- ✅ 컨텍스트는 충분히 유지

---

## 🎯 핵심 개선사항

### 1. **Zero Breaking Changes**
- 기존 API 변경 없음
- 기존 동작 100% 호환
- 추가된 로직만 삽입

### 2. **Progressive Enhancement**
- 토큰이 예산 내면 기존과 동일 동작
- 예산 초과 위험시에만 pruning 활성화
- 로깅으로 투명성 확보

### 3. **Fail-Safe Design**
- Pruning 실패 → 에러로 조기 탐지
- Tool truncation 실패 → 원본 사용 (최악의 경우)
- 모든 단계에서 로깅으로 디버깅 가능

### 4. **Configuration**
```typescript
// 필요시 설정 조정 가능
const tokenManager = new TokenBudgetManager({
  maxTokens: 200000,
  safetyMargin: 0.10,  // 10%
  warningThreshold: 0.80,  // 80%
});

const historyManager = new HistoryManager(tokenManager, {
  maxTokens: 100000,  // History limit
  minTurnsToKeep: 3,
  prioritizeErrors: true,
  prioritizeSetup: true,
});

const toolResultManager = new ToolResultManager(tokenManager, {
  maxTokensPerResult: 5000,
  maxSearchResults: 20,
  maxListFiles: 50,
  maxReadFileTokens: 3000,
});
```

---

## 🚀 배포 체크리스트

- [x] TokenBudgetManager 구현
- [x] HistoryManager 구현
- [x] ToolResultManager 구현
- [x] Code job (codeGen + tool) 통합
- [x] Design job (docGen + tool) 통합
- [x] TypeScript 컴파일 성공
- [ ] 실제 프로젝트 테스트
- [ ] 로그 분석 및 튜닝
- [ ] Production 배포

---

## 📝 향후 개선 방향

### 1. **Adaptive Truncation**
- Turn 수에 따라 truncation 강도 조절
- 예: Turn 10+면 더 aggressive truncation

### 2. **Semantic Summarization**
- 대량 결과를 단순 truncate 대신 요약
- 예: "Found 216 matches in 45 files. Top matches: ..."

### 3. **Token Cache**
- 자주 사용되는 메시지의 토큰 수 캐싱
- 반복 계산 비용 절감

### 4. **Metrics & Monitoring**
- 토큰 사용량 통계 수집
- 평균/최대 토큰 수 추적
- Pruning 효과 측정

---

## 🔍 디버깅 가이드

### 토큰 초과 발생 시
```bash
# 1. 로그에서 토큰 추정 확인
📊 [TokenBudget] Estimation:
   ...

# 2. History pruning 확인
🗜️  [HistoryManager] Pruned conversation history:
   ...

# 3. Tool result truncation 확인
✂️  [ToolResult] Truncated search_code:
   ...
```

### Pruning이 안되는 경우
- `minTurnsToKeep` 설정 확인 (기본: 3)
- 각 turn의 토큰 수 확인
- 우선순위 로직 검토

### Tool result가 여전히 큰 경우
- `maxTokensPerResult` 설정 확인 (기본: 5000)
- Tool별 제한 확인 (search: 20, list: 50)
- Truncation 로직이 해당 tool을 지원하는지 확인

---

## 👥 기여자
- **설계 및 구현**: @ant-ai (2025-11-25)
- **리뷰**: N/A
- **테스트**: Pending

---

## 📚 참고 문서
- Anthropic API Limits: https://docs.anthropic.com/en/api/rate-limits
- Token Counting Best Practices: https://help.openai.com/en/articles/4936856
- LangGraph State Management: https://langchain-ai.github.io/langgraph/

