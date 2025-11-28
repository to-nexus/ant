# 코드베이스 저장 → LLM 컨텍스트 흐름 (실제 구현)

> **용어 참고**: 프롬프트, 메시지, 토큰의 차이는 `LLM_API_REQUEST_STRUCTURE.md` 참조

## 🎯 전체 흐름 한눈에

```
┌─────────────────────────────────────────────────────────────────┐
│                     1️⃣ 인덱싱 (Learn Job)                        │
└─────────────────────────────────────────────────────────────────┘
    코드베이스 (76개 파일)
         ↓
    CodebaseIndexer
         ↓ [배치 처리: 10개씩]
    각 파일 → ChunkEngine → 청크 생성 (15줄씩)
         ↓
    ChromaMemoryAdapter → Embedding 생성 → Vector DB 저장
         ↓
    📦 Vector DB에 저장 완료
    
┌─────────────────────────────────────────────────────────────────┐
│                     2️⃣ 검색 (Code Job)                          │
└─────────────────────────────────────────────────────────────────┘
    사용자 요청: "Add logout button"
         ↓
    resolve 노드 → CodebaseRetriever.retrieve()
         ↓
    UnifiedSearchStrategy.search()
         ↓ [시맨틱 검색]
    Vector DB 쿼리 → 관련 청크 15개 + 레슨 5개
         ↓
    FileLoader.load() → 전체 파일 내용 로드
         ↓
    📄 CodeContext 생성 (code, lessons)

┌─────────────────────────────────────────────────────────────────┐
│                     3️⃣ LLM 호출 (Code Job)                      │
└─────────────────────────────────────────────────────────────────┘
    codeGen 노드 → PromptEngine.buildExecutePrompt()
         ↓
    프롬프트 조립:
      - 시스템 프롬프트 (역할, 규칙)
      - 디렉티브 (사용자 요청)
      - 디자인 문서
      - 코드베이스 (검색된 파일들)  ← 여기!
      - 레슨 (이전 학습)           ← 여기!
      - 현재 태스크
         ↓
    LLM.call(messages) → Claude API
         ↓
    🤖 새로운 코드 생성
```

---

## 📋 1단계: 인덱싱 (Learn Job)

### 진입점: `learn/nodes/resolve.ts`

```typescript
// agents/architect/graph/learn/nodes/resolve.ts

async function executeIndexing(state, command) {
  const indexer = new CodebaseIndexer();
  
  // Git 정보
  const repoName = await git.getRepoName();
  const branch = await git.getCurrentBranch();
  const commit = await git.getCurrentCommit();
  
  // 인덱싱 실행
  const stats = await indexer.index(
    { git, vectorDB, chunk },
    {
      project: state.context.project,  // 'ant-tetris'
      workingDir: state.context.workingDir,
      incremental: true  // 변경된 파일만
    }
  );
  
  // 결과: 76 files → 1,234 chunks
}
```

### Vector DB 저장 구조

```typescript
// ChromaDB Collection: 'ant-tetris'
{
  id: 'ant-tetris-1234567890-xyz-0',
  embedding: [0.15, 0.22, ..., 0.79],  // 768차원
  document: "function login(username, password) {...}",
  metadata: {
    type: 'codebase',
    filePath: 'src/auth/login.ts',
    project: 'ant-tetris',
    branch: 'main',
    commitHash: 'abc123',
    language: 'typescript',
    chunkIndex: 0,
    startLine: 0,
    endLine: 15
  }
}
```

---

## 🔍 2단계: 검색 (Code Job)

### 진입점: `code/nodes/resolve.ts`

