# 📚 코드베이스 학습 구조 완전 분석

## 🎯 **핵심 질문에 대한 답**

### **Q1: 코드베이스를 학습할 때 AST로 전환하나?**
**A: ✅ 일부 AST, 주로 정규표현식 기반**

현재는 **정규표현식 기반 구조 인식**을 사용하고, 주석에 "프로덕션에선 `@babel/parser`로 AST 사용 권장"이라고 되어 있습니다.

### **Q2: 정확히 어떻게 저장하는 구조인가?**
**A: ✅ 6-Stage Pipeline**
```
Raw Code → Load → Split → Clean → Annotate → Encode → Vector DB
```

### **Q3: 청킹 엔진이 담당하는가?**
**A: ✅ 맞습니다**

ChunkEngine이 전체 파이프라인을 orchestrate합니다.

---

## 🔄 **전체 흐름: 코드가 Vector DB에 저장되기까지**

### **1단계: CodebaseIndexer 시작**

```typescript
// CodebaseIndexer.ts

const indexer = new CodebaseIndexer();
await indexer.index(
  { git, vectorDB, chunk },
  {
    project: 'my-project',
    workingDir: '/path/to/code',
    branch: 'feature-login'
  }
);

// 내부 동작:
for (const filePath of allFiles) {
  await this.indexFile(
    filePath,         // 'src/Auth.ts'
    workingDir,       // '/path/to/code'
    project,          // 'my-project'
    branch,           // 'feature-login'
    commitHash,       // 'abc1234'
    { vectorDB, chunk }
  );
}
```

### **2단계: 파일 읽기**

```typescript
// CodebaseIndexer.ts - indexFile()

// 1. 파일 읽기
const content = fs.readFileSync('src/Auth.ts', 'utf8');

// 예시 content:
`
export class AuthService {
  async validateUser(email: string, password: string) {
    // 검증 로직
    return true;
  }
  
  async hashPassword(password: string) {
    // 해시 로직
    return hash;
  }
}
`
```

### **3단계: 청킹 엔진 호출**

```typescript
// CodebaseIndexer.ts

const result = await deps.chunk.process({
  source: 'src/Auth.ts',
  sourceType: 'code',
  content: content,  // 위의 코드
  metadata: {
    type: 'codebase',
    filePath: 'src/Auth.ts',
    project: 'my-project',
    branch: 'feature-login',
    commitHash: 'abc1234',
    language: 'typescript',
    timestamp: '2024-01-15T10:00:00Z'
  }
});
```

---

## 📦 **6-Stage Chunking Pipeline**

### **Stage 1: Loader** (파일 로드)

```typescript
// ChunkingAdapter.ts

const loaders = new Map();
loaders.set('text', new TextLoader());
loaders.set('file', new FileLoader());

// 실행:
const loader = loaders.get('code');  // sourceType이 'code'면 TextLoader
const loaded = await loader.load({
  source: 'src/Auth.ts',
  sourceType: 'code',
  content: <위의 코드>,
  metadata: {...}
});

// Result:
{
  text: <코드 content>,
  contentType: 'code',  // 확장자 기반 (.ts → code)
  metadata: {...}
}
```

### **Stage 2: Splitter** (코드 분할)

```typescript
// ChunkingAdapter.ts

const splitters = new Map();
splitters.set('code', new CodeSplitter());  // ✅ 코드용 스플리터
splitters.set('markdown', new MarkdownSplitter());

// 실행:
const splitter = splitters.get('code');
const rawChunks = await splitter.split(loaded, {
  maxTokens: 300,      // 청크당 최대 토큰
  overlapTokens: 30,   // 청크 간 overlap
  preserveStructure: true
});

// CodeSplitter 내부 동작:
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### **CodeSplitter 상세 (정규표현식 기반)**

```typescript
// splitters/CodeSplitter.ts

