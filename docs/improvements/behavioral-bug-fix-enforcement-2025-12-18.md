# Behavioral Bug Fix Enforcement 개선

> **날짜**: 2025-12-18  
> **문제**: 에이전트가 behavioral bug를 분석만 하고 실제 코드를 수정하지 않음  
> **해결**: `runtimeValidate.ts`에 zero-modification 검증 로직 추가

---

## 문제 분석

### 증상
- AI 탭 버그 수정 요청
- 에이전트가 32턴 동안 코드 읽기와 분석만 반복
- `filesWritten = 0`임에도 태스크를 완료로 표시
- 사용자가 "해결 못하고 있다"고 보고

### 근본 원인

**에이전트 행동 패턴**:
```
1. read_file (ClassificationService.ts 읽기)
2. search_code (코드 검색)
3. [LLM 응답]
   "근본 원인을 파악했습니다..."
   "ClassificationService의 fallback 로직이 문제입니다..."
   "이를 수정하면 됩니다..."
4. <done>true</done>  ← 실제 코드 수정 없이!
```

**에이전트의 착각**:
- "문제 이해 = 문제 해결"로 오인
- Behavioral bug는 **runtime 검증이 없어** violation이 발생하지 않음
- 시스템은 `<done>true</done>`를 받으면 성공으로 간주

### 기존 프롬프트 구조 분석

**잘못된 접근**:
1. ❌ `execute/base.md`에 behavioral bug 섹션 추가 시도
2. ❌ `behavioral-debugging.md`가 이미 존재함을 몰랐음
3. ❌ **Injection 메커니즘을 무시**하고 중복 내용 추가

**올바른 이해**:
```typescript
// ModeController.ts Line 164-168
if (this.isRefactorMode(mode, context)) {
  injections.push(`${taskPrefix}/behavioral-debugging.md`);
  console.log('[ModeController] Adding behavioral-debugging for refactor mode');
}
```

- `behavioral-debugging.md`는 **이미 존재**
- **Refactor 모드**에서만 injection됨
- 472줄의 comprehensive behavioral debugging 가이드

**진짜 문제**:
- Prompt는 충분히 good (behavioral-debugging.md 존재)
- **Validation이 부족**: Zero-modification 체크가 없음

---

## 해결 방법

### A. 시도했지만 잘못된 접근 (Reverted)

```markdown
execute/base.md에 "Behavioral Bug Fix MUST Modify Code" 섹션 추가
execute/rules.md에 "Task Completion Criteria" 섹션 추가
plan/base.md에 "Implementation Actions" 추가
```

**문제점**:
- 기존 설계 무시 (behavioral-debugging.md 중복)
- Injection 메커니즘 이해 부족
- Prompt만으로는 enforcement 불가

### B. 올바른 해결책 (Implemented)

**`runtimeValidate.ts`에 Zero-Modification 검증 추가**:

```typescript
// Behavioral Bug Fix Verification
if (currentTask && (currentTask.type === 'error' || currentTask.type === 'fix')) {
  const taskDesc = (currentTask.description || '').toLowerCase();
  const isBehavioralBug = 
    taskDesc.includes('not working') ||
    taskDesc.includes('not displayed') ||
    taskDesc.includes('doesn\'t work') ||
    taskDesc.includes('안 나오') ||
    // ... more patterns
    
  if (isBehavioralBug) {
    const filesWritten = state.filesWritten || 0;
    
    if (filesWritten === 0) {
      // ❌ VIOLATION: Zero file modifications
      return {
        ...state,
        violations: [{
          type: 'behavioral_bug_unfixed',
          message: 'Behavioral bug fix completed with ZERO file modifications...',
          severity: 'major',
          isRetryable: true
        }]
      };
    }
  }
}
```

**핵심**:
- **Runtime validation 단계**에서 강제
- Prompt 개선이 아닌 **System enforcement**
- Violation 생성 → `enforce.ts` → retry loop

---

## 왜 이 방법이 올바른가?

### 1. Architecture-aware

