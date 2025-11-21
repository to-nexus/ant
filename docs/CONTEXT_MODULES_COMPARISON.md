# ContextAssembler vs Context Analyzer/Loader - 비교 분석

두 시스템은 **중복이 아니라 상호 보완 관계**입니다.

---

## 📋 **전체 아키텍처**

```
┌─────────────────────────────────────────────────────────────┐
│                       Plan 노드 시작                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  1️⃣ Smart Context Pre-loading (architect/context/)           │
│     - analyzer.ts: "이 task는 API 수정이네? grep 필요!"      │
│     - loader.ts: Git 탐색 → grep → 파일 읽기                 │
│     → UI 업데이트 (Exploring... Grepping... Reading...)      │
│     → 결과: fileTree, grepResults, fileContents              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  2️⃣ ContextAssembler (core/prompt/engine/)                   │
│     - 위 결과 + 문서 + 메모리 + Git 통합                      │
│     → 전체 컨텍스트 수집                                      │
│     → 결과: AssembledContext (모든 컨텍스트 통합)             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  3️⃣ PromptEngine (core/prompt/engine/)                       │
│     - 템플릿 로드 (design/phases/plan/base.md)               │
│     - 컨텍스트 주입                                           │
│     → 최종 프롬프트 생성                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    LLM 호출                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🆚 **세부 비교**

### **1️⃣ Smart Context Pre-loading (architect/context/)**

| **항목** | **내용** |
|---------|---------|
| **위치** | `/agents/architect/context/` |
| **파일** | `analyzer.ts`, `loader.ts`, `index.ts` |
| **역할** | LLM 호출 전 코드베이스 스마트 탐색 |
| **입력** | Task, enforcementReason, design, existingFiles |
| **출력** | `LoadedContext { fileTree, grepResults, fileContents, summary }` |
| **타이밍** | Plan/DocGen 노드 시작 시 (LLM 호출 전) |
| **UI** | ✅ Yes (Exploring, Grepping, Reading 상태 표시) |
| **책임** | - Task 분석 (API? UI? 버그 수정?)<br>- 필요한 파일 자동 탐색<br>- 검색 실행<br>- 파일 읽기 |

**예시 코드:**
```typescript
// plan/index.ts
const { analyzeContextNeeds } = await import('../../../../context/analyzer');
const { loadContext } = await import('../../../../context/loader');

const strategy = analyzeContextNeeds(
  nextTask,                    // PRIMARY: Task 자체
  state.enforcementReason,     // SECONDARY: 에러 컨텍스트
  state.design,                // TERTIARY: Design 문서
  state.files?.map(f => f.path) // QUATERNARY: 기존 파일
);

const context = await loadContext(strategy, gitPort);
// → fileTree, grepResults, fileContents
```

---

### **2️⃣ ContextAssembler (core/prompt/engine/)**

| **항목** | **내용** |
|---------|---------|
| **위치** | `/core/prompt/engine/ContextAssembler.ts` |
| **역할** | 프롬프트 조립을 위한 전체 컨텍스트 수집 |
| **입력** | Task, ProjectContext, artifacts (문서, 코드 등) |
| **출력** | `AssembledContext { directive, designDoc, currentCode, memory, stats, ... }` |
| **타이밍** | PromptEngine 실행 시 |
| **UI** | ❌ No (백그라운드 작업) |
| **책임** | - 문서 로드 (directive, design, PRD)<br>- Git HEAD 파일 로드<br>- Vector 메모리 조회<br>- 세션 히스토리 조회<br>- 코드베이스 분석 (language/framework)<br>- 통계 생성 |

**예시 코드:**
```typescript
// PromptEngine.buildPlanPrompt()
const assembled = await this.assembler.assemble(
  task,
  context,
  { git, memory, analyzer },
  loader,  // task-specific loader
  {
    directive,
    designDoc,
    prdSpec,
    currentCode,  // ← 여기에 context/loader 결과 포함!
    currentTask,
  }
);

// assembled = {
//   directive,
//   designDoc,
//   currentCode: "...(fileTree + grepResults + fileContents)...",
//   originalFiles,
//   memory,
//   sessionHistory,
//   codebaseProfile,
//   stats: { hasDirective, hasDesign, ... }
// }
```

---

## 🔄 **통합 흐름 (실제 사용)**

```typescript
// plan/index.ts

// 1️⃣ Smart Context Pre-loading
const { analyzeContextNeeds } = await import('../../../../context/analyzer');
const { loadContext } = await import('../../../../context/loader');

const strategy = analyzeContextNeeds(
  nextTask,
  state.enforcementReason,
  state.design,
  state.files?.map(f => f.path)
);

const preloadedContext = await loadContext(strategy, gitPort);
// → fileTree: "src/\n  api/\n  components/\n"
// → grepResults: "Found 'authenticate' in 3 files:\n..."
// → fileContents: "FILE: src/api/auth.ts\n..."

// 2️⃣ ContextAssembler (PromptEngine 내부)
const promptResult = await promptEngine.buildPlanPrompt(
  task,
  context,
  {
    directive: state.directive,
    designDoc: state.design,
    prdSpec: state.prd,
    currentCode: preloadedContext.fileTree + '\n' + preloadedContext.grepResults + '\n' + preloadedContext.fileContents,  // ✅ 통합!
    currentTask: { name, type, description },
  },
  mode,
  taskType
);

