# Vector DB 코드베이스 인덱싱 파이프라인

## 📋 목차
1. [전체 흐름 개요](#전체-흐름-개요)
2. [각 단계 상세 설명](#각-단계-상세-설명)
3. [청킹 파이프라인](#청킹-파이프라인)
4. [Vector DB 저장](#vector-db-저장)
5. [검색 및 활용](#검색-및-활용)

---

## 전체 흐름 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                     코드베이스 인덱싱 파이프라인                      │
└─────────────────────────────────────────────────────────────────┘

1️⃣ CodebaseIndexer (진입점)
   ↓
   ├─ Git에서 소스 파일 목록 수집
   └─ 배치 단위로 파일 처리 (10개씩)

2️⃣ 각 파일별 처리
   ↓
   ├─ 파일 읽기 (fs.readFileSync)
   ├─ 크기 체크 (>2MB 스킵)
   └─ ChunkPort.process() 호출

3️⃣ ChunkEngine (청킹 파이프라인)
   ↓
   ├─ Stage 1: Loader    → 파일 내용 로드
   ├─ Stage 2: Splitter  → 청크로 분할
   ├─ Stage 3: Cleaner   → 청크 정제
   └─ Stage 4: Annotator → 메타데이터 추가

4️⃣ Vector DB 저장
   ↓
   ├─ ChromaMemoryAdapter.store()
   ├─ Embedding 생성 (10개씩 배치)
   └─ ChromaDB에 저장

5️⃣ 검색 및 활용
   ↓
   ├─ 시맨틱 검색 (vectorDB.query)
   └─ LLM 컨텍스트로 활용
```

---

## 각 단계 상세 설명

### 1️⃣ CodebaseIndexer (진입점)

**위치**: `packages/ant-cli/src/core/codebase/CodebaseIndexer.ts`

**역할**: 코드베이스 전체를 조율하여 Vector DB에 인덱싱

```typescript
class CodebaseIndexer {
  async index(deps, options) {
    // 1. Git 상태 확인
    const branch = await deps.git.getCurrentBranch();
    const commit = await deps.git.getCurrentCommit();
    
    // 2. 인덱싱 전략 결정
    const indexStatus = await this.checkBranchIndexStatus(...);
    // → 전체 인덱싱 vs 증분 인덱싱
    
    // 3. 소스 파일 목록 수집
    const filesToIndex = await this.getSourceFiles(workingDir, exclude);
    // → Git에서 추적하는 모든 소스 파일
    
    // 4. 배치 처리 (10개씩)
    for (let i = 0; i < filesToIndex.length; i += 10) {
      const batch = filesToIndex.slice(i, i + 10);
      
      for (const file of batch) {
        await this.indexFile(file, ...);  // 🔥 핵심!
      }
    }
  }
}
```

**주요 기능**:
- ✅ **증분 인덱싱**: 이미 인덱싱된 브랜치는 변경된 파일만 처리
- ✅ **배치 처리**: 10개 파일씩 동시 처리 (메모리 효율)
- ✅ **파일 필터링**: `node_modules`, `dist`, 테스트 파일 제외
- ✅ **커밋 추적**: 각 인덱싱마다 커밋 해시 저장

---

### 2️⃣ 각 파일별 처리

**위치**: `CodebaseIndexer.indexFile()`

```typescript
async indexFile(filePath, workingDir, project, branch, commitHash, deps) {
  // 1. 파일 읽기
  const absolutePath = path.join(workingDir, filePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const relativePath = path.relative(workingDir, absolutePath);
  
  // 2. 크기 체크 (>2MB 스킵)
  if (content.length > 2 * 1024 * 1024) {
    console.log(`⚠️ Skipping large file: ${relativePath}`);
    return { chunks: 0, tokens: 0 };
  }
  
  // 3. 기존 청크 삭제 (증분 인덱싱 시)
  await deps.vectorDB.delete(project, {
    $and: [
      { type: 'codebase' },
      { filePath: relativePath },
      { branch }
    ]
  });
  
  // 4. 청킹 파이프라인 실행 🔥
  const result = await deps.chunk.process({
    source: relativePath,
    sourceType: 'text',      // TextLoader 사용
    content,                 // 이미 읽은 내용 전달
    metadata: {
      type: 'codebase',      // 코드베이스 타입
      filePath: relativePath,
      project,
      feature: 'index',
      branch,
      commitHash,
      language: this.detectLanguage(filePath),  // .ts, .tsx, .py 등
      timestamp: new Date().toISOString()
    }
  });
  
  // 5. Vector DB에 저장
  const documents = result.chunks.map(chunk => ({
    content: chunk.text,
    metadata: chunk.metadata
  }));
  
  await deps.vectorDB.store(documents, project);
  
  return {
    chunks: documents.length,
    tokens: result.stats.avgTokens * documents.length
  };
}
```

**핵심 포인트**:
- 파일을 **한 번만** 읽음 (`sourceType: 'text'`)
- 기존 청크를 **먼저 삭제** (중복 방지)
- 메타데이터에 **Git 정보 포함** (branch, commit)

---

### 3️⃣ ChunkEngine (청킹 파이프라인)

**위치**: `packages/ant-cli/src/core/chunk/ChunkEngine.ts`

청킹은 **6단계 파이프라인**으로 구성됩니다:

```
📄 Input (파일 내용)
  ↓
┌─────────────────────┐
│ Stage 1: Loader     │  파일/텍스트 로드
└─────────────────────┘
  ↓
┌─────────────────────┐
│ Stage 2: Splitter   │  청크로 분할 🔥 핵심!
└─────────────────────┘
  ↓
┌─────────────────────┐
│ Stage 3: Cleaner    │  불필요한 내용 제거
└─────────────────────┘
  ↓
┌─────────────────────┐
│ Stage 4: Annotator  │  토큰 수, 메타데이터 추가
└─────────────────────┘
  ↓
📦 Output (청크 배열)
```

#### Stage 1: Loader

**역할**: 파일 내용을 로드하고 타입 감지

```typescript
// TextLoader (우리가 사용)
class TextLoader implements Loader {
  async load(input: ChunkInput): Promise<LoadedContent> {
    return {
      text: input.content,  // 이미 제공된 내용
      metadata: input.metadata,
      contentType: this.detectContentType(input)  // 'code' 또는 'markdown'
    };
  }
  
  private detectContentType(input): string {
    // metadata.type === 'codebase' → 'code'
    // metadata.language → 'code'
    // .md 확장자 → 'markdown'
    
    if (input.metadata?.type === 'codebase') return 'code';
    if (input.metadata?.language) return 'code';
    if (input.source?.endsWith('.md')) return 'markdown';
    return 'plain';
  }
}
```

#### Stage 2: Splitter 🔥 가장 중요!

**역할**: 파일을 의미 있는 청크로 분할

**2가지 Splitter**:
1. **MarkdownSplitter**: `.md` 파일 (헤딩 기반)
2. **CodeSplitter**: `.ts`, `.tsx`, `.py` 등 (라인 기반)

##### CodeSplitter (단순화된 버전)

```typescript
class CodeSplitter implements Splitter {
  async split(content: LoadedContent, strategy: ChunkStrategy): Promise<RawChunk[]> {
    const { text, metadata } = content;
    const lines = text.split('\n');
    
    // 작은 파일 (< maxTokens) → 단일 청크
    const estimatedTokens = Math.ceil(text.length / 4);
    if (estimatedTokens <= strategy.maxTokens) {
      return [{
        text: text.trim(),
        index: 0,
        startPos: 0,
        endPos: lines.length,
        metadata
      }];
    }
    
    // 큰 파일 → 라인 기반 분할
    return this.splitByLines(text, metadata, strategy);
  }
  
  private splitByLines(text, metadata, strategy): RawChunk[] {
    const lines = text.split('\n');
    const targetLines = Math.max(10, Math.floor(strategy.maxTokens * 4 / 80));
    const overlapLines = Math.max(2, Math.floor(strategy.overlapTokens * 4 / 80));
    
    // 예: maxTokens=300 → targetLines=15줄, overlapLines=2줄
    
    const chunks = [];
    let pos = 0;
    let index = 0;
    
    while (pos < lines.length) {
      const end = Math.min(pos + targetLines, lines.length);
      const chunkText = lines.slice(pos, end).join('\n').trim();
      
      chunks.push({
        text: chunkText,
        index: index++,
        startPos: pos,
        endPos: end,
        metadata
      });
      
      pos = end - overlapLines;  // 오버랩 추가
      if (pos >= lines.length || end === lines.length) break;
    }
    
    return chunks;
  }
}
```

**청킹 전략**:
- `maxTokens`: 300 (코드 분석용)
- `overlapTokens`: 30 (컨텍스트 유지)

**예시**: 100줄 파일
```
청크 1: 줄 0-15   (15줄)
청크 2: 줄 13-28  (15줄, 2줄 오버랩)
청크 3: 줄 26-41  (15줄, 2줄 오버랩)
...
```

#### Stage 3: Cleaner

**역할**: 불필요한 공백, 주석 제거

```typescript
class PlainCleaner implements Cleaner {
  async clean(chunks: RawChunk[]): Promise<RawChunk[]> {
    return chunks.map(chunk => ({
      ...chunk,
      text: chunk.text.trim()  // 앞뒤 공백 제거
    }));
  }
}
```

#### Stage 4: Annotator

**역할**: 토큰 수 계산, 메타데이터 추가

```typescript
class DefaultAnnotator implements Annotator {
  async annotate(chunks: RawChunk[]): Promise<Chunk[]> {
    return chunks.map(chunk => ({
      ...chunk,
      tokens: this.estimateTokens(chunk.text),  // 대략 length/4
      metadata: {
        ...chunk.metadata,
        chunkIndex: chunk.index,
        startLine: chunk.startPos,
        endLine: chunk.endPos
      }
    }));
  }
}
```

**최종 청크 구조**:
```typescript
{
  text: "import React from 'react';\n\nfunction App() {...}",
  index: 0,
  startPos: 0,
  endPos: 15,
  tokens: 75,
  metadata: {
    type: 'codebase',
    filePath: 'src/App.tsx',
    project: 'my-project',
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

### 4️⃣ Vector DB 저장

**위치**: `packages/ant-cli/src/periphery/adapters/memory/ChromaMemoryAdapter.ts`

```typescript
class ChromaMemoryAdapter implements MemoryPort {
  async store(documents, namespace) {
    const collection = await client.getOrCreateCollection({
      name: namespace,           // 프로젝트 이름
      embeddingFunction: embedder  // Embedding 생성 함수
    });
    
    // 1. 데이터 준비
    const docs = [];
    const metadatas = [];
    const ids = [];
    
    const timestamp = Date.now();
    const randomSeed = Math.random().toString(36).substring(7);
    
    for (let i = 0; i < documents.length; i++) {
      docs.push(documents[i].content);         // 청크 텍스트
      metadatas.push(documents[i].metadata);   // 메타데이터
      ids.push(`${namespace}-${timestamp}-${randomSeed}-${i}`);
    }
    
    // 2. ChromaDB에 저장 (자동으로 Embedding 생성)
    await collection.add({ documents: docs, metadatas, ids });
  }
}
```

#### Embedding 생성 (중요!)

```typescript
class CustomEmbeddingFunction {
  private MAX_BATCH_SIZE = 10;
  
  async generate(texts: string[]): Promise<number[][]> {
    // 10개씩 나눠서 Embedding API 호출
    if (texts.length > 10) {
      const allEmbeddings = [];
      
      for (let i = 0; i < texts.length; i += 10) {
        const batch = texts.slice(i, i + 10);
        const batchEmbeddings = await this.generateBatch(batch);
        allEmbeddings.push(...batchEmbeddings);
      }
      
      return allEmbeddings;
    }
    
    return this.generateBatch(texts);
  }
  
  private async generateBatch(texts: string[]): Promise<number[][]> {
    // Embedding 서버 (localhost:8001)에 요청
    const response = await fetch(`${this.embedUrl}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts })
    });
    
    const data = await response.json();
    return data.embeddings;  // [[0.1, 0.2, ...], [0.3, 0.4, ...]]
  }
}
```

**Embedding**:
- 각 청크 텍스트 → 벡터 (예: 768차원)
- 시맨틱 유사도 계산 가능
- 예: "user authentication" 검색 시 "login", "auth" 관련 코드 찾음

---

## 🔍 심화: Vector DB 작동 원리

### ❓ 핵심 질문들

1. **파일 단위가 아니라 청크 단위로 검색하나요?**
   - ✅ **네, 청크 단위입니다!**
   - 파일 전체를 검색하면 너무 크고 불필요한 코드까지 포함됨
   - 청크 단위로 검색하면 **정확히 필요한 부분만** 찾을 수 있음

2. **의미 유사도를 어떻게 저장하나요?**
   - **저장하지 않습니다!** 
   - 대신 **숫자 벡터(Embedding)**를 저장합니다
   - 유사도는 **검색할 때 계산**합니다

3. **LLM 없이 어떻게 의미를 판단하나요?**
   - **Embedding 모델**을 사용합니다 (LLM과는 다름)
   - 텍스트 → 숫자 벡터로 변환하는 **특수 모델**
   - 벡터 간 거리 = 의미적 유사도

---

### 📦 Vector DB 저장 과정 (상세)

#### 1단계: 청크 생성
```typescript
// 파일: src/auth/login.ts (50줄)
파일 전체 X  →  청크 3개 O

청크 1: "import { hashPassword } from './utils';\n\nexport async function login..."
청크 2: "const user = await db.findUser(username);\nconst isValid = ..."
청크 3: "return isValid ? createToken(user) : null;\n}"
```

#### 2단계: Embedding 생성 (텍스트 → 벡터)
```typescript
// Embedding API 호출 (localhost:8001)
POST /embed
{
  "texts": [
    "import { hashPassword } from './utils';\n\nexport async function login...",
    "const user = await db.findUser(username);\nconst isValid = ...",
    "return isValid ? createToken(user) : null;\n}"
  ]
}

// 응답
{
  "embeddings": [
    [0.15, 0.22, -0.05, 0.31, ..., 0.79],  // 768개 숫자 (청크 1)
    [0.13, 0.25, -0.03, 0.28, ..., 0.81],  // 768개 숫자 (청크 2)
    [0.11, 0.19, -0.08, 0.25, ..., 0.76]   // 768개 숫자 (청크 3)
  ]
}
```

**Embedding이란?**
- 텍스트의 **의미를 숫자로 표현**한 것
- 768차원 공간의 한 점
- 비슷한 의미 = 가까운 위치
- 다른 의미 = 먼 위치

**예시: 2차원으로 단순화**
```
Y축
│
│  • "login"
│  • "authenticate" 
│  • "signin"
│
│              • "database"
│              • "query"
│
│                          • "button"
│                          • "click"
└─────────────────────────────── X축
```

#### 3단계: ChromaDB에 저장
```typescript
// ChromaDB는 3가지를 함께 저장
await collection.add({
  ids: ['proj-123-0', 'proj-123-1', 'proj-123-2'],
  
  // 원본 텍스트 (청크 내용)
  documents: [
    "import { hashPassword } from './utils';\n\nexport async function login...",
    "const user = await db.findUser(username);\nconst isValid = ...",
    "return isValid ? createToken(user) : null;\n}"
  ],
  
  // Embedding 벡터
  embeddings: [
    [0.15, 0.22, -0.05, ..., 0.79],  // 768개 숫자
    [0.13, 0.25, -0.03, ..., 0.81],
    [0.11, 0.19, -0.08, ..., 0.76]
  ],
  
  // 메타데이터
  metadatas: [
    { filePath: 'src/auth/login.ts', chunkIndex: 0, branch: 'main' },
    { filePath: 'src/auth/login.ts', chunkIndex: 1, branch: 'main' },
    { filePath: 'src/auth/login.ts', chunkIndex: 2, branch: 'main' }
  ]
});
```

**실제 저장 구조** (개념적):
```
┌─────────────────────────────────────────────────────────────┐
│ ChromaDB Collection: "my-project"                           │
├─────────────────────────────────────────────────────────────┤
│ ID           │ Embedding (768차원)  │ Document    │ Metadata│
├─────────────────────────────────────────────────────────────┤
│ proj-123-0   │ [0.15, 0.22, ...]   │ "import..." │ {file:..}│
│ proj-123-1   │ [0.13, 0.25, ...]   │ "const..."  │ {file:..}│
│ proj-123-2   │ [0.11, 0.19, ...]   │ "return..." │ {file:..}│
│ proj-124-0   │ [0.88, -0.12, ...]  │ "function..."│ {file:..}│
│ proj-124-1   │ [0.75, 0.05, ...]   │ "export..." │ {file:..}│
│ ...          │ ...                 │ ...         │ ...     │
└─────────────────────────────────────────────────────────────┘
```

---

### 🔍 Vector DB 검색 과정 (상세)

#### 1단계: 쿼리 → Embedding 변환
```typescript
// 사용자 검색
const query = "user authentication code";

// 🔥 쿼리도 Embedding으로 변환!
POST /embed
{
  "texts": ["user authentication code"]
}

// 응답
{
  "embeddings": [
    [0.14, 0.21, -0.04, 0.30, ..., 0.78]  // 768개 숫자
  ]
}
```

#### 2단계: 벡터 유사도 계산 (Cosine Similarity)

```typescript
// ChromaDB가 자동으로 모든 청크와 비교
쿼리 벡터: [0.14, 0.21, -0.04, 0.30, ..., 0.78]

vs

청크 1 벡터: [0.15, 0.22, -0.05, 0.31, ..., 0.79]  → 유사도: 0.95 ✅
청크 2 벡터: [0.13, 0.25, -0.03, 0.28, ..., 0.81]  → 유사도: 0.88 ✅
청크 3 벡터: [0.11, 0.19, -0.08, 0.25, ..., 0.76]  → 유사도: 0.72
청크 4 벡터: [0.88, -0.12, 0.45, -0.10, ..., 0.15] → 유사도: 0.23 ❌
청크 5 벡터: [0.75, 0.05, 0.38, -0.05, ..., 0.20]  → 유사도: 0.31 ❌
...
```

**Cosine Similarity 계산 방법**:
```python
# 두 벡터의 각도로 유사도 계산
cosine_similarity(A, B) = (A · B) / (||A|| × ||B||)

# 예시 (2차원으로 단순화)
A = [0.14, 0.21]  # 쿼리
B = [0.15, 0.22]  # 청크 1

A · B = 0.14×0.15 + 0.21×0.22 = 0.0672
||A|| = √(0.14² + 0.21²) = 0.252
||B|| = √(0.15² + 0.22²) = 0.265

similarity = 0.0672 / (0.252 × 0.265) = 1.00 (완벽히 유사!)
```

**시각화** (2차원으로 단순화):
```
Y축
│
│  • B (청크 1: login)
│  • A (쿼리: authentication)
│    ↖ 각도가 작음 = 유사도 높음
│
│              • C (청크 4: database)
│                ↖ 각도가 큼 = 유사도 낮음
│
└─────────────────────────────── X축
```

#### 3단계: 상위 결과 반환
```typescript
// ChromaDB query 결과
const results = await collection.query({
  queryTexts: ["user authentication code"],
  nResults: 15,  // 상위 15개
  where: { type: 'codebase', branch: 'main' }
});

// 반환값 (유사도 높은 순)
[
  {
    id: 'proj-123-0',
    distance: 0.05,  // 거리가 작음 = 유사함
    score: 0.95,     // 1 / (1 + distance) = 유사도
    document: "import { hashPassword } from './utils';\n\nexport async function login...",
    metadata: { filePath: 'src/auth/login.ts', chunkIndex: 0 }
  },
  {
    id: 'proj-123-1',
    distance: 0.12,
    score: 0.88,
    document: "const user = await db.findUser(username);\nconst isValid = ...",
    metadata: { filePath: 'src/auth/login.ts', chunkIndex: 1 }
  },
  {
    id: 'proj-123-2',
    distance: 0.28,
    score: 0.72,
    document: "return isValid ? createToken(user) : null;\n}",
    metadata: { filePath: 'src/auth/login.ts', chunkIndex: 2 }
  },
  // ... 12개 더
]
```

---

### 🤖 Embedding 모델 vs LLM

**Embedding 모델** (예: `all-MiniLM-L6-v2`)
- **목적**: 텍스트 → 숫자 벡터
- **크기**: 작음 (~100MB)
- **속도**: 빠름 (~10ms)
- **출력**: 고정 길이 벡터 (768차원)
- **용도**: 검색, 분류, 클러스터링

**LLM** (예: Claude, GPT-4)
- **목적**: 텍스트 → 텍스트 (생성)
- **크기**: 큼 (~100GB)
- **속도**: 느림 (~1s)
- **출력**: 가변 길이 텍스트
- **용도**: 대화, 코드 생성, 분석

**전체 흐름**:
```
1. 인덱싱 시:
   코드 → [Embedding 모델] → 벡터 → [Vector DB 저장]

2. 검색 시:
   쿼리 → [Embedding 모델] → 벡터 → [Vector DB 검색] → 관련 청크

3. 코드 생성 시:
   관련 청크 → [LLM] → 새로운 코드
```

---

### 💡 왜 청크 단위로 검색하나?

#### 파일 단위의 문제
```typescript
// 파일 전체 (1000줄)
import React from 'react';
import { Button } from './Button';
... (990줄의 다른 코드) ...
function logout() { ... }  // ← 이것만 필요!
```

**문제점**:
1. 불필요한 코드 990줄 포함
2. LLM 컨텍스트 낭비
3. 검색 정확도 하락 (관련 없는 코드가 섞임)

#### 청크 단위의 장점
```typescript
// 청크 50 (10줄만)
function logout() {
  localStorage.removeItem('token');
  redirectToLogin();
}
export default logout;
```

**장점**:
1. ✅ 필요한 코드만 정확히
2. ✅ LLM 컨텍스트 효율적 사용
3. ✅ 검색 정확도 향상

---

### 🎯 실전 예시: "logout 버튼 추가" 요청

#### 1단계: Vector DB 검색 (LLM 사용 안 함)
```typescript
const query = "logout button implementation";

// Embedding 모델 (빠름, 10ms)
const queryEmbedding = await embedder.generate([query]);
// → [0.45, 0.32, -0.12, ...]

// Vector DB 검색 (자동 유사도 계산)
const results = await vectorDB.query(query, 'my-project', { k: 10 });

// 결과 (관련 청크만)
[
  { content: "function logout() {...}", score: 0.92, file: 'auth/logout.ts' },
  { content: "function redirectToLogin() {...}", score: 0.85, file: 'utils/redirect.ts' },
  { content: "<Button onClick={handleLogout}>...</Button>", score: 0.88, file: 'Header.tsx' },
  ...
]
```

#### 2단계: LLM에 전달 (이때만 LLM 사용)
```typescript
const prompt = `
User wants: Add logout button

Relevant code from codebase:
${results.map(r => `
File: ${r.metadata.filePath}
\`\`\`
${r.content}
\`\`\`
`).join('\n')}