// 1. 코드 구조 패턴 정의
const patterns = {
  function: /^(export\s+)?(async\s+)?function\s+\w+/,
  class: /^(export\s+)?class\s+\w+/,
  const: /^(export\s+)?const\s+\w+\s*=/,
  interface: /^(export\s+)?interface\s+\w+/,
  type: /^(export\s+)?type\s+\w+\s*=/
};

// 2. 라인별 분석
for (const line of lines) {
  // 중괄호 깊이 추적
  braceDepth += (line.match(/\{/g) || []).length;
  braceDepth -= (line.match(/\}/g) || []).length;
  
  // 새 선언 감지
  for (const [type, pattern] of patterns) {
    if (pattern.test(line.trim())) {
      // 이전 청크 저장
      if (currentChunk.length > 0 && braceDepth === 0) {
        chunks.push({
          text: currentChunk.join('\n'),
          index: chunkIndex++,
          type: currentType,    // 'class', 'function', etc.
          name: currentName     // 'AuthService', 'validateUser', etc.
        });
        currentChunk = [];
      }
      // 새 청크 시작
      currentType = type;
      currentName = extractName(line);
    }
  }
  
  currentChunk.push(line);
}

// 3. 예시 결과 (Auth.ts):
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Chunk 1:
{
  text: `
export class AuthService {
  async validateUser(email: string, password: string) {
    // 검증 로직
    return true;
  }
}
  `,
  index: 0,
  type: 'class',
  name: 'AuthService',
  startLine: 1,
  endLine: 7
}

// Chunk 2:
{
  text: `
  async validateUser(email: string, password: string) {
    // 검증 로직
    return true;
  }
  `,
  index: 1,
  type: 'function',
  name: 'validateUser',
  startLine: 2,
  endLine: 5
}

// Chunk 3:
{
  text: `
  async hashPassword(password: string) {
    // 해시 로직
    return hash;
  }
  `,
  index: 2,
  type: 'function',
  name: 'hashPassword',
  startLine: 7,
  endLine: 10
}
```

**💡 주석: "Note: For production, consider using @babel/parser for AST-based splitting"**

현재는 정규표현식으로 구조를 파악하지만, 프로덕션에선 진짜 AST 파서를 권장합니다.

---

### **Stage 3: Cleaner** (정제)

```typescript
// ChunkingAdapter.ts

const cleaners = new Map();
cleaners.set('code', new PlainCleaner());  // 코드는 PlainCleaner

// 실행:
const cleaner = cleaners.get('code');
const cleanedChunks = await cleaner.clean(rawChunks);

// PlainCleaner 동작:
// - 공백 정규화
// - 불필요한 빈 줄 제거
// - 코멘트 유지 (중요한 정보 포함)
```

### **Stage 4: Annotator** (메타데이터 추가)

```typescript
// ChunkingAdapter.ts

const annotator = new DefaultAnnotator();
const annotatedChunks = await annotator.annotate(cleanedChunks);

// DefaultAnnotator 동작:
// - 토큰 수 계산 (text.length / 4)
// - 메타데이터 풍부화
// - 청크 ID 생성

// 결과 예시:
{
  text: `export class AuthService { ... }`,
  index: 0,
  type: 'class',
  name: 'AuthService',
  tokens: 75,  // ✅ 추가됨
  metadata: {
    type: 'codebase',
    filePath: 'src/Auth.ts',
    project: 'my-project',
    branch: 'feature-login',
    commitHash: 'abc1234',
    language: 'typescript',
    timestamp: '2024-01-15T10:00:00Z',
    chunkType: 'class',      // ✅ 추가됨
    chunkName: 'AuthService' // ✅ 추가됨
  }
}
```

### **Stage 5: Encoder** (벡터 인코딩)

```typescript
// Vector DB (ChromaMemoryAdapter)에서 처리

// CodebaseIndexer에서 전달:
const documents = result.chunks.map(chunk => ({
  content: chunk.text,
  metadata: chunk.metadata
}));

await vectorDB.store(documents, 'my-project');

