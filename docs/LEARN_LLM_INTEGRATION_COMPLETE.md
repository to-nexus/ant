# ✅ Learn Job LLM 통합 완료

## 🎯 **핵심 개념**

**채팅 = 자연어 → LLM 분해 필수**

```
❌ Agent 직접 파싱:
  "feature-login 브랜치 학습해줘"
  → Agent: 어떻게 파싱? (불가능)

✅ LLM 분해 → Agent 실행:
  "feature-login 브랜치 학습해줘"
  → LLM: { "action": "index_branch", "branch": "feature-login" }
  → Agent: CodebaseIndexer.index(branch: "feature-login")
```

---

## 🔄 **전체 흐름**

### **3-Node Workflow**

```
User (채팅):
  "feature-login 브랜치 학습해줘"
  
  ↓

[1. decompose] - LLM이 자연어 분해
  System Prompt:
    - "자연어를 JSON 명령으로 변환하라"
    - "4가지 action: index_branch, index_codebase, learn_files, learn_text"
  
  LLM Response:
    <learn_command>
    {
      "action": "index_branch",
      "branch": "feature-login",
      "mode": "smart"
    }
    </learn_command>
  
  ↓

[2. resolve] - Agent가 명령 실행
  if (action === 'index_branch'):
    CodebaseIndexer.index(branch: "feature-login")
    → 100 files indexed
  
  ↓

[3. store] - Vector DB에 저장
  storeLearnings(texts)
  → "Indexed 100 files from feature-login"
```

---

## 📋 **지원하는 명령어**

### **1. 브랜치 인덱싱**

```
User:
  "feature-login 브랜치를 학습해줘"
  "main 브랜치 코드 분석해줘"
  "develop 브랜치 전체를 학습해줘"

LLM → Agent:
  {
    "action": "index_branch",
    "branch": "feature-login",
    "mode": "smart"
  }

Result:
  📇 Indexing codebase from branch: feature-login...
  📂 Branch exists → Incremental (3 files)
  ✅ Indexed 3 files (15 chunks, ~2000 tokens)
```

### **2. 전체 코드베이스 인덱싱**

```
User:
  "전체 코드베이스를 학습해줘"
  "현재 프로젝트 전체를 분석해줘"
  "이 프로젝트 모든 코드를 학습해줘"

LLM → Agent:
  {
    "action": "index_codebase",
    "mode": "smart"
  }

Result:
  📇 Indexing entire codebase...
  📂 Branch not found → Full indexing (120 files)
  ✅ Indexed 120 files (650 chunks, ~85000 tokens)
```

### **3. 특정 파일 학습**

```
User:
  "src/Auth.ts 파일을 학습해줘"
  "components/ 디렉토리 분석해줘"
  "src/Auth.ts와 src/api/ 를 학습해줘"

LLM → Agent:
  {
    "action": "learn_files",
    "files": ["src/Auth.ts", "src/api/"]
  }

Result:
  📖 Reading src/Auth.ts...
  ✅ Read complete
  📖 Reading src/api/...
  ✅ Read 5 files from directory
```

### **4. 텍스트 학습**

```
User:
  "이 프로젝트는 Next.js 14를 사용하고 App Router 구조를 따릅니다"
  "우리 팀은 prettier와 eslint를 사용합니다"
  "TypeScript strict 모드를 사용합니다"

LLM → Agent:
  {
    "action": "learn_text",
    "text": "이 프로젝트는 Next.js 14를 사용하고..."
  }

Result:
  💾 Stored project information to Vector DB
```

---

## 🛠️ **구현 세부사항**

### **1. decompose 노드 (LLM 분해)**

```typescript
// learn/nodes/decompose.ts

export async function decompose(state: LearnGraphState) {
  const llm = state.deps?.llm;
  
  // 1. Load system prompt
  const systemPrompt = fs.readFileSync(
    'templates/learn/system.md',
    'utf-8'
  );
  
  // 2. Call LLM
  const response = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: state.spec }
  ]);
  
  // 3. Parse <learn_command>
  const commandMatch = response.content.match(
    /<learn_command>\s*([\s\S]*?)\s*<\/learn_command>/
  );
  
  const command = JSON.parse(commandMatch[1]);
  
  return { command };
}
```

### **2. resolve 노드 (명령 실행)**

```typescript
// learn/nodes/resolve.ts

export async function resolve(state: LearnGraphState) {
  const command = state.command;
  
  switch (command.action) {
    case 'index_branch':
    case 'index_codebase':
      return await executeIndexing(state, command);
      
    case 'learn_files':
      return await executeFileLearn(state, command);
      
    case 'learn_text':
      return await executeTextLearn(state, command);
  }
}

async function executeIndexing(state, command) {
  const indexer = new CodebaseIndexer();
  const stats = await indexer.index({
    project: state.context.project,
    workingDir: state.context.workingDir,
    branch: command.branch,
    incremental: command.mode !== 'full'
  });
  
  return {
    targets: [`branch:${command.branch}`],
    texts: [`Indexed ${stats.filesIndexed} files`]
  };
}
```

### **3. store 노드 (기존 유지)**

```typescript
// learn/nodes/store.ts

export async function store(state: LearnGraphState) {
  const joined = state.texts.join("\n\n---\n\n");
  await storeLearnings(
    joined,
    state.context.project,
    state.context.featureFolder || "default"
  );
  return state;
}
```

---

## 📊 **실제 시나리오**

### **시나리오 1: 브랜치 학습**