// ContextAssembler가 추가로 수집:
// - originalFiles (Git HEAD)
// - memory (Vector DB)
// - sessionHistory
// - codebaseProfile (언어/프레임워크 분석)

// 3️⃣ PromptEngine이 템플릿에 주입
const finalPrompt = promptResult.formatted.systemPrompt;
// → "Current task: ...\n\nCodebase:\n{fileTree}\n\nSearch results:\n{grepResults}\n\nMemory:\n{memory}\n..."
```

---

## 💡 **왜 분리했는가?**

### **관심사의 분리 (Separation of Concerns)**

1. **architect/context/ (Domain-Specific)**
   - **관심사:** "이 task를 수행하려면 어떤 코드를 봐야 할까?"
   - **책임:** Task 유형 분석 + 코드베이스 탐색
   - **재사용:** Code Job, Design Job 모두 사용

2. **core/prompt/engine/ (Generic)**
   - **관심사:** "프롬프트를 만들려면 어떤 컨텍스트가 필요한가?"
   - **책임:** 모든 소스에서 데이터 수집 + 통합
   - **재사용:** 모든 에이전트 (Architect, 미래의 다른 에이전트)

---

## 🎯 **핵심 차이점 요약**

| **비교 항목** | **context/analyzer+loader** | **ContextAssembler** |
|--------------|----------------------------|----------------------|
| **레벨** | Architect 에이전트 레벨 | Core 엔진 레벨 |
| **목적** | Task 기반 코드 탐색 자동화 | 프롬프트용 전체 컨텍스트 통합 |
| **입력** | Task + 에러 + Design + 파일 목록 | Task + ProjectContext + 문서 |
| **출력** | 탐색 결과 (파일 트리, grep, 파일 내용) | 전체 컨텍스트 (문서, 코드, 메모리, 통계) |
| **UI** | ✅ Yes | ❌ No |
| **Git 작업** | 파일 탐색, 읽기 | HEAD 버전 로드 (diff용) |
| **메모리** | ❌ No | ✅ Yes (Vector DB 조회) |
| **분석** | Task 유형 분석 (API? UI?) | 코드베이스 분석 (언어/프레임워크) |
| **통계** | ❌ No | ✅ Yes (hasDirective, hasDesign, ...) |
| **사용 시점** | Plan 노드 시작 시 | PromptEngine 실행 시 |

---

## 📊 **데이터 흐름**

```
Task: "Implement user authentication API"

┌─────────────────────────────────────────┐
│  1️⃣ analyzer.ts                          │
│     Input: Task, enforcementReason, ... │
│     분석: "API 구현 → 코드 탐색 필요"     │
│     Output: ContextStrategy              │
│     {                                    │
│       needsExplore: true,                │
│       needsGrep: true,                   │
│       keywords: ['auth', 'api'],         │
│       readFiles: ['src/api/routes.ts']   │
│     }                                    │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  2️⃣ loader.ts                            │
│     Input: ContextStrategy, gitPort     │
│     실행:                                 │
│     - listFiles() → fileTree            │
│     - grep('auth') → grepResults        │
│     - readFile('src/api/routes.ts')     │
│     Output: LoadedContext               │
│     {                                    │
│       fileTree: "src/\n  api/\n...",    │
│       grepResults: "Found 'auth'...",   │
│       fileContents: "FILE: src/...",    │
│       summary: "Loaded 3 files, ..."    │
│     }                                    │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  3️⃣ ContextAssembler.assemble()          │
│     Input:                               │
│     - artifacts.currentCode =            │
│       LoadedContext.fileTree + ...      │
│     추가 수집:                            │
│     - originalFiles (Git HEAD)          │
│     - memory (Vector DB)                │
│     - sessionHistory                     │
│     - codebaseProfile (분석)             │
│     Output: AssembledContext            │
│     {                                    │
│       directive,                         │
│       designDoc,                         │
│       currentCode: "(fileTree + grep + files)", │
│       originalFiles: "(Git HEAD)",      │
│       memory: "(Vector DB)",            │
│       stats: { hasDirective: true, ... }│
│     }                                    │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  4️⃣ TemplateComposer.compose()           │
│     Input: AssembledContext             │
│     템플릿에 주입:                        │
│     - {{currentCode}}                   │
│     - {{memory}}                        │
│     - {{directive}}                     │
│     Output: ComposedPrompt              │
└─────────────────────────────────────────┘
```

---

## ✅ **결론**

**중복이 아닙니다!**

- **context/analyzer+loader**: Cursor 스타일의 "스마트 프리로딩" (Task → 코드 탐색 자동화)
- **ContextAssembler**: 프롬프트 엔진의 "컨텍스트 통합" (모든 소스 → 하나의 컨텍스트)

**둘은 협력합니다:**
1. `context/loader`가 코드베이스를 탐색
2. 결과를 `currentCode`에 포함
3. `ContextAssembler`가 이를 받아 문서/메모리/통계와 통합
4. `PromptEngine`이 최종 프롬프트 생성

**설계 원칙:**
- **Single Responsibility**: 각자 하나의 명확한 책임
- **Separation of Concerns**: Domain vs. Core 레벨 분리
- **Reusability**: 각각 독립적으로 재사용 가능

