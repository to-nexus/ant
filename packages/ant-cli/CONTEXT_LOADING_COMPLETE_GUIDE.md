# Context Loading 완전 가이드

## 📊 **전체 구조**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Code Job vs Design Job                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Decompose (Meta-level)        Plan (Task-level)                │
│  ├─ Code Job      ✅           ├─ Code Job      ✅              │
│  └─ Design Job    ❌           └─ Design Job    ✅ (조건부)      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1️⃣ **Code Job - Decompose Node**

### **🎯 목적**
- **Resume 확인**: Session에서 이어서 진행 가능한지 확인
- **Project Deletion 감지**: 작업 중 프로젝트가 삭제되었는지 확인

### **⚙️ 실행 조건**
```typescript
// Resume 시도시 실행
if (session.state && session.state.taskQueue) {
  if (gitPort) {
    // ✅ Context 로딩 시작
  }
}
```

### **📥 입력 (분석 기준)**
| **항목** | **내용** | **역할** |
|---------|---------|---------|
| **파일 존재 여부만** | 파일 개수 확인 | 삭제 감지용 |

**분석 없음** - 파일 개수만 체크!

---

### **🔍 Context 로딩 방법**

```typescript
// ✅ SMART RELOAD: Only check file count for deletion detection
const allFiles = await gitPort.listFiles('.', [
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 
  'coverage', '.cache', '.turbo', '.vercel', '.netlify'
]);

console.log(`Found ${allFiles.length} files in codebase`);

// ✅ Detect full project deletion
const hasNoFiles = allFiles.length === 0;
if (hasCompletedTasks && hasNoFiles) {
  // Reset and re-decompose
}
```

**특징**:
- ✅ **파일 개수만 확인** (내용 로딩 ❌)
- ✅ 전체 프로젝트 삭제 감지
- ✅ Plan 노드가 Smart Context Loading 수행

---

### **📤 LLM 요청 시 제공되는 소스**

```typescript
// Decompose 노드는 LLM 호출 안함!
// 단순히 state.code 업데이트만 수행

state.code = result.content;

// 이후 Plan 노드에서 사용됨
```

**사용처**: 
- Resume 시 `state.code` 업데이트
- Full project deletion 감지
- **LLM 직접 호출 안함!**

---

## 2️⃣ **Code Job - Plan Node**

### **🎯 목적**
- **Task별 맞춤형 Context**: 현재 Task에 필요한 codebase 정보만 제공
- **Token 최적화**: 관련 있는 파일만 읽어서 전달

### **⚙️ 실행 조건**
```typescript
// 매번 실행
const shouldReload = state.taskQueue && nextTask && gitPort;

if (shouldReload) {
  // ✅ Context 로딩 시작
}
```

---

### **📥 입력 (분석 기준)**

| **우선순위** | **항목** | **내용** | **역할** |
|------------|---------|---------|---------|
| **PRIMARY** | `nextTask` | 현재 실행할 Task | Task type/name/description 분석 |
| **SECONDARY** | `enforcementReason` | 에러 컨텍스트 | 에러 파일/키워드 추출 |
| **TERTIARY** | `state.design` | Design 문서 | Task 관련 키워드 추출 |
| **QUATERNARY** | `state.files` | 이미 생성된 파일 | 패턴 매칭 |

---

### **🔍 Context 분석 (analyzer.ts)**

```typescript
import { analyzeContextNeeds } from '../../../../context/analyzer';

const strategy = analyzeContextNeeds(
  nextTask,                    // PRIMARY
  state.enforcementReason,     // SECONDARY
  state.design,                // TERTIARY
  state.files?.map(f => f.path) // QUATERNARY
);

// strategy = {
//   needsExplore: true,              // File tree 필요?
//   needsGrep: true,                 // Keyword 검색 필요?
//   needsRead: true,                 // 파일 읽기 필요?
//   keywords: ['auth', 'login'],     // 검색할 키워드
//   readFiles: ['auth-service.ts'],  // 직접 읽을 파일 (에러시)
//   maxFilesToRead: 10               // 최대 읽을 파일 수
// }
```

