# Violations 처리 흐름 상세 분석

## 🔍 Violations 처리 담당자

### 답변: **3단계 협업**

1. **enforce 노드**: Violations 포맷팅 및 전달
2. **plan/base.md (RETRY 섹션)**: 수정 계획 수립 가이드
3. **execute/base.md (ERROR TASK 섹션)**: 실제 수정 수행 가이드

---

## 상세 흐름

### 1️⃣ Violations 발생

```
Final Task 완료
  ↓
installDeps → runtimeValidate (자동 노드)
  ↓
violations = [
  {
    type: 'type_error',
    severity: 'major',
    file: 'src/App.tsx',
    message: 'TS2304: Cannot find name React',
    suggestedFix: 'Import React from react',
    isRetryable: true
  }
]
```

---

### 2️⃣ enforce 노드 (Formatting)

**파일**: `packages/ant-cli/src/agents/architect/graph/code/nodes/enforce.ts`

**역할**:
- Violations 우선순위 분석
- 포맷팅 (사람이 읽기 좋게)
- 반복 에러 감지
- State에 전달

**코드** (line 200-233):
```typescript
// 반복 에러 감지
if (areErrorsRepeating(currentViolations, previousViolations)) {
  formattedViolations = `
⚠️⚠️⚠️ CRITICAL: REPEATED ERRORS DETECTED ⚠️⚠️⚠️

You have seen these EXACT SAME ERRORS before.
Your previous fix DID NOT WORK.

🔴 YOU MUST:
1. STOP and READ the error messages MORE CAREFULLY
2. THINK DIFFERENTLY - your previous approach failed
3. CHECK YOUR ASSUMPTIONS
4. BE MORE PRECISE - follow the error message LITERALLY

${formattedViolations}
`;
}

console.log(`\n📋 Violation Summary:\n${formattedViolations}\n`);
```

**출력**:
```typescript
state.violationsText = `
📋 VIOLATIONS (2 total)

🔴 CRITICAL (Priority 1000)
─────────────────────────────────────────
Type: type_error
File: src/App.tsx
Message: TS2304: Cannot find name 'React'.

Suggested Fix: Import React from 'react'

🟡 MAJOR (Priority 500)
─────────────────────────────────────────
Type: import_error
File: src/utils.ts
Message: Module 'lodash' not found

Suggested Fix: Install lodash package
`
```

---

### 3️⃣ plan/base.md (RETRY 섹션)

**파일**: `packages/ant-cli/src/core/prompt/templates/code/phases/plan/base.md`

**조건**: `{{#if isRetry}}` (violations 발생 시 true)

**내용** (line 96-114):
```markdown
### ⚠️  RETRY CONTEXT: PREVIOUS ATTEMPT FAILED

**The following violations occurred in the previous attempt:**

```
{{violationsText}}
```

**Your plan MUST address these failures:**
- ✅ Analyze root cause of each violation
- ✅ Understand WHY the previous approach failed
- ✅ Propose fundamentally different approach
- ✅ Consider trade-offs: simpler vs complete, safe vs efficient
- ❌ DO NOT blindly retry the exact same operations
- ❌ DO NOT just apply generic fixes without understanding
```

**역할**:
- Violations를 LLM에게 제시
- 수정 계획 수립 요구
- 분석 방법 가이드

**LLM 출력 (Plan)**:
```markdown
## Fix Plan

**Violations Analysis:**
1. Type error in App.tsx: Missing React import
   - Root cause: Forgot to import React
   - Fix: Add `import React from 'react'`

2. Import error in utils.ts: lodash not found
   - Root cause: Package not in package.json
   - Fix: Add lodash to dependencies

**Approach:**
1. Add React import to src/App.tsx
2. Add lodash to package.json dependencies
3. Verify with type check
```

---

### 4️⃣ execute/base.md (ERROR TASK 섹션)

**파일**: `packages/ant-cli/src/core/prompt/templates/code/phases/execute/base.md`

**조건**: `{{#if (eq currentTask.type "error")}}` (Error task일 때)

**내용** (line 234-291):
```markdown
## 🔧 ERROR TASK: Fix Specific Issues

### Error Classification Principle

**Category 1: Structural Errors**
- Detectable through static analysis
- Fix approach: Code structure correction
- Verification: Re-run static analysis

**Category 2: Behavioral Errors**
- Detectable only through runtime observation
- Fix approach: Mechanism correction
- Verification: Runtime observation mandatory

### Diagnostic Strategy by Category

**For Structural Errors:**
1. Error message identifies exact issue
2. Locate problematic code structure
3. Apply minimal structural correction
4. Re-verify with static analysis

**For Behavioral Errors:**
1. Classify behavioral symptom
2. Form hypothesis about causal mechanism
3. Instrument system to gather runtime evidence
4. Execute system and observe behavior
5. Analyze evidence against hypothesis
6. Apply fix to mechanism
7. Verify through runtime observation
```

**역할**:
- Structural vs Behavioral 분류 가이드
- 각 카테고리별 수정 전략 제시
- behavioral-debugging.md 조건부 주입

