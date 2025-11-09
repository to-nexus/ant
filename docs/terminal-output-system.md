# Terminal Output System Documentation

## 📊 Overview

이 문서는 ANT CLI에서 생성되는 모든 터미널 출력(console.log)의 카테고리, 패턴, 클라이언트 처리 방식을 정리합니다.

---

## 🎯 목적

- **현재 상태 파악**: 어떤 로그들이 어떻게 출력되는지 완전 이해
- **리팩토링 가이드**: 장황한 로그를 간결하게 개선
- **일관성 유지**: 통일된 로그 포맷 정의

---

## 📁 데이터 흐름

```
Agent Node (서버)
  ↓ console.log()
stdout
  ↓ child_process
ExpressServerAdapter
  ↓ SSE (Server-Sent Events)
클라이언트 (ant-ui)
  ↓ subscribeToLogs()
CircularLogBuffer (2000개)
  ↓ filterLogsForTerminal()
TerminalBar Component
```

---

## 🏷️ 로그 카테고리 체계

### **1. NODE_TRANSITION (노드 전환)**

**패턴:**
```typescript
🔍 resolve
🧩 decompose
📋 plan → Task Name
⚡ execute → Task Name
📝 writeFiles → Task Name
✓ validate → Task Name
📦 installDeps → Task Name
🔨 runtimeValidate → Task Name
🔄 enforce → Task Name
✅ checkTaskStatus → Task Name
🎓 learn → Task Name
```

**실제 예시:**
```
🔍 resolve
🧩 decompose
📋 plan → Add Test Line to README
⚡ execute → Add Test Line to README
📝 writeFiles → Add Test Line to README
✓ validate → Add Test Line to README
```

**특징:**
- `WorkflowStateService`에서 자동 생성
- 이모지 + 노드명 + Task명 (간결)
- 항상 표시 ✅

**위치:**
- `packages/ant-cli/src/periphery/adapters/http/services/WorkflowStateService.ts`

**클라이언트 처리:**
- 필터링하지 않음
- 그대로 표시
- 워크플로 추적에 필수

---

### **2. TASK_STATUS (태스크 상태)**

#### **2.1 Planning 시작**
```typescript
🧭 Planning (1/50)
```

**위치:** `plan.ts` Line 88

**실제 예시:**
```
🧭 Planning (1/50)
```

**리팩토링 제안:**
- 현재: 적절함 ✅ (간결)

---

#### **2.2 Task 시작**
```typescript
📊 Progress: 0/5 (0%) | Setup: 1 | Feature: 4 | Error: 0
🚀 Starting: Task Name (feature)
   1 more task(s) in queue
```

**위치:** `plan.ts` Line 177-180

**실제 예시:**
```
📊 Progress: 0/5 (0%) | Setup: 1 | Feature: 4 | Error: 0
🚀 Starting: Add Test Line to README (feature)
   0 more task(s) in queue
```

**리팩토링 제안:**
```typescript
// Before (3줄)
📊 Progress: 0/5 (0%) | Setup: 1 | Feature: 4 | Error: 0
🚀 Starting: Task Name (feature)
   1 more task(s) in queue

// After (1줄)
🚀 Task Name (feature) [0/5, +1 queued]
```

---

#### **2.3 Task 재시도**
```typescript
🔄 Retrying failed task: Task Name
   Retries: 2/3
   Violations: 5
```

**위치:** `plan.ts` Line 102-104

**실제 예시:**
```
🔄 Retrying failed task: Fix TypeScript errors
   Retries: 1/3
   Violations: 3
```

**리팩토링 제안:**
```typescript
// Before (3줄)
🔄 Retrying failed task: Task Name
   Retries: 2/3
   Violations: 5

// After (1줄)
🔄 Retry 2/3: Task Name (5 errors)
```

---

#### **2.4 Task 완료**
```typescript
✅ Task "Task Name" completed in 12s!
```

**위치:** `graph.ts` Line 26-60

**실제 예시:**
```
✅ Task "Add Test Line to README" completed in 8s!
```

**리팩토링 제안:**
```typescript
// Before
✅ Task "Task Name" completed in 12s!

// After
✅ Task Name (12s)
```

---

#### **2.5 Task 실패 (재시도 한계)**
```typescript
⚠️  ═══════════════════════════════════════════════════════════
⚠️  Task "Task Name" EXHAUSTED RETRIES (3/3)
⚠️  ═══════════════════════════════════════════════════════════
```