#### **분석 로직**

| **Task Type** | **Explore** | **Grep** | **Read** | **Keywords 출처** | **Max Files** |
|--------------|-----------|---------|---------|------------------|--------------|
| **setup** | ✅ | ❌ | ❌ | - | 0 |
| **feature** | ✅ | ✅ | ✅ | Task name + Design doc | 10 |
| **error** | ✅ | ✅ | ✅ | Error message | 5 |

**예시 1: Feature Task**
```typescript
task = { 
  name: "Implement Authentication", 
  type: "feature",
  description: "Add login/logout with JWT"
}
design = "## Auth Module\n- JWT tokens\n- bcrypt hashing"

// → keywords = ["authentication", "login", "logout", "jwt", "bcrypt"]
```

**예시 2: Error Task**
```typescript
task = { name: "Fix Build Errors", type: "error" }
enforcementReason = `
Build Error:
  - src/auth/auth-service.ts:15 - Missing import 'hashPassword'
`

// → keywords = ["auth-service", "hashPassword"]
// → readFiles = ["src/auth/auth-service.ts"]  // ✅ 직접 읽기!
```

---

### **🔍 Context 로딩 (loader.ts)**

```typescript
import { loadContext } from '../../../../context/loader';

const context = await loadContext(strategy, gitPort);

// context = {
//   fileTree: '📁 src/\n  └─ auth/\n    └─ auth-service.ts',
//   grepResults: 'Found 5 matches in 3 files...',
//   fileContents: '=== auth-service.ts ===\n(content)...',
//   summary: 'Explored 127 files, found 5 matches, read 3 files'
// }
```

#### **실행 순서**

##### **Step 1: Explore (File Tree)**
```typescript
// UI: 🔍 Exploring... → ✅ Explored 127 files

const allFiles = await gitPort.listFiles('', [excludes]);

fileTree = `
=== FILE TREE ===
Total files: 127

📁 src/auth/
  └─ auth-service.ts
  └─ types.ts

📁 src/components/
  └─ LoginForm.tsx
...
`;

// Tokens: ~2K
```

---

##### **Step 2: Grep (Keyword Search)**
```typescript
// UI: 🔍 Searching... → ✅ Found 5 matches in 3 files

const keywords = ["authentication", "login", "jwt"];

grepResults = `
=== SEARCH RESULTS ===
Found 5 matches in 3 files

