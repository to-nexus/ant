# 📁 파일 처리 전략 (File Handling Strategy)

## 🤔 사용자 질문

> 새로 작업을 시작할 때 만들 파일을 결정짓는데:
> 1. 이전에 작업한 것 중 이미 만들어진 게 있다면 무시하는지 덮어쓰는지?
> 2. 최초 작업 시 현재 작업할 폴더에 파일이 있다면 "기존 파일이 있으니 넘어가자"는 판단이 있는가?

---

## ✅ 답변: LLM이 결정하며, 시스템은 정보만 제공합니다

### 핵심 원리

**시스템의 역할**: 기존 파일 정보를 수집하여 LLM에게 제공  
**LLM의 역할**: 제공된 정보를 바탕으로 파일을 생성/수정/보존 결정  
**파일 쓰기**: LLM이 출력한 파일은 항상 **덮어쓰기** (무조건 적용)

---

## 🔍 상세 흐름

### 1️⃣ **기존 파일 감지 단계** (`resolve` 노드)

```typescript
// src/agents/architect/graph/code/nodes/resolve.ts

const codeContext = await retriever.retrieve(
  directive || design,
  context.workingDir,
  { git, vectorDB },
  { maxTokens: 100000, maxFiles: 30 }
);

// state.code에 기존 코드베이스가 저장됨
// state.codeHead에 Git HEAD 버전 저장됨 (비교용)
```

**수집되는 정보:**
- 현재 작업 디렉토리의 모든 파일 (최대 30개)
- 각 파일의 전체 내용
- Git HEAD 버전 (수정 전/후 비교용)

---

### 2️⃣ **LLM에게 정보 제공** (`TemplateComposer`)

```typescript
// src/core/prompt/engine/TemplateComposer.ts

modificationMode: assembled.stats.hasOriginalFiles
  ? 'MODIFYING EXISTING FILES - READ CAREFULLY'
  : 'CREATION MODE: Build from scratch'
```

#### Case A: 기존 파일이 **있는** 경우

**Prompt에 주입:**
```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  MODIFYING EXISTING FILES - READ CAREFULLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ORIGINAL FILES (COMPLETE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{files}}  ← 전체 파일 내용이 여기에 들어감
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED PROCESS:
1. Copy the ENTIRE original file as your base
2. Add/modify ONLY what's needed for the task
3. Keep ALL existing code (imports, state, logic, JSX)
4. Output similar line count (200 lines → ~205 lines, NOT 20 lines)
```

**LLM의 선택지:**
- ✅ 기존 파일을 base로 하여 수정하고 출력 → **덮어쓰기**
- ✅ 기존 파일을 무시하고 새로 작성하여 출력 → **덮어쓰기**
- ✅ 특정 파일만 출력하고 나머지는 출력 안함 → **출력한 파일만 덮어쓰기, 나머지는 보존**

#### Case B: 기존 파일이 **없는** 경우

**Prompt에 주입:**
```markdown
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆕 NEW PROJECT INITIALIZATION - STEP 1: SETUP FILES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  CRITICAL: This is a NEW PROJECT with no existing code.

EXECUTION SEQUENCE:
Step 1: Generate Project Configuration Files (Do this FIRST)
   - package.json
   - tsconfig.json
   - vite.config.ts
   ...

Step 2: Generate Application Code
   - src/main.tsx
   - src/App.tsx
   ...
```

**LLM의 선택지:**
- ✅ 모든 파일을 처음부터 생성

---

### 3️⃣ **파일 쓰기 단계** (`postProcess` 노드)

```typescript
// src/agents/architect/graph/code/nodes/postProcess.ts

console.log(`📝 Writing ${state.files.length} files to disk...`);

for (const file of state.files) {
  await gitPort.writeFile(file.path, file.content);  // ✅ 항상 덮어쓰기
  console.log(`   ✓ ${file.path}`);
}
```

**중요:** 
- LLM이 출력한 파일은 **무조건 덮어쓰기**
- LLM이 출력하지 않은 파일은 **보존됨**

---

## 🎯 실제 시나리오별 동작

### 시나리오 1: 최초 프로젝트 생성

**상황:**
```bash
workspace/test-app/
  # 빈 디렉토리
```

**LLM이 받는 정보:**
```
CREATION MODE: Build from scratch
기존 파일: 없음
```

**LLM 판단:**
- 50개 파일 모두 생성

**결과:**
- 50개 파일 모두 **새로 생성됨**

---

### 시나리오 2: 기존 프로젝트 수정 (일부만 변경)

**상황:**
```bash
workspace/test-app/
  package.json      (200줄)
  src/App.tsx       (150줄)
  src/Header.tsx    (80줄)
  src/Footer.tsx    (60줄)
```

**LLM이 받는 정보:**
```
MODIFYING EXISTING FILES
ORIGINAL FILES:
  - package.json: [전체 내용 200줄]
  - src/App.tsx: [전체 내용 150줄]
  - src/Header.tsx: [전체 내용 80줄]
  - src/Footer.tsx: [전체 내용 60줄]
```