Generate new logout button component based on existing patterns.
`;

const response = await llm.call(prompt);
// → 새로운 LogoutButton.tsx 생성
```

---

### 📊 비교: 키워드 검색 vs Vector 검색

| 검색어 | 키워드 검색 | Vector 검색 |
|--------|------------|-------------|
| "login" | ✅ "login" 함수만 | ✅ "login", "signin", "authenticate" 모두 |
| "authentication" | ❌ 정확히 "authentication"만 | ✅ "auth", "login", "verify" 포함 |
| "user database query" | ❌ 3단어 모두 포함된 것만 | ✅ "findUser", "getUserById" 등 의미 유사 |
| "버튼 클릭 이벤트" | ❌ 한글로 검색 불가 | ✅ "onClick", "handleClick" 찾음 |

**Vector 검색의 강력함**:
- 동의어 자동 인식
- 다국어 지원
- 의미적 유사성
- 컨텍스트 이해

---

### 🔑 핵심 요약

1. **저장**:
   - 청크 단위로 쪼갬 (15줄씩)
   - Embedding 모델로 벡터 변환 (768차원)
   - Vector DB에 저장 (벡터 + 원본 텍스트 + 메타데이터)

2. **검색**:
   - 쿼리도 벡터로 변환 (같은 Embedding 모델)
   - 모든 청크와 유사도 계산 (Cosine Similarity)
   - 상위 K개 반환 (유사도 높은 순)

