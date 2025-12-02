# 벡터 DB 검색 키워드 정규화 분석

## 🔍 현황 파악

### 1. Decompose 노드에서 벡터 DB 검색하는가?

**답변**: ❌ **NO** - Decompose는 벡터 DB를 **전혀 사용하지 않습니다**

```typescript
// decompose/index.ts
export async function decompose(state: ArchitectGraphState) {
  // 1. Session 복원 체크
  // 2. Design 문서 준비 (selectedDesignFiles 기반)
  // 3. LLM 호출 (task breakdown)
  // 4. TaskQueue 생성
  
  // ❌ 벡터 DB 검색 없음!
  // ❌ 파일 리스트 검색 없음!
}
```

**Decompose의 역할**:
- ✅ Directive → Task 분해
- ✅ Design 문서만 사용
- ✅ 코드베이스 검색 **안 함**

---

### 2. 벡터 DB 검색은 어디서 하는가?

**답변**: ✅ **Resolve 노드에서만 검색**

#### Resolve 노드 (Line 282-296)
```typescript
// resolve.ts
const codeContext = await retriever.retrieve(
  directive || design || "",  // ← 🔴 문제: 그냥 directive 그대로 전달!
  context.workingDir,
  { git: state.deps?.git, vectorDB: state.deps?.memory },
  {
    project: context.project,
    maxTokens: 100000,
    maxFiles: 15,
    mode: modeResult.mode
  }
);
```

#### CodebaseRetriever (Line 93-94)
```typescript
// CodebaseRetriever.ts
const unifiedResult = await this.unifiedStrategy.search(
  directive,  // ← 🔴 그대로 벡터 DB에 전달!
  project,
  { vectorDB: deps.vectorDB, git: deps.git },
  { maxCodeFiles, maxLessons, ... }
);
```

#### VectorSearchStrategy (Line 28)
```typescript
// VectorSearchStrategy.ts
const results = await vectorDB.query(
  directive,  // ← 🔴 정규화 없이 그대로 검색!
  'codebase',
  { k: options.maxFiles * 2, minScore: 0.4 }
);
```

---

## 🎯 당신의 제안 분석

### 제안: "LLM이 검색 키워드를 정규화해서 내려주기"

#### 장점 ✅
1. **더 나은 검색 품질**
   ```
   사용자: "로그인 버튼 추가해줘"
   LLM 정규화: ["authentication", "login", "button component", "user session"]
   → 벡터 검색 품질 향상
   ```

2. **다국어 지원**
   ```
   사용자: "ログイン機能を追加" (일본어)
   LLM 정규화: ["login", "authentication", "user management"]
   → 영어 codebase에서도 검색 가능
   ```

3. **의도 파악**
   ```
   사용자: "버그 고쳐줘" (애매함)
   LLM 정규화: ["error handling", "validation", "null checks"] + context
   → 더 정확한 파일 검색
   ```

4. **불필요한 단어 제거**
   ```
   사용자: "Please kindly add a login button to the homepage"
   LLM 정규화: ["login", "button", "homepage"]
   → 노이즈 제거
   ```

#### 단점 ⚠️
1. **추가 LLM 호출**
   - 비용 증가 (~100 tokens)
   - 지연 시간 증가 (~1초)

2. **오버헤드**
   - Simple directive는 정규화 불필요
   - 예: "Fix typo in App.tsx" → 정규화 필요 없음

---

## 🔄 현재 워크플로우

```
resolve
  ├─ directive (raw) → CodebaseRetriever.retrieve()
  │    ├─ Vector DB search: directive → 검색
  │    ├─ Keyword search: directive → grep
  │    └─ Git changes boost
  ├─ state.code (loaded files)
  └─ state.profile (language/framework)
  
detectEnvironment
  ├─ directive + design files list → LLM
  └─ selectedDesignFiles
  
decompose
  ├─ directive + selectedDesignFiles → LLM
  └─ TaskQueue
```

---

## 💡 개선 제안

### Option 1: Resolve에 검색 키워드 추출 단계 추가 (추천)

```
resolve
  ├─ 1. Normalize directive (NEW LLM call)
  │    Input: "로그인 버튼 추가해줘"
  │    Output: {
  │      searchKeywords: ["login", "authentication", "button", "component"],
  │      searchContext: "User wants to add login UI",
  │      language: "ko"
  │    }
  │
  ├─ 2. Vector DB search
  │    Query: searchKeywords (normalized)
  │    → 더 정확한 결과
  │
  └─ 3. Load files
```

