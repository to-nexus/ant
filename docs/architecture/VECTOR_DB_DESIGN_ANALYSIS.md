# Vector DB Design Analysis & Recommendations

## 🔍 현재 구조

### 1. 저장되는 데이터 타입
현재 Vector DB에 저장되는 데이터:
```typescript
type StoredDocumentType = 'codebase' | 'lesson';

// Codebase (코드 청크)
{
  content: "function foo() { ... }",
  metadata: {
    type: 'codebase',
    filePath: 'src/utils/foo.ts',
    language: 'typescript',
    // ...
  }
}

// Lesson (학습 내용)
{
  content: "## Code Generation Session\n**Project**: ant-pong\n...",
  metadata: {
    type: 'lesson',
    task: 'code',
    project: 'ant-pong',
    feature: 'skeleton',
    taskName: 'setup-nextjs-project',
    // PROBLEM: design doc, planText, directive 등이 포함됨
  }
}
```

### 2. 현재 Lesson에 포함되는 내용
**문제점**: `extractCodeLessons()`가 다음을 모두 포함:
- ✅ Implementation Plan 요약 (500자로 제한)
- ❌ Design Document 전체 내용 (수 KB~수십 KB)
- ❌ Directive 전체 내용 (최대 2000자)
- ✅ Files Generated 목록
- ✅ Quality Issues
- ✅ Patterns Applied

**OOM 발생 원인**:
- Design doc이 매우 클 수 있음 (10KB+)
- Directive도 클 수 있음 (chat history 포함 시)
- 이들이 lesson에 포함되어 Vector DB에 저장됨
- Embedding 생성 시 메모리 폭발

---

## 🌍 일반적인 Vector DB 설계 원칙

### 1. Document Type Segregation (문서 타입 분리)
**RAG (Retrieval-Augmented Generation) 시스템의 표준 접근법**:

```
Collection Strategy:
├─ Code Collection (코드베이스)
│  ├─ Source code chunks
│  └─ API documentation
├─ Document Collection (문서)
│  ├─ PRD (Product Requirements)
│  ├─ Design documents
│  └─ Technical specifications
├─ Knowledge Collection (지식/경험)
│  ├─ Lessons learned
│  ├─ Best practices
│  └─ Anti-patterns
└─ Context Collection (실행 컨텍스트)
   ├─ User preferences
   ├─ Session history
   └─ Recent decisions
```

**이점**:
- 검색 시 타입별 독립적 쿼리 가능
- 타입별 다른 임베딩 모델 사용 가능
- 메모리 효율적 (필요한 것만 로드)

### 2. Lesson의 본질
**Lesson이 저장해야 하는 것**:
```
✅ SHOULD Include:
- What was the problem/task?
- What solution was applied?
- Why did it work (or not work)?
- What patterns/techniques were used?
- What mistakes were avoided?
- Contextual tags for retrieval

❌ SHOULD NOT Include:
- Full design documents → Separate collection
- Full PRD → Separate collection
- Full directives → Separate collection or reference only
- Full code → Already in codebase collection
```

**Lesson 예시 (Good)**:
```markdown
## Lesson: React State Management with Zustand

**Context**: Building a real-time chat UI with multiple tabs
**Problem**: Global state updates not reflecting across tabs
**Solution**: Used Zustand with SSE event handlers
**Why it worked**: Zustand's subscriptions work across components
**Pattern**: Event-driven state updates
**Mistakes avoided**: Avoided React Context (re-render issues)
**Tags**: react, state-management, zustand, real-time, sse

**Related Files**: src/domain/store/index.ts
**Design Reference**: [fe-system-design.md#state-management]
```

---

## 🎯 권장 설계

### Option 1: Multi-Collection Strategy (권장)
```typescript
// 4개의 독립적인 컬렉션
Collections:
1. codebase-{project}     // 코드 청크
2. documents-{project}    // PRD, Design docs, Specs
3. lessons-{project}      // 실제 경험/패턴
4. context-{project}      // Session, preferences (선택)

// Lesson 구조 (최소화)
interface Lesson {
  // Core lesson content
  summary: string;           // 200자 이내
  problem: string;           // 문제 정의
  solution: string;          // 해결 방법
  outcome: string;           // 결과 (성공/실패)
  patterns: string[];        // 적용된 패턴
  antipatterns: string[];    // 피한 안티패턴
  
  // References (NOT full content)
  relatedFiles: string[];
  designRef: string;         // 파일명만 (내용 X)
  directiveRef: string;      // ID만 (내용 X)
  
  // Metadata
  tags: string[];
  taskType: string;
  timestamp: string;
}

// Document 구조 (별도 컬렉션)
interface Document {
  type: 'prd' | 'design' | 'directive' | 'spec';
  title: string;
  content: string;           // Full content OK here
  version: string;
  lastModified: string;
  tags: string[];
}
```

