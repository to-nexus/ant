# Vector DB Multi-Collection Refactoring Plan

## 🎯 목표

Single-collection → Multi-collection 구조로 전환하여:
1. **OOM 문제 해결**: Document 분리로 메모리 효율화
2. **검색 품질 향상**: 타입별 독립적 검색
3. **확장성 확보**: 새로운 document type 추가 용이

---

## 📊 현재 구조 vs 목표 구조

### 현재 (Single Collection)
```typescript
Collection: "{project}"
├─ Document (type: 'codebase')
│  ├─ filePath: "src/Login.tsx"
│  ├─ language: "typescript"
│  └─ content: "export function Login() { ... }"
└─ Document (type: 'lesson')
   ├─ taskName: "implement-login"
   ├─ content: "## Session\n**Design**: [...full design doc...]"
   └─ PROBLEM: design doc/PRD 전체가 포함됨
```

### 목표 (Multi-Collection)
```typescript
Collection: "codebase-{project}"
├─ Document
│  ├─ type: 'codebase'
│  ├─ filePath: "src/Login.tsx"
│  └─ content: "export function Login() { ... }"

Collection: "documents-{project}"
├─ Document (docType: 'design')
│  ├─ type: 'document'
│  ├─ docType: 'design'
│  ├─ title: "Login System Design"
│  └─ content: "# Design Document\n..."
├─ Document (docType: 'prd')
│  ├─ type: 'document'
│  ├─ docType: 'prd'
│  └─ content: "# PRD: User Authentication"
└─ Document (docType: 'directive')
   ├─ type: 'document'
   ├─ docType: 'directive'
   └─ content: "Implement login with OAuth2"

Collection: "lessons-{project}"
└─ Document
   ├─ type: 'lesson'
   ├─ taskName: "implement-login"
   ├─ problem: "Need secure authentication"
   ├─ solution: "Used bcrypt + JWT"
   ├─ outcome: "success"
   ├─ patterns: ["jwt-auth", "bcrypt-hash"]
   ├─ designRef: "login-system-design.md"  // Reference only
   └─ directiveRef: "directive-001"  // Reference only

Collection: "context-{project}" (Optional, 추후 확장)
└─ User preferences, session history...
```

---

## 🔄 영향 받는 컴포넌트

### 1. Storage (저장)
```
📦 Storage Points:
├─ CodebaseIndexer
│  └─ 변경: codebase-{project} 컬렉션 사용
├─ learn.ts (learn node)
│  ├─ 변경: lessons-{project} 컬렉션 사용
│  └─ 변경: lesson 구조 재설계 (problem-solution-outcome)
└─ DocumentIndexer (NEW!)
   ├─ Design doc → documents-{project}
   ├─ PRD → documents-{project}
   └─ Directive → documents-{project}
```

### 2. Retrieval (검색)
```
🔍 Retrieval Points:
├─ CodebaseRetriever
│  ├─ 변경: Multi-collection 검색
│  └─ 변경: Document 참조 해석
├─ UnifiedSearchStrategy
│  ├─ 변경: 3개 컬렉션 병렬 검색
│  └─ 변경: Cross-collection 참조 처리
├─ VectorSearchStrategy
│  └─ 변경: codebase-{project} 컬렉션 사용
├─ retrieveMemoryForAgent
│  └─ 변경: lessons-{project} 컬렉션 사용
└─ resolve nodes (design/code)
   └─ 변경: Document retrieval 추가
```

### 3. Core Infrastructure
```
🏗️ Infrastructure:
├─ MemoryPort (interface)
│  ├─ 추가: getCollectionName(type, project)
│  └─ 유지: store(), query(), delete() - 동일 시그니처
├─ ChromaMemoryAdapter
│  ├─ 추가: Collection name resolution 로직
│  └─ 변경: namespace → collectionType + project
└─ AdapterFactory
   └─ 유지: 변경 없음
```

---

## 📐 새로운 타입 정의