**위치:** `plan.ts` Line 224-226

**실제 예시:**
```
⚠️  ═══════════════════════════════════════════════════════════
⚠️  Task "Fix Build Errors" EXHAUSTED RETRIES (3/3)
⚠️  ═══════════════════════════════════════════════════════════
```

**리팩토링 제안:**
```typescript
// Before (3줄 + 구분선)
⚠️  ═══════════════════════════════════════════════════════════
⚠️  Task "Task Name" EXHAUSTED RETRIES (3/3)
⚠️  ═══════════════════════════════════════════════════════════

// After (1줄)
❌ Task failed after 3 retries: Task Name
```

---

#### **2.6 에러 Task 생성**
```typescript
📝 Creating 2 error task(s) from 5 violation(s):

   1. "Fix TypeScript Errors" (P10) - 3 error(s)
   2. "Fix Lint Errors" (P11) - 2 error(s)
```

**위치:** `plan.ts` Line 233-249

**실제 예시:**
```
📝 Creating 1 error task(s) from 2 violation(s):

   1. "Fix Build Errors in feature.ts" (P10) - 2 error(s)
```

**리팩토링 제안:**
- 현재: 적절함 ✅ (사용자에게 유용한 정보)

---

### **3. LLM_INTERACTION (LLM 상호작용)**

#### **3.1 THINKING 블록**
```
=== THINKING ===

(100+ lines of LLM reasoning)

=== END THINKING ===
```

**위치:** LLM raw response

**현재 처리:**
```typescript
// logFilters.ts
🧠 Analyzing...  // 1줄로 축약 ✅
```

#### **3.2 RESPONSE 블록**
```
=== RESPONSE ===

(50+ lines of LLM explanation)

=== END RESPONSE ===
```

**위치:** LLM raw response

**현재 처리:**
```typescript
// logFilters.ts
💬 Responding...  // 1줄로 축약 ✅
```

#### **3.3 CODE 블록**
```
=== FILE: src/feature.ts ===

(500+ lines of code)

=== END FILE ===
```

**위치:** LLM raw response

**현재 처리:**
```typescript
// logFilters.ts
📝 Writing: src/feature.ts  // 파일명만 ✅
```

---

### **4. FILE_OPERATIONS (파일 작업)**

#### **4.1 파일 작성 시작**
```typescript
================================================================================
📝 FILE OPERATIONS REPORT
================================================================================
```

**위치:** `writeFiles.ts` Line 70-72

**리팩토링 제안:**
```typescript
// Before
================================================================================
📝 FILE OPERATIONS REPORT
================================================================================

// After
📝 File Operations:
```

#### **4.2 파일 작성 결과**
```typescript
📝 MODIFIED  src/feature.ts
           Size: 1.2 KB     Lines: 45
```

**위치:** `writeFiles.ts` Line 95-107

**현재:** 적절함 ✅

#### **4.3 파일 삭제**
```typescript
🗑️  DELETED   src/old-file.ts
```

**위치:** `writeFiles.ts` Line 134

**현재:** 적절함 ✅

#### **4.4 요약**
```typescript
────────────────────────────────────────────────────────────────────────────────
📊 SUMMARY:
   ✨ New files:      0
   📝 Modified files: 1
   📦 Total files:    1
   💾 Total size:     1.9 KB
================================================================================
```

**위치:** `writeFiles.ts` Line 147-154

**리팩토링 제안:**
```typescript
// Before (8줄)
────────────────────────────────────────────────────────────────────────────────
📊 SUMMARY:
   ✨ New files:      0
   📝 Modified files: 1
   📦 Total files:    1
   💾 Total size:     1.9 KB
================================================================================

// After (1줄)
📊 1 file modified (1.9 KB)
```

---

### **5. VALIDATION (검증)**

#### **5.1 검증 시작**
```typescript
📋 Running runtime validation in: /path/to/project
   🔒 Policy: feature tasks → runtime validation
```

**위치:** `runtimeValidate.ts` Line 123-125

**리팩토링 제안:**
```typescript
// Before (2줄)
📋 Running runtime validation in: /path/to/project
   🔒 Policy: feature tasks → runtime validation

// After (1줄)
🔨 Validating...
```

