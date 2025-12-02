# Code Job 프롬프트 리팩토링 제안

## 📊 현재 토큰 사용량

### Execute Phase (코드 실행)
- **system.md**: 846 토큰
- **execute/base.md**: 4,628 토큰  
- **execute/rules.md**: 3,305 토큰
- **tool-calling-rules.md**: 1,460 토큰
- **text-response-format.md**: 2,301 토큰
- **design-document-guide.md**: 1,784 토큰
- **환경별 rules**: 2,697~3,081 토큰
- **examples.md**: 1,594 토큰

**기본 합계**: ~16,831 토큰 (디자인 문서 제외)
**실제 사용**: ~20,000-35,000 토큰 (문서 포함)

---

## 🔍 발견된 문제점

### 1. 중복 (Duplication)

#### A) 출력 형식 규칙 중복
**위치 1**: `execute/rules.md` (Lines 1-407)
```markdown
## 🎯 XML TAG REFERENCE
### Tool Use: Creating New Files
<tool_use>
  <name>write_file</name>
  ...
</tool_use>

### Edit: Modifying Existing Files
<edit path="file/path">
<search>exact code</search>
<replace>new code</replace>
</edit>
```

**위치 2**: `execute/base.md`에도 일부 중복 언급
- setup task에서 "Use `write_file` tool"
- feature task에서 "Create/modify source code files using `write_file` or `apply_patch`"

**문제**: rules.md에 이미 자세히 설명되어 있는데, base.md에서 또 언급
**영향**: ~500 토큰 중복 (추정)

#### B) 검증 명령어 제약 중복
**위치 1**: `execute/base.md` - FEATURE TASK section
```markdown
🚨🚨🚨 **CRITICAL - READ THIS FIRST** 🚨🚨🚨

**YOU CANNOT:**
- ❌ Run `npm run build` (will fail)
- ❌ Run `npm run type-check` (will fail)
- ❌ Run `npm test` (will fail)

**DO NOT try to verify your code works. Just implement and finish.**
```

**위치 2**: `execute/base.md` - FINAL VERIFICATION TASK section  
```markdown
🚨🚨🚨 **CRITICAL - VALIDATION ORDER IS MANDATORY** 🚨🚨🚨

**Step 1: Type-check FIRST**
**Step 2: Lint SECOND**
**Step 3: Build LAST**
```

**위치 3**: `execute/base.md` - ERROR TASK section
```markdown
🚨 **CRITICAL - COMMAND RESTRICTIONS** 🚨

**❌ NEVER USE THESE COMMANDS (they never exit):**
- npm run dev ❌
- npm start ❌
```

**문제**: 같은 내용을 3번 반복 (feature, final, error)
**영향**: ~800 토큰 중복

#### C) Design Document 역할 설명 중복
**위치 1**: `execute/base.md` - Lines 6-38
```markdown
## 📋 DESIGN DOCUMENT (Architecture Reference)

**⚠️ CRITICAL: This design document is for REFERENCE ONLY!**

**YOU MUST:**
- ✅ Modify the EXISTING code
- ✅ Keep the same architecture/patterns
...
```

**위치 2**: `design-document-guide.md` - 전체 내용 (1,784 토큰)
```markdown
## 📐 DESIGN DOCUMENTS GUIDE

**You have access to design documents that guide your implementation:**

### 📋 API Contract (api-contract.md)
...
```

**문제**: base.md에서 간단히 설명하고, guide에서 자세히 설명하는데, 두 개가 충분히 분리되지 않음
**영향**: ~400 토큰 중복 가능성

#### D) Self-Verification Checklist 중복
**위치 1**: `system.md` - Lines 56-65
```markdown
RULE 5: Self-Verification (mental checks before output)
Before finalizing, mentally verify:
- ✅ Did I follow the directive exactly?
- ✅ Does this match the design document's architecture?
- ✅ Are ALL imports present?
...
```

**위치 2**: `execute/base.md` - CONSISTENCY CHECKS section
```markdown
## 🔍 CONSISTENCY CHECKS (Mental Verification)

Before outputting, mentally verify these consistency requirements:

### 1. package.json ↔ Config Files
### 2. Import Paths ↔ tsconfig.json
...
```

**위치 3**: `execute/rules.md` - Lines 208-227
```markdown
## 📋 SELF-VERIFICATION CHECKLIST

Before outputting, verify:

### Format ✓
- [ ] Used `<edit>` for modifying existing files
...

### Content ✓
...

### Language ✓
...
```

**문제**: Self-verification이 3곳에서 다르게 설명됨
**영향**: ~600 토큰 중복

---

### 2. 모순 (Contradictions)

#### A) 도구 호출 횟수 제약
**위치 1**: `tool-calling-rules.md` - 전체 문서
```markdown
🎯 **CRITICAL: EXACTLY ONE TOOL CALL PER TURN - NO EXCEPTIONS**

⛔ **THE SYSTEM WILL DROP ALL TOOL CALLS AFTER THE FIRST ONE**
```

**위치 2**: `execute/base.md` - FEATURE TASK section
```markdown
**Actions:**
1. Create/modify source code files using `write_file` or `apply_patch` tools
2. Output `<done>true</done>` immediately when done
```