**Directive:** "Header 컴포넌트에 검색바 추가해"

**LLM 판단:**
- `src/Header.tsx`만 수정 필요
- 나머지 파일은 출력 안함

**LLM 출력:**
```
=== FILE: src/Header.tsx ===
[수정된 내용 85줄]
=== END FILE ===
```

**결과:**
- `src/Header.tsx`: **덮어쓰기** (85줄로 업데이트)
- `package.json`, `src/App.tsx`, `src/Footer.tsx`: **보존됨** (출력 안했으므로)

---

### 시나리오 3: 기존 프로젝트 수정 (전체 리팩토링)

**상황:**
```bash
workspace/test-app/
  src/App.tsx       (150줄)
  src/Header.tsx    (80줄)
  src/Footer.tsx    (60줄)
```

**Directive:** "전체 컴포넌트를 TypeScript strict mode로 리팩토링"

**LLM 판단:**
- 모든 파일 수정 필요
- 각 파일의 전체 내용을 base로 타입 추가

**LLM 출력:**
```
=== FILE: src/App.tsx ===
[타입 추가된 전체 내용 160줄]
=== END FILE ===

=== FILE: src/Header.tsx ===
[타입 추가된 전체 내용 85줄]
=== END FILE ===

=== FILE: src/Footer.tsx ===
[타입 추가된 전체 내용 65줄]
=== END FILE ===
```

**결과:**
- 3개 파일 모두 **덮어쓰기**

---

## 🤖 LLM의 판단 기준

LLM은 다음을 고려하여 판단:

### 1. **Directive 분석**
- "Header에 검색바 추가" → Header.tsx만 수정
- "전체 리팩토링" → 모든 파일 수정
- "새로운 Dashboard 추가" → Dashboard.tsx 생성 + 기존 라우팅 파일 수정

### 2. **파일 간 의존성**
- Header.tsx 수정 시 → App.tsx에서 import 추가 필요? → App.tsx도 출력
- 새 컴포넌트 생성 → index.ts에 export 추가 필요? → index.ts도 출력

### 3. **일관성 유지**
- package.json에 dependency 추가 시 → package.json 반드시 출력
- tsconfig.json 설정 변경 시 → tsconfig.json 반드시 출력

---

## ⚠️ 주의사항

### 문제 상황 1: LLM이 필요한 파일을 출력 안함

**증상:**
```
Directive: "Tailwind CSS 추가해"
LLM 출력: tailwind.config.js만 생성
결과: package.json에 tailwindcss 없음 → npm install 실패
```

**해결:**
- System prompt에 명시: "Config 파일 생성 시 package.json도 함께 업데이트"
- **현재 구현**: `CONSISTENCY CHECKS - CRITICAL` 섹션에서 이미 가이드하고 있음

### 문제 상황 2: LLM이 기존 파일을 축약하여 출력

**증상:**
```
원본 App.tsx: 150줄
LLM 출력:
  import ...
  // ... rest of the code ...  ← 축약!
  export default App;

결과: 150줄 → 10줄로 축약됨
```

**해결:**
- System prompt에 **FORBIDDEN** 규칙:
  ```
  ❌ "// ... rest of the code ..."
  ✅ Write EVERY line completely
  ```
- **현재 구현**: 이미 base.md에 명시되어 있음

---

## 📊 통계 추적

```typescript
// state.ts

previousFileCount?: number;  // 이전 파일 수
```

**용도:**
- 새 파일 생성 감지 (progress indicator)
- `previousFileCount`와 `files.length` 비교

**예시:**
```
이전: 10개 파일
현재: 12개 파일
→ 2개 파일 추가됨 (진전!)
```

---

## 🎯 결론

### 질문 1: 이전에 만든 파일 처리?
**답변:** 
- LLM이 다시 출력하면 → **덮어쓰기**
- LLM이 출력 안하면 → **보존**

### 질문 2: "기존 파일이 있으니 넘어가자" 판단?
**답변:**
- **시스템은 판단 안함**
- **LLM이 판단함**
  - 기존 파일 전체를 받아서
  - Directive 분석해서
  - 필요한 파일만 출력
  - 출력 안한 파일은 자동 보존

### 장점:
✅ 유연성: LLM이 상황에 맞게 판단  
✅ 안전성: 출력 안한 파일은 보존  
✅ 효율성: 불필요한 파일 재생성 안함  

### 단점:
⚠️ LLM 실수: 필요한 파일을 출력 안할 수 있음  
⚠️ 축약 문제: 기존 파일을 축약하여 출력할 수 있음  

### 현재 대응책:
✅ System prompt에 명확한 가이드라인  
✅ Validation에서 축약 감지 (ellipsis check)  
✅ Consistency checks로 dependency 누락 방지  

---

**요약**: **LLM이 모든 것을 결정하며, 시스템은 정보 제공자 역할만 합니다.**

