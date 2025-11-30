# Decompose Prompt 설계 결함 분석: 버그 수정 vs 전체 재구현

## 🚨 문제 상황

### 사용자 지시

```
방입장시(생성시) 계속 다음 에러가 뜬다. 해결을 계속 못하고 있는데 뭣떄문인가? 
근본 결함이 있는것 같다. 계속 반복하는데도 못고치고 있다.

websocket.service.ts:76 
WebSocket connection to 'ws://localhost:5173/game' failed: 
WebSocket is closed before the connection is established.

websocket.service.ts:126 WebSocket is not connected
websocket.service.ts:53 WebSocket error: Event {isTrusted: true, type: 'error', ...}
```

**사용자 의도**: **버그 수정** - WebSocket URL이 잘못됨 (`ws://localhost:5173/game` → `ws://localhost:3000/ws`)

### LLM의 Task 생성 (Decompose 결과)

```
📊 Created 11 tasks:
   1. [P200] Implement Next.js Custom Server with WebSocket Support
   2. [P210] Implement SessionManager for Player Connection Management
   3. [P215] Implement RoomManager for Game Room Lifecycle
   4. [P220] Implement MessageDispatcher for WebSocket Message Routing
   5. [P230] Implement GameState and Physics Data Structures
   6. [P240] Implement GameEngine for Authoritative Game Physics
   7. [P250] Implement 60 FPS Game Loop with State Broadcast
   8. [P260] Implement WebSocket Connection and Disconnection Handlers
   9. [P270] Fix Client WebSocket Connection URL  ✅ 이것만 필요!
  10. [P280] Add Comprehensive Error Handling and Recovery
  11. [P1000] Final Integration & Verification
```

**LLM의 판단**: **전체 재구현** (11개 task 중 9번 task만 필요한데 1-8번까지 불필요한 작업 추가)

### 현재 코드 상태

```typescript
// lib/services/websocket.service.ts (이미 존재)
private getWebSocketURL(): string {
  // ❌ 문제: Vite dev server port(5173)와 endpoint(/game) 사용
  return `ws://localhost:5173/game`;  
  
  // ✅ 필요: Backend server port(3000)와 endpoint(/ws) 사용
  // return `ws://localhost:3000/ws`;
}
```

**실제 필요한 작업**: `websocket.service.ts` 파일의 **단 1줄 수정**

---

## 🔍 근본 원인 분석

### 1. Decompose Prompt의 구조적 한계

#### 현재 Prompt 구조

```markdown
# decompose/base.md

SPECIFICATION:
{{spec}}