### Option 2: Metadata Filtering (현재 구조 개선)
```typescript
// 단일 컬렉션, metadata로 구분
type DocumentType = 'codebase' | 'lesson' | 'document';

metadata: {
  type: 'document',
  docType: 'design' | 'prd' | 'directive',
  // ...
}

// 검색 시 필터링
vectorDB.query(query, project, {
  where: { type: 'lesson' }  // Lesson만
});

vectorDB.query(query, project, {
  where: { type: 'document', docType: 'design' }  // Design만
});
```

---

## 📋 구현 우선순위

### Phase 1: Immediate (OOM 해결)
- [x] Lesson에서 design/directive 전체 내용 제거
- [ ] Design doc/PRD를 별도 컬렉션에 저장
- [ ] Lesson은 **reference only** (파일명/ID만)

### Phase 2: Refactoring (구조 개선)
- [ ] Multi-collection 구조로 전환
- [ ] Lesson 구조 재설계 (problem-solution-outcome)
- [ ] Document 컬렉션 추가 (design, prd, directives)

### Phase 3: Enhancement (검색 개선)
- [ ] 타입별 검색 가중치 조정
- [ ] Cross-collection 검색 (lesson → design 참조)
- [ ] Lesson 품질 평가 시스템

---

## 🔥 핵심 인사이트

### 1. Lesson의 본질
**Lesson ≠ Session Dump**
- ❌ 현재: Session state 전체를 텍스트로 변환
- ✅ 목표: 문제-해결-패턴-결과의 구조화된 지식

### 2. 참조 vs 포함
**"Don't repeat yourself" in Vector DB**:
- Design doc → 별도 저장, lesson에서 참조
- PRD → 별도 저장, lesson에서 참조
- Codebase → 이미 별도 저장, lesson에서 참조

### 3. 검색 효율성
**타입별 검색 특성**:
- Code: 정확한 매칭 (함수명, API)
- Document: 개념적 매칭 (요구사항, 스펙)
- Lesson: 경험 매칭 (유사한 문제 해결)

각각 다른 검색 전략이 필요함!

---

## 💡 제안

### 즉시 적용 (OOM 해결)
```typescript
// learn.ts - extractCodeLessons() 수정
function extractCodeLessons(state: ArchitectGraphState): string {
  return `
## Lesson: ${state.currentTask?.name}

**Problem**: ${state.directive?.substring(0, 200)}
**Solution**: Generated ${state.files.length} files
**Outcome**: ${state.violations.length === 0 ? 'Success' : 'Partial success'}

**Patterns Applied**:
${extractPatterns(state)}

**Files**: ${state.files.slice(0, 5).map(f => f.path).join(', ')}
**Design**: [Reference: ${extractDesignFileName(state)}]
**Quality**: ${state.retries} retries, ${state.violations.length} issues

**Tags**: ${extractTags(lessons, state.directive)}
  `.trim();
}

// 최대 1KB로 제한
```

### 중기 적용 (구조 개선)
- Design doc indexer 추가
- PRD indexer 추가
- Lesson에서 참조만 저장

---

## 🎓 결론

**현재 문제**:
- Lesson이 "session dump"가 됨
- Design/PRD/Directive가 중복 저장됨
- 메모리 비효율 + 검색 노이즈

**Vector DB 표준과의 차이**:
- ❌ 표준: 문서 타입별 컬렉션 분리
- ❌ 표준: Lesson = 구조화된 지식
- ✅ 우리: 모든 것을 lesson에 포함

**권장 방향**:
1. 즉시: Lesson 크기 최소화 (reference only)
2. 중기: Multi-collection 구조
3. 장기: Lesson 품질 향상 (LLM 자동 추출)

