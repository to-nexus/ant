# Vector DB: Storage & Retrieval - Complete Guide

## 📋 Table of Contents

1. [Overview](#overview)
2. [Storage Strategy](#storage-strategy)
3. [Retrieval Strategy](#retrieval-strategy)
4. [Job-Specific Behavior](#job-specific-behavior)
5. [Comparison with Standard RAG](#comparison-with-standard-rag)
6. [Architecture Decisions](#architecture-decisions)

---

## Overview

### Purpose

Ant의 Vector DB는 **컨텍스트 기반 코드 생성**을 위한 지식 저장소입니다:

1. **Codebase Context**: 관련 코드 파일 검색
2. **Lessons**: 과거 작업에서 학습한 패턴
3. **Documents**: Design docs, PRD, Directives

### Multi-Collection Architecture

```
ChromaDB
│
├─ codebase-{project}      // Source code chunks
├─ documents-{project}     // Design, PRD, Directives
├─ lessons-{project}       // Problem-solution patterns
└─ context-{project}       // (Future) User preferences
```

**Design Rationale**:
- 표준 RAG 시스템과 동일한 multi-collection 전략
- 타입별 독립 검색 → 검색 품질 향상
- 각 컬렉션의 독립적인 확장 및 관리

---

## Storage Strategy

### 1. Codebase Collection (`codebase-{project}`)

#### **저장 시점**

| 트리거 | 시점 | 컴포넌트 |
|--------|------|----------|
| Learn Job | `ant learn [project]` 실행 시 | CodebaseIndexer |
| Git Push | Push 후 자동 인덱싱 | ProjectService.autoIndexCodebase() |
| Manual Index | `ant index [project]` 실행 시 | CodebaseIndexer |
| Project Init | 프로젝트 최초 생성 시 (선택적) | CodebaseIndexer |

#### **저장 내용**

```typescript
{
  type: 'codebase',
  content: "function login(username, password) { ... }",  // Code chunk
  metadata: {
    filePath: 'src/auth/login.ts',
    language: 'typescript',
    chunkType: 'function',
    branch: 'main',
    commit: 'abc1234',
    timestamp: '2025-11-29T...'
  }
}
```

#### **목적**

1. **Semantic Search**: 자연어 질의로 관련 코드 검색
2. **Context Loading**: LLM에게 관련 코드 전달
3. **Incremental Updates**: Git 변경사항 기반 점진적 업데이트

#### **처리 과정**

```
Source Code
    ↓
CodeSplitter (AST-based chunking)
    ↓
ChunkEngine (metadata annotation)
    ↓
EmbeddingFunction (semantic vectors)
    ↓
ChromaDB: codebase-{project}
```

---

### 2. Documents Collection (`documents-{project}`)

#### **저장 시점**

| 트리거 | 시점 | 컴포넌트 |
|--------|------|----------|
| Design Job Complete | Design doc 생성 후 | Design learn node → DocumentIndexer |
| Design Job Complete | PRD와 함께 저장 | Design learn node → DocumentIndexer |
| Code Job Start | Chat directive 입력 시 | Code resolve node → DocumentIndexer |
| Manual Import | (Future) PRD/Spec 임포트 시 | DocumentIndexer |

#### **저장 내용**

```typescript
// Design Document
{
  type: 'document',
  docType: 'design',
  content: "# Auth System Design\n\n## Architecture...",
  metadata: {
    title: 'Auth System Design',
    project: 'myapp',
    feature: 'auth',
    createdAt: '2025-11-29T...',
    lastModified: '2025-11-29T...',
    tags: ['auth', 'security', 'jwt'],
    version: '1.0',
    sourceType: 'generated'
  }
}

// PRD
{
  type: 'document',
  docType: 'prd',
  content: "# Product Requirements: Authentication\n...",
  metadata: {
    title: 'Product Requirements: Authentication',
    project: 'myapp',
    feature: 'auth',
    tags: ['requirements', 'auth'],
    version: '1.0',
    sourceType: 'user-provided'
  }
}

// Directive
{
  type: 'document',
  docType: 'directive',
  content: "Add OAuth2 support to login flow with Google provider",
  metadata: {
    title: 'Directive myapp-auth-2025-11-29T...',
    project: 'myapp',
    feature: 'auth',
    tags: ['add', 'oauth', 'api'],
    sourceType: 'user-provided'
  }
}
```

#### **목적**

1. **Design Reference**: 이전 설계 문서 검색 및 참조
2. **Requirements Context**: PRD 기반 구현 가이드
3. **Intent Tracking**: 사용자 의도 기록 및 검색

#### **중요 특징**

- ✅ **Full Content Storage**: Design doc과 PRD는 전체 내용 저장
- ✅ **Semantic Chunking**: 큰 문서는 자동 chunking
- ✅ **Version Tracking**: 버전 관리 가능 (future)

---

### 3. Lessons Collection (`lessons-{project}`)

#### **저장 시점**

| 트리거 | 시점 | 컴포넌트 |
|--------|------|----------|
| Code Task Complete | 각 task 완료 후 | Code learn node |
| Design Job Complete | Design 생성 후 | Design learn node |

#### **저장 내용**

```typescript
{
  type: 'lesson',
  content: `
## Lesson: Implement JWT Authentication

### Problem
User authentication needed with secure token-based approach...

### Solution
Generated 3 files using JWT + bcrypt pattern:
- auth/jwt.ts: Token generation
- middleware/auth.ts: Verification
- routes/auth.ts: Login endpoint

### Outcome
✅ Success - All checks passed on first attempt

### Patterns Applied
- jwt-authentication
- bcrypt-password-hashing
- express-middleware

### Mistakes Avoided
- None

### Related Files
- src/auth/jwt.ts
- src/middleware/auth.ts
- src/routes/auth.ts

### References
- Design: Auth System Design
- Directive: myapp-auth-turn-5

### Context
- Project: myapp
- Feature: auth
- Mode: generate
- Language: typescript
- Framework: express
  `,
  metadata: {
    project: 'myapp',
    feature: 'auth',
    task: 'code',
    timestamp: '2025-11-29T...',
    tags: ['jwt', 'auth', 'express'],
    relatedFiles: ['src/auth/jwt.ts', ...],
    sessionId: 'session-abc',
    turnId: 5
  }
}
```

#### **목적**

1. **Pattern Learning**: 성공/실패 패턴 학습
2. **Context Reuse**: 유사 작업 시 참고
3. **Knowledge Building**: 프로젝트별 지식 축적

#### **Key Design Principles**

- ✅ **Problem-Solution-Outcome**: 표준 지식 관리 형식
- ✅ **References Only**: 전체 내용 대신 참조 (< 1KB per lesson)
- ✅ **Actionable**: 즉시 적용 가능한 인사이트

---

### 4. Storage Comparison: Before vs After

#### **Before (OOM 발생)**

```
lessons-{project}
└─ Lesson {
     content: "## Code Generation Session\n
                **Design**: [... 10KB of full design doc ...]\n
                **PRD**: [... 5KB of full PRD ...]\n
                **Directive**: [... 3KB of full directive ...]\n
                **Plan**: [... 2KB of full plan ...]\n
                **Files**: [... file contents ...]"
   }

Size: 20-50KB per lesson
Result: OOM during embedding generation
```

#### **After (OOM 해결)**

```
documents-{project}
├─ Design doc (full, chunked) → 10KB
├─ PRD (full, chunked) → 5KB
└─ Directive (full, chunked) → 1KB

lessons-{project}
└─ Lesson {
     content: "Problem-Solution-Outcome + References"
   }

Size: < 1KB per lesson
Result: Stable, 90% memory reduction
```

---

## Retrieval Strategy

### Overview

```
User Request (Directive)
    ↓
CodebaseRetriever
    ↓
UnifiedSearchStrategy
    ↓
┌─────────────────────────────────────────────┐
│  Parallel Multi-Collection Search           │
├─────────────────────────────────────────────┤
│  1. codebase-{project}  → Code files        │
│  2. lessons-{project}   → Patterns          │
│  3. documents-{project} → Design/PRD (opt)  │
└─────────────────────────────────────────────┘
    ↓
Result Merging & Prioritization
    ↓
Context Assembly
    ↓
LLM Prompt
```

### Parallel Search

```typescript
// UnifiedSearchStrategy.search()
const [codeResults, lessonResults, documentResults] = await Promise.all([
  vectorDB.query(directive, project, {
    k: 30,
    minScore: 0.6,
    collectionType: 'codebase'
  }),
  
  vectorDB.query(directive, project, {
    k: 10,
    minScore: 0.5,
    collectionType: 'lessons'
  }),
  
  vectorDB.query(directive, project, {
    k: 5,
    minScore: 0.5,
    collectionType: 'documents'  // Optional
  })
]);
```

**Benefits**:
- ⚡ **Faster**: Parallel queries instead of sequential
- 🎯 **Better Relevance**: Type-specific embeddings
- 🔧 **Tunable**: Independent k and threshold per collection

---

## Job-Specific Behavior

### 1. Design Job

#### **Retrieval (resolve node)**

| Collection | Purpose | K | Min Score | Priority |
|------------|---------|---|-----------|----------|
| documents | Previous design docs | 3 | 0.6 | High |
| documents | Related PRDs | 2 | 0.5 | Medium |
| lessons | Design patterns | 3 | 0.5 | Low |
| codebase | ❌ Not used | - | - | - |

**Rationale**:
- Design job은 코드가 아닌 문서 생성
- 이전 design docs가 가장 중요
- Codebase 불필요 (새 설계이므로)

#### **Storage (learn node)**

```
Design Job Complete
    ↓
1. Save design doc to disk
    ↓
2. Index design doc → documents-{project}
    ↓
3. Index PRD → documents-{project}
    ↓
4. Extract lesson → lessons-{project}
```

**Lesson Format**:
- Problem: "Design authentication system"
- Solution: "JWT + OAuth2 pattern chosen"
- Outcome: "Success - comprehensive design"
- References: Design doc filename

---

### 2. Code Job - Generate Mode

#### **Retrieval (resolve node)**

| Collection | Purpose | K | Min Score | Priority |
|------------|---------|---|-----------|----------|
| documents | Design doc (full) | 1 | 0.7 | **Highest** |
| lessons | Similar patterns | 8 | 0.7 | High |
| codebase | Type definitions | 12 | 0.6 | Medium |
| documents | Directive (if chat) | 1 | 0.8 | Highest |

**Rationale**:
- Generate mode는 **새 코드 생성**
- Design doc이 가장 중요 (what to build)
- Lessons 많이 필요 (how to build)
- Codebase는 types만 (existing APIs)

#### **Retrieval Priority**

```
1. Design Document (100%)
   ↓ Must have - 전체 설계 이해
   
2. Lessons (80%)
   ↓ 유사 패턴 학습
   
3. Type Definitions (50%)
   ↓ API 호환성
   
4. Related Code (30%)
   ↓ 참고용
```

#### **Storage (learn node - each task)**

```
Task Complete
    ↓
1. Save files to disk
    ↓
2. Extract lesson
   - Problem: Task description
   - Solution: Files generated + approach
   - Outcome: Success/Partial/Failed
   - Patterns: jwt, express, etc.
   - References: Design doc title
    ↓
3. Store lesson → lessons-{project}
```

---

### 3. Code Job - Refactor Mode

#### **Retrieval (resolve node)**

| Collection | Purpose | K | Min Score | Priority |
|------------|---------|---|-----------|----------|
| codebase | Existing code (to refactor) | 20 | 0.5 | **Highest** |
| codebase | Dependencies | 15 | 0.5 | High |
| documents | Design doc | 1 | 0.6 | Medium |
| lessons | Refactor patterns | 3 | 0.6 | Low |

**Rationale**:
- Refactor mode는 **기존 코드 수정**
- Existing code가 가장 중요
- Dependencies 파악 필수 (import graph)
- Lessons는 참고용

#### **Retrieval Priority**

```
1. Target Code (100%)
   ↓ Must have - 수정할 코드
   
2. Dependencies (90%)
   ↓ Import graph 기반
   
3. Design Doc (40%)
   ↓ 전체 맥락 이해
   
4. Lessons (20%)
   ↓ 리팩토링 패턴
```

#### **Special: Git Diff Boost**

```typescript
// If git changes exist
const gitChanges = await git.getChangedFiles();

// Boost changed files to top priority
codeFiles = boostChangedFiles(codeFiles, gitChanges);

Priority:
1. Git-changed files (100%)
2. Vector search results (by score)
```

---

### 4. Code Job - Explain Mode

#### **Retrieval (resolve node)**

| Collection | Purpose | K | Min Score | Priority |
|------------|---------|---|-----------|----------|
| codebase | Target code (to explain) | 10 | 0.6 | **Highest** |
| documents | Design doc | 1 | 0.6 | High |
| codebase | Related code | 5 | 0.5 | Medium |
| lessons | ❌ Not used | - | - | - |

**Rationale**:
- Explain mode는 **코드 이해 및 설명**
- Target code만 집중적으로
- Design doc으로 의도 파악
- Lessons 불필요 (설명만 하므로)

#### **Retrieval Priority**

```
1. Target Code (100%)
   ↓ 설명할 코드
   
2. Design Doc (60%)
   ↓ 설계 의도
   
3. Related Code (30%)
   ↓ 전후 맥락
```

#### **Storage**

Explain mode는 **코드를 수정하지 않으므로** lesson을 저장하지 않습니다.

---

### 5. Learn Job

#### **Retrieval**

Learn Job은 **retrieval 없음**. Codebase를 디스크에서 직접 읽어 인덱싱합니다.

#### **Storage**

```
ant learn [project]
    ↓
1. Scan codebase directory
    ↓
2. Filter files (exclude node_modules, etc.)
    ↓
3. For each file:
   - Read content
   - AST parsing (if code)
   - Split into chunks
   - Generate embeddings
    ↓
4. Store to codebase-{project}
```

**특징**:
- ✅ Incremental indexing (Git-based)
- ✅ Smart filtering (only source files)
- ✅ Parallel processing (batch embeddings)

---

## Comparison with Standard RAG

### 1. Collection Structure

#### **Standard RAG Systems**

```
Pinecone:
├─ index-documents
├─ index-code
└─ index-metadata

Weaviate:
├─ class Documents
├─ class Code
└─ class Knowledge

Qdrant:
├─ collection documents
├─ collection code
└─ collection knowledge
```

#### **Ant (This System)**

```
ChromaDB:
├─ codebase-{project}    // Similar to "code"
├─ documents-{project}   // Similar to "documents"
├─ lessons-{project}     // Unique: Problem-solution patterns
└─ context-{project}     // Future: User preferences
```

**Similarities**:
- ✅ Multi-collection architecture (표준 접근)
- ✅ Type-based separation
- ✅ Independent scaling

**Differences**:
- ✨ **Project-scoped collections**: Isolation per project
- ✨ **Lessons collection**: Not standard in RAG (knowledge management)
- ✨ **Problem-Solution-Outcome**: Structured learning format

---

### 2. Retrieval Strategy

#### **Standard RAG**

```
User Query
    ↓
Embedding Model
    ↓
Vector Search (Single Collection)
    ↓
Top K Results
    ↓
Reranking (optional)
    ↓
LLM Context
```

**Characteristics**:
- Single-stage retrieval
- Usually one collection per query
- Post-filtering by metadata

#### **Ant (This System)**

```
User Directive
    ↓
Mode Inference (generate/refactor/explain)
    ↓
Parallel Multi-Collection Search
    ├─> codebase-{project}
    ├─> lessons-{project}
    └─> documents-{project}
    ↓
Git Diff Boost (if refactor mode)
    ↓
Priority Merge
    ↓
Import Graph Boost (if available)
    ↓
Context Assembly
    ↓
LLM Context
```

**Differences**:
- ✨ **Mode-aware retrieval**: Different strategy per mode
- ✨ **Parallel multi-collection**: Query 3 collections simultaneously
- ✨ **Git-aware boosting**: Priority to changed files
- ✨ **Import graph integration**: Boost dependencies

---

### 3. Storage Strategy

#### **Standard RAG**

```
Document Upload
    ↓
Text Splitting (fixed size)
    ↓
Embedding Generation
    ↓
Store to Vector DB
```

**Characteristics**:
- Fixed-size chunking (e.g., 512 tokens)
- No semantic awareness
- Store-and-forget

#### **Ant (This System)**

```
Code/Document Generation
    ↓
Semantic Chunking (AST/Markdown-aware)
    ↓
Metadata Annotation (project, feature, task)
    ↓
Collection Resolution (by type)
    ↓
Embedding Generation (batched)
    ↓
Store to Appropriate Collection
```

**Differences**:
- ✨ **Semantic chunking**: AST-based for code, Markdown for docs
- ✨ **Rich metadata**: Project, feature, task tracking
- ✨ **Automatic collection routing**: By metadata.type
- ✨ **Incremental updates**: Git-based diff detection

---

### 4. Context Window Management

#### **Standard RAG**

```
Token Budget: Fixed (e.g., 4K tokens)
Strategy: Top K by score

Result:
- Top 10 chunks (regardless of type)
- May be all code or all docs
```

#### **Ant (This System)**

```
Token Budget: Dynamic (by mode)
Strategy: Typed allocation

Generate Mode (100K tokens):
- Design doc: 20K tokens (full)
- Lessons: 8 lessons × 2K = 16K tokens
- Codebase: 12 files × 3K = 36K tokens
- Reserve: 28K tokens

Refactor Mode (100K tokens):
- Codebase: 20 files × 4K = 80K tokens
- Design doc: 10K tokens (summary)
- Lessons: 3 lessons × 2K = 6K tokens
- Reserve: 4K tokens
```

**Differences**:
- ✨ **Mode-aware allocation**: Different budgets per type
- ✨ **Typed quotas**: Guaranteed representation
- ✨ **Dynamic adjustment**: By task complexity

---

### 5. Learning & Feedback

#### **Standard RAG**

```
User Interaction
    ↓
Query Logs (tracking)
    ↓
No automatic learning
```

**Learning**: Manual (retrain embeddings periodically)

#### **Ant (This System)**

```
Task Completion
    ↓
Automatic Lesson Extraction
    ├─ Problem identified
    ├─ Solution applied
    └─ Outcome measured
    ↓
Store to lessons-{project}
    ↓
Available for future tasks
```

**Learning**: **Automatic and Immediate**

**Differences**:
- ✨ **Continuous learning**: Every task generates lesson
- ✨ **Structured format**: Problem-Solution-Outcome
- ✨ **Immediate availability**: Next task can use it

---

## Architecture Decisions

### 1. Why Multi-Collection?

**Decision**: Separate collections by type

**Rationale**:
- Industry standard (Pinecone, Weaviate, Qdrant all use it)
- Better search quality (type-specific embeddings)
- Independent scaling and management
- Clear separation of concerns

**Trade-offs**:
- ✅ Pro: Better relevance, faster search
- ❌ Con: More complex queries (but manageable)

---

### 2. Why Problem-Solution-Outcome Format?

**Decision**: Structured lesson format instead of free text

**Rationale**:
- Standard knowledge management format
- Case-based reasoning principle
- Clear, actionable insights
- Easy to search and filter

**Trade-offs**:
- ✅ Pro: Structured, searchable, actionable
- ✅ Pro: Smaller size (< 1KB vs 50KB)
- ❌ Con: More rigid format (but beneficial)

---

### 3. Why References Instead of Full Content?

**Decision**: Lessons reference documents, don't embed them

**Rationale**:
- Database normalization principle
- Avoid duplication
- Smaller lesson size (OOM prevention)
- Single source of truth

**Trade-offs**:
- ✅ Pro: No duplication, consistent updates
- ✅ Pro: 90% memory reduction
- ❌ Con: Need to lookup references (but fast)

---

### 4. Why Mode-Aware Retrieval?

**Decision**: Different retrieval strategy per mode

**Rationale**:
- Different modes have different needs
- Generate: Needs design + patterns
- Refactor: Needs existing code + dependencies
- Explain: Needs target code only

**Trade-offs**:
- ✅ Pro: Better context relevance
- ✅ Pro: Efficient token usage
- ❌ Con: More complex logic (but worth it)

---

### 5. Why Git-Aware Boosting?

**Decision**: Boost files with uncommitted changes

**Rationale**:
- Changed files are likely the focus
- Refactor mode especially benefits
- Real-world developer workflow

**Trade-offs**:
- ✅ Pro: Much better context in refactor mode
- ✅ Pro: Matches developer intent
- ❌ Con: Requires Git integration (already have)

---

## Summary: Key Principles

### Storage

1. **Type-based Collections**: 각 타입별 독립 컬렉션
2. **Semantic Chunking**: AST/Markdown aware
3. **Rich Metadata**: Project, feature, task tracking
4. **Incremental Updates**: Git-based diff detection
5. **Problem-Solution-Outcome**: Structured lesson format

### Retrieval

1. **Parallel Multi-Collection**: 동시 검색으로 속도 향상
2. **Mode-Aware Strategy**: 모드별 최적화된 검색
3. **Git-Aware Boosting**: 변경 파일 우선순위
4. **Import Graph Integration**: 의존성 boost
5. **Typed Token Allocation**: 타입별 토큰 할당

### Comparison with Standard RAG

| Aspect | Standard RAG | Ant System |
|--------|--------------|------------|
| Collections | Single or few | Multi (by project) |
| Chunking | Fixed-size | Semantic (AST/MD) |
| Retrieval | Single-stage | Multi-stage (parallel) |
| Learning | Manual | Automatic (continuous) |
| Context | Top K by score | Mode-aware typed allocation |
| Git Integration | None | Full (diff-aware) |

**결론**: Ant는 표준 RAG의 원칙을 따르면서도, **code generation 특화** 기능을 추가한 시스템입니다.

---

## Appendix: Collection Metadata Schema

### Codebase

```typescript
{
  type: 'codebase',
  filePath: string,
  language: string,
  chunkType: 'function' | 'class' | 'import' | 'export',
  branch: string,
  commit: string,
  timestamp: string,
  project: string,
  feature?: string
}
```

### Documents

```typescript
{
  type: 'document',
  docType: 'design' | 'prd' | 'directive' | 'spec',
  title: string,
  project: string,
  feature?: string,
  version?: string,
  createdAt: string,
  lastModified: string,
  sourcePath?: string,
  sourceType: 'generated' | 'user-provided' | 'imported',
  tags: string[]
}
```

### Lessons

```typescript
{
  type: 'lesson',
  task: 'code' | 'design',
  project: string,
  feature: string,
  timestamp: string,
  tags: string[],
  relatedFiles: string[],
  sessionId?: string,
  turnId?: number
}
```

---

**Document Version**: 1.0
**Last Updated**: 2025-11-29
**Status**: Complete and Production-Ready