3. **LLM은 언제?**:
   - ❌ 인덱싱 시: 사용 안 함
   - ❌ 검색 시: 사용 안 함
   - ✅ 코드 생성 시: 검색 결과를 받아 새 코드 생성

4. **왜 빠른가?**:
   - Embedding 모델: 작고 빠름 (~10ms)
   - 벡터 계산: 단순 수학 (행렬 곱셈)
   - 인덱싱: 미리 계산해서 저장

이제 Vector DB의 작동 원리가 명확해지셨나요? 🎉

---

### 5️⃣ 검색 및 활용

#### 검색 (Semantic Search)

```typescript
const results = await vectorDB.query(
  "user authentication logic",  // 검색 쿼리
  "my-project",                 // 프로젝트 (namespace)
  {
    k: 15,                      // 상위 15개 결과
    minScore: 0.6,              // 최소 유사도 0.6
    where: {
      $and: [
        { type: 'codebase' },
        { branch: 'main' }
      ]
    }
  }
);

// 결과
[
  {
    content: "function login(username, password) {...}",
    score: 0.85,
    metadata: {
      filePath: 'src/auth/login.ts',
      branch: 'main',
      chunkIndex: 0
    }
  },
  {
    content: "class AuthService {...}",
    score: 0.78,
    metadata: {
      filePath: 'src/services/AuthService.ts',
      branch: 'main',
      chunkIndex: 2
    }
  }
]
```