```typescript
// agents/architect/graph/code/nodes/resolve.ts

export async function resolve(state: ArchitectGraphState) {
  const directive = "Add logout button";  // 사용자 요청
  const retriever = new CodebaseRetriever();
  
  // 🔥 핵심: 관련 코드 검색
  const codeContext = await retriever.retrieve(
    directive,              // "Add logout button"
    context.workingDir,     // 작업 디렉토리
    {
      git: state.deps?.git,
      vectorDB: state.deps?.memory  // Vector DB
    },
    {
      project: 'ant-tetris',  // Vector DB namespace
      maxTokens: 100000,      // ~75KB
      maxFiles: 15,           // 최대 15개 파일
      mode: 'generate'        // 모드에 따라 검색 전략 다름
    }
  );
  
  // 결과
  // codeContext.code: 검색된 파일들의 전체 내용
  // codeContext.lessons: 관련 레슨 (이전 학습)
  // codeContext.strategy: 'unified' (어떤 전략 사용했는지)
  
  return {
    ...state,
    code: codeContext.code,       // LLM에 전달할 코드
    lessons: codeContext.lessons  // LLM에 전달할 레슨
  };
}
```

### 내부: `CodebaseRetriever.retrieve()`

```typescript
// core/codebase/CodebaseRetriever.ts

async retrieve(directive, workingDir, deps, options) {
  // 모드별 설정 (generate/refactor/explain)
  let maxCodeFiles = 15;   // 코드 파일 개수
  let maxLessons = 5;      // 레슨 개수
  let minCodeScore = 0.6;  // 최소 유사도
  let minLessonScore = 0.5;
  
  if (mode === 'generate') {
    maxLessons = 8;        // 패턴 중심
    maxCodeFiles = 12;     // 타입 정의만
  } else if (mode === 'refactor') {
    maxCodeFiles = 20;     // 의존성 중심
    maxLessons = 3;
  }
  
  // STEP 1: Unified Search (코드 + 레슨 동시 검색)
  const unifiedResult = await this.unifiedStrategy.search(
    directive,  // "Add logout button"
    project,    // 'ant-tetris'
    { vectorDB: deps.vectorDB, git: deps.git },
    {
      maxCodeFiles,
      maxLessons,
      minCodeScore,
      minLessonScore,
      includeGitChanges: true  // Git 변경사항 우선
    }
  );
  
  // 결과:
  // - codeFiles: [{ path: 'src/auth/login.ts', score: 0.92 }, ...]
  // - lessons: [{ content: 'React 컴포넌트 패턴', score: 0.85 }, ...]
  
  // STEP 2: 전체 파일 내용 로드
  const result = await this.fileLoader.load(
    codeFiles,       // 검색된 파일 목록
    workingDir,
    deps.git,
    maxTokens        // 100K 토큰
  );
  
  return {
    code: result.code,        // 전체 파일 내용
    lessons: lessons,         // 레슨
    strategy: 'unified',
    stats: result.stats
  };
}
```

### 내부: `UnifiedSearchStrategy.search()`

```typescript
// core/codebase/strategies/UnifiedSearchStrategy.ts

async search(directive, project, deps, options) {
  // 🔥 핵심: Vector DB 단일 쿼리
  const allResults = await deps.vectorDB.query(
    directive,  // "Add logout button"
    project,    // 'ant-tetris'
    {
      k: 15 + 5 + 30,  // 코드 15 + 레슨 5 + 여유 30
      minScore: 0.5    // 최소 유사도
      // ✅ NO where filter! 코드 + 레슨 모두 검색
    }
  );
  
  // 타입별 분리
  const codeResults = allResults
    .filter(r => r.metadata?.type === 'codebase')
    .filter(r => r.score >= 0.6);
  
  const lessonResults = allResults
    .filter(r => r.metadata?.type === 'lesson')
    .filter(r => r.score >= 0.5);
  
  // Git 변경사항 부스트 (우선순위 높임)
  if (deps.git) {
    const gitChanges = await deps.git.getChangedFiles();
    // Git에서 변경된 파일을 codeResults 앞에 추가
  }
  
  // 파일 경로 추출 (청크 → 파일)
  const filePaths = codeResults
    .map(r => r.metadata?.filePath)
    .filter((v, i, a) => a.indexOf(v) === i)  // 중복 제거
    .slice(0, maxCodeFiles);  // 15개
  
  return {
    codeFiles: filePaths.map(path => ({
      path,
      sources: ['vector'],  // 검색 출처
      priority: 'normal',
      hasLocalChanges: false
    })),
    lessons: lessonResults.slice(0, maxLessons)  // 5개
  };
}
```