### 1. Collection Types
```typescript
// packages/ant-cli/src/core/types.ts

/**
 * Vector DB Collection Types
 */
export type CollectionType = 
  | 'codebase'     // Source code chunks
  | 'documents'    // Design docs, PRD, directives
  | 'lessons'      // Learned patterns, experiences
  | 'context';     // User preferences, session (future)

/**
 * Document Types (for 'documents' collection)
 */
export type DocumentType = 
  | 'design'       // Design documents
  | 'prd'          // Product requirements
  | 'directive'    // User directives/instructions
  | 'spec';        // Technical specifications

/**
 * Collection naming strategy
 */
export function getCollectionName(
  type: CollectionType, 
  project: string
): string {
  return `${type}-${project}`;
}
```

### 2. Lesson Structure (Redesigned)
```typescript
// packages/ant-cli/src/core/types.ts

/**
 * Lesson metadata (stored in Vector DB)
 */
export interface LessonMetadata {
  type: 'lesson';
  
  // Core lesson info
  taskName: string;
  taskType: string;
  
  // Context
  project: string;
  feature: string;
  branch: string;
  timestamp: string;
  
  // Problem-Solution-Outcome
  problemCategory: string;      // 'auth', 'api', 'ui', etc.
  solutionType: string;          // 'pattern', 'refactor', 'fix'
  outcome: 'success' | 'partial' | 'failure';
  
  // References (NOT full content)
  relatedFiles: string[];
  designRef?: string;            // File name only
  directiveRef?: string;         // ID only
  
  // Tags for retrieval
  tags: string[];
  patterns: string[];
  antipatterns: string[];
  
  // Session tracking
  sessionId?: string;
  turnId?: number;
}

/**
 * Lesson content structure
 */
export interface LessonContent {
  summary: string;              // 200 chars max
  problem: string;              // What was the issue?
  solution: string;             // How was it solved?
  outcome: string;              // What was the result?
  patternsApplied: string[];    // Patterns used
  mistakesAvoided: string[];    // Anti-patterns avoided
  relatedContext?: string;      // Optional context (500 chars max)
}
```

### 3. Document Metadata
```typescript
/**
 * Document metadata (for documents collection)
 */
export interface DocumentMetadata {
  type: 'document';
  docType: DocumentType;
  
  // Document info
  title: string;
  project: string;
  feature?: string;
  version?: string;
  
  // Timestamps
  createdAt: string;
  lastModified: string;
  
  // Source
  sourcePath?: string;          // Original file path
  sourceType: 'generated' | 'user-provided' | 'imported';
  
  // Tags
  tags: string[];
  relatedLessons?: string[];    // Lesson IDs that reference this
}
```

---

## 🛠️ 구현 단계

### Phase 1: Infrastructure (Core)
**목표**: Multi-collection 지원 기반 구축

```typescript
// 1.1 MemoryPort 확장
// packages/ant-cli/src/core/ports/MemoryPort.ts

export interface MemoryPort {
  /**
   * Store documents (collection auto-resolved from metadata.type)
   */
  store(
    documents: Array<{ content: string; metadata?: Record<string, any> }>, 
    project: string,
    collectionType?: CollectionType  // NEW: Optional explicit type
  ): Promise<void>;
  
  /**
   * Query documents (collection auto-resolved from options.where.type)
   */
  query(
    query: string, 
    project: string,
    options?: QueryOptions & {
      collectionType?: CollectionType;  // NEW: Explicit collection
    }
  ): Promise<QueryResult[]>;
  
  /**
   * Delete documents (collection auto-resolved from where.type)
   */
  delete(
    project: string, 
    where: Record<string, any>,
    collectionType?: CollectionType  // NEW: Explicit collection
  ): Promise<void>;
}
```