// Vector DB 내부:
// 1. 텍스트 → 임베딩 벡터 변환
//    "export class AuthService { ... }" 
//    → [0.123, -0.456, 0.789, ...]  (1536차원)
//
// 2. Chroma DB에 저장
```

### **Stage 6: VectorSink** (Vector DB 저장)

```typescript
// ChromaMemoryAdapter.ts

async store(documents, collection) {
  // 1. 컬렉션 생성/가져오기
  const coll = await chromaClient.getOrCreateCollection({
    name: 'my-project'
  });
  
  // 2. 문서 저장
  await coll.add({
    ids: ['chunk-0', 'chunk-1', 'chunk-2'],
    documents: [
      'export class AuthService { ... }',
      'async validateUser(...) { ... }',
      'async hashPassword(...) { ... }'
    ],
    embeddings: [
      [0.123, -0.456, ...],  // AuthService class
      [0.234, -0.567, ...],  // validateUser method
      [0.345, -0.678, ...]   // hashPassword method
    ],
    metadatas: [
      {
        type: 'codebase',
        filePath: 'src/Auth.ts',
        project: 'my-project',
        branch: 'feature-login',
        commitHash: 'abc1234',
        language: 'typescript',
        chunkType: 'class',
        chunkName: 'AuthService'
      },
      {
        type: 'codebase',
        filePath: 'src/Auth.ts',
        project: 'my-project',
        branch: 'feature-login',
        commitHash: 'abc1234',
        language: 'typescript',
        chunkType: 'function',
        chunkName: 'validateUser'
      },
      {
        type: 'codebase',
        filePath: 'src/Auth.ts',
        project: 'my-project',
        branch: 'feature-login',
        commitHash: 'abc1234',
        language: 'typescript',
        chunkType: 'function',
        chunkName: 'hashPassword'
      }
    ]
  });
}
```

---

## 📊 **Vector DB 최종 저장 구조**

```typescript
// Chroma DB에 저장된 실제 데이터

Collection: 'my-project'

// Document 1 (AuthService 클래스)
{
  id: 'chunk-abc1234-auth-0',
  document: `export class AuthService {
  async validateUser(email: string, password: string) {
    // 검증 로직
    return true;
  }
  
  async hashPassword(password: string) {
    // 해시 로직
    return hash;
  }
}`,
  embedding: [0.123, -0.456, 0.789, ...],  // 1536 dimensions
  metadata: {
    type: 'codebase',           // ✅ 코드베이스 타입
    filePath: 'src/Auth.ts',    // ✅ 파일 경로
    project: 'my-project',      // ✅ 프로젝트명
    branch: 'feature-login',    // ✅ 브랜치명
    commitHash: 'abc1234',      // ✅ 커밋 해시
    language: 'typescript',     // ✅ 언어
    timestamp: '2024-01-15T10:00:00Z',
    chunkType: 'class',         // ✅ 청크 타입 (class, function, etc.)
    chunkName: 'AuthService',   // ✅ 클래스/함수명
    startLine: 1,
    endLine: 11
  }
}

// Document 2 (validateUser 메서드)
{
  id: 'chunk-abc1234-auth-1',
  document: `  async validateUser(email: string, password: string) {
    // 검증 로직
    const user = await findUserByEmail(email);
    if (!user) return false;
    
    const isValid = await comparePassword(password, user.passwordHash);
    return isValid;
  }`,
  embedding: [0.234, -0.567, 0.890, ...],
  metadata: {
    type: 'codebase',
    filePath: 'src/Auth.ts',
    project: 'my-project',
    branch: 'feature-login',
    commitHash: 'abc1234',
    language: 'typescript',
    timestamp: '2024-01-15T10:00:00Z',
    chunkType: 'function',      // ✅ 함수
    chunkName: 'validateUser',  // ✅ 함수명
    startLine: 2,
    endLine: 8
  }
}