#### **5.2 검증 모드**
```typescript
🔍 Runtime validation mode (full)
   ✅ TypeScript type check
   ✅ Build execution
   ✅ Lint checks
```

**위치:** `runtimeValidate.ts` Line 188-191

**리팩토링 제안:**
```typescript
// Before (4줄)
🔍 Runtime validation mode (full)
   ✅ TypeScript type check
   ✅ Build execution
   ✅ Lint checks

// After (1줄)
🔨 Full validation (type/build/lint)
```

#### **5.3 검증 건너뛰기**
```typescript
⏭️  Skipping validation (LLM decision)
   Task: Task Name
   Rationale: Simple text file modification
```

**위치:** `runtimeValidate.ts` Line 70-72

**리팩토링 제안:**
```typescript
// Before (3줄)
⏭️  Skipping validation (LLM decision)
   Task: Task Name
   Rationale: Simple text file modification

// After (1줄)
⏭️  Skipping validation (text file only)
```

#### **5.4 검증 결과**
```typescript
✅ Type check passed
✅ Build succeeded!
✅ Lint passed
```

**현재:** 적절함 ✅

---

### **6. COMMAND_EXECUTION (명령 실행)**

#### **6.1 명령 실행**
```typescript
💻 Executing: npm install
   Purpose: Install dependencies
   ✅ Success
```

**위치:** `execute.ts` Line 451-463

**리팩토링 제안:**
```typescript
// Before (3줄)
💻 Executing: npm install
   Purpose: Install dependencies
   ✅ Success

// After (2줄)
💻 npm install
✅ Success
```

#### **6.2 의존성 설치**
```typescript
⏭️  Skipping dependency installation (package.json unchanged)
   Task: Task Name
   Type: feature
   Rationale: Feature tasks only need install if dependencies change
```

**위치:** `installDeps.ts` Line 67-72

**리팩토링 제안:**
```typescript
// Before (4줄)
⏭️  Skipping dependency installation (package.json unchanged)
   Task: Task Name
   Type: feature
   Rationale: Feature tasks only need install if dependencies change

// After (1줄)
⏭️  Skipping npm install (no changes)
```

---

### **7. ERROR_HANDLING (에러 처리)**

#### **7.1 Enforcement 트리거**
```typescript
⚠️  ENFORCEMENT triggered (retry 2/3)
   Violations: 5

📋 Violation Summary:
1. [MAJOR] TypeScript Error
   Message: Property 'x' does not exist
   File: src/feature.ts
   💡 Suggested Fix: Add property 'x'
   ♻️  Retryable: YES
```

**위치:** `enforce.ts` Line 95-133

**리팩토링 제안:**
```typescript
// Before (10+ 줄)
⚠️  ENFORCEMENT triggered (retry 2/3)
   Violations: 5
📋 Violation Summary:
1. [MAJOR] TypeScript Error
   Message: Property 'x' does not exist
   File: src/feature.ts
   💡 Suggested Fix: Add property 'x'
   ♻️  Retryable: YES

// After (3줄)
🔄 Retry 2/3: 5 errors
❌ src/feature.ts: Property 'x' missing
💡 Add property 'x'
```

#### **7.2 반복 에러 경고**
```typescript
🚨 REPEATED ERRORS DETECTED - Same errors as previous attempt!
   This suggests the LLM is stuck or misunderstanding the problem.
   Escalating context for next retry...
```

**위치:** `enforce.ts` Line 102-104

**현재:** 적절함 ✅ (중요한 경고)

#### **7.3 재시도 한계**
```typescript
⚠️  ═══════════════════════════════════════════════════════════
⚠️  Task "Task Name" EXHAUSTED RETRIES (3/3)
⚠️  ═══════════════════════════════════════════════════════════
```

**위치:** `plan.ts` Line 224-226

**리팩토링 제안:**
```typescript
// Before (3줄 + 구분선)
⚠️  ═══════════════════════════════════════════════════════════
⚠️  Task "Task Name" EXHAUSTED RETRIES (3/3)
⚠️  ═══════════════════════════════════════════════════════════

// After (1줄)
❌ Task failed after 3 retries: Task Name
```

---

### **8. BUILD_OUTPUT (빌드 출력)**

#### **8.1 npm 빌드 시작**
```typescript
💻 Executing: npm run build
```

**위치:** `runtimeValidate.ts` via command execution

**현재:** 적절함 ✅