```typescript
// 1.2 ChromaMemoryAdapter 리팩토링
// packages/ant-cli/src/periphery/adapters/memory/ChromaMemoryAdapter.ts

export class ChromaMemoryAdapter implements MemoryPort {
  
  /**
   * Resolve collection name from type and project
   */
  private getCollectionName(
    project: string, 
    type: CollectionType = 'codebase'
  ): string {
    return `${type}-${project}`;
  }
  
  /**
   * Extract collection type from metadata or options
   */
  private extractCollectionType(
    metadata?: Record<string, any>,
    explicitType?: CollectionType
  ): CollectionType {
    if (explicitType) return explicitType;
    
    const metaType = metadata?.type;
    if (metaType === 'lesson') return 'lessons';
    if (metaType === 'document') return 'documents';
    if (metaType === 'codebase') return 'codebase';
    
    // Default fallback
    return 'codebase';
  }
  
  async store(
    documents: Array<{ content: string; metadata?: Record<string, any> }>, 
    project: string,
    collectionType?: CollectionType
  ): Promise<void> {
    // Group documents by collection type
    const grouped = new Map<CollectionType, typeof documents>();
    
    for (const doc of documents) {
      const type = this.extractCollectionType(doc.metadata, collectionType);
      if (!grouped.has(type)) {
        grouped.set(type, []);
      }
      grouped.get(type)!.push(doc);
    }
    
    // Store to each collection
    for (const [type, docs] of grouped.entries()) {
      const collectionName = this.getCollectionName(project, type);
      const collection = await client.getOrCreateCollection({ 
        name: collectionName, 
        embeddingFunction: embedder 
      });
      
      // Prepare data
      const contents: string[] = [];
      const metadatas: Record<string, any>[] = [];
      const ids: string[] = [];
      
      const timestamp = Date.now();
      const randomSeed = Math.random().toString(36).substring(7);
      
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        contents.push(doc.content);
        metadatas.push(doc.metadata || { type, timestamp: new Date().toISOString() });
        ids.push(`${collectionName}-${timestamp}-${randomSeed}-${i}`);
      }
      
      await collection.add({ documents: contents, metadatas, ids });
      
      console.log(`✅ Stored ${docs.length} documents to collection: ${collectionName}`);
    }
  }
  
  async query(
    query: string, 
    project: string,
    options?: QueryOptions & { collectionType?: CollectionType }
  ): Promise<QueryResult[]> {
    const type = options?.collectionType || 
                 this.extractCollectionType(options?.where);
    
    const collectionName = this.getCollectionName(project, type);
    
    try {
      const collection = await client.getOrCreateCollection({ 
        name: collectionName, 
        embeddingFunction: embedder 
      });
      
      const k = options?.k || 5;
      const where = options?.where;
      const minScore = options?.minScore || 0;
      
      const results = await collection.query({ 
        queryTexts: [query], 
        nResults: k,
        where: where as any
      });
      
      // ... rest of query logic (unchanged)
      
    } catch (error) {
      console.warn(`⚠️  Query failed for collection ${collectionName}:`, error);
      return [];
    }
  }
  
  async delete(
    project: string, 
    where: Record<string, any>,
    collectionType?: CollectionType
  ): Promise<void> {
    const type = collectionType || this.extractCollectionType(where);
    const collectionName = this.getCollectionName(project, type);
    
    // ... rest of delete logic (unchanged)
  }
}
```

### Phase 2: Document Indexer (NEW)
**목표**: Design/PRD/Directive를 documents 컬렉션에 저장