---

## 🤖 3단계: LLM 호출 (Code Job)

### 진입점: `code/nodes/codeGen.ts`

```typescript
// agents/architect/graph/code/nodes/codeGen.ts

export async function codeGen(state: ArchitectGraphState) {
  // STEP 1: 프롬프트 빌드
  const messages = await buildMessages(state);
  
  // STEP 2: LLM 호출
  const response = await llm.call(messages, {
    tools: state.tools,  // 파일 쓰기, 실행 등
    onStreamEvent: (event) => {
      // 실시간 스트리밍
    }
  });
  
  return {
    ...state,
    actions: response.actions  // 파일 쓰기 액션
  };
}
```

### 프롬프트 빌드: `buildMessages()`

```typescript
async function buildMessages(state) {
  const promptEngine = state.deps?.promptEngine;
  
  // PromptEngine으로 프롬프트 생성
  const promptResult = await promptEngine.buildExecutePrompt(
    'code',  // 작업 타입
    state.context,
    {
      directive: state.directive,         // "Add logout button"
      designDoc: state.design,            // 디자인 문서
      prdSpec: state.prd,                 // PRD
      originalFiles: state.codeHead,      // Git HEAD 버전
      currentCode: state.code,            // 🔥 검색된 코드!
      lessons: state.lessons,             // 🔥 검색된 레슨!
      sessionContext: state.sessionContext,
      currentTask: {
        name: state.currentTask.name,
        type: state.currentTask.type,
        description: state.currentTask.description
      }
    },
    state.codeMode,  // 'generate'
    state.currentTask.type  // 'component'
  );
  
  // 메시지 배열 구성
  const messages = [
    {
      role: 'user',
      content: promptResult.formatted.messages[0].content
      // 여기에 모든 컨텍스트 포함됨!
    },
    ...state.conversationHistory  // 이전 대화 (재시도 시)
  ];
  
  return messages;
}
```

### PromptEngine이 생성하는 프롬프트 구조

```typescript
// core/prompt/PromptEngine.ts

async buildExecutePrompt(...) {
  // 템플릿 로드
  const template = await this.promptPort.load('execute', 'code');
  
  // 변수 바인딩
  const variables = {
    // 1. 기본 정보
    directive: "Add logout button",
    designDoc: "# Design\n...",
    
    // 2. 🔥 코드베이스 (검색된 파일들)
    currentCode: `
=== src/auth/login.ts ===
\`\`\`typescript
function login(username, password) {
  const user = await db.findUser(username);
  return user ? createToken(user) : null;
}
\`\`\`

=== src/components/Header.tsx ===
\`\`\`typescript
export function Header() {
  return <nav>...</nav>;
}
\`\`\`

... (총 15개 파일)
`,
    
    // 3. 🔥 레슨 (이전 학습)
    lessons: `
📚 Previous Learnings:

1. React 컴포넌트 패턴
   - Button 컴포넌트는 항상 onClick props 받음
   - 스타일은 Tailwind 사용
   
2. 인증 로직
   - logout 시 localStorage.removeItem('token')
   - redirectToLogin() 호출

... (총 5개 레슨)
`,
    
    // 4. 현재 태스크
    task: {
      name: "Add logout button to header",
      type: "component",
      constraints: "Use existing Button component"
    }
  };
  
  // 템플릿 렌더링
  const rendered = Handlebars.compile(template)(variables);
  
  return {
    formatted: {
      messages: [
        {
          role: 'user',
          content: rendered  // 완성된 프롬프트
        }
      ]
    }
  };
}
```

### 최종 LLM 프롬프트 예시

```
You are an expert software architect...