```
User (채팅):
  "feature-login 브랜치의 코드를 학습해줘"

[1. decompose]
  LLM:
    <learn_command>
    {
      "action": "index_branch",
      "branch": "feature-login",
      "mode": "smart"
    }
    </learn_command>

[2. resolve]
  Agent:
    📇 Indexing codebase from branch: feature-login...
    
    CodebaseIndexer.index():
      - Check Vector DB: feature-login exists? → YES
      - Strategy: Incremental
      - Git diff: 3 files changed
      - Index: Login.tsx, Auth.ts, api.ts
    
    ✅ Indexed 3 files (15 chunks, ~2000 tokens)
    Duration: 0.4s

[3. store]
  Vector DB:
    type: 'learning'
    content: "Indexed codebase from branch: feature-login
              Files: 3, Chunks: 15, Tokens: ~2000"
    project: 'my-project'
    feature: 'current-feature'

Result (LLM):
  "feature-login 브랜치의 코드를 학습했습니다.
   3개 파일 (15 청크, 약 2000 토큰)이 Vector DB에 저장되었습니다."
```

### **시나리오 2: 모호한 요청**

```
User (채팅):
  "로그인 관련 코드 학습해줘"

[1. decompose]
  LLM (해석):
    "로그인" = login, auth 관련 파일
    
    <learn_command>
    {
      "action": "learn_files",
      "files": ["**/login*", "**/auth*", "**/Login*", "**/Auth*"]
    }
    </learn_command>

[2. resolve]
  Agent:
    📖 Searching for login/auth related files...
    Found:
      - src/Login.tsx
      - src/Auth.ts
      - src/components/LoginForm.tsx
      - src/api/auth.ts
    
    📖 Reading 4 files...
    ✅ Read complete

[3. store]
  Vector DB:
    (4개 파일 내용 저장)

Result (LLM):
  "로그인 관련 코드 4개 파일을 학습했습니다."
```

### **시나리오 3: 전체 코드베이스**

```
User (채팅):
  "이 프로젝트 전체를 학습해줘"

[1. decompose]
  LLM:
    <learn_command>
    {
      "action": "index_codebase",
      "mode": "smart"
    }
    </learn_command>

[2. resolve]
  Agent:
    📇 Indexing entire codebase...
    
    CodebaseIndexer.index():
      - Current branch: main
      - Check Vector DB: main exists? → NO
      - Strategy: Full indexing
      - Found: 120 source files
      - Batch 1/12: 10 files
      - Batch 2/12: 10 files
      ...
    
    ✅ Indexed 120 files (650 chunks, ~85000 tokens)
    Duration: 5.2s

[3. store]
  Vector DB:
    type: 'learning'
    content: "Indexed entire codebase from main branch..."

Result (LLM):
  "전체 코드베이스를 학습했습니다.
   120개 파일 (650 청크, 약 85,000 토큰)이 Vector DB에 저장되었습니다."
```

---

## 🎯 **왜 LLM 분해가 필요한가?**

### **자연어의 다양성**

```
동일한 의도, 다른 표현:

1. "feature-login 브랜치 학습해줘"
2. "feature-login 브랜치의 코드를 분석해줘"
3. "feature-login 브랜치 전체를 인덱싱해줘"
4. "login 기능 브랜치 학습 좀"

→ LLM:
  {
    "action": "index_branch",
    "branch": "feature-login",
    "mode": "smart"
  }

❌ Agent 직접 파싱: 불가능 (표현이 너무 다양)
✅ LLM 분해: 가능 (의미 이해)
```

### **모호한 요청 처리**

```
User: "로그인 코드 학습해줘"

❌ Agent:
  - "로그인"이 브랜치명? 파일명? 기능명?
  - 어디서 찾아야 하나?
  - 판단 불가능

✅ LLM:
  - "로그인" = login, auth 관련 파일
  - 패턴: **/login*, **/auth*
  - action: learn_files
```

---

## ✅ **최종 정리**

### **Q: CLI 명령어는 Agent 판단?**
**A: ✅ 맞습니다**
```bash
aidev index my-project
  → 구조화된 명령 → Agent 직접 파싱 가능
```

### **Q: 채팅 명령어는 LLM 판단?**
**A: ✅ 맞습니다**
```
"feature-login 브랜치 학습해줘"
  → 자연어 → LLM 분해 → Agent 실행
```

### **Q: decompose 노드 역할?**
**A: ✅ 자연어 → JSON 명령**
```
Input:  "feature-login 브랜치 학습해줘"
Output: { "action": "index_branch", "branch": "feature-login" }
```

### **Q: resolve 노드 역할?**
**A: ✅ JSON 명령 → 실행**
```
Input:  { "action": "index_branch", "branch": "feature-login" }
Output: CodebaseIndexer.index() 실행 결과
```

---

## 🎉 **구현 완료!**

**구현된 것:**
- ✅ decompose 노드: LLM이 자연어 분해
- ✅ resolve 노드: Agent가 명령 실행
- ✅ 4가지 action: index_branch, index_codebase, learn_files, learn_text
- ✅ System prompt: 명령 규격 정의
- ✅ Workflow: decompose → resolve → store

**사용 방법:**
```
채팅:
  "feature-login 브랜치 학습해줘"
  "전체 코드베이스 분석해줘"
  "src/Auth.ts 학습해줘"
  "이 프로젝트는 Next.js를 사용합니다"

→ LLM이 자동 분해
→ Agent가 자동 실행
→ Vector DB에 저장
```

**바로 사용 가능합니다!** 🚀