```typescript
// packages/ant-cli/src/core/documents/DocumentIndexer.ts

import { MemoryPort, ChunkPort } from '../ports';
import { DocumentType, DocumentMetadata } from '../types';

export interface DocumentIndexOptions {
  project: string;
  feature?: string;
  tags?: string[];
}

export class DocumentIndexer {
  constructor(
    private vectorDB: MemoryPort,
    private chunkEngine: ChunkPort
  ) {}
  
  /**
   * Index a design document
   */
  async indexDesignDoc(
    content: string,
    title: string,
    options: DocumentIndexOptions
  ): Promise<void> {
    await this.indexDocument(content, {
      docType: 'design',
      title,
      ...options
    });
  }
  
  /**
   * Index a PRD
   */
  async indexPRD(
    content: string,
    title: string,
    options: DocumentIndexOptions
  ): Promise<void> {
    await this.indexDocument(content, {
      docType: 'prd',
      title,
      ...options
    });
  }
  
  /**
   * Index a directive
   */
  async indexDirective(
    content: string,
    directiveId: string,
    options: DocumentIndexOptions
  ): Promise<void> {
    await this.indexDocument(content, {
      docType: 'directive',
      title: `Directive ${directiveId}`,
      ...options
    });
  }
  
  /**
   * Generic document indexing
   */
  private async indexDocument(
    content: string,
    params: {
      docType: DocumentType;
      title: string;
      project: string;
      feature?: string;
      tags?: string[];
    }
  ): Promise<void> {
    console.log(`📄 [DocumentIndexer] Indexing ${params.docType}: ${params.title}`);
    
    // Chunk the document
    const result = await this.chunkEngine.process({
      source: `document-${params.docType}`,
      sourceType: 'text',
      content,
      metadata: {
        type: 'document',  // Collection type
        docType: params.docType,
        title: params.title,
        project: params.project,
        feature: params.feature,
        tags: params.tags || [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        sourceType: 'generated'
      }
    });
    
    console.log(`   📚 Chunked into ${result.chunks.length} pieces`);
    
    // Convert to documents
    const documents = result.chunks.map(chunk => ({
      content: chunk.text,
      metadata: chunk.metadata
    }));
    
    // Store to documents collection
    await this.vectorDB.store(documents, params.project, 'documents');
    
    console.log(`   ✅ Indexed ${result.chunks.length} chunks to documents-${params.project}`);
  }
  
  /**
   * Delete a document
   */
  async deleteDocument(
    project: string,
    docType: DocumentType,
    title: string
  ): Promise<void> {
    await this.vectorDB.delete(
      project,
      { docType, title },
      'documents'
    );
    
    console.log(`   🗑️  Deleted document: ${title} (type: ${docType})`);
  }
}
```

### Phase 3: Lesson Extraction 재설계
**목표**: Lesson을 problem-solution-outcome 구조로 전환

```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/learn.ts

/**
 * Extract structured lessons (NEW FORMAT)
 */
function extractCodeLessons(state: ArchitectGraphState): string {
  // 1. Problem
  const problem = extractProblem(state);
  
  // 2. Solution
  const solution = extractSolution(state);
  
  // 3. Outcome
  const outcome = extractOutcome(state);
  
  // 4. Patterns
  const patterns = extractPatterns(state);
  
  // 5. Anti-patterns
  const antipatterns = extractAntipatterns(state);
  
  // 6. Build lesson content (structured)
  return `
## Lesson: ${state.currentTask?.name || 'Unknown'}

### Problem
${problem}

### Solution
${solution}

### Outcome
${outcome}

### Patterns Applied
${patterns.map(p => `- ${p}`).join('\n')}

### Mistakes Avoided
${antipatterns.map(a => `- ${a}`).join('\n')}

### Related Files
${state.files.slice(0, 5).map(f => `- ${f.path}`).join('\n')}

### References
- Design: ${extractDesignFileName(state)}
- Directive: ${extractDirectiveId(state)}

