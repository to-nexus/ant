# Codebase Context Loading (Architect-Level Shared Module)

## 📂 **구조**

```
packages/ant-cli/src/agents/architect/
├── context/                    # ✅ Architect 레벨 공통 모듈
│   ├── index.ts               # 공통 유틸리티 (Full codebase loading)
│   ├── analyzer.ts            # Task-based context 분석
│   ├── loader.ts              # Smart pre-loading
│   └── README.md              # 이 파일
├── graph/
│   ├── code/                  # Code job
│   │   └── nodes/
│   │       ├── decompose/     # ✅ Uses: context/index.ts
│   │       └── plan/          # ✅ Uses: context/analyzer.ts + loader.ts
│   └── design/                # Design job
│       └── nodes/
│           ├── decompose/     # ✅ Uses: context/index.ts (동일 모듈!)
│           └── plan/          # ✅ Uses: context/analyzer.ts + loader.ts (동일 모듈!)
```

---

## 🎯 **사용처**

### **1. Decompose Node (Meta-level) - Code & Design 공통**

```typescript
// ✅ Code job & Design job 모두 동일 모듈 사용!
import { loadFullCodebase, hasCodebase } from '../../../../context';

// Resume시 전체 codebase 로딩
const result = await loadFullCodebase(gitPort, {
  maxFiles: 50,
  maxTokens: 100000
});

state.code = result.content;  // or state.design = result.content
```

**목적**:
- Session resume시 현재 codebase 상태 확인
- Full project deletion 감지
- Task Queue 생성을 위한 전체 코드 파악

**사용 Job**:
- ✅ Code job: `graph/code/nodes/decompose/`
- ✅ Design job: `graph/design/nodes/decompose/`

---

### **2. Plan Node (Task-level) - Code & Design 공통**

```typescript
// ✅ Code job & Design job 모두 동일 모듈 사용!
import { analyzeContextNeeds } from '../../../../context/analyzer';
import { loadContext } from '../../../../context/loader';

// Task별 맞춤형 context 로딩
const strategy = analyzeContextNeeds(
  task,
  enforcementReason,
  state.design,
  state.files?.map(f => f.path)
);

const context = await loadContext(strategy, gitPort);
```

**목적**:
- Task 유형별 최적화된 context (setup/feature/error)
- Keyword 기반 검색 (grep)
- Top-ranked 파일만 읽기 (smart pre-loading)

**사용 Job**:
- ✅ Code job: `graph/code/nodes/plan/`
- ✅ Design job: `graph/design/nodes/plan/`

---

## 🔄 **역할 분리**

| **Module** | **Decompose (Code/Design)** | **Plan (Code/Design)** |
|-----------|---------------------------|----------------------|
| `index.ts` | ✅ 사용 | ❌ 사용 안함 |
| `analyzer.ts` | ❌ 사용 안함 | ✅ 사용 |
| `loader.ts` | ❌ 사용 안함 | ✅ 사용 |

---

## 💡 **설계 원칙**

1. **공통 유틸리티** (`index.ts`)
   - 단순하고 범용적인 기능
   - Decompose의 full codebase loading
   - 파일 카운트, 존재 여부 확인

2. **확장 모듈** (`analyzer.ts`, `loader.ts`)
   - Task별 맞춤형 로직
   - Plan의 smart pre-loading
   - Keyword 추출, 검색, 우선순위 결정

3. **중복 제거**
   - `DEFAULT_EXCLUDES` 같은 상수는 공통 모듈에
   - File listing, reading 기본 로직은 공통 모듈에
   - 분석/최적화 로직만 확장 모듈에

---

## 🚀 **마이그레이션 완료**

### **Step 1: 공통 모듈 생성** ✅
- `architect/context/index.ts` 생성
- `loadFullCodebase`, `hasCodebase`, `getFileCount` 추가

### **Step 2: Plan 모듈 이동** ✅
- `code/nodes/plan/contextAnalyzer.ts` → `architect/context/analyzer.ts`
- `code/nodes/plan/contextLoader.ts` → `architect/context/loader.ts`

### **Step 3: Decompose 리팩토링** ✅
- Code job decompose: 직접 파일 읽기 제거 → `loadFullCodebase` 사용
- Design job decompose: (동일 모듈 사용 가능)

### **Step 4: Import 경로 정리** ✅
- Code job: `from '../../../../context/analyzer'`
- Design job: `from '../../../../context/analyzer'` (동일 경로!)

### **Step 5: Architect 레벨로 승격** ✅
- `graph/code/context/` → `architect/context/`
- Code & Design job 모두 공유 가능

