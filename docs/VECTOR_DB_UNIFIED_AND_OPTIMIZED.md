# Vector DB 타입 통합 및 프롬프트 최적화 완료

**작업 날짜**: 2025-11-27  
**상태**: ✅ 완료

---

## 📋 작업 요약

### 1. **용어 변경: `learning` → `lesson`**

**이유**:
- `learning`은 동명사로 의미가 모호함 (배우는 것? 배운 것?)
- `lesson`은 명사로 명확하며, "lessons learned"는 업계 표준 용어
- 일반적이고 이해하기 쉬움

**변경 범위**:
- ✅ Vector DB 메타데이터: `type: 'lesson'`
- ✅ 함수명: `storeLearnings` → `storeLessons` (+ legacy alias)
- ✅ 변수명: `learnings` → `lessons`
- ✅ State 인터페이스: `lessons: string[]`
- ✅ 프롬프트 템플릿: "Previous Lessons"

**영향받은 파일**:
- `packages/ant-cli/src/agents/architect/memory/storage.ts`
- `packages/ant-cli/src/agents/architect/memory/index.ts`
- `packages/ant-cli/src/core/chunk/types.ts`
- `packages/ant-cli/src/agents/architect/graph/*/nodes/learn.ts`
- 기타 graph state 파일들

---

## 🔄 2. **Vector DB 통합 검색 (Phase 3)**

### 2.1 **UnifiedSearchStrategy 구현**

**파일**: `packages/ant-cli/src/core/codebase/strategies/UnifiedSearchStrategy.ts`

**핵심 기능**:
```typescript
async search(
  directive: string,
  project: string,
  deps: { vectorDB, git },
  options: {
    maxCodeFiles: 15,      // ✅ 30 → 15 감소
    maxLessons: 5,
    minCodeScore: 0.6,     // ✅ 높은 임계값
    minLessonScore: 0.5,
    includeGitChanges: true
  }
): Promise<{
  codeFiles: FileWithSource[];
  lessons: LessonResult[];
  stats: { ... };
}>
```

**특징**:
1. **단일 쿼리**: `codebase` + `lesson` 한 번에 검색 (성능 개선)
2. **유사도 기반 자동 우선순위**: 점수 순으로 자동 정렬
3. **Git 변경사항 Boost**: 로컬 변경 파일 우선순위 상승
4. **관련성 필터링**: 임계값 이상만 선택

### 2.2 **CodebaseRetriever 업데이트**

**변경사항**:
- `VectorSearchStrategy`, `KeywordSearchStrategy`, `HybridStrategy` 제거
- `UnifiedSearchStrategy` 단일 전략 사용
- `maxFiles` 기본값: 30 → 15 (토큰 최적화)
- 반환 타입에 `lessons` 추가

**파일**: `packages/ant-cli/src/core/codebase/CodebaseRetriever.ts`

---

## 🏷️ 3. **Lesson 메타데이터 강화**

### 3.1 **storeLessons 함수 개선**

**파일**: `packages/ant-cli/src/agents/architect/memory/storage.ts`

**추가된 메타데이터**:
```typescript
{
  type: "lesson",
  project,
  feature,
  timestamp,
  // ✅ NEW
  relatedFiles: string[],     // 관련 파일 목록
  tags: string[],              // 자동 추출 태그
  directive: string,           // 원본 지시문
  taskType: string,            // 작업 유형
  branch: string               // Git 브랜치
}
```

### 3.2 **extractTags 함수 추가**

**파일**: `packages/ant-cli/src/agents/architect/graph/code/nodes/learn.ts`

**기능**:
- lessons와 directive에서 키워드 추출
- 25개 주요 키워드 목록 (auth, api, database, react, etc.)
- 자동 태깅으로 검색 정확도 향상

---

## 🎯 4. **프롬프트 토큰 최적화**

### 4.1 **우선순위 기반 필터링**

**파일**: `packages/ant-cli/src/core/prompt/engine/TemplateComposer.ts`

