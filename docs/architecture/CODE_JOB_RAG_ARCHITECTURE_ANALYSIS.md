# Code Job RAG 아키텍처 분석 - 현재 구조와 모순점

## 🎯 핵심 질문 4가지

### Q1. Resolve에서 벡터 DB 검색하는 게 필요한가?
### Q2. Decompose는 태스크만 제공하니까 벡터 DB 파일이 불필요한가?
### Q3. 실제 파일 RAG는 각 태스크의 codeGen 때인가? Plan에서 키워드 요청?
### Q4. 수정/리팩토링 시 decompose부터 RAG 코드파일 제공이 필요한가?

---

## 📊 현재 워크플로우 완전 분석

```
START
  │
  ├─ resolve (ONCE)
  │   ├─ 🔍 Vector DB 검색 (directive → 15 files, ~75KB)
  │   ├─ 📊 Profile 분석 (language/framework)
  │   ├─ 💾 state.code = retrieved code
  │   ├─ 💾 state.files = [{path, content}]
  │   └─ 💾 state.lessons = lessons
  │
  ├─ detectEnvironment (ONCE)
  │   └─ 🤖 LLM: directive → environment (frontend/backend)
  │
  ├─ decompose (ONCE)
  │   ├─ 📥 INPUT: directive, design doc, profile
  │   ├─ ❌ state.code 사용 안 함!
  │   ├─ ❌ state.files 사용 안 함!
  │   └─ 📤 OUTPUT: TaskQueue (3-8 tasks)
  │
  ├─ plan (PER TASK)
  │   ├─ 🔄 Pop next task from queue
  │   ├─ 📂 Smart context loading (NEW!)
  │   │   ├─ analyzeContextNeeds(task) → keywords
  │   │   ├─ explore (file tree)
  │   │   ├─ grep (search patterns)
  │   │   └─ read (specific files)
  │   ├─ 🤖 LLM: task + context → execution plan
  │   └─ 💾 state.planText = plan
  │
  ├─ codeGen (PER TASK)
  │   ├─ 📥 INPUT:
  │   │   ├─ state.directive
  │   │   ├─ state.design (design doc)
  │   │   ├─ state.code (from resolve)  ← 🔴 문제!
  │   │   ├─ state.gitDiff
  │   │   ├─ state.lessons
  │   │   ├─ state.planText (from plan)
  │   │   └─ conversationHistory (tool results)
  │   ├─ 🤖 LLM: generate code
  │   ├─ 🔧 Tool calls:
  │   │   ├─ read_file(path)
  │   │   ├─ search_code(pattern)
  │   │   ├─ list_files(dir)
  │   │   └─ search_reference_code(project, query)
  │   └─ 📤 OUTPUT: files or tool calls
  │
  ├─ tool (IF tool calls)
  │   ├─ Execute tools
  │   └─ Add to conversationHistory
  │
  ├─ evaluate
  │   └─ Parse files or loop back
  │
  └─ enforce (IF errors)
      └─ Loop back to plan
```

---

## 🔴 모순점 분석

### 모순 #1: Resolve의 Vector DB 검색이 사용되지 않음

#### 현황:
```typescript
// resolve.ts (Line 282-296)
const codeContext = await retriever.retrieve(
  directive || design || "",  // 전체 directive로 검색
  context.workingDir,
  { git: state.deps?.git, vectorDB: state.deps?.memory },
  {
    maxTokens: 100000,  // ~75KB
    maxFiles: 15,
    mode: modeResult.mode
  }
);

// ✅ state.code = codeContext.code
// ✅ state.files = [{path, content}]
```

#### 문제:
- **Decompose**: `state.code` 전혀 안 씀!
  ```typescript
  // decompose/llmCaller.ts (Line 15-95)
  export function buildDecomposePrompt(context: DecomposePromptContext): string {
    // ❌ state.code 사용 안 함
    // ✅ directive + designDoc만 사용
  }
  ```

- **Plan**: `state.code` 무시하고 자체 검색!
  ```typescript
  // plan/index.ts (Line 558-578)
  const strategy = analyzeContextNeeds(
    nextTask,  // PRIMARY: 태스크 자체
    state.enforcementReason,
    state.design,
    state.files?.map(f => f.path)  // 파일 경로만 참고
  );
  
  // 🔥 자체적으로 grep/read 수행!
  const context = await loadContext(strategy, gitPort);
  ```