{{#if hasExistingCode}}
🚨 CRITICAL: EXISTING CODEBASE DETECTED 🚨

**YOU MUST:**
- ✅ Create tasks to MODIFY/FIX/COMPLETE existing code
- ✅ Use verbs: "Fix", "Complete", "Extend", "Modify"
- ❌ DO NOT create "Setup Task (priority 100)"
- ❌ DO NOT recreate existing infrastructure

**If you see errors like "entry point missing":**
- These are BUG FIX tasks (priority 200+), NOT setup tasks
- Create ONE focused task to fix the specific missing file

**Task Description Guidelines for Existing Code:**
- ✅ GOOD: "Fix missing main.ts"
- ❌ BAD: "Implement AuthModule" (sounds like from scratch)
{{/if}}

YOUR TASK:
Break this specification into a prioritized list of implementation tasks.
```

#### 문제점

1. **"Existing Code" 감지는 있지만, "Error Type" 구분이 없음**
   - ✅ 있음: `hasExistingCode` 플래그
   - ❌ 없음: `isErrorFix`, `isBugFix`, `isRefactoring` 구분

2. **에러 수정 지침이 "entry point missing" 같은 구조적 에러에만 초점**
   ```markdown
   **If you see errors like "entry point missing" or "module not found":**
   - These are BUG FIX tasks (priority 200+)
   - Create ONE focused task to fix the specific missing file
   ```
   
   **하지만**: 런타임 에러, 로직 버그, URL 설정 오류 등에 대한 지침 없음!

3. **Specification이 에러 메시지를 포함할 때 LLM이 혼란**
   ```
   SPECIFICATION:
   방입장시 다음 에러가 뜬다...
   WebSocket connection to 'ws://localhost:5173/game' failed
   ```
   
   LLM 해석:
   - "WebSocket connection failed" → WebSocket 시스템이 없다?
   - "localhost:5173" → 서버가 제대로 설정 안됨?
   - → **전체 WebSocket 인프라를 재구현해야 한다!**

4. **Design Document의 영향**
   - Decompose는 `{{spec}}`에 design document를 포함함
   - Design doc은 **이상적인 전체 아키텍처** 설명
   - LLM이 "현재 코드가 design과 다르다" → "design대로 재구현"으로 오해

---

### 2. Directive의 Ambiguity (모호성)

#### 사용자 Directive 분석

```
방입장시(생성시) 계속 다음 에러가 뜬다. 해결을 계속 못하고 있는데 뭣떄문인가? 
근본 결함이 있는것 같다. 계속 반복하는데도 못고치고 있다.

websocket.service.ts:76 
WebSocket connection to 'ws://localhost:5173/game' failed
```

#### Ambiguity 포인트

1. **"근본 결함"**
   - 사용자 의도: URL 설정 오류가 반복적으로 수정 안됨
   - LLM 해석: 시스템 아키텍처에 근본적인 설계 결함 있음 → 재설계 필요

2. **"계속 반복하는데도 못고치고 있다"**
   - 사용자 의도: 이전에 수정 시도했지만 아직도 안됨
   - LLM 해석: 현재 구현 방식 자체가 잘못됨 → 다른 방식으로 재구현

3. **에러 메시지만 있고 "어떻게 고쳐야 하는지" 명시 없음**
   - 사용자: 에러 보고 알아서 수정해줄 것으로 기대
   - LLM: 에러의 원인을 추론 → **"WebSocket 시스템 전체 재구현"**으로 해석

4. **에러 컨텍스트 부족**
   ```
   websocket.service.ts:76  // ✅ 파일명과 라인 번호는 있음
   WebSocket connection to 'ws://localhost:5173/game' failed  // ✅ 에러 메시지 있음
   
   // ❌ 없는 정보:
   // - 백엔드 서버는 어느 포트에서 실행?
   // - 올바른 WebSocket URL은?
   // - 다른 부분은 정상 작동?
   ```

---

### 3. Decompose의 Mode Inference 부재

#### 현재 Flow

```
User Directive
  ↓
Resolve (mode inference: refactor)  ✅
  ↓
Decompose (LLM call - NO mode awareness)  ❌
  ↓
11 tasks generated (full reimplementation)
```

#### 문제

- **Resolve에서 `mode: refactor` 감지했지만**
- **Decompose는 이 정보를 활용하지 않음!**

```typescript
// resolve.ts
🎯 [Mode] Agent inference (confident): refactor (0.95)
   Mode: refactor (confidence: 0.95)
   Reasoning: Session continuation: fixing previous generate output

// decompose/index.ts
// ❌ Mode 정보가 Decompose prompt에 전달되지 않음!
```

#### Decompose Prompt에 Mode가 없는 이유

```markdown
# decompose/base.md
SPECIFICATION:
{{spec}}

{{#if hasExistingCode}}
  // ... existing code handling
{{/if}}

// ❌ {{#if (eq mode "refactor")}} 같은 조건 없음!
// ❌ Mode-specific guidance 없음!
```

---

## 🎯 LLM의 잘못된 판단 과정

### Step 1: Specification 해석

```
Input Specification:
  - Design Document: "WebSocket 기반 게임 서버, Custom Server, /ws endpoint..."
  - User Directive: "방입장시 에러... 근본 결함... ws://localhost:5173/game failed"
  - Existing Code: lib/services/websocket.service.ts (일부만 표시)
```

### Step 2: LLM의 추론

```
LLM Reasoning:
1. "근본 결함" → 아키텍처 문제
2. WebSocket connection failed → WebSocket 시스템 없음?
3. Design doc: "Next.js Custom Server with WebSocket on /ws"
4. Current error: "ws://localhost:5173/game"
5. Mismatch! → Design대로 재구현 필요

Conclusion:
  → Implement entire WebSocket system from design doc
  → Task 1-8: 전체 인프라 재구현
  → Task 9: URL 수정 (부수적)
```

### Step 3: Task 생성 로직

```markdown
# LLM이 생성한 Task 구조

## Architecture Tasks (P200-P260)
1. Custom Server (design 요구사항)
2. SessionManager (design 요구사항)
3. RoomManager (design 요구사항)
4. MessageDispatcher (design 요구사항)
5. GameState (design 요구사항)
6. GameEngine (design 요구사항)
7. Game Loop (design 요구사항)
8. Connection Handlers (design 요구사항)

## Bug Fix (P270)
9. Fix Client WebSocket URL ← 실제 필요한 것!

## Recovery (P280)
10. Error Handling
```

**분석**: LLM은 Design Doc를 **Target State**로 보고, 현재 에러를 **Gap**으로 인식, **Gap을 메우기 위한 전체 구현** 생성

---

## 💡 설계적 결함 (Design Flaws)

### 1. Decompose Prompt의 Binary Mode

```
Current Logic:
  IF hasExistingCode:
    → "Modify existing code"
  ELSE:
    → "Build from scratch"

Missing:
  IF isErrorFix:
    → "Fix specific error ONLY"
  IF isRefactoring:
    → "Refactor specific part"
  IF isFeatureAddition:
    → "Add new feature to existing"
```

**문제**: "Existing Code" 여부만 구분, **작업 유형**(error fix, refactor, feature, etc.)은 구분 안함

### 2. Specification Overload

```
Decompose Input:
  1. Design Document (전체 아키텍처, 이상적 상태)
  2. User Directive (버그 수정, 에러 메시지)
  3. Existing Code Preview (현재 상태)

Problem:
  - Design Doc (Target) + User Directive (Problem) = Confusion
  - LLM은 "Target에 도달하기 위한 모든 작업" 생성
  - 버그 수정 의도가 "전체 구현 필요"로 오해됨
```

### 3. Mode Information Loss

```
Resolve Node:
  ✅ Infers mode: "refactor" (0.95 confidence)
  ✅ Reasoning: "Session continuation: fixing previous output"

Decompose Node:
  ❌ Mode 정보 전달 안됨
  ❌ Prompt에 mode-specific guidance 없음
  ❌ LLM은 "refactor"인지 "generate"인지 모름
```

**결과**: Resolve가 올바르게 판단해도, Decompose는 처음부터 다시 판단 (정보 단절)

### 4. Error Context의 부재

```
Current Directive Format:
  "에러가 뜬다... WebSocket connection failed"

Missing Context:
  - What is the CORRECT behavior?
  - What is the ACTUAL error root cause?
  - Which specific file/line needs change?
  - What are the OTHER parts that work fine?
```

**문제**: LLM은 에러만 보고 "무엇이 정상인지" 모름 → Over-engineering

---

## 🔧 통합적 개선 방안

### Phase 1: Decompose Prompt 개선 (Immediate Fix)

#### 1.1. Mode-Aware Decomposition

```markdown
# decompose/base.md (NEW)

SPECIFICATION:
{{spec}}

{{#if mode}}
════════════════════════════════════════════════════════════════════════════════
🎯 WORK MODE: {{mode}} (Confidence: {{modeConfidence}})
════════════════════════════════════════════════════════════════════════════════

{{#if (eq mode "refactor")}}
**REFACTOR MODE - Fix/Improve Existing Code**

**YOU MUST:**
- ✅ Focus on MINIMAL changes to fix the stated problem
- ✅ Preserve working parts of the codebase
- ✅ Create ONLY tasks needed to fix the specific issue
- ❌ DO NOT recreate working components
- ❌ DO NOT add features not mentioned in directive
- ❌ DO NOT redesign the entire system

**Task Creation Rules:**
1. Identify the EXACT file/component causing the issue
2. Create ONE task per distinct issue
3. If directive mentions "error X" → create "Fix error X" task ONLY
4. DO NOT bundle fixes with feature additions

**Example:**
- Directive: "WebSocket connection to wrong URL fails"
- ✅ GOOD: "Fix WebSocket URL in websocket.service.ts"
- ❌ BAD: "Implement WebSocket infrastructure + Fix URL"
{{/if}}

{{#if (eq mode "explain")}}
**EXPLAIN MODE - Minimal Bug Fix**
(Similar guidance for explain mode)
{{/if}}

{{#if (eq mode "generate")}}
**GENERATE MODE - New Implementation**
(Existing guidance for generate mode)
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}
```

#### 1.2. Error-Specific Guidance

```markdown
{{#if hasErrorInDirective}}
════════════════════════════════════════════════════════════════════════════════
🚨 ERROR DETECTED IN DIRECTIVE
════════════════════════════════════════════════════════════════════════════════

**ERROR FIX MODE ACTIVATED**

**CRITICAL RULES:**
1. **Analyze the error message carefully**
   - What EXACTLY is failing?
   - What is the EXPECTED behavior?
   - What is the ACTUAL behavior?

2. **Identify the minimal fix**
   - Which specific file needs change?
   - Which specific line/function?
   - What is the ONE change needed?

3. **Create FOCUSED task**
   - Task description: State the EXACT fix
   - DO NOT add "and also..." or "plus..."
   - ONE task = ONE fix

4. **DO NOT over-engineer**
   - ❌ "Error: URL wrong" → "Rebuild entire system"
   - ✅ "Error: URL wrong" → "Fix URL constant"

**Example Error Fix Tasks:**
```json
{
  "id": "fix-websocket-url",
  "name": "Fix WebSocket Connection URL",
  "type": "feature",
  "priority": 200,
  "description": "Update websocket.service.ts line 39: Change WebSocket URL from 'ws://localhost:5173/game' to 'ws://localhost:3000/ws' to match backend server configuration."
}
```

════════════════════════════════════════════════════════════════════════════════
{{/if}}
```

#### 1.3. Design Doc Handling

```markdown
{{#if designDoc}}
════════════════════════════════════════════════════════════════════════════════
📐 DESIGN DOCUMENT (REFERENCE ONLY)
════════════════════════════════════════════════════════════════════════════════

**⚠️ CRITICAL: Design document is for REFERENCE, not a TODO list!**

{{#if (eq mode "refactor")}}
**IN REFACTOR MODE:**
- Design doc shows the INTENDED architecture
- Your task is to FIX specific issues, NOT implement entire design
- Use design doc to understand context ONLY
- DO NOT create tasks for every component in design doc

**Example:**
- Design doc: "System has SessionManager, RoomManager, GameEngine..."
- Directive: "Fix WebSocket URL error"
- ✅ Create: "Fix WebSocket URL" (1 task)
- ❌ DO NOT create: 10 tasks to implement all managers
{{/if}}

{{#if (eq mode "generate")}}
**IN GENERATE MODE:**
- Design doc is your implementation guide
- Create tasks to implement components described
- Follow the architecture in design doc
{{/if}}

════════════════════════════════════════════════════════════════════════════════
{{/if}}
```

---

### Phase 2: Directive Quality 개선 (User Guidance)

#### 2.1. Error Directive Template

```markdown
# 에러 수정 요청 시 권장 포맷

❌ BAD (모호함):
"방입장시 에러가 뜬다. 근본 결함이 있는것 같다."

✅ GOOD (명확함):
"WebSocket 연결 실패 에러 수정:
- 파일: lib/services/websocket.service.ts:39
- 현재: ws://localhost:5173/game
- 수정 필요: ws://localhost:3000/ws (백엔드 서버 포트)
- 이유: Vite dev server 포트 대신 백엔드 서버 포트 사용해야 함"
```

#### 2.2. Directive Preprocessing

```typescript
// In resolve.ts - 새로운 전처리 로직

function preprocessDirective(directive: string, mode: string): string {
  if (mode === 'refactor' || mode === 'explain') {
    // 에러 메시지 추출
    const errorMatch = directive.match(/error:|failed:|exception:/gi);
    
    if (errorMatch) {
      // 에러 수정 컨텍스트 추가
      return `
🚨 ERROR FIX REQUEST

User reported error:
${directive}

CRITICAL INSTRUCTIONS FOR DECOMPOSE:
- This is a BUG FIX request, NOT a feature implementation
- Create MINIMAL tasks to fix the specific error
- DO NOT recreate working components
- DO NOT add features not mentioned
- Focus ONLY on fixing the reported error

Expected task count: 1-2 tasks maximum
      `.trim();
    }
  }
  
  return directive;
}
```

---

### Phase 3: Mode 정보 전달 (Architecture Fix)

#### 3.1. Decompose State Enhancement

```typescript
// decompose/index.ts

export async function decompose(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  // ...
  
  // ✅ NEW: Pass mode information to prompt
  const promptContext = {
    spec: specParts.join('\n\n'),
    hasExistingCode: state.code && state.code.length > 0,
    codePreview: codePreviewText,
    
    // ✅ NEW: Mode information
    mode: state.codeMode,
    modeConfidence: state.modeConfidence,
    modeReasoning: state.modeReasoning,
    
    // ✅ NEW: Error detection
    hasErrorInDirective: detectError(state.directive),
    errorContext: extractErrorContext(state.directive),
  };
  
  // ...
}

function detectError(directive: string): boolean {
  const errorKeywords = [
    'error', 'failed', 'exception', '에러', '실패',
    'not working', 'broken', '안됨', '못하고'
  ];
  
  return errorKeywords.some(keyword => 
    directive.toLowerCase().includes(keyword)
  );
}

function extractErrorContext(directive: string): ErrorContext | null {
  // 파일명, 라인 번호, 에러 메시지 추출
  const fileMatch = directive.match(/([a-zA-Z0-9_-]+\.(ts|js|tsx|jsx)):(\d+)/);
  const errorMsgMatch = directive.match(/(error|failed|exception):(.+)/i);
  
  if (fileMatch || errorMsgMatch) {
    return {
      file: fileMatch?.[1],
      line: fileMatch?.[3] ? parseInt(fileMatch[3]) : undefined,
      message: errorMsgMatch?.[2]?.trim(),
    };
  }
  
  return null;
}
```

---

### Phase 4: Task Validation (Safety Net)

#### 4.1. Post-Decompose Validation

```typescript
// decompose/index.ts - After LLM call

function validateTasks(
  tasks: Task[], 
  mode: string, 
  directive: string
): Task[] {
  
  // ✅ Refactor/Explain mode: Excessive task count warning
  if ((mode === 'refactor' || mode === 'explain') && tasks.length > 5) {
    console.warn(`
⚠️  WARNING: Decompose generated ${tasks.length} tasks in ${mode} mode.
   This might indicate over-engineering.
   
   Directive: ${directive.substring(0, 100)}...
   Mode: ${mode}
   
   Recommended: 1-3 tasks for bug fixes
   Generated: ${tasks.length} tasks
   
   Review if tasks are truly necessary.
    `);
  }
  
  // ✅ Error directive: Check if first task is focused fix
  if (detectError(directive)) {
    const firstTask = tasks[0];
    
    if (firstTask && isOverBroadTask(firstTask)) {
      console.warn(`
⚠️  WARNING: First task seems too broad for error fix.
   
   Task: ${firstTask.name}
   Description: ${firstTask.description.substring(0, 100)}...
   
   Expected: Focused fix (e.g., "Fix X in file.ts")
   Got: Broad implementation (e.g., "Implement entire X system")
      `);
    }
  }
  
  return tasks;
}

function isOverBroadTask(task: Task): boolean {
  const broadKeywords = [
    'implement entire', 'build complete', 'create all',
    'implement', 'create', 'build', 'setup'
  ];
  
  const focusedKeywords = [
    'fix', 'update', 'modify', 'change', 'correct'
  ];
  
  const hasBroad = broadKeywords.some(k => 
    task.name.toLowerCase().includes(k) || 
    task.description.toLowerCase().includes(k)
  );
  
  const hasFocused = focusedKeywords.some(k =>
    task.name.toLowerCase().includes(k)
  );
  
  return hasBroad && !hasFocused;
}
```

---

## 📊 개선 효과 예측

### Before (현재)

```
User: "WebSocket URL 에러 수정"
  ↓
Decompose: 11 tasks
  1-8: 전체 WebSocket 인프라 재구현
  9: URL 수정 ← 실제 필요한 것
  10-11: 추가 작업
  ↓
Result: 불필요한 작업 90%, 시간 낭비, 사용자 불만
```

### After (개선 후)

```
User: "WebSocket URL 에러 수정"
  ↓
Resolve: mode=refactor, hasError=true
  ↓
Decompose (Mode-Aware):
  - Mode: refactor → Minimal fix only
  - Error detected → Focus on error
  - Design doc → Reference only
  ↓
Tasks: 1-2 tasks
  1: Fix WebSocket URL ← 필요한 것만!
  2: Final Verification
  ↓
Result: 정확한 작업, 빠른 수정, 사용자 만족
```

---

## 🎯 우선순위별 실행 계획

### Priority 1: Immediate (긴급)

1. **Decompose Prompt에 Mode 섹션 추가**
   - `{{#if (eq mode "refactor")}}` 조건 추가
   - Refactor mode일 때 "minimal fix" 지침

2. **Error Detection 플래그 추가**
   - `{{#if hasErrorInDirective}}` 조건
   - Error fix 전용 지침

**예상 효과**: 60-70% 개선

### Priority 2: Short-term (1-2주)

1. **Directive Preprocessing**
   - `resolve.ts`에서 directive 전처리
   - Error context 자동 추출

2. **Task Validation**
   - Post-decompose task count 검증
   - Over-engineering 경고

**예상 효과**: 80-90% 개선

### Priority 3: Long-term (1-2개월)

1. **Directive Quality Guidance**
   - UI에 directive 작성 가이드
   - 템플릿 제공

2. **Smart Decompose**
   - 과거 세션 분석
   - Task 패턴 학습

**예상 효과**: 95%+ 개선

---

## 💭 결론

### 핵심 문제

1. **Decompose는 Mode를 모른다** (정보 단절)
2. **Error Fix vs Feature 구분 없음** (이진 분류의 한계)
3. **Design Doc을 TODO로 오해** (컨텍스트 혼란)
4. **Directive가 모호함** (사용자 표현의 한계)

### 근본 해결책

**Decompose Prompt는 Mode-Aware해야 한다!**

```
Refactor Mode + Error Detected:
  → "Fix ONLY the specific error"
  → "Preserve working code"
  → "Design doc is reference, not todo"

Generate Mode + No Error:
  → "Implement from design doc"
  → "Create complete system"
  → "Design doc is implementation guide"
```

### 통합적 접근

1. ✅ **Prompt 개선**: Mode-aware, error-aware
2. ✅ **정보 전달**: Resolve → Decompose mode 연결
3. ✅ **Validation**: Task count, scope 검증
4. ✅ **User Guidance**: Directive 작성 가이드

**이 모든 것이 함께 작동해야 근본적 해결!**

---

**문서 작성**: 2025-11-29  
**분석 대상**: ant-pong-be/skeleton (Turn 33)  
**다음 단계**: Phase 1 (Mode-Aware Decompose) 구현