**formatLessons 함수**:
```typescript
private formatLessons(lessons) {
  // ✅ 점수 0.7 이상만 포함
  const relevantLessons = lessons.filter(l => l.score >= 0.7);
  
  return relevantLessons.map((lesson, idx) => {
    const tags = `[${lesson.tags.join(', ')}]`;
    const files = lesson.relatedFiles.slice(0, 3).join(', ');
    
    return `## Lesson ${idx + 1} (score: ${lesson.score}) ${tags}
${lesson.content}
Related files: ${files}`;
  }).join('\n\n---\n\n');
}
```

**효과**:
- ❌ 낮은 관련성 lessons 제거 (< 0.7)
- ✅ 고품질 lessons만 LLM에게 전달
- 📉 프롬프트 토큰 30-50% 감소 예상

### 4.2 **Lessons 템플릿 추가**

**파일**: `packages/ant-cli/src/core/prompt/templates/code/phases/execute/injections/lessons.md`

```markdown
# Previous Lessons from Similar Work

{{lessons}}

Use these lessons to:
- Avoid repeating past mistakes
- Follow established patterns
- Apply proven solutions
```

### 4.3 **ModeController 통합**

**파일**: `packages/ant-cli/src/core/prompt/engine/ModeController.ts`

```typescript
// ✅ Lessons injection (high priority)
if (context.lessons && context.lessons.length > 0) {
  injections.push(`${phasePrefix}/injections/lessons`);
}
```

---

## 🗑️ 5. **레거시 코드 제거**

### 5.1 **메모리 Retrieval 제거**

**확인사항**:
- ✅ `architect/memory/index.ts`의 `retrieve` 함수는 더 이상 import되지 않음
- ✅ Code job에서 별도의 memory retrieval 호출 없음
- ✅ 모든 retrieval은 `UnifiedSearchStrategy`로 통합

**결과**:
- 중복 Vector DB 쿼리 제거
- 코드 복잡도 감소
- 성능 개선 (1회 쿼리 vs 2-3회 쿼리)

### 5.2 **Legacy 전략들**

**제거된 클래스** (사용하지 않지만 파일은 유지):
- `VectorSearchStrategy` (단독 사용 x)
- `KeywordSearchStrategy` (단독 사용 x)
- `HybridStrategy` (병합 로직 x)

**Note**: 파일은 유지하되, `CodebaseRetriever`에서는 사용하지 않음. 향후 필요시 재사용 가능.

---

## 📊 6. **성능 개선 지표**

### Before (Phase 2):
```
Vector DB 쿼리:
  1. codebase 타입: 30개 파일
  2. lesson 타입: 10개 레슨
  (총 2회 쿼리, 40개 결과)

프롬프트 크기:
  - 코드: ~30 파일 × 500 토큰 = ~15K
  - 레슨: 10개 × 200 토큰 = ~2K
  (총 ~17K 토큰)
```

### After (Phase 3):
```
Vector DB 쿼리:
  1. 통합 검색: 15개 파일 + 5개 레슨
  (총 1회 쿼리, 20개 결과, 유사도 정렬)

프롬프트 크기:
  - 코드: ~15 파일 × 500 토큰 = ~7.5K
  - 레슨: ~3개 (0.7+ 점수) × 200 토큰 = ~600
  (총 ~8K 토큰, 50% 감소!)
```

### 효과:
- ⚡ **Vector DB 쿼리**: 2회 → 1회 (50% 감소)
- 📉 **프롬프트 토큰**: ~17K → ~8K (53% 감소)
- 🎯 **관련성**: 임계값 필터링으로 정확도 향상
- 💰 **비용**: LLM API 비용 40-50% 절감 예상

---

## 🔄 7. **데이터 흐름 (전체 파이프라인)**

### 7.1 **Lesson 저장 (Write Path)**

```
[Code Job - learn node]
  ↓
extractCodeLessons(state)
  ↓
extractTags(lessons, directive)  ← ✅ 자동 태깅
  ↓
ChunkEngine.process({
  content: lessons,
  metadata: {
    type: 'lesson',
    relatedFiles: [...],  ← ✅ 강화된 메타데이터
    tags: [...],
    directive, taskType, branch
  }
})
  ↓
ChromaDB.store([...chunks], project)
```