기존 프롬프트 구조 존중:
```
code/base/injections/behavioral-debugging.md (472 lines)
  ↓ (ModeController가 injection)
execute/base.md
  ↓ (LLM에게 전달)
Comprehensive behavioral debugging guidance
```

중복 추가 대신 **시스템 검증 추가**

### 2. Separation of Concerns

```
Prompt Layer:     무엇을 해야 하는가 (behavioral-debugging.md)
Validation Layer: 실제로 했는지 검증 (runtimeValidate.ts)
Enforcement Layer: 안 했으면 재시도 강제 (enforce.ts)
```

### 3. Fail-fast Principle

```
Before: 32 turns of read-only operations
After:  Turn 1 detects zero modification → violation → retry
```

---

## 예상 효과

### Before
```
Turn 1: read_file + search_code + "근본 원인 파악" + <done>  (filesWritten=0)
Task marked complete ✅  ← 잘못된 성공
```

### After
```
Turn 1: read_file + search_code + "근본 원인 파악" + <done>  (filesWritten=0)
RuntimeValidate: ❌ BEHAVIORAL_BUG_UNFIXED violation
Enforce: Retry with focused message
Turn 2: read_file + edit_file + <done>  (filesWritten=1)
RuntimeValidate: ✅ Passed
```

---

## 교훈

### ❌ 하지 말 것

1. **기존 설계 무시하고 prompt 추가**
   - behavioral-debugging.md 이미 존재
   - Injection 메커니즘 무시
   - 중복 내용 생성

2. **Prompt만으로 강제하려는 시도**
   - "MUST modify code" 같은 강압
   - LLM은 무시할 수 있음
   - 검증 없는 지시는 약함

3. **Architecture 이해 없이 수정**
   - ModeController의 역할 몰랐음
   - Injection vs Direct inclusion 차이 몰랐음

### ✅ 해야 할 것

1. **기존 설계 먼저 이해**
   ```bash
   find templates/ -name "*.md" | grep behavioral
   grep -r "behavioral" packages/ant-cli/src/core/prompt/
   ```

2. **Validation으로 Enforcement**
   - Prompt: 가이드라인
   - Validation: 강제
   - Separation of concerns

3. **Fail-fast with Clear Feedback**
   - Early detection
   - Actionable violation message
   - Automatic retry with focus

---

## 변경 파일

### Modified
- `packages/ant-cli/src/agents/architect/graph/code/nodes/runtimeValidate.ts`
  - Line 102-162: Behavioral bug fix verification logic 추가

### Not Modified (기존 설계 유지)
- `packages/ant-cli/src/core/prompt/templates/code/base/injections/behavioral-debugging.md`
  - 이미 존재하는 472줄의 comprehensive guide
  - Refactor 모드에서 ModeController가 injection

- `packages/ant-cli/src/core/prompt/engine/ModeController.ts`
  - Line 164-168: behavioral-debugging injection 로직
  - 변경 불필요

---

## 검증 계획

### Test Case 1: AI 탭 버그 재현
```
Directive: "AI 탭을 눌러도 AI 뉴스가 안 나온다. 수정해라."
Expected: 
  - Turn 1: Analysis only → BEHAVIORAL_BUG_UNFIXED violation
  - Turn 2: edit_file applied → Pass
```

### Test Case 2: 일반 컴파일 에러
```
Directive: "TypeScript 타입 에러 수정해라."
Expected:
  - No behavioral bug check (compile error)
  - Normal validation flow
```

### Test Case 3: Feature 추가
```
Task type: "feature"
Expected:
  - No behavioral bug check
  - Normal validation flow
```

---

## 결론

**문제**: Prompt는 충분했지만 Validation이 없었음

**해결**: System-level enforcement 추가
- Prompt layer는 유지 (behavioral-debugging.md)
- Validation layer에 zero-modification check 추가
- Architecture-aware 접근

**교훈**: 
> "기존 설계를 이해하고 리팩토링하라" - 사용자
>
> Prompt 개선보다 **System enforcement**가 더 효과적
