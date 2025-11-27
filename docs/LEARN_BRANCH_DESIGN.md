# Learn Job 브랜치 학습 설계

## 🎯 **설계 선택: Agent 판단 vs LLM 판단**

### **결론: Agent 판단 (정규 표현식 파싱)**

**이유:**
1. ✅ **명령어가 구조적**: `@learn branch:feature-login`
2. ✅ **LLM 불필요**: 간단한 패턴 매칭으로 충분
3. ✅ **빠름**: LLM 호출 없이 즉시 실행
4. ✅ **비용 절감**: LLM API 비용 불필요
5. ✅ **명확성**: 사용자 의도가 명확함

**LLM이 필요한 경우:**
- ❌ "최근 작업한 브랜치를 학습해줘" (모호함)
- ❌ "로그인 관련 코드를 학습해줘" (검색 필요)

**Agent가 적합한 경우:**
- ✅ `@learn branch:feature-login` (명확한 브랜치명)
- ✅ `@learn branch:main` (명확한 브랜치명)
- ✅ `@learn codebase` (전체 코드베이스)

---

## 📋 **채팅 명령어 구조**

### **Option 1: 브랜치 학습 (권장)**
```
@learn branch:feature-login
@learn branch:main
@learn branch:develop
```

### **Option 2: 전체 코드베이스 학습**
```
@learn codebase
@learn codebase --branch=feature-login
```

### **Option 3: 특정 파일/디렉토리 (기존)**
```
@learn src/Auth.ts
@learn src/components/
```

### **Option 4: 혼합**
```
@learn branch:feature-login src/Auth.ts
```

---

## 🔄 **처리 흐름**

### **현재 (기존)**
```
User: "@learn src/Auth.ts"
  ↓
Agent: extractPaths(spec) → ["src/Auth.ts"]
  ↓
Agent: readFile("src/Auth.ts") → content
  ↓
Agent: storeLearnings(content) → Vector DB
```

### **신규 (브랜치 학습)**
```
User: "@learn branch:feature-login"
  ↓
Agent: parseCommand(spec)
  → type: 'branch'
  → branch: 'feature-login'
  ↓
Agent: CodebaseIndexer.index(branch: 'feature-login')
  ↓
Agent: "✅ Learned 100 files from branch feature-login"
```

---

## 🛠️ **구현 방법**

### **1. 명령어 파싱 (Agent)**

```typescript
// learn/nodes/resolve.ts

interface LearnCommand {
  type: 'branch' | 'codebase' | 'files';
  branch?: string;
  files?: string[];
}

function parseLearnCommand(spec: string): LearnCommand {
  // Pattern 1: @learn branch:feature-login
  const branchMatch = spec.match(/branch:([a-zA-Z0-9\-_\/]+)/);
  if (branchMatch) {
    return {
      type: 'branch',
      branch: branchMatch[1]
    };
  }
  
  // Pattern 2: @learn codebase
  if (spec.includes('codebase')) {
    return {
      type: 'codebase',
      branch: undefined  // Current branch
    };
  }
  
  // Pattern 3: @learn src/Auth.ts (기존 방식)
  const files = extractPaths(spec);
  if (files.length > 0) {
    return {
      type: 'files',
      files
    };
  }
  
  // Default: treat as raw text
  return {
    type: 'files',
    files: []
  };
}
```

### **2. 브랜치 학습 실행**

