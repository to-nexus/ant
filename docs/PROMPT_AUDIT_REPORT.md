# Code Job 프롬프트 전체 감사 보고서

## 🔍 감사 범위

**노드별 프롬프트:**
1. `detectEnvironment` - Mode + Environment + RAG 추론
2. `decompose` - Task 분해
3. `plan` (generateTaskKeywords) - Task별 RAG 키워드 생성
4. `execute` (codeGen) - 코드 생성/수정

**Injection 파일:**
- `base/injections/` - 공통 주입
- `code/base/injections/` - Code job 전용
- `code/phases/execute/injections/` - Execute phase 전용

---

## 🚨 발견된 문제점

### 1. ❌ **중복 Injection 경로 혼동 (CRITICAL)**

**문제:**
```typescript
// ModeController.ts (line 123-124)
const commonPrefix = `base/injections`;  // ✅ templates/base/injections
const taskPrefix = `${task}/base/injections`;  // ✅ templates/{task}/base/injections
```

**실제 파일 위치:**
```
templates/
├── base/injections/          ← "commonPrefix" (모든 job 공통)
│   ├── directive.md
│   ├── design-doc.md
│   ├── memory.md
│   ├── retrieved-code.md     ← 🚨 CODE JOB 전용인데 base에 있음!
│   ├── reference-code.md     ← 🚨 CODE JOB 전용인데 base에 있음!
│   └── git-diff.md           ← 🚨 CODE JOB 전용인데 base에 있음!
│
└── code/base/injections/     ← "taskPrefix" (code job 전용)
    ├── design-document-guide.md
    ├── text-format-compact.md
    └── tool-calling-rules-compact.md
```

**혼동 사항:**
- `retrieved-code`, `reference-code`, `git-diff`는 **Code job 전용**인데 `base/injections/`에 위치
- Design job이나 Learn job에서는 사용 안 함
- 경로 이름과 실제 용도가 불일치

**권장 해결:**
```
templates/
├── base/injections/          ← 진짜 공통 (모든 job 사용)
│   ├── directive.md
│   ├── design-doc.md
│   └── memory.md
│
└── code/base/injections/     ← code job 전용
    ├── retrieved-code.md     ← 이동 필요
    ├── reference-code.md     ← 이동 필요
    ├── git-diff.md           ← 이동 필요
    ├── design-document-guide.md
    ├── text-format-compact.md
    └── tool-calling-rules-compact.md
```

---

### 2. ❌ **Missing Injection 파일 참조**

**문제:**
```typescript
// ModeController.ts (line 201-203)
if (task === 'code') {
  injections.push(`${commonPrefix}/output-format-markdown`);
  console.log(`[ModeController] Adding markdown streaming format injection`);
}
```

**파일 존재 여부:**
```bash
✅ templates/base/injections/output-format-markdown.md  # 존재함
```

하지만 이것도 **code job 전용**인데 `base/injections/`에 있음!

---

### 3. ⚠️ **Decompose 프롬프트의 모순**

**파일:** `code/phases/decompose/system.md`

**문제 1: Mode별 가이드 중복**
```markdown
## Mode: {{mode}}

{{#if (eq mode 'generate')}}
- Break into: Setup → Core Features → Polish
- Typical: 3-8 tasks
{{else if (eq mode 'refactor')}}
- Focus on minimal changes
- Typical: 1-3 tasks
{{/if}}
```

그런데 바로 이 정보가 `detectEnvironment.md`에도 있음!

**detectEnvironment.md:**
```markdown
### 1. Mode Inference
**generate**: Creating new features/files from scratch
- Keywords: "create", "add", "new", "implement"

**refactor**: Modifying/improving existing code
- Keywords: "fix", "update", "change", "improve"
```

**중복 제거 필요:** Decompose 프롬프트에서 mode 가이드 제거 (detectEnvironment에만 유지)

---