#### **8.2 빌드 에러**
```typescript
❌ Build failed with 5 errors:
   src/feature.ts(10,5): error TS2345: ...
   src/main.ts(20,10): error TS2339: ...
```

**위치:** `runtimeValidate.ts` Line 200-250

**현재:** 적절함 ✅ (디버깅에 필수)

---

### **9. PROGRESS_TRACKING (진행 추적)**

#### **9.1 체크포인트 저장**
```typescript
[saveCheckpoint] 💾 Saving checkpoint: {
  "completedTasksCount": 1,
  "queueSize": 4
}
[saveCheckpoint] ✅ Checkpoint saved successfully
```

**위치:** `checkpoint.ts` Line 15-30

**현재 처리:**
```typescript
// logFilters.ts에서 PROGRESS로 분류되어 생략 ✅
```

#### **9.2 프롬프트 빌드 시간**
```typescript
⏱️  Prompt build time: 118ms
```

**위치:** `plan.ts`, `execute.ts`

**현재 처리:**
```typescript
// 이미 제거됨 ✅
```

---

### **10. SYSTEM_INFO (시스템 정보)**

#### **10.1 LLM 초기화**
```typescript
🤖 [LLM] Initializing LLM Client: {
  "agentType": "architect",
  "provider": "anthropic",
  "modelName": "claude-sonnet-4-5"
}
```

**위치:** Agent initialization

**리팩토링 제안:**
```typescript
// Before (6줄)
🤖 [LLM] Initializing LLM Client: {
  "agentType": "architect",
  "provider": "anthropic",
  "modelName": "claude-sonnet-4-5"
}

// After (1줄)
🤖 LLM: claude-sonnet-4-5 (anthropic)
```

#### **10.2 실시간 업데이트 활성화**
```typescript
✅ Real-time updates enabled (HTTP - Kanban + Workflow)
```

**위치:** Agent initialization

**리팩토링 제안:**
```typescript
// 제거 (사용자에게 의미 없음)
```

#### **10.3 작업 디렉토리**
```typescript
📂 Working directory: /Users/wag/dev/coin-watcher
```

**위치:** Agent initialization

**리팩토링 제안:**
```typescript
// 제거 또는
📂 coin-watcher  // 프로젝트명만
```

---

## 📊 로그 출력 통계

### **현재 상태**

| 카테고리 | 로그 수 | 평균 길이 | 총 라인 수 |
|---------|--------|-----------|-----------|
| NODE_TRANSITION | 11 | 1줄 | 11 |
| TASK_STATUS | 30 | 3줄 | 90 |
| LLM_INTERACTION | 3 | 100+줄 | 300+ |
| FILE_OPERATIONS | 20 | 2줄 | 40 |
| VALIDATION | 25 | 4줄 | 100 |
| COMMAND_EXECUTION | 15 | 3줄 | 45 |
| ERROR_HANDLING | 10 | 10줄 | 100 |
| BUILD_OUTPUT | 1 | 50줄 | 50 |
| PROGRESS_TRACKING | 20 | 2줄 | 40 |
| SYSTEM_INFO | 10 | 5줄 | 50 |
| **Total** | **145** | - | **826** |

### **필터링 후**

| 카테고리 | 필터링 전 | 필터링 후 | 감소율 |
|---------|----------|----------|-------|
| LLM_INTERACTION | 300 | 3 | 99% ↓ |
| PROGRESS_TRACKING | 40 | 0 | 100% ↓ |
| TASK_STATUS | 90 | 90 | 0% |
| NODE_TRANSITION | 11 | 11 | 0% |
| Others | 385 | 385 | 0% |
| **Total** | **826** | **489** | **41% ↓** |

---

## 🎯 리팩토링 우선순위

### **High Priority (즉시 적용)**

1. **TASK_STATUS 간결화** (90줄 → 30줄, -67%)
   ```typescript
   // 3줄 → 1줄
   📊 Progress: 0/5 (0%) | Setup: 1 | Feature: 4
   🚀 Starting: Task Name (feature)
   → 🚀 Task Name [0/5]
   ```

2. **VALIDATION 간결화** (100줄 → 30줄, -70%)
   ```typescript
   // 4줄 → 1줄
   🔨 Full validation (type/build/lint)
   ```

3. **FILE_OPERATIONS 간결화** (40줄 → 10줄, -75%)
   ```typescript
   // 8줄 → 1줄
   📊 1 file modified (1.9 KB)
   ```