# Directive
Add logout button to header

# Design Document
[디자인 문서 내용]

# Current Codebase
[검색된 15개 파일의 전체 내용]

# Previous Learnings
[검색된 5개 레슨]

# Current Task
- Name: Add logout button to header
- Type: component
- Constraints: Use existing Button component

Generate code that follows the existing patterns...
```

---

## 📊 흐름 요약 (실제 구현)

### 1️⃣ 인덱싱 (Learn Job)

```typescript
// 1회만 실행 (코드베이스 변경 시)
learn/nodes/resolve → executeIndexing()
  → CodebaseIndexer.index()
    → 76 files → ChunkEngine → 1,234 chunks
    → ChromaMemoryAdapter.store()
      → Embedding 생성 (768차원)
      → ChromaDB 저장
```

**저장 데이터**:
- ID: `ant-tetris-{timestamp}-{random}-{index}`
- Embedding: `[0.15, 0.22, ..., 0.79]` (768개)
- Document: 청크 텍스트 (15줄)
- Metadata: 파일 경로, 브랜치, 커밋 등

---

### 2️⃣ 검색 (Code Job - resolve 노드)

```typescript
// 매번 실행 (새 요청마다)
code/nodes/resolve
  → CodebaseRetriever.retrieve("Add logout button")
    → UnifiedSearchStrategy.search()
      → vectorDB.query() // 시맨틱 검색
        → 청크 50개 검색 (유사도순)
        → 파일 15개 추출 (중복 제거)
        → 레슨 5개 추출
    → FileLoader.load()
      → 15개 파일 전체 내용 읽기
      → 포맷팅 (=== 파일명 === + 내용)
```

**반환 데이터**:
```typescript
{
  code: "=== src/auth/login.ts ===\n...\n=== src/components/Header.tsx ===\n...",
  lessons: [{ content: "React 패턴...", score: 0.85 }, ...],
  strategy: 'unified',
  stats: { filesLoaded: 15, estimatedTokens: 45000 }
}
```

---

### 3️⃣ LLM 호출 (Code Job - codeGen 노드)

```typescript
// 태스크마다 실행
code/nodes/codeGen
  → buildMessages(state)
    → PromptEngine.buildExecutePrompt()
      → 템플릿 + 변수 바인딩
        → directive + design + code + lessons + task
      → 프롬프트 조립
  → LLM.call(messages)
    → Claude API
    → 새로운 코드 생성
```

**LLM 입력**:
- 시스템 프롬프트: ~5K 토큰
- 디렉티브: ~1K 토큰
- 코드베이스 (검색됨): ~45K 토큰 ← 🔥
- 레슨 (검색됨): ~5K 토큰 ← 🔥
- 현재 태스크: ~1K 토큰
- **총: ~57K 토큰**

---

## 🎯 핵심 포인트

### 검색 전략
- **청크 단위 검색** → **파일 단위 로드**
- Vector DB: 청크 50개 검색 (정밀)
- FileLoader: 파일 15개 로드 (컨텍스트)

### 검색 최적화
- **모드별 조정**: generate는 레슨 중심, refactor는 코드 중심
- **Git 부스트**: 변경된 파일 우선순위 높임
- **중복 제거**: 같은 파일의 여러 청크 → 1개 파일로

### 메모리 효율
- 청크는 작게 저장 (15줄)
- 파일은 필요할 때만 로드
- LLM에는 필요한 파일만 전달 (15개)

### 토큰 관리
- maxTokens: 100K (설정)
- 실제 사용: ~50-60K (검색 결과에 따라)
- 나머지: LLM 응답 공간

이제 전체 흐름이 명확하게 이해되셨나요? 🎉