- **CodeGen**: `state.code`를 전달하지만 LLM이 선택적으로 사용
  ```typescript
  // codeGen.ts (Line 278-300)
  const promptResult = await promptEngine.buildExecutePrompt(
    'code',
    state.context,
    {
      currentCode: state.code,  // ← resolve에서 검색한 코드
      // ...
    }
  );
  
  // 🤔 문제: 이 코드가 현재 task에 relevant한가?
  ```

#### 결론:
**🔴 Resolve의 Vector DB 검색은 대부분 낭비됩니다!**

- Decompose: 사용 안 함
- Plan: 무시하고 자체 검색
- CodeGen: 전달하지만 task-specific하지 않음

---

### 모순 #2: Task-Specific Context의 부재

#### 현황:
```
Task 1: "Setup project structure"
  → state.code = 15 files (전체 directive 기반)
  → 불필요한 파일들 포함 (예: API 구현, 컴포넌트 등)

Task 2: "Implement user authentication"
  → state.code = 동일한 15 files
  → Task 1과 같은 파일! (Task 2에 특화 안 됨)

Task 3: "Add dashboard UI"
  → state.code = 여전히 동일한 15 files
  → Frontend-specific 파일이 부족할 수 있음
```

#### 문제:
- **모든 태스크가 같은 코드 컨텍스트를 받음**
- **태스크별 최적화가 없음**
- **Token 낭비 심각** (~75KB × 8 tasks = 600KB!)

---

### 모순 #3: Plan의 Smart Context Loading이 Vector DB를 안 씀

#### 현황:
```typescript
// plan/index.ts (Line 558-578)
const strategy = analyzeContextNeeds(nextTask, ...);

// 🔥 Git 기반 grep/read만 수행
const context = await loadContext(strategy, gitPort);

// ❌ Vector DB 검색 안 함!
// ❌ CodebaseRetriever 안 씀!
```

#### 문제:
- **Plan이 task-specific context를 로드하지만 Vector DB는 안 씀**
- **Keyword-based grep만 사용** (semantic search 없음)
- **신규 프로젝트에서 비효율적** (grep할 파일이 없음)

---

### 모순 #4: Generate vs Refactor 모드의 불일치

#### Generate 모드 (신규 프로젝트):
```
resolve:
  ├─ Vector DB: 비어있음 (신규 프로젝트)
  └─ Fallback: Keyword search (directive → grep)
      └─ 결과: 빈 파일 (당연함)

decompose:
  └─ Design doc만으로 task 분해 ✅

plan:
  └─ Smart context: 빈 codebase
      └─ Explore만 수행 (file tree)

codeGen:
  └─ state.code = 빈 문자열
      └─ Design doc + task → 생성 ✅
```

**결론**: ✅ **Generate 모드는 괜찮음**

---

#### Refactor 모드 (기존 프로젝트):
```
resolve:
  ├─ Vector DB 검색: "로그인 버튼 추가"
  └─ 결과: 15 files (일반적인 파일들)
      ├─ App.tsx
      ├─ routes.ts
      ├─ Button.tsx
      ├─ LoginForm.tsx  ← 🎯 필요한 파일!
      └─ ... (나머지 11개는 불필요할 수 있음)

decompose:
  └─ ❌ state.code 사용 안 함!
      └─ 🔴 문제: 기존 코드 구조를 모름!
      └─ Task 분해가 부정확할 수 있음
      
      예시:
      - "Add login button" → 어디에? 어떤 파일?
      - LoginForm.tsx가 있는지 모름
      - 새 파일 만들지, 기존 파일 수정할지 모호함

plan (Task 1: "Add login button to header"):
  ├─ Smart context: grep "login"
  └─ 결과: LoginForm.tsx, Header.tsx 발견 ✅

codeGen:
  ├─ state.code = 15 files (resolve에서)
  └─ plan context = Header.tsx + LoginForm.tsx
      └─ 중복 + 불필요한 파일들
```

**결론**: 🔴 **Refactor 모드에 문제가 많음!**

---

## 💡 4가지 질문에 대한 답변

### Q1. Resolve에서 벡터 DB 검색하는 게 필요한가?

**답변**: ❌ **현재 구조에서는 대부분 불필요!**

**이유**:
1. Decompose가 사용 안 함 (design doc만 씀)
2. Plan이 자체 context loading 수행
3. CodeGen에 전달되지만 task-specific하지 않음

**예외**:
- Profile 분석용 (language/framework 감지)
- 최초 탐색용 (codebase가 뭐가 있는지 대략 파악)

