# Context Pre-loading 전략 (Smart Context Loading)

## 📋 **개요**

**Context Pre-loading**은 LLM 첫 호출 전에 필요한 codebase 정보를 자동으로 취합하여 제공하는 시스템입니다.  
Cursor/Copilot의 "Exploring...", "Searching...", "Reading..." UI와 동일한 방식으로 동작합니다.

---

## 🎯 **핵심 원칙**

### **1. Decompose vs Plan 노드의 역할 구분**

```
┌─────────────────────────────────────────────────────────────┐
│ DECOMPOSE NODE (Meta-level Planning)                        │
│ - User directive를 분석하여 Task Queue 생성                  │
│ - Directive가 중요! ("시스템 설계서 기반으로 구현해라")       │
│ - 한 번만 실행 (job 시작시)                                  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ PLAN NODE (Task-level Planning)                             │
│ - 개별 Task를 분석하여 Context Pre-loading                   │
│ - Task가 중요! (type, name, description, error)            │
│ - 매 Task마다 실행                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 **Context 분석 기준 (우선순위)**

### **1. PRIMARY: Task Type**

| **Task Type** | **Explore** | **Grep** | **Read** | **전략** |
|--------------|-----------|---------|---------|---------|
| `setup` | ✅ | ❌ | ❌ | File tree만 (기존 코드 불필요) |
| `feature` | ✅ | ✅ | ✅ | 유사 패턴 검색 + 읽기 (10 files) |
| `error` | ✅ | ✅ | ✅ | 에러 파일 집중 읽기 (5 files) |

---

### **2. SECONDARY: Task Name & Description**

```typescript
// Example
task = {
  name: "Implement Authentication",
  description: "Add login/logout with JWT tokens",
  type: "feature"
}

// 추출된 Keywords
keywords = ["authentication", "login", "logout", "jwt", "tokens"]

// Grep 실행
searchCode(keywords) → finds:
  - src/utils/auth.ts (기존 auth 유틸)
  - src/components/LoginForm.tsx (참고할 컴포넌트)
```

---

### **3. TERTIARY: Design Document**

```typescript
// state.design에서 현재 Task 관련 섹션 추출
state.design = `
## Authentication Module
- JWT-based authentication
- Password hashing with bcrypt
- Login/Logout endpoints
...
`

// 현재 Task: "Implement Authentication"
// → "Authentication Module" 섹션에서 키워드 추출
// → Keywords: ["jwt", "bcrypt", "authentication", "login", "logout"]

// Grep 실행
searchCode(keywords) → 유사 패턴 발견
```

---

### **4. QUATERNARY: Enforcement Reason (Error Context)**

```typescript
// Retry시 에러 메시지에서 파일/키워드 추출
enforcementReason = `
Build Error:
  - src/auth/auth-service.ts:15 - Missing import 'hashPassword'
  - src/auth/auth-service.ts:42 - Type error: User | undefined
`

// 추출
keywords = ["auth-service", "hashPassword", "User"]
files = ["src/auth/auth-service.ts"]