4. **SYSTEM_INFO 정리** (50줄 → 5줄, -90%)
   ```typescript
   // 6줄 → 1줄
   🤖 claude-sonnet-4-5
   ```

**예상 효과:** 280줄 감소 → **총 209줄 (75% 감소)**

### **Medium Priority**

5. **ERROR_HANDLING 간결화** (100줄 → 40줄, -60%)
6. **COMMAND_EXECUTION 간결화** (45줄 → 30줄, -33%)

### **Low Priority**

7. NODE_TRANSITION: 이미 간결함 ✅
8. BUILD_OUTPUT: 디버깅에 필수 ✅

---

## 🔧 구현 가이드

### **1. 노드별 리팩토링**

각 노드의 `console.log` 위치:

```
packages/ant-cli/src/agents/architect/graph/code/nodes/
├── plan.ts          (44 logs) ← High Priority
├── execute.ts       (22 logs) ← Medium
├── runtimeValidate.ts (46 logs) ← High Priority
├── writeFiles.ts    (21 logs) ← High Priority
├── enforce.ts       (7 logs)  ← Medium
├── installDeps.ts   (22 logs) ← High Priority
├── validate.ts      (1 log)   ← Skip
├── learn.ts         (16 logs) ← Low
├── decompose.ts     (45 logs) ← Low
└── ...
```

### **2. 템플릿 정의**

```typescript
// packages/ant-cli/src/core/logging/templates.ts

export const LogTemplates = {
  // Task
  taskStart: (name: string, progress: string) => 
    `🚀 ${name} ${progress}`,
  
  taskComplete: (name: string, duration: number) => 
    `✅ ${name} (${duration}s)`,
  
  // Validation
  validationFull: () => 
    `🔨 Full validation (type/build/lint)`,
  
  validationSkip: (reason: string) => 
    `⏭️  Skipping validation (${reason})`,
  
  // Files
  fileSummary: (count: number, size: string) => 
    `📊 ${count} file${count > 1 ? 's' : ''} modified (${size})`,
  
  // Commands
  commandExec: (cmd: string) => 
    `💻 ${cmd}`,
  
  commandSuccess: () => 
    `✅ Success`,
  
  // Errors
  retry: (attempt: number, max: number, errors: number) => 
    `🔄 Retry ${attempt}/${max}: ${errors} error${errors > 1 ? 's' : ''}`,
};
```

---

## 📝 Next Steps

### **Phase 1: 즉시 적용 (High Priority)**

1. **TASK_STATUS 간결화**
   - 파일: `plan.ts`
   - 라인: 177-180, 224-226
   - 예상 감소: 90줄 → 30줄 (-67%)

2. **VALIDATION 간결화**
   - 파일: `runtimeValidate.ts`
   - 라인: 123-125, 188-191
   - 예상 감소: 100줄 → 30줄 (-70%)

3. **FILE_OPERATIONS 간결화**
   - 파일: `writeFiles.ts`
   - 라인: 70-154
   - 예상 감소: 40줄 → 10줄 (-75%)

4. **SYSTEM_INFO 정리**
   - 파일: 여러 초기화 로그
   - 예상 감소: 50줄 → 5줄 (-90%)

**예상 총 효과:** 280줄 감소 → **전체 약 209줄 (75% 감소)**

---

### **Phase 2: 중요도 중간 (Medium Priority)**

5. **ERROR_HANDLING 간결화**
   - 파일: `enforce.ts`
   - 예상 감소: 100줄 → 40줄 (-60%)

6. **COMMAND_EXECUTION 간결화**
   - 파일: `execute.ts`, `installDeps.ts`
   - 예상 감소: 45줄 → 30줄 (-33%)

---

### **Phase 3: 유지 (Low Priority)**

7. **NODE_TRANSITION**: 이미 간결함 ✅
8. **BUILD_OUTPUT**: 디버깅에 필수 ✅
9. **LLM_INTERACTION**: 이미 필터링됨 ✅

---

## 🔧 구현 가이드

### **리팩토링 체크리스트**

각 노드 파일을 수정할 때:

- [ ] 기존 로그의 목적 파악
- [ ] 사용자에게 중요한 정보만 남기기
- [ ] 다중 라인 로그를 단일 라인으로 축약
- [ ] 구분선(`===`, `───`) 제거
- [ ] 디버그 정보 제거
- [ ] 이모지 일관성 유지