**문제 2: Explain Mode 처리 혼란**
```markdown
{{#if (eq mode 'explain')}}
## 💡 EXPLAIN TASK
- **Expected**: 1 task of type "explain".
{{/if}}
```

그런데 **실제 코드에서는 decompose를 스킵함!**
```typescript
// decompose/index.ts
if (state.mode === 'explain') {
  // LLM 호출 없이 즉시 리턴
  return { taskQueue: [explainTask] };
}
```

**모순:** Decompose 템플릿에 explain mode 가이드가 있지만, 실제로는 템플릿을 사용 안 함!

**권장:** Explain mode 가이드를 decompose 템플릿에서 제거

---

### 4. ⚠️ **Execute 프롬프트의 중복 및 복잡성**

**파일:** `code/phases/execute/base.md`

**문제 1: Design Document 중복 표시**
```markdown
{{#if designDoc}}
{{#if (eq modificationMode "MODIFICATION MODE: Copy original, then modify")}}
## 📋 DESIGN DOCUMENT (Architecture Reference)
...
{{else}}
## 📋 DESIGN DOCUMENT (Implementation Guide)
...
{{/if}}
{{/if}}
```

**그런데:**
- `modificationMode` 변수가 명확하지 않음
- `"Copy original, then modify"` 문자열이 하드코딩되어 있는데 실제로는 다른 값이 들어옴

**TemplateComposer.ts (line 71):**
```typescript
modificationMode: assembled.projectCodeContext?.files && assembled.projectCodeContext.files.length > 0
  ? 'MODIFICATION MODE: Modify existing code'
  : 'CREATION MODE: Build from scratch',
```

**모순:** 템플릿은 `"Copy original, then modify"`를 체크하는데, 실제로는 `"Modify existing code"`가 전달됨!

**결과:** `modificationMode === "Copy original, then modify"` 조건이 **절대 true가 안 됨!**

---

**문제 2: Task Type별 프롬프트 중복**
```markdown
{{#if (eq currentTask.type "setup")}}
## 🔧 SETUP TASK
...
{{else if (eq currentTask.type "feature")}}
## 🎯 FEATURE TASK
...
{{else if (eq currentTask.type "error")}}
## 🐛 ERROR FIX TASK
...
{{/if}}
```

각 섹션이 너무 길고 (50-100줄씩) 유사한 내용 반복:
- "What to create" vs "What to modify" vs "What to fix"
- 모두 동일한 tool 사용법 설명

**권장:** 공통 부분을 injection으로 분리

---

### 5. ⚠️ **Injection 조건 로직 오류**

**ModeController.ts (line 231-234):**
```typescript
if (!context.stats.hasProjectCode && task === 'code' && context.currentTask?.type === 'setup') {
  const languageConfigPath = `${task}/languages/${language}/setup/config`;
  injections.push(languageConfigPath);
}
```

**문제:**
- `language` 변수가 `undefined`일 수 있음 (line 184에서 detect하지만 보장 안 됨)
- 결과: `code/languages/undefined/setup/config` 경로 생성 가능
- 파일 없으면 조용히 실패 (에러 안남)

**권장:** `if (language)` 체크 추가

---

### 6. ⚠️ **Git Diff Injection 중복 가능성**

**문제:**
```typescript
// ModeController.ts (line 154-157)
if (context.projectCodeContext?.gitDiff) {
  injections.push(`${commonPrefix}/git-diff`);
}
```

그런데 **decompose 템플릿**에도 gitDiff가 직접 주입됨:
```markdown
{{#if gitDiff.hasChanges}}
## Recent Changes (Git Diff)
{{gitDiff.summary}}
{{/if}}
```

**결과:** Decompose phase에서는 템플릿 내 직접 주입, Execute phase에서는 injection 파일 사용

**권장:** 일관성 있게 injection 파일로 통일

---

### 7. ❌ **불필요한 프롬프트 내용 (토큰 낭비)**

