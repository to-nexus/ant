# 🐛 Setup Task에서 테스트 설정 파일 생성 버그 분석

## 📋 문제 상황

Setup task에서 의도하지 않은 파일들이 생성됨:
- `jest.config.js` (32 lines)
- `jest.setup.js` (2 lines with `import '@testing-library/jest-dom'`)
- `package.json`에 testing libraries 포함

## 🔍 근본 원인 추적

### 1단계: Decompose Phase (태스크 분해)

**로그 분석 결과:**
```json
{
  "type": "setup",
  "priority": 100,
  "description": "Generate package.json with ALL dependencies (..., testing libraries), ..."
}
```

**문제**: LLM이 setup task description에 **"testing libraries"**를 명시적으로 포함시킴

**왜 이렇게 판단했는가?**
- User spec이나 design document에서 "comprehensive" 또는 "complete" setup 요구
- LLM의 일반 지식: "프로덕션 프로젝트 = 테스트 필수"
- Decompose 프롬프트에 테스트 배제 명시 없음

### 2단계: Execute Phase (셋업 실행)

**기존 프롬프트 (Line 20-24):**
```markdown
**What NOT to create:**
- ❌ Source code files (.ts, .tsx, .py, .go, etc.)
- ❌ Test files  ← 모호함!
- ❌ Documentation beyond README.md
- ❌ Component/page/service files
```

**문제점:**
- "Test files" = `*.test.ts`, `*.spec.ts`로만 해석 가능
- **`jest.config.js`는 "config file"**로 분류될 수 있음
- 명시적으로 "test config 금지" 없음

**LLM의 추론:**
```
Task description: "testing libraries" 포함
→ package.json에 jest, @testing-library 추가 ✅
→ jest 설정이 필요함 (일반 지식)
→ jest.config.js는 "config file"이니 허용됨 ✅ (잘못된 해석!)
```

## 🎯 해결책

### ✅ 1. Decompose Phase 수정

**`code/phases/decompose/base.md` (Line 34-48):**

```markdown
**1. Setup Task (priority 100)** - OPTIONAL, create only if needed:
   - **CRITICAL - Testing:**
     - ❌ DO NOT mention "testing libraries" or "test setup" in setup task description
     - ❌ DO NOT request creation of jest.config.js, vitest.config.ts, or test setup files
     - Testing infrastructure is explicitly excluded from setup
     - If spec mentions testing: Acknowledge in analysis but don't include in setup task
```

**효과**: Setup task description 자체에 "testing libraries"가 포함되지 않음

### ✅ 2. Execute Phase 수정

**`code/phases/execute/base.md` (Line 10-25):**

```markdown
**What NOT to create:**
- ❌ Source code files (.ts, .tsx, .py, .go, etc.)
- ❌ Test files (*.test.*, *.spec.*)
- ❌ Test configuration (jest.config.js, vitest.config.ts, jest.setup.js)  ← 새로 추가!
- ❌ Test infrastructure files (setupTests.ts, test-utils.ts)              ← 새로 추가!
- ❌ Documentation beyond README.md
- ❌ Component/page/service files

**Important**: If task description mentions "testing libraries":
- ✅ Add them to package.json devDependencies
- ❌ DO NOT create jest.config.js, vitest.config.ts, or any test setup files
- Testing setup will be handled separately if needed
```

**효과**: 
1. 테스트 관련 config 파일을 명시적으로 금지
2. "testing libraries" 언급 시 대응 방법 명확화
3. Mental checks에 테스트 config 금지 추가

## 📊 Before vs After

### Before (잘못된 동작)

**Decompose:**
```
Setup Task Description: 
"Generate package.json with ALL dependencies (Next.js, React, testing libraries), 
tsconfig.json, next.config.js, tailwind.config.ts..."
```

**Execute:**
```
프롬프트: "Test files ❌" (모호함)
→ LLM 해석: jest.config.js는 config file이니 OK
→ 결과: jest.config.js, jest.setup.js 생성 ❌
```

### After (올바른 동작)

**Decompose:**
```
프롬프트: "테스트 관련 내용을 setup task에 포함하지 마라"
→ Setup Task Description: 
"Generate package.json with dependencies (Next.js, React), 
tsconfig.json, next.config.js, tailwind.config.ts..."
(testing libraries 언급 없음)
```

**Execute:**
```
프롬프트: 
"Test configuration (jest.config.js, vitest.config.ts) ❌"
"If description has 'testing libraries': Add to package.json only, no config files"

→ LLM 해석: Testing libraries가 description에 없으니 무시
→ 또는: 있더라도 config 파일은 만들지 않음
→ 결과: jest.config.js 생성 안 함 ✅
```

## 💡 교훈

### 1. "Test files" vs "Test config files"
- **모호한 표현**: "Test files" → *.test.ts만 해석 가능
- **명확한 표현**: "Test configuration (jest.config.js, ...)" → 오해 불가능

### 2. 양방향 방어 (Defense in Depth)
- **Decompose**: 잘못된 요구사항 생성 방지
- **Execute**: 잘못된 요구사항이 와도 방어

### 3. 명시적 예시의 중요성
- "config files" → 너무 넓음
- "jest.config.js, vitest.config.ts" → 명확함

### 4. LLM의 일반 지식 vs 프롬프트
- LLM 일반 지식: "프로젝트 = 테스트 포함"
- 프롬프트: "이 시스템에서는 setup에 테스트 배제"
- **명시적 금지 없으면 일반 지식 우선**

## 🔧 적용된 수정 사항

1. ✅ `code/phases/decompose/base.md` - Line 34-48 수정
2. ✅ `code/phases/execute/base.md` - Line 10-38 수정

## 🧪 테스트 시나리오

### 시나리오 1: Spec에 "testing" 언급 없음
- ✅ Setup task description: 테스트 언급 없음
- ✅ 결과: jest.config.js 생성 안 됨

### 시나리오 2: Spec에 "comprehensive testing" 언급
- ✅ Decompose: Setup task에 테스트 포함 안 함 (프롬프트가 차단)
- ✅ 결과: jest.config.js 생성 안 됨

### 시나리오 3: 기존 regression (사용자가 강제로 "testing libraries" 요구)
- ✅ Decompose: 프롬프트 경고에도 불구하고 description에 포함
- ✅ Execute: "If description has testing libraries: package.json only" 규칙 적용
- ✅ 결과: package.json에만 추가, jest.config.js는 생성 안 됨

---

**수정 완료 시각**: 2025-11-23
**영향 범위**: Setup task 실행 로직
**회귀 위험**: Low (명시적 금지 추가만, 기존 동작 변경 없음)