**모순**: tool-calling-rules는 "한 번에 하나만!"을 강조하지만, base.md는 "files(복수) using tools"라고 하여 여러 파일을 만들 수 있다는 인상

**실제**: tool-calling-rules가 맞음 (시스템 제약)

**해결**: base.md에서 "Create files ONE AT A TIME" 명시 필요

#### B) Configuration 파일 수정 권한
**위치 1**: `execute/base.md` - SETUP TASK
```markdown
**What to create:**
- Configuration files: package.json, tsconfig.json, build tool configs
- ❌ Source code files (.ts, .tsx, .py, .go, etc.)
```

**위치 2**: `execute/base.md` - FEATURE TASK  
```markdown
**Feature Task Rules:**
- ✅ CREATE application code files
- ⚠️ Config files (package.json, tsconfig.json, etc.):
  - **Preferred:** Setup task handles config files
  - **BUT:** You CAN modify if absolutely necessary for this feature
```

**모순**: 명확하지 않음. Feature task가 config를 수정할 수 있는가?

**실제 의도**: Setup에서 생성, Feature에서 필요시 수정 가능

**문제**: "CAN modify if absolutely necessary"가 너무 애매함

---

### 3. 충돌 (Conflicts)

#### A) Examples 포함 여부
**위치 1**: `ModeController.ts` - Line 98
```typescript
includeExamples: phase === 'execute' && task === 'code'
```

**위치 2**: `execute/base.md` - 전체
- base.md는 이미 충분한 예제를 포함하고 있음 (setup, feature, error task examples)

**충돌**: examples.md (1,594 토큰)를 추가로 포함할 필요가 있는가?
- base.md: Task-specific 예제 (어떤 태스크인지에 따라)
- examples.md: 일반적인 예제 (모든 태스크에 공통)

**문제**: 이 두 개가 겹칠 수 있음

#### B) 텍스트 포맷팅 규칙
**위치 1**: `text-response-format.md` (2,301 토큰!)
- 287줄의 텍스트 포맷팅 규칙
- Markdown, inline code, parentheses 규칙 등

**위치 2**: `execute/base.md`, `rules.md`에서 이미 간단히 언급
```markdown
**NO summary, NO explanation** - system tracks everything automatically
```

**충돌**: Feature task는 "설명 없이 코드만"이라고 하는데, text-response-format은 "어떻게 설명할지"를 자세히 설명

**실제**: Feature task에서는 요약이 필요 없고, Decompose task나 다른 phase에서 필요

**문제**: text-response-format이 항상 포함되는가? 조건부인가?
- `ModeController.ts`를 보면 injection 로직에 text-response-format이 명시적으로 추가되지 않음
- 하지만 `decompose/rules.md`에서 include하고 있음:
  ```markdown
  {{> code/base/injections/text-response-format}}
  ```

---

### 4. 불필요 (Unnecessary)

#### A) text-response-format.md의 과도한 상세함 (2,301 토큰!)
- 287줄에 걸쳐 텍스트 포맷팅 규칙 설명
- 한국어 특화 규칙까지 포함
- Parentheses 규칙만 여러 번 반복

**문제**: 
1. Execute phase에서 feature task는 "설명 없이 코드만" 출력
2. 이렇게 자세한 포맷팅 규칙이 필요한가?
3. Decompose phase에만 필요한 것 아닌가?

**제안**: 
- Execute phase에서 제거 (조건부로 decompose에만 포함)
- 또는 핵심 규칙 100줄로 요약

**절약 가능**: ~1,700 토큰

#### B) tool-calling-rules.md의 과도한 반복 (1,460 토큰)
- 같은 내용을 여러 번 반복:
  - "ONE tool call per turn"을 10번 이상 언급
  - 예제를 3가지 방식으로 중복 설명
  - 150줄 중 반복이 70%

**문제**: 중요한 규칙이지만 너무 장황함

**제안**: 핵심 규칙 40줄로 요약
```markdown
⚠️ SYSTEM CONSTRAINT: EXACTLY ONE TOOL CALL PER TURN

Why: System drops all tool calls after the first one

Pattern:
Turn 1: [tool_call: write_file("file1.ts")]
Turn 2: [tool_call: write_file("file2.ts")]
...
```

**절약 가능**: ~1,000 토큰

#### C) design-document-guide.md 중복 예제 (1,784 토큰)
- API Contract, Frontend, Backend 섹션이 각각 비슷한 구조
- 예제가 너무 자세함 (TypeScript 코드 포함)

**제안**: 
1. 핵심 원칙만 명시 (각 문서의 목적)
2. 예제는 1-2개로 축소
3. 상세한 예제는 design job에서 이미 설명했으므로 중복

**절약 가능**: ~800 토큰

---

## 💡 리팩토링 제안

### 제안 1: 중복 제거 및 통합

#### 통합 1: Self-Verification을 한 곳으로
- `system.md`의 RULE 5를 확장
- `execute/base.md`와 `rules.md`의 checklist 제거
- 절약: ~400 토큰