### 7.2 **Lesson 검색 및 사용 (Read Path)**

```
[Code Job - resolve node]
  ↓
CodebaseRetriever.retrieve(directive, ...)
  ↓
UnifiedSearchStrategy.search(directive, project, ...)  ← ✅ 통합 검색
  ├─ Vector DB Query (type: 'codebase' OR 'lesson')
  ├─ Filter by score (code >= 0.6, lesson >= 0.5)
  ├─ Git boost (changed files)
  └─ Return { codeFiles, lessons }
  ↓
state.lessons = [...lessons]
  ↓
[Code Job - codeGen node]
  ↓
PromptEngine.buildExecutePrompt({ ..., lessons })
  ↓
TemplateComposer.formatLessons(lessons)  ← ✅ 0.7+ 필터링
  ├─ Filter high-score lessons (>= 0.7)
  ├─ Format with tags, relatedFiles
  └─ Inject into prompt
  ↓
[LLM receives optimized lessons context]
```

---

## ✅ 8. **검증 체크리스트**

### 타입 안정성:
- [x] `LessonResult` 인터페이스 정의
- [x] `CodeContext` 타입에 `lessons` 추가
- [x] `AssembledContext` 타입에 `lessons` 추가
- [x] `RetrieveOptions` 타입에 `project` 추가

### 기능 통합:
- [x] `UnifiedSearchStrategy` 구현 및 테스트
- [x] `CodebaseRetriever`에서 사용
- [x] `resolve` 노드에서 lessons 전달
- [x] `codeGen` 노드에서 lessons 주입
- [x] `TemplateComposer`에서 렌더링

### 프롬프트:
- [x] `lessons.md` 템플릿 생성
- [x] `ModeController`에서 주입
- [x] `formatLessons` 함수 구현

### 레거시 제거:
- [x] 중복 memory retrieval 제거 확인
- [x] Legacy 전략 파일 유지 (재사용 가능)

---

## 🚀 9. **향후 개선 방향**

### Phase 4 (선택적):
1. **AST 기반 Chunking**
   - 현재: Regex 기반 코드 분리
   - 개선: Babel/TypeScript AST 파서 사용
   - 효과: 더 정확한 함수/클래스 단위 chunking

2. **Lesson 품질 점수**
   - 현재: 유사도 점수만 사용
   - 개선: Lesson 자체의 품질 점수 추가 (feedback 기반)
   - 효과: 더 신뢰성 높은 lessons 우선 제공

3. **Cross-Project Lessons**
   - 현재: 프로젝트별 격리
   - 개선: 유사 프로젝트 간 lessons 공유
   - 효과: 새 프로젝트에서도 lessons 활용

4. **Lesson Decay**
   - 현재: 모든 lessons 동일 가중치
   - 개선: 시간 경과에 따른 가중치 감소
   - 효과: 최신 lessons 우선 제공

---

## 📝 10. **사용 가이드**

### 개발자 체크리스트:

**Lesson이 잘 저장되는지 확인**:
```bash
# 1. Code job 실행
# 2. learn node에서 로그 확인:
🎓 [Async Learning] Queuing learning task...
✅ [Async Learning] N learning chunks stored to memory

# 3. Vector DB 확인 (Chroma Admin)
# type: 'lesson' 문서들 확인
```

**Lesson이 잘 검색되는지 확인**:
```bash
# 1. Code job 실행 (resolve node)
# 2. 로그 확인:
🔍 [Unified Search] Querying: "..."
   📊 Total results: N
   📁 Code results: M
   📚 Lesson results: K
   ✅ Selected: X code files, Y lessons
```

**프롬프트에 잘 주입되는지 확인**:
```bash
# 1. codeGen node 실행
# 2. 로그 확인:
[ModeController] Adding lessons injection
[TemplateComposer] Rendering injection: .../lessons
  ✅ Rendered (NNN chars)
```

---

## 🎉 완료!

모든 작업이 완료되었으며, `learning` → `lesson` 용어 변경과 함께 Phase 3 통합 검색 + 프롬프트 최적화가 성공적으로 적용되었습니다.

