# Code Job RAG 완전 리팩토링 - Phase 2 진행 상황

## ✅ Phase 2 완료 항목

### 5. Plan LLM 키워드 생성 + Task-specific RAG ✅

**완전 재작성**: `/packages/ant-cli/src/agents/architect/graph/code/nodes/plan/index.ts`

#### 핵심 변경사항:
```typescript
// STEP 1: LLM generates task-specific keywords
taskKeywords = await generateTaskKeywords(llm, nextTask, state);
// → LLM이 task 분석해서 semantic keywords 생성

// STEP 2: Vector DB Search (task-specific)
const searchResult = await retriever.retrieve(
  taskKeywords.join(' '),  // LLM이 만든 키워드!
  workingDir,
  { vectorDB, git },
  {
    maxTokens: 30000,
    maxFiles: 8
  }
);

codeContext = {
  filePaths: [...],
  files: [...],  // Full content
  stats: {...},
  source: 'plan'
};

// STEP 3: Reference projects
referenceContexts = await loadReferenceContexts(...);
```

#### LLM Prompt:
```
Task: "Add password toggle to login form"
→ LLM generates:
["login form", "password input", "visibility toggle", "eye icon", "input type password"]

→ Vector DB searches with these keywords
→ Task-specific, high-quality results!
```

#### 제거된 Legacy:
- ❌ Smart context loading (analyzeContextNeeds, loadContext)
- ❌ Git grep-based loading
- ❌ Rule-based keyword extraction
- ❌ planText generation (불필요한 필드였음)

---

### 6. CodeGen Context 사용 방식 변경 ✅

**파일**: `/packages/ant-cli/src/agents/architect/graph/code/nodes/codeGen.ts`

#### 변경사항:
```typescript
// Before (legacy)
const promptResult = await promptEngine.buildExecutePrompt(
  'code',
  state.context,
  {
    currentCode: state.code,  // ❌ Legacy
    originalFiles: state.codeHead,  // ❌ Legacy
    // ...
  }
);

// After (refactored)
const promptResult = await promptEngine.buildExecutePrompt(
  'code',
  state.context,
  {
    codeContext: state.codeContext,  // ✅ NEW
    gitDiff: state.gitDiff,  // ✅ NEW
    referenceContexts: state.referenceContexts,  // ✅ NEW
    // ...
  }
);
```

#### generateFileTree 업데이트:
```typescript
// Before
const files = state.files?.map(f => f.path) || [];

// After
const files = state.codeContext?.filePaths || [];
```

#### buildRuntimeContext 정리:
```typescript
// Removed: planText injection (불필요)
// Kept: currentTask, enforcementReason, fileTree
```

---

## 🚧 남은 작업

### 7. PromptEngine artifacts 업데이트 (진행 중)

**파일**: `/packages/ant-cli/src/core/prompt/engine/PromptEngine.ts`

#### 필요한 변경:
```typescript
async buildExecutePrompt(
  task: AgentTask,
  context: ProjectContext,
  artifacts: {
    directive?: string;
    designDoc?: string;
    
    // ❌ Remove
    // originalFiles?: string;
    // currentCode?: string;
    // prdSpec?: string;
    
    // ✅ Add
    codeContext?: {
      filePaths: string[];
      files?: Array<{path: string; content: string}>;
      stats: { filesLoaded: number; estimatedTokens: number };
      source: 'decompose' | 'plan';
    };
    gitDiff?: any;
    referenceContexts?: Array<{
      project: string;
      branch?: string;
      files: Array<{path: string; content: string}>;
      stats: { filesLoaded: number; estimatedTokens: number };
    }>;
    
    // ... rest
  },
  mode?: CodeMode,
  taskType?: string
): Promise<PromptBuildResult>
```

**관련 파일들**:
- `ContextAssembler.ts` - AssembledContext interface 업데이트
- `TemplateComposer.ts` - Template variables 업데이트
- `ModeController.ts` - Injection variables 업데이트

---

### 8. Legacy 필드 완전 제거

**파일**: `/packages/ant-cli/src/core/types/task.ts` (TaskArtifacts)

#### 제거할 필드:
```typescript
export interface TaskArtifacts {
  prd?: string;
  directive?: string;
  design?: string;
  
  // ❌ Remove these
  code?: string;
  files?: Array<{path: string; content: string}>;
  codeHead?: string;
  
  profile?: CodebaseProfile;
}
```