---

### **템플릿 시스템 (향후 고려사항)**

```typescript
// packages/ant-cli/src/core/logging/templates.ts (새 파일)

export const LogTemplates = {
  // Task
  taskStart: (name: string, type: string, progress: string, queued: number) => 
    `🚀 ${name} (${type}) [${progress}${queued > 0 ? `, +${queued} queued` : ''}]`,
  
  taskComplete: (name: string, duration: number) => 
    `✅ ${name} (${duration}s)`,
  
  taskRetry: (name: string, attempt: number, max: number, errors: number) =>
    `🔄 Retry ${attempt}/${max}: ${name} (${errors} error${errors > 1 ? 's' : ''})`,
  
  // Validation
  validationFull: () => 
    `🔨 Full validation (type/build/lint)`,
  
  validationSkip: (reason: string) => 
    `⏭️  Skipping validation (${reason})`,
  
  // Files
  fileSummary: (modified: number, created: number, deleted: number, size: string) => {
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} created`);
    if (modified > 0) parts.push(`${modified} modified`);
    if (deleted > 0) parts.push(`${deleted} deleted`);
    return `📊 ${parts.join(', ')} (${size})`;
  },
  
  fileOperation: (action: 'CREATED' | 'MODIFIED' | 'DELETED', path: string) =>
    action === 'CREATED' ? `✨ ${path}` :
    action === 'MODIFIED' ? `📝 ${path}` :
    `🗑️  ${path}`,
  
  // Commands
  commandExec: (cmd: string) => 
    `💻 ${cmd}`,
  
  commandSuccess: () => 
    `✅ Success`,
  
  commandFailed: (error: string) =>
    `❌ Failed: ${error}`,
  
  // Errors
  errorDetected: (count: number, retryable: number) =>
    `⚠️  ${count} error${count > 1 ? 's' : ''} detected${retryable > 0 ? ` (${retryable} retryable)` : ''}`,
  
  // System
  llmInit: (model: string, provider?: string) =>
    `🤖 ${model}${provider ? ` (${provider})` : ''}`,
};
```

---

## 📚 참고

### **관련 파일**

#### **클라이언트 (ant-ui)**
- 필터링 로직: `packages/ant-ui/src/lib/logFilters.ts`
- Circular Buffer: `packages/ant-ui/src/lib/CircularLogBuffer.ts`
- 터미널 UI: `packages/ant-ui/src/components/TerminalBar.tsx`
- Zustand Store: `packages/ant-ui/src/lib/store.ts`

#### **서버 (ant-cli)**
- 로그 전송: `packages/ant-cli/src/periphery/adapters/http/ExpressServerAdapter.ts`
- 워크플로 상태: `packages/ant-cli/src/periphery/adapters/http/services/WorkflowStateService.ts`
- 주요 노드들:
  - `packages/ant-cli/src/agents/architect/graph/code/nodes/plan.ts`
  - `packages/ant-cli/src/agents/architect/graph/code/nodes/execute.ts`
  - `packages/ant-cli/src/agents/architect/graph/code/nodes/writeFiles.ts`
  - `packages/ant-cli/src/agents/architect/graph/code/nodes/runtimeValidate.ts`
  - `packages/ant-cli/src/agents/architect/graph/code/nodes/enforce.ts`

---

## 📊 요약

### **현재 상태**
- **총 로그 출력**: 826줄 (필터링 전)
- **필터링 후**: 489줄 (41% 감소)
- **주요 성과**: LLM 상호작용 로그 99% 감소 (300줄 → 3줄)

### **개선 목표**
- **Phase 1 적용 시**: 209줄 (75% 총 감소)
- **사용자 경험**: 간결하고 핵심적인 정보만 표시
- **성능**: CircularLogBuffer로 2000개 로그 효율 관리

### **핵심 원칙**
1. **사용자 중심**: 사용자에게 의미 있는 정보만
2. **간결성**: 다중 라인보다 단일 라인 선호
3. **일관성**: 통일된 이모지와 포맷
4. **추적성**: 워크플로 진행 상황은 명확히
5. **디버깅**: 에러 정보는 상세히 유지

---

**Last Updated:** 2025-01-08  
**Version:** 1.0  
**Author:** ANT Development Team