// 직접 읽기
readFile("src/auth/auth-service.ts")
```

---

## 📦 **Context 수집 Flow**

### **Phase 1: Analysis (contextAnalyzer.ts)**

```typescript
export function analyzeContextNeeds(
  task: Task,                   // PRIMARY: Task 자체
  enforcementReason?: string,   // SECONDARY: Error context
  design?: string,              // TERTIARY: Design document
  existingFiles?: string[]      // QUATERNARY: 기존 생성 파일
): ContextStrategy {
  
  // 1. Task Type 기반 전략
  if (task.type === 'setup') {
    return {
      needsExplore: true,
      needsGrep: false,
      needsRead: false,
      keywords: [],
      readFiles: [],
      maxFilesToRead: 0
    };
  }
  
  // 2. Error Task → 집중적 Context
  if (task.type === 'error') {
    return {
      needsExplore: true,
      needsGrep: true,
      needsRead: true,
      keywords: extractErrorKeywords(enforcementReason),
      readFiles: extractErrorFiles(enforcementReason),  // ✅ 에러 파일 직접 읽기
      maxFilesToRead: 5
    };
  }
  
  // 3. Feature Task → 유사 패턴 찾기
  if (task.type === 'feature') {
    const taskKeywords = extractKeywords(task.name + task.description);
    const designKeywords = extractDesignKeywords(design, task);
    
    return {
      needsExplore: true,
      needsGrep: true,
      needsRead: true,
      keywords: [...taskKeywords, ...designKeywords],
      readFiles: [],
      maxFilesToRead: 10
    };
  }
}
```

---

### **Phase 2: Collection (contextLoader.ts)**

```typescript
export async function loadContext(
  strategy: ContextStrategy,
  gitPort: GitPort
): Promise<LoadedContext> {
  
  // 1. EXPLORE: File tree (Always)
  if (strategy.needsExplore) {
    await chatAPI.showChatStatus('exploring');
    const allFiles = await gitPort.listFiles('', [excludes]);
    await chatAPI.showChatStatus('explored', { filesCount: allFiles.length });
    
    context.fileTree = buildFileTree(allFiles);
  }
  
  // 2. GREP: Search for keywords
  if (strategy.needsGrep && strategy.keywords.length > 0) {
    await chatAPI.showChatStatus('grepping');
    const results = await searchCodebase(gitPort, strategy.keywords);
    await chatAPI.showChatStatus('grepped', { filesCount: results.filesMatched });
    
    context.grepResults = formatGrepResults(results);
  }
  
  // 3. READ: Read files
  if (strategy.needsRead) {
    // A. Prioritize explicit readFiles (from error context)
    let filesToRead: string[] = [];
    
    if (strategy.readFiles.length > 0) {
      filesToRead = strategy.readFiles;  // ✅ Error files first!
    } else {
      filesToRead = extractTopFiles(context.grepResults, strategy.maxFilesToRead);
    }
    
    for (const file of filesToRead) {
      await chatAPI.showChatStatus('reading', { file });
      const content = await gitPort.readFile(file);
      context.fileContents += formatFileContent(file, content);
    }
  }
  
  return context;
}
```

---

### **Phase 3: Integration (plan/index.ts)**

```typescript
// LLM에게 제공되는 최종 Context
const llmContext = `
=== CODEBASE CONTEXT ===

${context.fileTree}        // ~2K tokens

${context.grepResults}     // ~5-10K tokens

${context.fileContents}    // ~30-50K tokens

💡 **Available Tools** (use if you need more info):
- read_file(path): Read any specific file
- search_code(pattern): Search for code patterns
- list_files(directory): List specific directory
- write_file(path, content): Create/modify files
- delete_file(path): Remove files
- apply_patch(path, patch): Apply diffs
- run_command(command): Execute commands

=== USER REQUEST ===
${state.design}  // Design document

=== CURRENT TASK ===
Task: ${task.name}
Type: ${task.type}
Description: ${task.description}

${enforcementReason ? `
=== ERROR CONTEXT ===
${enforcementReason}
` : ''}
`;

// Total: ~40-65K tokens
```

---

## 🎯 **실제 시나리오 예시**

### **Scenario 1: Setup Task (첫 작업)**

```typescript
// Input
task: { name: "Setup Next.js", type: "setup" }

// Strategy
{
  needsExplore: true,   // ✅ File tree만
  needsGrep: false,     // ❌ 검색 불필요
  needsRead: false,     // ❌ 읽기 불필요
}

// LLM Context
`
=== CODEBASE CONTEXT ===

=== FILE TREE ===
(empty or minimal)

💡 Available Tools: ...
`
```

---

### **Scenario 2: Feature Task (Authentication)**

```typescript
// Input
task: {
  name: "Implement Authentication",
  description: "Add login/logout with JWT",
  type: "feature"
}
design: `
## Authentication Module
- JWT-based auth
- bcrypt password hashing
- Login/Logout endpoints
`