#### 통합 2: Command Restrictions를 한 곳으로  
- `execute/base.md`의 task 섹션에서 반복 제거
- 한 곳에만 명시 (FEATURE TASK 섹션)
- 절약: ~600 토큰

#### 통합 3: XML Tag 규칙은 rules.md에만
- `execute/base.md`에서 tool 언급 제거
- rules.md에서 상세 설명 (이미 되어 있음)
- 절약: ~300 토큰

### 제안 2: 조건부 Injection 최적화

```typescript
// ModeController.ts - selectInjections()
if (phase === 'execute') {
  // text-response-format: ONLY for decompose and error explanation
  if (taskType === 'error' && requiresExplanation) {
    injections.push(`${commonPrefix}/text-response-format`);
  }
  
  // tool-calling-rules: 축약 버전 사용
  injections.push(`${taskPrefix}/tool-calling-rules-compact`);  // 400 토큰
  
  // design-document-guide: 첫 번째 execute turn에만
  if (!state.conversationHistory || state.conversationHistory.length === 0) {
    injections.push(`${taskPrefix}/design-document-guide`);
  }
}
```

절약: 
- text-response-format 제거: ~2,000 토큰 (대부분 케이스)
- tool-calling-rules 압축: ~1,000 토큰
- design-guide 조건부: ~1,500 토큰 (반복 turn)

### 제안 3: 핵심 규칙 Compaction

#### tool-calling-rules-compact.md (신규)
```markdown
⚠️ SYSTEM CONSTRAINT: ONE TOOL CALL PER TURN

The system drops all tool calls after the first one.

Pattern: Turn 1 → Tool 1 → Wait → Turn 2 → Tool 2 → ...

[40줄로 압축]
```

#### text-response-format-compact.md (신규)  
```markdown
Text Formatting:
- Use inline code: `variable`, `file.ts`
- Keep parentheses inline: (item1, item2)
- No excessive line breaks

[50줄로 압축]
```

### 제안 4: 문서 구조 재편성

**현재**:
```
execute/
├─ base.md (4,628 토큰) - 모든 task type 포함
├─ rules.md (3,305 토큰) - XML 규칙
└─ injections/
   ├─ tool-calling-rules.md (1,460 토큰)
   ├─ text-response-format.md (2,301 토큰)
   └─ design-document-guide.md (1,784 토큰)
```

**제안**:
```
execute/
├─ base.md (3,500 토큰) - 중복 제거
│  ├─ Task context
│  ├─ Design doc (간단히)
│  └─ Existing files
├─ rules/
│  ├─ output-format.md (800 토큰) - XML tags만
│  ├─ tool-calling.md (400 토큰) - 압축 버전
│  └─ self-check.md (300 토큰) - 통합 버전
└─ guides/ (조건부)
   ├─ design-documents.md (1,000 토큰) - 압축
   └─ text-formatting.md (500 토큰) - 필요시만
```

---

## 📊 예상 효과

### 현재 토큰 사용량
- 최소: ~16,831 토큰
- 일반: ~20,000-25,000 토큰
- 최대: ~35,000 토큰

### 리팩토링 후 예상
- 최소: ~12,000 토큰 (**-29%**)
- 일반: ~15,000-18,000 토큰 (**-28%**)
- 최대: ~28,000 토큰 (**-20%**)

### 절약 상세
1. text-response-format 조건부 제거: -1,800 토큰
2. tool-calling-rules 압축: -1,000 토큰  
3. 중복 제거 (checks, commands, etc): -1,500 토큰
4. design-guide 조건부: -500 토큰 (평균)

**총 절약**: ~4,800 토큰 (약 25-30%)

---

## 🎯 우선순위

### High Priority (즉시 적용 가능)
1. **중복 제거**: Self-verification, Command restrictions 통합
2. **tool-calling-rules 압축**: 40줄로 축소
3. **text-response-format 조건부 제거**: Decompose에만 포함

### Medium Priority (테스트 필요)
4. **design-document-guide 조건부**: 첫 turn에만
5. **examples.md 재검토**: base.md와 중복 여부

### Low Priority (구조 변경)
6. **문서 구조 재편성**: rules/ 하위 디렉토리
7. **언어별 분리**: 한국어 규칙 별도 파일

---

## 🔍 추가 조사 필요

1. **examples.md 사용 여부**
   - 실제로 포함되는가?
   - base.md의 예제와 얼마나 겹치는가?

2. **text-response-format 필요성**
   - Decompose phase에서만 필요한가?
   - Execute phase에서 정말 필요한가?

3. **환경별 rules 중복**
   - browser/node-api/fullstack rules가 얼마나 겹치는가?
   - 공통 부분을 base로 추출 가능한가?

---

## ✅ Action Items

1. [ ] 중복 self-verification 통합 (system.md로)
2. [ ] Command restrictions 한 곳으로 통합
3. [ ] tool-calling-rules-compact.md 생성 (40줄)
4. [ ] text-response-format을 decompose에만 조건부 적용
5. [ ] ModeController injection 로직 업데이트
6. [ ] 토큰 측정 로직으로 실제 효과 검증
7. [ ] LLM 출력 품질 테스트 (축소 후)