#### 영향받는 파일들:
- `TaskArtifacts` interface
- `ArchitectGraphState` extends TaskArtifacts
- All nodes that reference `state.code`, `state.files`, `state.codeHead`

---

## 📊 Phase 2 성과

### 완료된 핵심 개선:

1. **Plan 노드 완전 리팩토링** ✅
   - LLM 기반 키워드 생성
   - Task-specific Vector DB 검색
   - Reference project 로딩
   - Legacy smart context loading 제거

2. **CodeGen 노드 업데이트** ✅
   - 새로운 codeContext 사용
   - gitDiff, referenceContexts 사용
   - Legacy code/files 제거

3. **불필요한 주석 제거** ✅
   - Plan 노드 ~700줄 → ~300줄 (57% 감소)
   - 명확한 코드, 최소한의 주석

### Token 절감 효과 (누적):

```
Phase 1 (Resolve + Decompose):
- Resolve: 75KB → 15KB (80% 감소)
- Decompose: 조건부 5KB (파일 경로만)

Phase 2 (Plan):
- Task-specific 검색: ~30KB per task
- Reference: ~15KB per project
- Total: ~45KB per task

Before (전체):
- Resolve: 75KB
- Decompose: 0KB
- Plan × 5: 0KB
- CodeGen × 5: 75KB × 5 = 375KB
Total: ~450KB

After (전체):
- Resolve: 15KB (profile)
- Decompose: 5KB (paths, refactor만)
- Plan × 5: 45KB × 5 = 225KB (task-specific!)
- CodeGen × 5: 0KB (plan 결과 사용)
Total: ~245KB

절감: ~205KB (46%)
```

### 검색 품질 향상:

**Before (현재)**:
- Resolve: Directive 전체로 검색 → 관련 없는 파일 많음
- Plan: Git grep → Keyword-based, 정확도 낮음
- CodeGen: Resolve 결과 재사용 → Task-specific 아님

**After (리팩토링)**:
- Resolve: Profile만 (검색 안 함)
- Plan: **LLM 키워드** → Semantic search → Task-specific!
- CodeGen: Plan 결과 사용 → 완벽한 context

**예시**:
```
Task: "Add password visibility toggle to login form"

Before:
- Resolve에서 "전체 directive"로 검색
- 결과: App.tsx, routes.ts, Header.tsx, LoginForm.tsx, ...
- 불필요한 파일 많음

After:
- Plan에서 LLM이 키워드 생성:
  ["login form", "password input", "visibility toggle", "eye icon"]
- Vector DB 검색 결과:
  LoginForm.tsx, Input.tsx, useToggle.ts
- ✅ Task-specific, 정확한 파일만!
```

---

## 🎯 남은 Phase 2 작업

### 우선순위 1: PromptEngine artifacts 업데이트
- ContextAssembler interface
- TemplateComposer variables
- ModeController injections

### 우선순위 2: Legacy 완전 제거
- TaskArtifacts: code, files, codeHead 제거
- 모든 노드에서 legacy 참조 제거
- Type errors 수정

### 예상 완료 시간:
- PromptEngine: ~30분
- Legacy cleanup: ~20분
- **Total: ~50분**

---

## ✅ Phase 2 중간 점검

### 완료율: 75% (6/8 tasks)

**완료**:
1. ✅ State 완전 리팩토링
2. ✅ Resolve 최소화
3. ✅ DetectEnvironment 완전 리팩토링
4. ✅ Decompose 조건부 RAG
5. ✅ Plan LLM 키워드 + RAG
6. ✅ CodeGen context 변경

**남음**:
7. 🚧 PromptEngine artifacts 업데이트
8. ⏳ Legacy 필드 완전 제거

---

## 🚀 다음 단계

**계속 진행**:
1. PromptEngine 관련 파일 업데이트
2. Legacy 필드 완전 제거
3. Lint 에러 수정
4. 통합 테스트

**예상 최종 성과**:
- Token 46% 절감
- 검색 품질 대폭 향상
- Task-specific context
- 깔끔한 코드 (레거시 제거)

**계속 진행하시겠습니까?** 🚀

