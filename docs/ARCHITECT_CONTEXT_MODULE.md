# Architect Context Module (공통 모듈)

## 📂 **최종 구조**

```
packages/ant-cli/src/agents/architect/
├── context/                          # ✅ Architect 레벨 공통 모듈
│   ├── index.ts                     # Full codebase loading (Decompose용)
│   ├── analyzer.ts                  # Task-based 분석 (Plan용)
│   ├── loader.ts                    # Smart pre-loading (Plan용)
│   └── README.md
├── graph/
│   ├── code/                        # Code Job
│   │   └── nodes/
│   │       ├── decompose/           # ✅ Uses: ../../../context/
│   │       └── plan/                # ✅ Uses: ../../../context/
│   └── design/                      # Design Job
│       └── nodes/
│           ├── decompose/           # ✅ Uses: ../../../context/ (동일!)
│           └── plan/                # ✅ Uses: ../../../context/ (동일!)
```

---

## 🎯 **왜 Architect 레벨인가?**

### **이유 1: 다중 Job 공유**

| **Job** | **Decompose** | **Plan** | **Context 필요** |
|--------|--------------|---------|----------------|
| Code | ✅ | ✅ | Full + Smart |
| Design | ✅ | ✅ | Full + Smart |
| Learn | ❌ | ❌ | ❌ |

**결론**: Code & Design 모두 동일한 Context 로딩 필요!

---

### **이유 2: 단일 수행 주체**

```
Architect Agent
├── Code Job (구현)
├── Design Job (설계)
└── Learn Job (학습)

✅ 수행 주체: Architect (동일)
✅ Context 대상: Codebase (동일)
✅ 분석 방식: Task-based (동일)
```

**결론**: Job 하위가 아닌 **Architect 레벨에서 공유**!

---

### **이유 3: 중복 제거**

#### **Before (문제)**
```
❌ code/context/ - Code job 전용
❌ design/context/ - 만들어야 함 (중복!)
❌ 동일 로직을 2곳에서 관리
```

#### **After (해결)**
```
✅ architect/context/ - 모든 Job 공유
✅ Code & Design 동시 사용
✅ 단일 관리 지점
```

---

## 📊 **모듈별 사용 현황**

### **1. `context/index.ts` - Full Codebase Loading**

**사용처**:
- ✅ Code job - `decompose/index.ts`
- ✅ Design job - `decompose/index.ts` (사용 가능)

**기능**:
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

**목적**:
- Resume시 전체 codebase 로딩
- Full project deletion 감지
- 단순하고 범용적인 파일 읽기

---

### **2. `context/analyzer.ts` - Task-based Analysis**

**사용처**:
- ✅ Code job - `plan/index.ts`
- ✅ Design job - `plan/index.ts` (사용 가능)

**기능**:
```typescript
export interface ContextStrategy {
  needsExplore: boolean;
  needsGrep: boolean;
  needsRead: boolean;
  keywords: string[];
  filePatterns: string[];
  readFiles: string[];        // Error files (직접 읽기)
  maxFilesToRead: number;
}

export function analyzeContextNeeds(
  task: Task,              // PRIMARY: Task 자체
  enforcementReason?: string,  // SECONDARY: Error context
  design?: string,         // TERTIARY: Design document
  existingFiles?: string[] // QUATERNARY: 기존 생성 파일
): ContextStrategy;
```

**분석 전략**:

| **Task Type** | **Explore** | **Grep** | **Read** | **Max Files** |
|--------------|-----------|---------|---------|--------------|
| `setup` | ✅ | ❌ | ❌ | 0 |
| `feature` | ✅ | ✅ | ✅ | 10 |
| `error` | ✅ | ✅ | ✅ | 5 (focused) |

---

### **3. `context/loader.ts` - Smart Pre-loading**

**사용처**:
- ✅ Code job - `plan/index.ts`
- ✅ Design job - `plan/index.ts` (사용 가능)

**기능**:
```typescript
export interface LoadedContext {
  fileTree: string;        // ~2K tokens
  grepResults: string;     // ~5-10K tokens
  fileContents: string;    // ~30-50K tokens
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
3. **Read**: Top-ranked 파일 읽기 (UI: `reading`)

---

## 💡 **사용 예시**

### **Code Job - Decompose**

```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts

import { loadFullCodebase } from '../../../../context';

// Resume시 전체 codebase 로딩
const result = await loadFullCodebase(gitPort, {
  maxFiles: 50,
  maxTokens: 100000
});

state.code = result.content;

// 전체 삭제 감지
if (hasCompletedTasks && result.files.length === 0) {
  // Reset and decompose
}
```

---

### **Code Job - Plan**

```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/plan/index.ts

import { analyzeContextNeeds } from '../../../../context/analyzer';
import { loadContext } from '../../../../context/loader';

// Task별 맞춤형 context 로딩
const strategy = analyzeContextNeeds(
  nextTask,
  state.enforcementReason,
  state.design,
  state.files?.map(f => f.path)
);

const context = await loadContext(strategy, gitPort);

// LLM Context 구성
const llmContext = `
=== CODEBASE CONTEXT ===
${context.fileTree}
${context.grepResults}
${context.fileContents}
💡 Available Tools: ...
`;
```

---

### **Design Job - Decompose (불필요)**

```typescript
// packages/ant-cli/src/agents/architect/graph/design/nodes/decompose/index.ts

// ❌ Context 로딩 불필요
// 이유: Resume시에도 설계 문서만 복원하면 됨
// (codebase는 evolution/refactor에서만 필요)
```

---

### **Design Job - Plan (✅ 적용 완료!)**

```typescript
// packages/ant-cli/src/agents/architect/graph/design/nodes/plan.ts

import { analyzeContextNeeds } from '../../../context/analyzer';
import { loadContext } from '../../../context/loader';

// ✅ Evolution/Refactor 모드에서만 실행!
let currentCode = state.code;

if (hasExistingCode && gitPort && currentTask) {
  const strategy = analyzeContextNeeds(
    currentTask,                 // PRIMARY
    undefined,                   // SECONDARY
    state.prd,                   // TERTIARY
    state.files?.map(f => f.path) // QUATERNARY
  );
  
  const context = await loadContext(strategy, gitPort);
  
  currentCode = `
=== CODEBASE CONTEXT ===
${context.fileTree}
${context.grepResults}
${context.fileContents}
💡 Available Tools: ...
  `;
}
```

---

## 🔄 **Import 경로**

### **Code Job**

| **Node** | **Import Path** |
|---------|----------------|
| Decompose | `from '../../../../context'` |
| Plan | `from '../../../../context/analyzer'` |
| Plan | `from '../../../../context/loader'` |

### **Design Job**

| **Node** | **Import Path** | **사용** |
|---------|----------------|---------|
| Decompose | - | ❌ 불필요 |
| Plan | `from '../../../context/analyzer'` | ✅ 적용 완료 |
| Plan | `from '../../../context/loader'` | ✅ 적용 완료 |

---

## 📋 **설계 원칙**

### **1. 단일 책임 원칙 (SRP)**

| **Module** | **책임** |
|-----------|---------|
| `index.ts` | Full codebase loading (단순 범용) |
| `analyzer.ts` | Task-based 분석 (전략 결정) |
| `loader.ts` | Smart pre-loading (실행) |

---

### **2. 공유 가능성 (Shared by Design)**

- ✅ Architect 레벨 (모든 Job 접근 가능)
- ✅ Job-agnostic (Code/Design 구분 없음)
- ✅ Node-agnostic (Decompose/Plan 모두 사용 가능)

---

### **3. 확장 가능성 (Extensible)**

- ✅ 새 Job 추가시 바로 사용 가능
- ✅ 새 Task type 추가시 `analyzer.ts`만 수정
- ✅ 새 Context 전략 추가시 `loader.ts`만 수정

---

## ✅ **결론**

**Context Module은 Architect 레벨에 위치해야 합니다!**

1. ✅ **수행 주체**: Architect (Code & Design 모두)
2. ✅ **공유 대상**: Codebase (동일한 대상)
3. ✅ **중복 제거**: 단일 관리 지점
4. ✅ **확장성**: 새 Job 추가시 바로 사용 가능

**최종 위치**:
```
packages/ant-cli/src/agents/architect/context/
```

이로써 **Architect Agent의 모든 Job이 Context 로딩을 공유**할 수 있습니다! 🚀