#### LLM 컨텍스트로 활용

```typescript
// Architect Agent가 코드 생성 시
const relevantCode = await vectorDB.query(
  userDirective,  // "Add logout button"
  project,
  { k: 15 }
);

// LLM 프롬프트에 포함
const prompt = `
User wants: ${userDirective}

Relevant code from codebase:
${relevantCode.map(r => `
File: ${r.metadata.filePath}
\`\`\`
${r.content}
\`\`\`
`).join('\n')}

Generate new code based on existing patterns...
`;
```

---

## 전체 예시: `src/App.tsx` 인덱싱

### 입력 파일
```typescript
// src/App.tsx (100 lines)
import React from 'react';

function App() {
  return <div>Hello</div>;
}

export default App;
```

### 처리 과정

```
1️⃣ CodebaseIndexer.indexFile()
   ↓ fs.readFileSync('src/App.tsx')
   ↓ content = "import React...\nexport default App;"

2️⃣ ChunkEngine.process()
   ↓ TextLoader: contentType = 'code'
   ↓ CodeSplitter: 100줄 < maxTokens(300) → 단일 청크
   
   청크 1개 생성:
   {
     text: "import React...",
     tokens: 75,
     metadata: {
       filePath: 'src/App.tsx',
       branch: 'main',
       commitHash: 'abc123'
     }
   }

3️⃣ ChromaMemoryAdapter.store()
   ↓ Embedding API: "import React..." → [0.1, 0.2, ..., 0.8] (768차원)
   ↓ ChromaDB.add()
   
   Vector DB에 저장:
   {
     id: 'my-project-1234567890-xyz-0',
     embedding: [0.1, 0.2, ..., 0.8],
     document: "import React...",
     metadata: { filePath: 'src/App.tsx', ... }
   }
```