// Strategy
{
  needsExplore: true,
  needsGrep: true,
  needsRead: true,
  keywords: ["authentication", "login", "logout", "jwt", "bcrypt"],
  maxFilesToRead: 10
}

// LLM Context
`
=== FILE TREE ===
📁 src/auth/ (1 file)
📁 src/utils/ (2 files)

=== SEARCH RESULTS ===
Found 3 matches in 2 files:
  📄 src/utils/crypto.ts
     42: import bcrypt from 'bcrypt';
     56: export const hashPassword = ...
  
  📄 src/auth/types.ts
     12: export interface User { ... }

=== FILE CONTENTS ===
=== src/utils/crypto.ts ===
import bcrypt from 'bcrypt';

export const hashPassword = (password: string) => {
  return bcrypt.hashSync(password, 10);
};

=== src/auth/types.ts ===
export interface User {
  id: string;
  username: string;
  passwordHash: string;
}

💡 Available Tools: ...
`
```

---

### **Scenario 3: Error Task (Build Error)**

```typescript
// Input
task: { name: "Fix Build Errors", type: "error" }
enforcementReason: `
Build Error:
  - src/auth/auth-service.ts:15 - Missing import 'hashPassword'
  - src/auth/auth-service.ts:42 - Type error: User | undefined
`

// Strategy
{
  needsExplore: true,
  needsGrep: true,
  needsRead: true,
  keywords: ["auth-service", "hashPassword", "User"],
  readFiles: ["src/auth/auth-service.ts"],  // ✅ Error file directly!
  maxFilesToRead: 5
}

// LLM Context
`
=== FILE TREE ===
📁 src/auth/ (2 files)

=== SEARCH RESULTS ===
Found 2 matches:
  📄 src/utils/crypto.ts
     56: export const hashPassword
  
  📄 src/auth/types.ts
     12: export interface User

=== FILE CONTENTS ===
=== src/auth/auth-service.ts ===
// ❌ Missing import!
export class AuthService {
  authenticate(user: User) {
    const hash = hashPassword(user.password);  // ❌ Error here!
    // ...
  }
}

=== src/utils/crypto.ts ===
export const hashPassword = (password: string) => { ... };

=== src/auth/types.ts ===
export interface User { ... };

💡 Available Tools: ...
`
```

---

## 📊 **Token 사용량 최적화**

| **Context Type** | **Token 예상** | **조건** |
|-----------------|---------------|---------|
| File Tree | ~2K | Always |
| Grep Results | ~5-10K | If keywords exist |
| File Contents | ~30-50K | Top 5-10 files only |
| **Total** | **~40-65K** | **전체 합계** |

---

## 💡 **핵심 개선점**

### **Before (문제)**
```typescript
// ❌ Directive 기반 (의미 없음)
const strategy = analyzeContextNeeds(
  "작업을 시작해라",  // ❌ 아무 정보 없음
  task,
  enforcementReason
);
```

### **After (해결)**
```typescript
// ✅ Task 기반 (명확함)
const strategy = analyzeContextNeeds(
  task,                // ✅ PRIMARY: Task 자체
  enforcementReason,   // ✅ SECONDARY: Error context
  state.design,        // ✅ TERTIARY: Design document
  existingFiles        // ✅ QUATERNARY: 기존 파일
);
```

---

## 🎯 **결론**

**Context Pre-loading**의 핵심:

1. **Directive는 Decompose 노드에서만 중요** (Task Queue 생성)
2. **Plan 노드는 Task 기반** (type, name, description, error)
3. **Error Task는 readFiles 우선** (grep 결과보다 에러 파일 직접 읽기)
4. **Feature Task는 Design Document 활용** (관련 섹션에서 키워드 추출)
5. **Setup Task는 최소 Context** (File tree만)

이로써 **Cursor/Copilot과 동일한 Smart Context Pre-loading**이 완성되었습니다! 🚀