### Tags
${extractTags(problem + solution, state.directive || '').join(', ')}
  `.trim();
}

function extractProblem(state: ArchitectGraphState): string {
  // Extract from directive (max 300 chars)
  const directive = state.directive || 'No directive';
  return directive.substring(0, 300) + (directive.length > 300 ? '...' : '');
}

function extractSolution(state: ArchitectGraphState): string {
  const filesSummary = `Generated ${state.files.length} file(s)`;
  const deleteSummary = state.filesToDelete.length > 0 
    ? `, deleted ${state.filesToDelete.length} file(s)` 
    : '';
  
  return `${filesSummary}${deleteSummary}. Applied ${state.codeMode || 'generate'} mode.`;
}

function extractOutcome(state: ArchitectGraphState): string {
  if (state.violations.length === 0) {
    return '✅ Success - All quality checks passed on first attempt';
  } else if (state.retries > 0) {
    return `⚠️ Partial - Resolved ${state.violations.length} issue(s) after ${state.retries} retries`;
  } else {
    return `❌ Issues remain - ${state.violations.length} unresolved`;
  }
}

function extractAntipatterns(state: ArchitectGraphState): string[] {
  // Extract from violations
  const antipatterns: string[] = [];
  
  for (const v of state.violations.slice(0, 3)) {
    if (typeof v === 'string') {
      antipatterns.push(v.substring(0, 100));
    } else {
      antipatterns.push(`${v.type}: ${v.message}`.substring(0, 100));
    }
  }
  
  return antipatterns;
}

function extractDesignFileName(state: ArchitectGraphState): string {
  // Extract design file name from state (not full content)
  if (state.design) {
    // Try to find title from design content
    const titleMatch = state.design.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      return titleMatch[1];
    }
  }
  return 'Unknown design document';
}

function extractDirectiveId(state: ArchitectGraphState): string {
  // Generate directive ID from session
  const sessionId = (state as any).sessionId || 'unknown';
  const turnId = (state as any).turnId || 0;
  return `${sessionId}-${turnId}`;
}
```

### Phase 4: Retrieval 리팩토링
**목표**: Multi-collection 검색 구현

```typescript
// packages/ant-cli/src/core/codebase/strategies/UnifiedSearchStrategy.ts

export class UnifiedSearchStrategy {
  
  async search(
    directive: string,
    project: string,
    deps: {
      vectorDB: MemoryPort;
      git?: GitPort;
    },
    options: {
      maxCodeFiles: number;
      maxLessons: number;
      maxDocuments?: number;  // NEW
      minCodeScore: number;
      minLessonScore: number;
      minDocumentScore?: number;  // NEW
      includeGitChanges: boolean;
    }
  ): Promise<UnifiedSearchResult & { documents?: DocumentResult[] }> {
    
    console.log(`🔍 [Unified Search] Multi-collection query...`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. Parallel search across 3 collections
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const [codeResults, lessonResults, documentResults] = await Promise.all([
      // Code search
      deps.vectorDB.query(directive, project, {
        k: options.maxCodeFiles * 2,
        minScore: options.minCodeScore,
        collectionType: 'codebase'
      }),
      
      // Lesson search
      deps.vectorDB.query(directive, project, {
        k: options.maxLessons * 2,
        minScore: options.minLessonScore,
        collectionType: 'lessons'
      }),
      
      // Document search (NEW)
      options.maxDocuments 
        ? deps.vectorDB.query(directive, project, {
            k: options.maxDocuments * 2,
            minScore: options.minDocumentScore || 0.5,
            collectionType: 'documents'
          })
        : Promise.resolve([])
    ]);
    
    console.log(`   📊 Results: ${codeResults.length} code, ${lessonResults.length} lessons, ${documentResults.length} documents`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. Process each type
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    // Code (existing logic)
    const codeFiles = await this.processCodeResults(codeResults, deps.git, options);
    
    // Lessons (existing logic)
    const lessons = this.processLessonResults(lessonResults, options);
    
    // Documents (NEW)
    const documents = this.processDocumentResults(documentResults, options);
    
    return {
      codeFiles,
      lessons,
      documents,  // NEW
      stats: {
        totalCodeResults: codeResults.length,
        totalLessonResults: lessonResults.length,
        totalDocumentResults: documentResults.length,  // NEW
        avgCodeScore: this.avgScore(codeResults),
        avgLessonScore: this.avgScore(lessonResults),
        avgDocumentScore: this.avgScore(documentResults)  // NEW
      }
    };
  }
  
  private processDocumentResults(
    results: QueryResult[],
    options: any
  ): DocumentResult[] {
    return results
      .map(r => ({
        content: r.content,
        score: r.score,
        docType: r.metadata?.docType as DocumentType,
        title: r.metadata?.title || 'Untitled',
        metadata: r.metadata
      }))
      .slice(0, options.maxDocuments || 0);
  }
}
```

