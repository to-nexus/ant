# Context Loading 구조 정리

## 📂 **최종 구조**

```
packages/ant-cli/src/agents/architect/graph/code/
├── context/                    # ✅ 공통 Context 모듈
│   ├── index.ts               # 공통 유틸리티 (Full codebase loading)
│   ├── analyzer.ts            # Task-based context 분석 (Plan용)
│   ├── loader.ts              # Smart pre-loading (Plan용)
│   └── README.md              # 문서
├── nodes/
│   ├── decompose/
│   │   └── index.ts           # ✅ Uses: context/index.ts
│   └── plan/
│       └── index.ts           # ✅ Uses: context/analyzer.ts + context/loader.ts
```

---

## 🎯 **역할 분리**

### **1. Common Module (`context/index.ts`)**

**목적**: 범용 codebase 로딩 (Decompose용)

```typescript
export async function loadFullCodebase(
  gitPort: GitPort,
  options: { maxFiles?: number; maxTokens?: number }
): Promise<{
  files: string[];
  content: string;
  totalTokens: number;
}>;

export async function hasCodebase(gitPort: GitPort): Promise<boolean>;
export async function getFileCount(gitPort: GitPort): Promise<number>;
export const DEFAULT_EXCLUDES: string[];
```

**사용처**:
- Decompose 노드 (resume시 전체 codebase 로딩)
- Full project deletion 감지

---

### **2. Extended Module (`context/analyzer.ts`)**

**목적**: Task별 context 전략 분석 (Plan용)

```typescript
export interface ContextStrategy {
  needsExplore: boolean;
  needsGrep: boolean;
  needsRead: boolean;
  keywords: string[];
  filePatterns: string[];
  readFiles: string[];        // ✅ Error files (직접 읽기)
  maxFilesToRead: number;
}

export function analyzeContextNeeds(
  task: Task,              // PRIMARY: Task 자체
  enforcementReason?: string,  // SECONDARY: Error context
  design?: string,         // TERTIARY: Design document
  existingFiles?: string[] // QUATERNARY: 기존 생성 파일
): ContextStrategy;
```

**분석 기준**:

| **Task Type** | **Strategy** |
|--------------|-------------|
| `setup` | Explore only (기존 코드 불필요) |
| `feature` | Explore + Grep + Read (유사 패턴 찾기) |
| `error` | Explore + Grep + Read (에러 파일 집중) |

---

### **3. Extended Module (`context/loader.ts`)**

**목적**: Smart pre-loading 실행 (Plan용)

```typescript
export interface LoadedContext {
  fileTree: string;
  grepResults: string;
  fileContents: string;
  summary: string;
}

export async function loadContext(
  strategy: ContextStrategy,
  gitPort: GitPort
): Promise<LoadedContext>;
```

**실행 순서**:
1. **Explore**: File tree 생성 (UI: `exploring` → `explored`)
2. **Grep**: Keyword 기반 검색 (UI: `grepping` → `grepped`)
3. **Read**: Top-ranked 파일 읽기 (UI: `reading` → 파일별)

---

## 🔄 **노드별 사용 방식**

### **Decompose Node (Meta-level)**

```typescript
// Resume시 전체 codebase 로딩
import { loadFullCodebase } from '../../context';

const result = await loadFullCodebase(gitPort, {
  maxFiles: 50,
  maxTokens: 100000
});

state.code = result.content;

// 전체 삭제 감지
const hasCompletedTasks = session.state.completedTasks?.length > 0;
const hasNoFiles = result.files.length === 0;

if (hasCompletedTasks && hasNoFiles) {
  // 🚨 Project deleted → Reset and decompose
}
```

**특징**:
- ✅ 단순 전체 로딩 (분석 없음)
- ✅ Resume 확인용
- ✅ Directive 기반 Task Queue 생성

---

### **Plan Node (Task-level)**

```typescript
// Task별 맞춤형 context 로딩
import { analyzeContextNeeds } from '../../context/analyzer';
import { loadContext } from '../../context/loader';

// 1. 분석
const strategy = analyzeContextNeeds(
  nextTask,                    // PRIMARY
  state.enforcementReason,     // SECONDARY
  state.design,                // TERTIARY
  state.files?.map(f => f.path) // QUATERNARY
);

// 2. 로딩
const context = await loadContext(strategy, gitPort);

// 3. LLM Context 구성
const llmContext = `
=== CODEBASE CONTEXT ===

${context.fileTree}        // ~2K tokens
${context.grepResults}     // ~5-10K tokens
${context.fileContents}    // ~30-50K tokens

💡 Available Tools: ...
`;
```

**특징**:
- ✅ Task 유형별 최적화
- ✅ Keyword 기반 검색
- ✅ Top-ranked 파일만 읽기
- ✅ UI 피드백 (exploring/grepping/reading)

---

## 📊 **비교표**

| **항목** | **Decompose** | **Plan** |
|---------|--------------|---------|
| **분석 기준** | 없음 (단순 로딩) | Task type, name, error |
| **Context 모듈** | `context/index.ts` | `context/analyzer.ts` + `loader.ts` |
| **파일 선택** | 전체 (max 50 files) | Smart (top 5-10 files) |
| **Keyword 검색** | ❌ | ✅ |
| **UI 피드백** | ❌ | ✅ (exploring/grepping/reading) |
| **Token 사용** | ~100K (fixed) | ~40-65K (optimized) |
| **실행 빈도** | 1회 (job 시작) | 매 Task마다 |

---

## 💡 **설계 원칙**

### **1. 공통 유틸리티 분리**
- `DEFAULT_EXCLUDES` 같은 상수는 공통 모듈에
- 단순 파일 읽기/카운팅은 공통 모듈에

### **2. 확장 모듈 분리**
- Task별 분석 로직은 `analyzer.ts`에
- Smart pre-loading 로직은 `loader.ts`에

### **3. 중복 제거**
- Decompose의 직접 파일 읽기 → `loadFullCodebase()` 사용
- Plan의 context 로직 → `analyzer.ts` + `loader.ts` 사용

### **4. 역할 명확화**
- **Decompose**: Directive 기반, 전체 로딩
- **Plan**: Task 기반, 맞춤형 로딩

---

## 🚀 **개선 효과**

### **Before (문제)**
```
❌ Decompose: 직접 파일 읽기 (중복)
❌ Plan: contextAnalyzer.ts, contextLoader.ts (분산)
❌ 공통 상수/유틸 중복
❌ Directive 기반 분석 (의미 없음)
```

### **After (해결)**
```
✅ 공통 모듈: context/index.ts (재사용)
✅ 확장 모듈: context/analyzer.ts + loader.ts (집중)
✅ 공통 상수: DEFAULT_EXCLUDES (단일화)
✅ Task 기반 분석: Task type, name, error (명확)
```

---

## 📝 **결론**

**Context Loading 구조**:

1. **Decompose + Plan 모두 context 분석/로딩 수행**
2. **공통 모듈 (`context/index.ts`)** → Decompose용
3. **확장 모듈 (`context/analyzer.ts`, `loader.ts`)** → Plan용
4. **역할 분리**: 
   - Decompose = Directive 기반, 전체 로딩
   - Plan = Task 기반, 맞춤형 로딩

이로써 **중복 제거 + 역할 명확화**가 완성되었습니다! 🚀