**개선 방안**:
```typescript
// Option A: Resolve에서 최소한만 검색 (profile 분석용)
maxFiles: 5,  // 15 → 5
maxTokens: 20000,  // 100K → 20K

// Option B: Resolve에서 Vector DB 검색 제거
// - Profile만 분석
// - 실제 검색은 plan/codeGen에서 수행
```

---

### Q2. Decompose는 태스크만 제공하니까 벡터 DB 파일이 불필요한가?

**답변**: ⚠️ **모드에 따라 다름!**

#### Generate 모드:
✅ **불필요함** - Design doc만으로 충분

#### Refactor 모드:
🔴 **필요할 수 있음!**

**이유**:
```
Directive: "로그인 폼에 비밀번호 표시 토글 추가"

Without RAG:
  Task 1: "Add password toggle component"
  Task 2: "Integrate toggle into login form"
  Task 3: "Add styling"
  
  🔴 문제: LoginForm.tsx가 어디 있는지, 구조가 어떤지 모름!

With RAG:
  [Vector DB 검색으로 LoginForm.tsx 발견]
  
  Task 1: "Modify src/components/LoginForm.tsx - Add toggle state"
  Task 2: "Update password input field with toggle button"
  
  ✅ 더 구체적이고 실행 가능한 태스크!
```

**개선 방안**:
```typescript
// decompose/llmCaller.ts
export function buildDecomposePrompt(context: DecomposePromptContext): string {
  // ...
  
  // 🔥 NEW: Include codebase context for refactor mode
  if (context.mode === 'refactor' && context.codeFiles) {
    sections.push(`\n## Existing Codebase\n\n${context.codeFiles}`);
  }
  
  // ...
}
```

---

### Q3. 실제 파일 RAG는 각 태스크의 codeGen 때인가? Plan에서 키워드 요청?

**답변**: 🎯 **양쪽 다 필요하지만 역할이 다름!**

#### Plan에서의 RAG (현재 구현됨):
```typescript
// plan/index.ts (Line 558-578)
const strategy = analyzeContextNeeds(nextTask, ...);
const context = await loadContext(strategy, gitPort);

// 역할: Execution plan 생성
// - 어떤 파일 수정할지
// - 어떤 순서로 작업할지
// - 어떤 dependency가 있는지
```

**목적**: 📋 **Plan 생성을 위한 context**

**방법**: Git-based grep/read (현재)
- ✅ 빠름
- ✅ 정확함 (파일명/패턴 기반)
- ❌ Semantic search 없음

---

#### CodeGen에서의 RAG (tool calling):
```typescript
// codeGen.ts
// LLM이 tool calling으로 검색:
// - read_file(path)
// - search_code(pattern)
// - search_reference_code(project, query)
```

**목적**: 🔧 **실제 코드 생성을 위한 detailed context**

**방법**: Tool calling (현재)
- ✅ LLM이 필요한 것만 요청
- ✅ Interactive (여러 번 요청 가능)
- ✅ Precise

---

#### 🔥 제안: Plan에서 LLM이 Vector DB 검색 키워드 제공

**현재**:
```typescript
// plan/index.ts
const strategy = analyzeContextNeeds(nextTask, ...);
// → Rule-based keyword extraction (기계적)
```

**개선안**:
```typescript
// plan/index.ts
const strategy = await llm.generateSearchStrategy(nextTask, mode);
// → LLM이 semantic keywords 생성

// 예시:
// Task: "Add password toggle to login form"
// LLM keywords:
// - "password input"
// - "login form"
// - "visibility toggle"
// - "input type=password"
// - "eye icon component"

// ✅ Vector DB 검색 with LLM keywords
const codeContext = await retriever.retrieve(
  strategy.keywords.join(' '),  // ← LLM-generated!
  workingDir,
  { vectorDB: deps.vectorDB },
  { maxFiles: 10, mode: 'refactor' }
);
```

**장점**:
- ✅ Task-specific semantic search
- ✅ 더 정확한 파일 검색
- ✅ Token 효율화

**단점**:
- ⚠️ LLM 호출 1회 추가 (~100 tokens, ~1초)

---

### Q4. 수정/리팩토링 시 decompose부터 RAG 코드파일 제공이 필요한가?

**답변**: ✅ **네, 매우 필요합니다!**

#### 현재 문제:
```
Refactor Directive: "로그인 폼에 비밀번호 표시 토글 추가"