```typescript
// learn/nodes/resolve.ts

export async function resolve(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const gitPort = state.deps?.git;
  const chatAPI = getChatAPIClient();
  
  // ✅ Parse command
  const command = parseLearnCommand(state.spec);
  
  if (command.type === 'branch' || command.type === 'codebase') {
    // ✅ Use CodebaseIndexer for branch learning
    return await learnBranch(state, command.branch);
  } else {
    // ✅ Existing file-based learning
    return await learnFiles(state, command.files);
  }
}

async function learnBranch(
  state: LearnGraphState,
  branch?: string
): Promise<Partial<LearnGraphState>> {
  const chatAPI = getChatAPIClient();
  
  // Show status
  await chatAPI.addChatStatus({
    type: 'indexing',
    message: `Learning codebase from branch: ${branch || 'current'}...`
  });
  
  // Import CodebaseIndexer
  const { CodebaseIndexer } = await import('../../../../../core/codebase/CodebaseIndexer');
  const { ChromaMemoryAdapter } = await import('../../../../../periphery/adapters/memory/ChromaMemoryAdapter');
  const { ChunkAdapter } = await import('../../../../../infrastructure/adapters/ChunkAdapter');
  
  const git = state.deps?.git;
  const vectorDB = new ChromaMemoryAdapter();
  const chunk = new ChunkAdapter();
  
  // Run indexer
  const indexer = new CodebaseIndexer();
  const stats = await indexer.index(
    { git, vectorDB, chunk },
    {
      project: state.context.project,
      workingDir: state.context.workingDir,
      branch: branch  // undefined = current branch
    }
  );
  
  // Show completion
  await chatAPI.addChatStatus({
    type: 'indexed',
    message: `✅ Learned ${stats.filesIndexed} files (${stats.chunksCreated} chunks)`
  });
  
  return {
    targets: [`branch:${branch || 'current'}`],
    texts: [`Indexed ${stats.filesIndexed} files`]
  };
}

async function learnFiles(
  state: LearnGraphState,
  files: string[]
): Promise<Partial<LearnGraphState>> {
  // ... 기존 로직 ...
}
```

---

## 📊 **사용 예시**

### **예시 1: 특정 브랜치 학습**

```
User:
  "이 프로젝트의 feature-login 브랜치를 학습해줘
   @learn branch:feature-login"

Agent:
  📇 Learning codebase from branch: feature-login...
  📂 Branch exists in Vector DB → Incremental indexing
     Found 3 changed files
  ✅ Learned 3 files (15 chunks)
  
  "feature-login 브랜치의 코드를 학습했습니다.
   3개 파일, 15개 청크가 Vector DB에 저장되었습니다."
```

### **예시 2: 전체 코드베이스 학습**

```
User:
  "현재 코드베이스 전체를 학습해줘
   @learn codebase"

Agent:
  📇 Learning entire codebase...
  📂 Branch not in Vector DB → Full indexing
     Found 120 source files
  ✅ Learned 120 files (650 chunks)
  
  "현재 브랜치의 전체 코드베이스를 학습했습니다.
   120개 파일, 650개 청크가 Vector DB에 저장되었습니다."
```

### **예시 3: 기존 방식 (파일 지정)**

```
User:
  "Auth.ts 파일을 학습해줘
   @learn src/Auth.ts"

Agent:
  📖 Reading src/Auth.ts...
  ✅ Read complete
  💾 Stored to Vector DB
  
  "src/Auth.ts 파일을 학습했습니다."
```

---

## 🎯 **왜 Agent 판단이 적합한가?**

| 기준 | Agent 판단 | LLM 판단 |
|------|-----------|----------|
| **속도** | ✅ 즉시 | ❌ LLM 호출 필요 (1-2초) |
| **비용** | ✅ 무료 | ❌ API 비용 |
| **정확도** | ✅ 100% | ❌ 95% (오해석 가능) |
| **명확성** | ✅ 명확한 명령어 | ❌ 자연어 모호성 |
| **구현** | ✅ 간단 (정규표현식) | ❌ 복잡 (프롬프트 엔지니어링) |

### **LLM이 필요한 경우 (미래 확장)**

```
User: "최근 작업한 브랜치를 학습해줘"
  ↓
LLM: Git log 분석 → "feature-login이 최근 작업 브랜치"
  ↓
Agent: @learn branch:feature-login 실행
```

---

## ✅ **구현 우선순위**

### **Phase 1: Agent 기반 (지금)**
```
✅ @learn branch:feature-login
✅ @learn codebase
✅ 기존 파일 학습 유지
```

### **Phase 2: LLM 보조 (나중)**
```
⏳ "최근 작업 브랜치 학습" → LLM이 브랜치명 추출
⏳ "로그인 관련 코드 학습" → LLM이 파일 검색 후 학습
```

---

## 🚀 **다음 단계**

1. ✅ `parseLearnCommand()` 구현
2. ✅ `learnBranch()` 구현
3. ✅ `learnFiles()` 분리 (기존 로직)
4. ✅ ChatAPI 상태 추가 (`indexing`, `indexed`)
5. ✅ 테스트

**지금 바로 구현하시겠습니까?**

