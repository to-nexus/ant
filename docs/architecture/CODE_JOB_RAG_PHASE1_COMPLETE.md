# Code Job RAG 완전 리팩토링 - Phase 1 완료 보고서

## ✅ 완료된 작업

### 1. State 완전 리팩토링 ✅

#### 변경사항:
```typescript
export interface ArchitectGraphState extends TaskArtifacts {
  // 🔥 NEW: DetectEnvironment Output
  requireCodebase?: boolean;  // decompose에 RAG 필요 여부
  codebaseKeywords?: string[];  // Main project 검색 키워드
  referenceKeywords?: Map<string, string[]>;  // Reference project별 키워드
  
  // 🔥 NEW: Task-specific Context (from plan node)
  taskKeywords?: string[];  // Plan node: LLM-generated keywords
  
  // 🔥 NEW: Code Context (replaces code, files, codeHead)
  codeContext?: {
    filePaths: string[];  // File paths only (for decompose)
    files?: Array<{path: string; content: string}>;  // Full content (for plan/codeGen)
    stats: { filesLoaded: number; estimatedTokens: number };
    source: 'decompose' | 'plan';  // Where it came from
  };
  
  // ✅ Git Diff (working tree changes)
  gitDiff?: GitDiffSummary;
  
  // 🔥 NEW: Reference Contexts (per task, from plan node)
  referenceContexts?: Array<{
    project: string;
    branch?: string;
    files: Array<{path: string; content: string}>;
    stats: { filesLoaded: number; estimatedTokens: number };
  }>;
}
```

#### 핵심 변화:
- ❌ **제거 예정**: `code`, `files`, `codeHead` (legacy)
- ✅ **통합**: `codeContext`로 통합 (filePaths + files + stats + source)
- ✅ **명확화**: `gitDiff`는 separate (working tree changes)
- ✅ **추가**: `requireCodebase`, `codebaseKeywords`, `referenceKeywords`, `taskKeywords`

---

### 2. DetectEnvironment 완전 리팩토링 ✅

#### 새로운 책임:
1. ✅ 환경 감지 (frontend/backend/fullstack/unknown)
2. ✅ RAG 필요성 판단 (requireCodebase flag)
3. ✅ 검색 키워드 생성:
   - `codebaseKeywords`: Main project용
   - `referenceKeywords`: Reference project별

#### LLM Prompt 구조:
```
- Directive 분석
- Design docs 확인
- Project profile 참고
- Mode 고려 (generate/refactor/explain)

→ Output:
{
  "environment": "frontend" | "backend" | "fullstack" | "unknown",
  "reasoning": "...",
  "requireCodebase": true | false,
  "codebaseKeywords": ["keyword1", "keyword2", ...],
  "referenceProjects": [
    {"project": "backend", "keywords": ["user API", "auth endpoint"]}
  ]
}
```

#### 핵심 로직:
```typescript
// Generate mode → requireCodebase: false (보통)
// Refactor mode → requireCodebase: true (보통)
// Explain mode → requireCodebase: true (보통)

// Keywords: 5-10 semantic keywords
// - 파일명, 함수명, 컴포넌트명
// - 패턴, 개념, API
// - Directive-specific
```

---

### 3. Decompose 조건부 RAG ✅

#### 핵심 변화:
**Before**:
```typescript
// state.code 사용 안 함
// Design doc만으로 task 분해
```

**After**:
```typescript
if (state.requireCodebase && state.codebaseKeywords) {
  // Vector DB 검색 (keywords 기반)
  const searchResult = await retriever.retrieve(
    searchQuery,
    workingDir,
    { vectorDB, git },
    {
      maxTokens: 5000,  // Minimal (paths only)
      maxFiles: 20
    }
  );
  
  // 파일 경로만 추출 (content 없이!)
  codebaseFilePaths = searchResult.files?.map(f => f.path);
  
  // Git diff 추출
  gitDiff = await generateGitDiffSummary(git, workingDir);
}
```

#### LLM에 전달:
```typescript
const prompt = buildDecomposePrompt({
  directive,
  designDoc,
  codebaseFilePaths,  // 🔥 파일 경로 리스트만!
  gitDiff,            // 🔥 Git diff summary
  mode,
  profile
});
```

#### 효과:
- ✅ **Refactor 모드**: 기존 파일 구조 인지 → 더 정확한 task 분해
- ✅ **Token 효율**: 파일 경로만 전달 (content 없음)
- ✅ **Generate 모드**: RAG skip → 빠름

---

### 4. Resolve 최소화 ✅

#### 변경사항:
**Before**:
```typescript
maxTokens: 100000,  // ~75KB
maxFiles: 15
// → code, files, lessons, documents 모두 state에 저장
```

**After**:
```typescript
maxTokens: 20000,   // ~15KB (80% 감소)
maxFiles: 5         // (67% 감소)
// → profile만 state에 저장
```

#### 목적 명확화:
```typescript
// Resolve의 유일한 목적: Profile 분석
// - Language detection
// - Framework detection
// - 그 외 코드는 버림!
```

#### Return 값:
```typescript
return {
  ...state,
  directive,
  design,
  designDocPath,
  mode,
  sessionContext,
  profile,  // ✅ ONLY profile!
  // ❌ NO: code, files, lessons, documents
};
```

---

## 📊 성능 개선 효과 (예상)