// Document 3 (hashPassword 메서드)
{
  id: 'chunk-abc1234-auth-2',
  document: `  async hashPassword(password: string) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    return hash;
  }`,
  embedding: [0.345, -0.678, 0.901, ...],
  metadata: {
    type: 'codebase',
    filePath: 'src/Auth.ts',
    project: 'my-project',
    branch: 'feature-login',
    commitHash: 'abc1234',
    language: 'typescript',
    timestamp: '2024-01-15T10:00:00Z',
    chunkType: 'function',
    chunkName: 'hashPassword',
    startLine: 10,
    endLine: 14
  }
}
```

---

## 🔍 **검색 (RAG) 시 동작**

```typescript
// 사용자: "사용자 인증 로직은 어떻게 구현되어 있나요?"

// 1. 쿼리 임베딩
const queryEmbedding = await embed("사용자 인증 로직은 어떻게 구현되어 있나요?");
// → [0.245, -0.531, 0.876, ...]

// 2. Vector DB 검색 (코사인 유사도)
const results = await vectorDB.query(
  "사용자 인증 로직은 어떻게 구현되어 있나요?",
  'my-project',
  {
    k: 5,  // Top 5
    where: {
      type: 'codebase',
      branch: 'feature-login'
    }
  }
);

// 3. 유사도 계산 결과:
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Rank 1: validateUser 함수 (유사도: 0.92)
{
  document: `async validateUser(email: string, password: string) { ... }`,
  metadata: {
    filePath: 'src/Auth.ts',
    chunkType: 'function',
    chunkName: 'validateUser'
  }
}

// Rank 2: AuthService 클래스 (유사도: 0.88)
{
  document: `export class AuthService { ... }`,
  metadata: {
    filePath: 'src/Auth.ts',
    chunkType: 'class',
    chunkName: 'AuthService'
  }
}

// Rank 3: hashPassword 함수 (유사도: 0.65)
{
  document: `async hashPassword(password: string) { ... }`,
  metadata: {
    filePath: 'src/Auth.ts',
    chunkType: 'function',
    chunkName: 'hashPassword'
  }
}

// 4. LLM에게 전달
const prompt = `
User Question: 사용자 인증 로직은 어떻게 구현되어 있나요?

Relevant Code:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILE: src/Auth.ts (function: validateUser)
${results[0].document}

FILE: src/Auth.ts (class: AuthService)
${results[1].document}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please answer based on the code above.
`;

// LLM Response:
"사용자 인증은 AuthService 클래스의 validateUser 메서드로 구현되어 있습니다.
 1. 이메일로 사용자를 찾고
 2. 비밀번호를 비교하여
 3. 검증 결과를 반환합니다."
```

---

## ✅ **최종 정리**

### **Q: AST로 전환하나?**
**A: 현재는 정규표현식, 미래엔 AST**
- 현재: 정규표현식으로 `class`, `function`, `const` 등 감지
- 미래: `@babel/parser` 사용 권장 (주석에 명시)

### **Q: 어떻게 저장하나?**
**A: 6-Stage Pipeline**
```
Raw Code 
  → Load (파일 읽기)
  → Split (함수/클래스별 분할, 300 tokens)
  → Clean (공백 정규화)
  → Annotate (메타데이터 추가)
  → Encode (임베딩 벡터 변환)
  → Store (Vector DB 저장)
```

### **Q: 청킹 엔진이 담당하나?**
**A: ✅ 맞습니다**
- `ChunkEngine`: 파이프라인 orchestration
- `CodeSplitter`: 코드 구조 인식 및 분할
- `DefaultAnnotator`: 토큰 계산 및 메타데이터
- `ChromaMemoryAdapter`: 임베딩 및 저장

### **저장 단위**
```
하나의 파일 (Auth.ts)
  → 3개 청크:
    1. AuthService 클래스 (75 tokens)
    2. validateUser 함수 (65 tokens)
    3. hashPassword 함수 (55 tokens)
  → Vector DB에 3개 document로 저장
  → 각각 독립적으로 검색 가능
```

### **검색 시**
```
Query: "사용자 인증 로직"
  → Vector 검색
  → validateUser 함수 발견 (유사도 0.92)
  → LLM에게 전달
  → 정확한 답변 생성
```

**구조가 명확합니다!** 🎉