**LLM 출력 (Execute)**:
```markdown
Applying fixes based on plan:

1. src/App.tsx - Add React import
   <file path="src/App.tsx">
   import React from 'react';
   // ... rest of file
   </file>

2. package.json - Add lodash
   <file path="package.json">
   {
     "dependencies": {
       "react": "^18.0.0",
       "lodash": "^4.17.21"
     }
   }
   </file>

<done>true</done>
```

---

## 전체 흐름 다이어그램

```
┌─────────────────────────────────────────┐
│ 1. Final Task 완료                      │
│    LLM: <done>true</done>              │
└─────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────┐
│ 2. 자동 검증 (runtimeValidate)          │
│    violations 발견                      │
└─────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────┐
│ 3. checkTaskStatus                      │
│    if (violations) → enforce            │
└─────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────┐
│ 4. enforce 노드                         │
├─────────────────────────────────────────┤
│ - Violations 우선순위 분석              │
│ - 포맷팅 (violationsText 생성)         │
│ - 반복 에러 감지                        │
│ - State에 전달                         │
│                                        │
│ Output:                                │
│   state.violationsText = "..."        │
│   state.isRetry = true                │
└─────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────┐
│ 5. plan 노드 (RETRY 모드)              │
├─────────────────────────────────────────┤
│ Prompt:                                │
│   {{#if isRetry}}                      │
│     RETRY CONTEXT 섹션 활성화          │
│     {{violationsText}} 표시            │
│   {{/if}}                              │
│                                        │
│ LLM:                                   │
│   - Violations 분석                    │
│   - Root cause 파악                    │
│   - Fix plan 수립                      │
└─────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────┐
│ 6. execute 노드 (ERROR TASK)           │
├─────────────────────────────────────────┤
│ Prompt:                                │
│   {{#if (eq currentTask.type "error")}}│
│     ERROR TASK 섹션 활성화             │
│     Structural/Behavioral 가이드       │
│   {{/if}}                              │
│                                        │
│ LLM:                                   │
│   - Plan에 따라 수정 적용              │
│   - 파일 수정                          │
│   - <done>true</done>                 │
└─────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────┐
│ 7. 자동 검증 (재시도)                   │
│    violations 재확인                    │
└─────────────────────────────────────────┘
          ↓
    violations 있으면 3번으로 돌아감
    violations 없으면 완료
```

---

## 각 단계별 담당 역할

| 단계 | 담당자 | 역할 | 출력 |
|------|--------|------|------|
| **1. 검증** | runtimeValidate 노드 | violations 발견 | `violations[]` |
| **2. 포맷팅** | enforce 노드 | violations 정리/우선순위 | `violationsText` |
| **3. 계획** | plan/base.md (RETRY) | 수정 계획 수립 가이드 | LLM plan |
| **4. 수정** | execute/base.md (ERROR) | 실제 수정 수행 가이드 | LLM fixes |
| **5. 재검증** | runtimeValidate 노드 | 수정 확인 | pass/fail |

---

## 핵심 답변

### Q: Violations가 보고될 경우 처리하는 내용은 어디서 담당하나?

### A: **3곳에서 협업**

#### 1. enforce 노드 (코드)
- **위치**: `src/agents/architect/graph/code/nodes/enforce.ts`
- **역할**: Violations 포맷팅, 우선순위 분석
- **출력**: `state.violationsText`, `state.isRetry = true`

#### 2. plan/base.md (프롬프트)
- **위치**: `src/core/prompt/templates/code/phases/plan/base.md` (line 96-114)
- **조건**: `{{#if isRetry}}`
- **역할**: LLM에게 violations 제시, 수정 계획 수립 요구
- **출력**: LLM의 fix plan

#### 3. execute/base.md (프롬프트)
- **위치**: `src/core/prompt/templates/code/phases/execute/base.md` (line 234-291)
- **조건**: `{{#if (eq currentTask.type "error")}}`
- **역할**: LLM에게 수정 전략 가이드 (Structural vs Behavioral)
- **출력**: LLM의 실제 수정

---

## 데이터 흐름

```typescript
// 1. runtimeValidate 노드
violations = [
  { type: 'type_error', file: 'src/App.tsx', ... }
]

// 2. enforce 노드
state.violationsText = `
📋 VIOLATIONS (1 total)
🔴 CRITICAL: Type error in src/App.tsx
...
`
state.isRetry = true

// 3. plan phase (프롬프트)
{{#if isRetry}}  // true
  {{violationsText}}  // 위의 텍스트 표시
{{/if}}

→ LLM: "Add React import to App.tsx"

// 4. execute phase (프롬프트)
{{#if (eq currentTask.type "error")}}  // true
  ERROR TASK 섹션 활성화
{{/if}}

→ LLM: <file path="App.tsx">import React...</file>

// 5. 재검증
violations = []  // 성공!
```

---

## 결론

Violations 처리는 **3단계 협업**:

1. **enforce 노드**: 데이터 정리
2. **plan 프롬프트**: 계획 수립
3. **execute 프롬프트**: 수정 수행

모두 자동으로 연결되어 LLM이 violations를 보고 → 분석하고 → 수정합니다.