📄 src/auth/auth-service.ts
   15: export function authenticate(user: User) {
   42: const token = generateJWT(user);

📄 src/utils/crypto.ts
   10: import bcrypt from 'bcrypt';
   23: export const hashPassword = ...

📄 src/auth/types.ts
   5: export interface User { ... }
`;

// Tokens: ~5-10K
```

---

##### **Step 3: Read (Top Files)**
```typescript
// UI: 📖 Reading auth-service.ts... (파일별)

// A. Error Task → readFiles 우선
if (strategy.readFiles.length > 0) {
  filesToRead = strategy.readFiles;  // 에러 파일 직접 읽기
}
// B. Feature Task → Grep 결과 top-ranked
else {
  filesToRead = extractTopFiles(grepResults, strategy.maxFilesToRead);
}

fileContents = `
=== src/auth/auth-service.ts ===
import { User } from './types';
import { hashPassword } from '../utils/crypto';

export class AuthService {
  async authenticate(user: User): Promise<Token> {
    const hashedPassword = hashPassword(user.password);
    // ... (전체 156줄)
  }
}

=== src/utils/crypto.ts ===
import bcrypt from 'bcrypt';
export const hashPassword = (password: string) => {
  return bcrypt.hashSync(password, 10);
};

=== src/auth/types.ts ===
export interface User {
  id: string;
  username: string;
  password: string;
}
`;

// Tokens: ~30-50K
```

---

### **📤 LLM 요청 시 제공되는 소스**

```typescript
// 3. Build context for LLM
const contextParts: string[] = ['=== CODEBASE CONTEXT ===\n'];

if (context.fileTree) {
  contextParts.push(context.fileTree);      // ~2K tokens
  contextParts.push('');
}

if (context.grepResults) {
  contextParts.push(context.grepResults);   // ~5-10K tokens
  contextParts.push('');
}

if (context.fileContents) {
  contextParts.push(context.fileContents);  // ~30-50K tokens
  contextParts.push('');
}

contextParts.push('💡 **Available Tools** (use if you need more info):');
contextParts.push('- `read_file(path)`: Read any file');
contextParts.push('- `search_code(pattern)`: Search for code');
contextParts.push('- `list_files(directory)`: List specific directory');
contextParts.push('- `write_file(path, content)`: Create/modify files');
contextParts.push('- `delete_file(path)`: Remove files');
contextParts.push('- `apply_patch(path, patch)`: Apply diffs');
contextParts.push('- `run_command(command)`: Execute commands\n');

currentCode = contextParts.join('\n');

// Total: ~40-65K tokens
```

#### **LLM에 전달되는 최종 Prompt**

```typescript
const artifacts = {
  directive: state.directive,
  designDoc: state.design,
  prdSpec: state.prd,
  currentCode: currentCode,  // ✅ Smart Context!
  originalFiles: state.codeHead,
  currentTask: {
    name: nextTask.name,
    type: nextTask.type,
    description: nextTask.description
  }
};

const result = await engine.buildPlanPrompt("code", state.context, artifacts);

// LLM receives:
// - User directive
// - Design document
// - PRD spec
// - ✅ CODEBASE CONTEXT (file tree + grep + contents)  ← 여기!
// - Current task info
```

---

## 3️⃣ **Design Job - Decompose Node**

### **🎯 목적**
- Resume 확인만

### **⚙️ 실행 조건**
```typescript
// ❌ Context 로딩 안함!
// 이유: 설계 문서만 복원하면 됨 (codebase 불필요)
```

---

### **📥 입력 (분석 기준)**
- **없음** - Context 로딩 안함

---

### **📤 LLM 요청 시 제공되는 소스**
- **없음** - Decompose에서 LLM 호출 안함

---

## 4️⃣ **Design Job - Plan Node**

### **🎯 목적**
- **Evolution/Refactor 모드**: 기존 codebase 구조 파악
- **Greenfield 모드**: Context 로딩 안함 (새 프로젝트)

### **⚙️ 실행 조건**
```typescript
// 조건부 실행!
const hasExistingCode = Boolean(state.code && state.code.trim().length > 0);
const shouldReload = hasExistingCode && gitPort && currentTask;

if (shouldReload && currentTask) {
  // ✅ Context 로딩 시작 (Evolution/Refactor만!)
}
```

---

### **📥 입력 (분석 기준)**

| **우선순위** | **항목** | **내용** | **역할** |
|------------|---------|---------|---------|
| **PRIMARY** | `currentTask` | 현재 실행할 Task | Task type/name/description 분석 |
| **SECONDARY** | `undefined` | - | Design은 enforcement 없음 |
| **TERTIARY** | `state.prd` | PRD 문서 | Task 관련 키워드 추출 |
| **QUATERNARY** | `state.files` | 이미 생성된 파일 | 패턴 매칭 |

---

### **🔍 Context 분석 & 로딩**

```typescript
const strategy = analyzeContextNeeds(
  currentTask,                 // PRIMARY
  undefined,                   // SECONDARY (no enforcement)
  state.prd,                   // TERTIARY
  state.files?.map(f => f.path) // QUATERNARY
);

const context = await loadContext(strategy, gitPort);
```

**Code Job과 동일한 로직!**
- Explore → Grep → Read
- Task type별 전략 동일
- UI 피드백 동일

---

### **📤 LLM 요청 시 제공되는 소스**

```typescript
let currentCode = state.code;

// Evolution/Refactor 모드에서만 Context 로딩
if (hasExistingCode && gitPort && currentTask) {
  const contextParts: string[] = ['=== CODEBASE CONTEXT ===\n'];
  
  if (context.fileTree) { contextParts.push(context.fileTree); contextParts.push(''); }
  if (context.grepResults) { contextParts.push(context.grepResults); contextParts.push(''); }
  if (context.fileContents) { contextParts.push(context.fileContents); contextParts.push(''); }
  
  contextParts.push('💡 **Available Tools**: ...');
  
  currentCode = contextParts.join('\n');
}

// LLM에 전달
const artifacts = {
  directive: state.directive,
  designDoc: primaryDesign?.content,
  prdSpec: state.prd,
  previousDesign: state.design,
  currentCode: currentCode,  // ✅ Smart Context (조건부!)
  originalFiles: undefined,
  currentTask: { ... }
};

const result = await engine.buildPlanPrompt("design", state.context, artifacts);
```

---

## 📊 **전체 비교표**

| **Job** | **Node** | **실행** | **분석 기준** | **결과물** | **LLM 전달** | **Tokens** |
|--------|---------|---------|-------------|-----------|------------|-----------|
| **Code** | Decompose | ✅ Resume시 | 무조건 전체 | Full codebase | ❌ (state 업데이트만) | ~100K |
| **Code** | Plan | ✅ 매번 | Task + Error + Design | File tree + Grep + Contents | ✅ currentCode | ~40-65K |
| **Design** | Decompose | ❌ | - | - | ❌ | 0 |
| **Design** | Plan | ✅ 조건부 | Task + PRD | File tree + Grep + Contents | ✅ currentCode | ~40-65K |

---

## 🎯 **핵심 포인트**

### **1. 분석 기준**

| **Job** | **Node** | **기준** |
|--------|---------|---------|
| Code | Decompose | ❌ 없음 (무조건 전체) |
| Code | Plan | ✅ Task + Error + Design |
| Design | Decompose | ❌ 없음 (로딩 안함) |
| Design | Plan | ✅ Task + PRD |

---

### **2. Context 로딩**

| **Job** | **Node** | **방법** |
|--------|---------|---------|
| Code | Decompose | `loadFullCodebase()` - 단순 전체 |
| Code | Plan | `analyzeContextNeeds()` + `loadContext()` - 스마트 |
| Design | Decompose | ❌ 없음 |
| Design | Plan | `analyzeContextNeeds()` + `loadContext()` - 스마트 |

---

### **3. LLM에 전달되는 결과물**

**Code Job - Plan**:
```
=== CODEBASE CONTEXT ===

📁 FILE TREE (2K tokens)
127 files organized...

📝 SEARCH RESULTS (5-10K tokens)
Found 5 matches in 3 files...

📄 FILE CONTENTS (30-50K tokens)
=== auth-service.ts ===
(full content)

💡 Available Tools
- read_file(path)
- search_code(pattern)
...
```

**Design Job - Plan (Evolution/Refactor)**:
```
=== CODEBASE CONTEXT ===

📁 FILE TREE (2K tokens)
127 files organized...

📝 SEARCH RESULTS (5-10K tokens)
Found 3 matches in 2 files...

📄 FILE CONTENTS (30-50K tokens)
=== existing-design.md ===
(full content)

💡 Available Tools
- read_file(path)
- search_code(pattern)
...
```

**Design Job - Plan (Greenfield)**:
```
(no context - new project)
```

---

## ✅ **요약**

**Context 로딩의 핵심**:

1. **분석 기준**: Task (type/name/description) + Error/Design/PRD
2. **로딩 방법**: Explore (file tree) → Grep (keyword search) → Read (top files)
3. **결과물**: File tree + Search results + File contents (~40-65K tokens)
4. **LLM 전달**: `currentCode` 필드에 포함되어 전달

**이로써 LLM은 Task별로 최적화된 Codebase Context를 받아 작업을 수행합니다!** 🚀