---

## 📋 Migration Strategy

### Option 1: Clean Start (권장)
```bash
# 1. Stop server
# 2. Clear ChromaDB data
rm -rf /path/to/chroma/data/*

# 3. Restart server (new collections will be created)
# 4. Re-index all projects
ant index [project]
```

### Option 2: Gradual Migration
```typescript
// Migration script
async function migrateToMultiCollection(project: string) {
  const oldCollection = await client.getCollection(project);
  const docs = await oldCollection.get();
  
  // Group by type
  const codeChunks = docs.filter(d => d.metadata.type === 'codebase');
  const lessons = docs.filter(d => d.metadata.type === 'lesson');
  
  // Store to new collections
  await vectorDB.store(codeChunks, project, 'codebase');
  await vectorDB.store(lessons, project, 'lessons');
  
  // Delete old collection
  await client.deleteCollection(project);
}
```

---

## ✅ Testing Plan

### Unit Tests
```typescript
describe('ChromaMemoryAdapter Multi-Collection', () => {
  it('should store to correct collection based on type', async () => {
    await adapter.store([
      { content: 'code', metadata: { type: 'codebase' } }
    ], 'test-project');
    
    // Verify stored in codebase-test-project
  });
  
  it('should query from correct collection', async () => {
    const results = await adapter.query(
      'test query', 
      'test-project', 
      { collectionType: 'lessons' }
    );
    
    // Verify queried from lessons-test-project
  });
});

describe('DocumentIndexer', () => {
  it('should index design document', async () => {
    await indexer.indexDesignDoc(
      '# Design\nContent...',
      'Test Design',
      { project: 'test' }
    );
    
    // Verify stored in documents-test
  });
});

describe('Lesson Extraction', () => {
  it('should extract problem-solution-outcome format', () => {
    const lesson = extractCodeLessons(mockState);
    
    expect(lesson).toContain('### Problem');
    expect(lesson).toContain('### Solution');
    expect(lesson).toContain('### Outcome');
  });
  
  it('should not include full design content', () => {
    const lesson = extractCodeLessons(mockState);
    
    expect(lesson.length).toBeLessThan(2000);
    expect(lesson).not.toContain('[...full design doc...]');
  });
});
```

### Integration Tests
```typescript
describe('End-to-End Multi-Collection', () => {
  it('should store and retrieve from all collections', async () => {
    // Store
    await codebaseIndexer.index(project);
    await documentIndexer.indexDesignDoc(...);
    await learnNode.execute(state);  // Stores lesson
    
    // Retrieve
    const result = await retriever.retrieve(directive, workingDir, deps);
    
    expect(result.codeFiles.length).toBeGreaterThan(0);
    expect(result.lessons.length).toBeGreaterThan(0);
    expect(result.documents.length).toBeGreaterThan(0);
  });
});
```

---

## 🎯 Success Metrics

1. **Memory Usage**: Learn node OOM 해결 확인
2. **Search Quality**: 타입별 검색 정확도 향상
3. **Performance**: Multi-collection 병렬 검색 성능
4. **Code Quality**: TypeScript 에러 0개, 모든 테스트 통과

---

## 📅 Implementation Timeline

- **Phase 1** (Infrastructure): 2-3 hours
- **Phase 2** (DocumentIndexer): 1-2 hours
- **Phase 3** (Lesson 재설계): 1-2 hours
- **Phase 4** (Retrieval 리팩토링): 2-3 hours
- **Testing & Migration**: 1-2 hours

**Total**: ~8-12 hours

---

## 🚀 Next Steps

1. ✅ Phase 1: MemoryPort + ChromaMemoryAdapter 리팩토링
2. Phase 2: DocumentIndexer 구현
3. Phase 3: Lesson extraction 재설계
4. Phase 4: UnifiedSearchStrategy 리팩토링
5. Migration + Testing

**시작합니다!** 🎉