### Token 절감:
```
Before (현재):
- Resolve: 75KB (모든 태스크 공통)
- Decompose: 0KB
- Plan × 5: 0KB
- CodeGen × 5: 75KB × 5 = 375KB
Total: ~450KB

After (리팩토링):
- Resolve: 15KB (profile만)
- Decompose: 5KB (경로만, refactor만)
- Plan × 5: 예정 (task-specific)
- CodeGen × 5: 예정 (plan 결과 사용)
Total: ~165KB 예상

절감: ~285KB (63%)
```

### 검색 품질:
- ✅ **Decompose**: 기존 파일 구조 인지 (refactor 모드)
- ✅ **Plan**: Task-specific keywords (예정)
- ✅ **Reference**: Project별 keywords

---

## 🔧 주요 설계 결정

### 1. state.files vs gitDiff 통합 여부?
**결론**: ❌ **통합 불필요**

**이유**:
- `state.files` → Vector DB 검색 결과 (semantic search, full content)
- `gitDiff` → Working tree 변경사항 (diff summary만)
- **역할이 다름!**

**해결책**: `codeContext.files`로 명확히 분리
```typescript
codeContext.files: Array<{path, content}>;  // Vector DB 검색
gitDiff.changedFiles: Array<{path, status, additions, deletions}>;  // Git diff
```

---

### 2. Reference 프로젝트 처리?
**사용자 지적**: "Decompose에서 모든 reference 검색은 착각"

**올바른 이해**:
- **Decompose**: Reference **프로젝트 이름만** 등록 (referenceRequests)
- **Plan**: 각 태스크마다 **키워드로 검색**해서 파일 로드
- **CodeGen**: Plan 결과 사용 + tool calling 추가 가능

**설계**:
```typescript
// Decompose
referenceRequests: [{project: "backend", branch: "main"}]

// Plan (per task)
referenceKeywords: Map {
  "backend" => ["user API", "auth endpoint"]
}

// Plan이 backend에서 검색:
const refResult = await retriever.retrieve(
  "user API auth endpoint",
  backendPath,
  ...
);
```

---

### 3. Decompose 파일 리스트만?
**사용자 질문**: "파일 리스트만 제공하면 task 분할에 충분한가?"

**답변**: ✅ **충분함!**

**이유**:
```
파일 경로 리스트:
- src/components/LoginForm.tsx
- src/components/Input.tsx
- src/hooks/useToggle.ts

→ LLM이 task 생성:
Task 1: "Modify LoginForm.tsx - Add password visibility state"
Task 2: "Update Input component in LoginForm - Add toggle button"
Task 3: "Use existing useToggle hook for state management"

✅ 파일 경로만으로도:
- 기존 구조 파악 가능
- 수정할 파일 명시 가능
- 기존 리소스 활용 가능
```

**Content가 필요한 시점**: Plan/CodeGen (실제 구현 시)

---

## 🚧 남은 작업 (Phase 2)

### 5. Plan LLM 키워드 생성 + Task-specific RAG
```typescript
// Plan 노드에서:
// 1. LLM에게 task 전달 → semantic keywords 생성
// 2. Keywords로 Vector DB 검색
// 3. Reference project 검색 (필요시)
// 4. codeContext, gitDiff, referenceContexts 저장
```

### 6. CodeGen context 사용 방식 변경
```typescript
// buildMessages에서:
currentCode: state.codeContext?.files  // Plan에서 검색한 결과
gitDiff: state.gitDiff
referenceContexts: state.referenceContexts
```

### 7. PromptEngine artifacts 업데이트
```typescript
// buildExecutePrompt artifacts:
- Remove: code, files, codeHead
- Add: codeContext, gitDiff, referenceContexts
```

### 8. Legacy 필드 완전 제거
```typescript
// TaskArtifacts interface:
- Remove: code, files, codeHead
- Keep: directive, design, profile
```

---

## ✅ 검증 포인트

### 1. Backward Compatibility
**사용자**: "백워드 호환 무시하고 레거시 제거"
→ ✅ **수용**: Legacy 필드 완전 제거 예정

### 2. Reference 프로젝트
**사용자**: "Decompose에서 reference 파일 검색하는 게 아니라 이름만 파악"
→ ✅ **수정됨**: Decompose는 이름만 등록, Plan이 검색

### 3. 파일 리스트만
**사용자**: "파일 리스트만 제공하면 문제없지 않나?"
→ ✅ **적용됨**: Decompose는 경로만 (content 없음)

### 4. state.files vs gitDiff
**사용자**: "state.files와 gitDiff 역할 겹치는 것 같다"
→ ✅ **명확화됨**: 역할이 다름, 분리 유지

---

## 🎯 Phase 1 완료 요약

### ✅ 완료:
1. State 완전 리팩토링 (`codeContext`, `taskKeywords`, 새 필드들)
2. DetectEnvironment 완전 리팩토링 (RAG 판단 + 키워드 생성)
3. Decompose 조건부 RAG (파일 경로만 제공)
4. Resolve 최소화 (profile 분석만)

### 🚧 남은 작업:
5. Plan LLM 키워드 생성 + Task-specific RAG
6. CodeGen context 사용 방식 변경
7. PromptEngine artifacts 업데이트
8. Legacy 필드 완전 제거

### 📊 예상 효과:
- Token 63% 절감 (450KB → 165KB)
- 검색 품질 대폭 향상 (LLM semantic keywords)
- Task-specific context (불필요한 파일 제외)
- Mode-aware RAG (generate/refactor 최적화)

---

## 🔄 다음 단계

**Phase 2 시작**:
1. Plan 노드 리팩토링 (LLM 키워드 생성 + RAG)
2. CodeGen 노드 업데이트 (새 context 사용)
3. PromptEngine 업데이트
4. Legacy cleanup

**계속 진행하시겠습니까?** 🚀