### 검색 시

```typescript
// "React component" 검색
const results = await vectorDB.query("React component", "my-project");

// Vector 유사도 계산:
// query embedding: [0.15, 0.22, ..., 0.79]
// App.tsx embedding: [0.1, 0.2, ..., 0.8]
// cosine similarity: 0.95 (매우 유사!)

// 결과 반환:
[
  {
    content: "import React from 'react';\n\nfunction App() {...}",
    score: 0.95,
    metadata: { filePath: 'src/App.tsx' }
  }
]
```

---

## 요약: 핵심 포인트

### 1. **청킹 파이프라인의 목적**
   - 거대한 파일을 **검색 가능한 작은 조각**으로 분할
   - 각 청크는 **자체적으로 의미 있는 단위**
   - **오버랩**으로 컨텍스트 유지

### 2. **CodeSplitter의 역할**
   - 코드 파일을 **라인 기반**으로 분할
   - **단순하고 안전** (JSX/TSX에서도 작동)
   - 작은 파일은 **단일 청크**로 유지

### 3. **Vector DB의 역할**
   - 청크를 **벡터(Embedding)**로 변환
   - **시맨틱 검색** 가능 (키워드가 아닌 의미로 검색)
   - LLM에 **관련 코드 제공**

### 4. **메타데이터의 역할**
   - 파일 경로, 브랜치, 커밋 추적
   - **증분 인덱싱** 가능
   - **필터링** 및 **정렬** 기준

### 5. **메모리 최적화**
   - 파일 10개씩 배치 처리
   - Embedding 10개씩 API 호출
   - 청크 수 제한 (CodeSplitter 단순화)

이제 Vector DB 인덱싱 과정을 완전히 이해하셨나요? 🎉