**execute/base.md - Task Type 가이드 (150+ 줄)**
```markdown
## 🔧 SETUP TASK: Project Configuration

**What to create:**
- Configuration files: package.json, tsconfig.json, build tool configs
- NO source code yet (only in feature tasks)
- NO complex validation (keep it simple)

**Example Files:**
1. package.json - Define dependencies
2. tsconfig.json - TypeScript config
3. vite.config.ts - Build tool config

**Guidelines:**
1. Use latest stable versions
2. Keep dependencies minimal
3. Follow best practices
...
(50 more lines of examples)
```

**문제:**
- 너무 상세한 예시 (LLM은 이미 알고 있음)
- 매번 동일한 가이드 전송 (캐싱 불가)
- 토큰 낭비 (~500-1000 tokens)

**권장:** 핵심만 남기고 축약
```markdown
## 🔧 SETUP TASK
Create config files (package.json, tsconfig.json, etc.). NO source code yet.
```

---

### 8. ⚠️ **Reference Code Injection 조건 불명확**

**ModeController.ts (line 164-167):**
```typescript
if (context.referenceCodeContexts && context.referenceCodeContexts.length > 0) {
  injections.push(`${commonPrefix}/reference-code`);
}
```

**그런데 Plan 노드에서만 로드됨:**
```typescript
// plan/index.ts
const referenceCodeContexts = await loadReferenceContexts(...);
```

**결과:**
- Decompose phase: `referenceCodeContexts`가 항상 빈 배열
- Execute phase: Plan에서 로드한 것 사용

**혼동:** Decompose에서는 injection이 추가 안 되지만 로직이 명확하지 않음

**권장:** 주석으로 명시
```typescript
// Reference code (only available in Execute phase after Plan loads it)
if (context.referenceCodeContexts && context.referenceCodeContexts.length > 0) {
  injections.push(`${commonPrefix}/reference-code`);
}
```

---

## 📊 우선순위별 수정 필요 항목

### 🔴 Critical (즉시 수정 필요)

1. **Injection 파일 재배치** (`retrieved-code`, `reference-code`, `git-diff` → `code/base/injections/`)
2. **modificationMode 문자열 불일치 수정** (템플릿 vs 실제 값)
3. **language undefined 체크 추가**

### 🟡 High (다음 리팩토링 시 수정)

4. **Decompose 프롬프트에서 mode 가이드 중복 제거**
5. **Decompose 템플릿에서 explain mode 섹션 제거** (실제로 사용 안 됨)
6. **Execute base.md 토큰 낭비 축약** (~500 tokens 절약 가능)

### 🟢 Medium (점진적 개선)

7. **Git Diff 주입 방식 통일** (decompose도 injection 파일 사용)
8. **Task type별 프롬프트 공통 부분 injection 분리**
9. **주석으로 injection 조건 명확화**

---

## ✅ 잘 설계된 부분

1. **Layer 분리**: InputNormalizer → ContextAssembler → ModeController → TemplateComposer → PolicyInjector → PromptFormatter
2. **Injection 시스템**: 조건별 동적 조합 가능
3. **Mode별 분기**: `generate`, `refactor`, `explain` 명확히 구분
4. **Retrieved Code + Reference Code**: RAG 결과를 명확하게 프롬프트에 주입

---

## 🔧 제안하는 리팩토링 방향

### Phase 1: Critical Fixes (지금)
- Injection 파일 재배치
- modificationMode 문자열 수정
- language undefined 체크

### Phase 2: Prompt Optimization (다음)
- 중복 제거 (mode 가이드, task type 가이드)
- 토큰 낭비 축약 (500+ tokens 절약)
- Unused 섹션 제거 (explain mode in decompose)

### Phase 3: Architecture Improvement (미래)
- Prompt versioning 시스템
- A/B testing 프레임워크
- Token budget 자동 최적화