decompose (현재):
  ├─ INPUT: directive + design doc
  ├─ ❌ 코드베이스 구조 모름
  └─ OUTPUT:
      Task 1: "Create password toggle component"
      Task 2: "Add toggle to login form"
      Task 3: "Style the toggle"
      
  🔴 문제: 어디에? 어떤 파일?
  🔴 문제: 이미 있는 컴포넌트는?
  🔴 문제: 새 파일? 기존 파일 수정?
```

#### 개선 후:
```
decompose (개선):
  ├─ INPUT:
  │   ├─ directive
  │   ├─ design doc
  │   └─ 🔥 RAG code context (Vector DB)
  │       ├─ src/components/LoginForm.tsx (existing)
  │       ├─ src/components/Input.tsx (existing)
  │       └─ src/hooks/useToggle.ts (existing)
  │
  └─ OUTPUT:
      Task 1: "Modify LoginForm.tsx - Add password visibility state"
      Task 2: "Update Input component in LoginForm - Add toggle button"
      Task 3: "Use existing useToggle hook for state management"
      
  ✅ 구체적인 파일명
  ✅ 기존 리소스 활용
  ✅ 정확한 수정 범위
```

---

## 🎯 최종 권장 사항

### 1. Resolve 노드 개선

#### Option A: 최소화 (추천)
```typescript
// resolve.ts
// 🎯 목적: Profile 분석만
const codeContext = await retriever.retrieve(
  directive,
  workingDir,
  { git: deps.git, vectorDB: deps.vectorDB },
  {
    maxFiles: 5,  // 15 → 5
    maxTokens: 20000,  // 100K → 20K
    mode: modeResult.mode
  }
);

// ✅ state.profile = analyze(codeContext.code)
// ❌ state.code = "" (don't pass to decompose)
```

#### Option B: Mode-aware
```typescript
if (mode === 'generate') {
  // 신규: Profile만
  maxFiles: 3;
  maxTokens: 10000;
} else if (mode === 'refactor') {
  // 수정: 좀 더 자세히
  maxFiles: 10;
  maxTokens: 50000;
}
```

---

### 2. Decompose 노드 개선

```typescript
// decompose/index.ts

// 🔥 Mode-specific RAG
let codeContext = '';

if (state.mode === 'refactor' || state.mode === 'explain') {
  // 기존 코드 검색 필요
  const retriever = state.deps?.retriever;
  const vectorDB = state.deps?.vectorDB;
  
  if (retriever && vectorDB) {
    const searchResult = await retriever.retrieve(
      state.directive,
      state.context.workingDir,
      { vectorDB },
      {
        maxFiles: 10,
        maxTokens: 30000,
        mode: state.mode,
        project: state.context.project
      }
    );
    
    codeContext = searchResult.code;
  }
}

// Prompt에 포함
const prompt = buildDecomposePrompt({
  directive: state.directive,
  designDoc,
  codeContext,  // 🔥 NEW
  hasCodeContext: Boolean(codeContext),
  mode: state.mode,
  profile: state.profile
});
```

---

### 3. Plan 노드 개선

```typescript
// plan/index.ts

// 🔥 Option 1: LLM이 검색 키워드 생성
const searchKeywords = await llm.generateSearchKeywords(nextTask, state.mode);

// 🔥 Option 2: Vector DB 검색
const codeContext = await retriever.retrieve(
  searchKeywords.join(' '),
  workingDir,
  { vectorDB: deps.vectorDB, git: deps.git },
  {
    maxFiles: 8,
    maxTokens: 30000,
    mode: state.mode
  }
);

// 기존 grep/read와 병합
const context = {
  ...await loadContext(strategy, gitPort),  // grep/read
  vectorSearchResults: codeContext.code     // vector DB
};
```

---

### 4. CodeGen 노드

**현재 구조 유지** - Tool calling이 잘 작동함
```typescript
// Tool calling:
// - read_file(path)
// - search_code(pattern)
// - search_reference_code(project, query)