#### 구현 방안:
```typescript
// resolve.ts

// STEP 1: Normalize search query (NEW)
const normalizedQuery = await normalizeSearchQuery(llm, directive);

// STEP 2: Retrieve with normalized query
const codeContext = await retriever.retrieve(
  normalizedQuery.searchKeywords.join(' '),  // ✅ Normalized!
  context.workingDir,
  { git: state.deps?.git, vectorDB: state.deps?.memory },
  { project: context.project, maxTokens: 100000, maxFiles: 15, mode: modeResult.mode }
);
```

### Option 2: CodebaseRetriever 내부에서 정규화

```typescript
// CodebaseRetriever.ts
async retrieve(directive: string, ...) {
  // Normalize query before search
  const normalized = await this.normalizeQuery(directive);
  
  // Search with normalized query
  const results = await vectorDB.query(normalized, ...);
}
```

### Option 3: 현상 유지 (No LLM normalization)

**근거**:
- Vector DB의 semantic search는 이미 의미 기반 검색
- "로그인 버튼" → "login button"은 embedding 레벨에서 유사
- 추가 LLM 호출 비용/시간이 아까움

---

## 📊 비교 분석

| 항목 | 현재 (No LLM) | Option 1 (Resolve에 추가) | Option 2 (Retriever 내부) |
|------|---------------|---------------------------|--------------------------|
| **검색 품질** | 보통 | 높음 ✅ | 높음 ✅ |
| **다국어 지원** | 제한적 | 우수 ✅ | 우수 ✅ |
| **비용** | 낮음 ✅ | 중간 (+100 tokens) | 중간 (+100 tokens) |
| **지연 시간** | 빠름 ✅ | +1초 | +1초 |
| **구현 복잡도** | - | 낮음 ✅ | 중간 |
| **테스트 용이성** | - | 높음 ✅ | 낮음 |

---

## 🎯 권장 사항

### 단계별 접근 (추천)

#### Phase 1: 현상 유지 (당장)
- Vector DB의 semantic search 성능 먼저 측정
- 실제 검색 품질 문제가 있는지 확인
- 비용 대비 효과 검증

#### Phase 2: 선택적 정규화 (필요시)
```typescript
// 조건부 정규화
if (shouldNormalize(directive)) {
  // 다국어 또는 복잡한 directive만 정규화
  normalized = await normalizeQuery(llm, directive);
} else {
  // Simple directive는 그대로 사용
  normalized = directive;
}
```

**조건**:
- 다국어 (한글, 일본어, 중국어)
- 긴 문장 (>100자)
- 애매한 표현 ("버그 고쳐줘")

#### Phase 3: 항상 정규화 (검증 후)
- Phase 2에서 효과가 입증되면
- 모든 directive 정규화

---

## ✅ 현황 요약

### Decompose 노드
- ❌ 벡터 DB 검색 안 함
- ❌ 파일 리스트 검색 안 함
- ✅ Design 문서만 사용
- ✅ Task breakdown만 수행

### Resolve 노드
- ✅ 벡터 DB 검색 수행
- 🔴 **directive를 그대로 사용** (정규화 없음)
- ✅ Git changes boost
- ✅ Lessons + Documents 통합 검색

### CodebaseRetriever
- ✅ Unified search (code + lessons + documents)
- 🔴 **directive를 그대로 vectorDB.query()에 전달**
- ✅ Hybrid fallback (keyword search)

---

## 🎯 결론

### 현재 구조
```
directive (raw)
  → resolve 노드
  → CodebaseRetriever.retrieve(directive)  ← 🔴 정규화 없음
  → vectorDB.query(directive)  ← 🔴 그대로 검색
```

### 제안의 타당성
- ✅ **매우 타당함**: 특히 다국어, 복잡한 directive
- ⚠️ **비용 고려**: 모든 작업마다 +100 tokens
- 💡 **추천**: 조건부 정규화 (Phase 2)

### 다음 단계
1. 📊 현재 검색 품질 측정 (다양한 directive 테스트)
2. 🔬 정규화 효과 검증 (A/B 테스트)
3. 💰 비용 대비 효과 분석
4. 🚀 구현 여부 결정

**제안을 구현하시겠습니까?** (조건부 정규화 추천)