// ✅ LLM이 필요한 것만 요청
// ✅ Interactive
// ✅ Precise
```

---

## 📊 개선 후 워크플로우

```
START
  │
  ├─ resolve (ONCE)
  │   ├─ 🔍 Minimal Vector DB search (profile only)
  │   │   └─ maxFiles: 5, maxTokens: 20K
  │   └─ 📊 Profile 분석
  │
  ├─ detectEnvironment (ONCE)
  │   └─ 🤖 LLM: directive → environment
  │
  ├─ decompose (ONCE)
  │   ├─ 🔥 IF refactor mode:
  │   │   └─ Vector DB search (directive → 10 files)
  │   ├─ 📥 INPUT: directive, design, codeContext
  │   └─ 📤 OUTPUT: Task-specific, precise tasks
  │
  ├─ plan (PER TASK)
  │   ├─ 🤖 LLM: Generate search keywords from task
  │   ├─ 🔍 Vector DB search (keywords → 8 files)
  │   ├─ 📂 Git-based grep/read (complementary)
  │   ├─ 🤖 LLM: task + context → execution plan
  │   └─ 💾 state.planText = plan
  │
  ├─ codeGen (PER TASK)
  │   ├─ 📥 INPUT: plan, design, gitDiff, lessons
  │   ├─ 🤖 LLM: generate code
  │   ├─ 🔧 Tool calling (as needed):
  │   │   ├─ read_file(path)
  │   │   ├─ search_code(pattern)
  │   │   └─ search_reference_code(project, query)
  │   └─ 📤 OUTPUT: files or tool calls
  │
  └─ ...
```

---

## 🎯 개선 효과 예상

### Token 절감:
```
현재:
- resolve: 75KB (모든 태스크 공통)
- decompose: 0KB
- plan × 5 tasks: 0KB (grep만)
- codeGen × 5 tasks: 75KB × 5 = 375KB
- Total: ~450KB

개선:
- resolve: 15KB (profile만)
- decompose: 30KB (refactor만)
- plan × 5 tasks: 24KB × 5 = 120KB (task-specific)
- codeGen × 5 tasks: tool calling (minimal)
- Total: ~165KB

절감: ~285KB (63% 절감!)
```

### 품질 개선:
- ✅ Decompose: 더 정확한 task 분해 (기존 코드 인지)
- ✅ Plan: Task-specific context (semantic search)
- ✅ CodeGen: Minimal context (tool calling으로 필요한 것만)

### 속도 개선:
- ✅ LLM 호출당 token 감소 → 응답 속도 향상
- ⚠️ LLM 호출 횟수 증가 (plan에서 keyword 생성)
- 💡 Net: 약간 느려질 수 있지만 품질 향상이 큼

---

## 🚨 핵심 고민 포인트

### 1. Resolve의 역할 재정의
- 현재: "모든 것을 위한 검색" (실패)
- 제안: "Profile 분석만" 또는 제거

### 2. Decompose에 RAG 추가
- Generate: 불필요
- Refactor: **필수**
- 조건부 구현 필요

### 3. Plan에서 LLM keyword generation
- 비용: +100 tokens/task
- 효과: Task-specific semantic search
- Trade-off: 속도 vs 품질

### 4. 중복 최소화
- resolve, decompose, plan 모두 검색
- 각각의 목적과 scope를 명확히

---

## ✅ 구현 우선순위

### Phase 1: Quick Wins (즉시)
1. **Resolve 최소화**: maxFiles 15→5, maxTokens 100K→20K
2. **Decompose에 state.code 추가** (refactor 모드만)

### Phase 2: 핵심 개선 (1-2주)
3. **Plan에서 LLM keyword generation**
4. **Plan에서 Vector DB search**

### Phase 3: 최적화 (나중)
5. **Token budget 전체 최적화**
6. **Caching 전략**

---

## 🎯 최종 답변

### Q1. Resolve에서 벡터 DB 검색 필요한가?
❌ **대부분 불필요** - Profile 분석용으로만 최소화 추천

### Q2. Decompose는 파일이 불필요한가?
⚠️ **모드에 따라 다름**:
- Generate: 불필요 ✅
- Refactor: **필요함** 🔴

### Q3. Plan에서 키워드 요청?
✅ **매우 좋은 아이디어!**
- LLM이 semantic keywords 생성
- Vector DB에 task-specific 검색
- Token 효율화 + 품질 향상

### Q4. Decompose에 RAG 필요?
✅ **Refactor 모드에서 필수!**
- 기존 코드 구조 파악
- 정확한 task 분해
- 파일명/경로 명시

---

**전체적으로 개념이 충돌하고 있는 이유**:
1. Resolve가 "모든 것을 위한 검색"을 하지만 실제론 거의 안 쓰임
2. 각 단계(decompose, plan, codeGen)가 독립적으로 context 필요
3. Task-specific context가 없어서 token 낭비
4. Generate vs Refactor 모드 차이를 고려 안 함

**해결 방법**: 각 단계의 목적을 명확히 하고 mode-aware RAG 구현!

