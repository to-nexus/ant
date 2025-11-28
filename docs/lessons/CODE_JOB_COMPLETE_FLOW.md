# 🤖 Code Job 전체 흐름 완전 분석

## 📋 **목차**
1. [전체 워크플로우](#전체-워크플로우)
2. [Retrieval: 소스 수집](#retrieval-소스-수집)
3. [Prompt 구성: 우선순위](#prompt-구성-우선순위)
4. [LLM 판단 및 응답](#llm-판단-및-응답)
5. [Tool Calling 루프](#tool-calling-루프)
6. [실제 시나리오](#실제-시나리오)

---

## 🔄 **전체 워크플로우**

```
사용자 요청 (채팅/파일)
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 1. RESOLVE (소스 수집)                                        │
│    - Design Doc 로드                                         │
│    - Directive 로드 (Chat > File)                           │
│    - Codebase Retrieval (Vector/Keyword/Git)               │
│    - Profile 분석 (언어/프레임워크)                          │
│    - Memory 검색 (Vector DB)                                │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. DECOMPOSE (작업 분해) - LLM 호출 #1                       │
│    - Directive 분석                                          │
│    - Task Queue 생성                                         │
│    - Priority 결정 (setup → feature → bugfix)               │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. PLAN (실행 계획) - LLM 호출 #2                            │
│    - Current Task 계획 수립                                  │
│    - 파일 목록 결정                                           │
│    - Dependency 확인                                         │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. CODEGEN (코드 생성) - LLM 호출 #3+                        │
│    ┌───────────────────────────────────────────────┐       │
│    │ LLM 응답:                                      │       │
│    │  - Thinking (사고 과정)                       │       │
│    │  - Text (설명)                                │       │
│    │  - Tool Calls (파일 작업)                     │       │
│    └───────────────────────────────────────────────┘       │
│                     ↓                                        │
│    Tool Calls 있음? ──YES→ [5. TOOL]                       │
│         │                      ↓                            │
│         NO                 Tool 실행                        │
│         ↓                      ↓                            │
│    [Router]            Tool Results 추가                   │
│         ↓                      ↓                            │
│    Priority 판단         [4. CODEGEN] ← 재호출              │
│         ↓                                                    │
│    ┌─────────────────────────────────┐                     │
│    │ Setup Task?    → installDeps    │                     │
│    │ Feature Task?  → checkTaskStatus│                     │
│    │ Error Task?    → runtimeValidate│                     │
│    └─────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. TASK 완료 → 다음 Task                                    │
│    - taskQueue.dequeue()                                    │
│    - 다음 Task 있음? → [3. PLAN]                           │
│    - 없음? → [7. LEARN]                                     │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. LEARN (학습 저장)                                         │
│    - 작업 결과 Vector DB 저장                               │
│    - 패턴/교훈 추출                                          │
└─────────────────────────────────────────────────────────────┘
  ↓
✅ 완료
```

---

## 📥 **Retrieval: 소스 수집**

### **Phase 1: resolve 노드**

```typescript
// 1. Design Document 로드
const designResult = await ArtifactService.findLatestDesign(context, gitPort);
const design = designResult?.content || undefined;

// 2. Directive 로드 (우선순위)
if (state.overrideDirective) {
  // ✅ 최우선: Chat 입력
  directive = state.overrideDirective;
} else {
  // ✅ 파일 시스템: directive.md
  directive = await ArtifactService.getDirective(context, 'code', gitPort);
}

// 3. Codebase Retrieval (Smart Hybrid Strategy)
const codeContext = await retriever.retrieve(
  directive || design || "",
  context.workingDir,
  {
    git: state.deps?.git,
    vectorDB: state.deps?.memory
  },
  {
    maxTokens: 100000,  // ~75KB
    maxFiles: 30,
    exclude: ['test', 'tests', '__tests__']
  }
);

// Result:
{
  code: `
FILE: src/Auth.ts [CURRENT]
export class AuthService { ... }

FILE: src/api/user.ts [CURRENT]
export function getUser() { ... }
  `,
  codeHead: `
FILE: src/Auth.ts [ORIGINAL - Git HEAD]
export class AuthService { ... }
  `,
  files: [
    {
      path: 'src/Auth.ts',
      sources: [
        { type: 'vector', score: 0.92 },
        { type: 'git-changed' }
      ],
      priority: 'high',
      hasLocalChanges: true
    },
    {
      path: 'src/api/user.ts',
      sources: [
        { type: 'keyword', matches: 5 }
      ],
      priority: 'normal',
      hasLocalChanges: false
    }
  ],
  strategy: 'hybrid',
  stats: {
    filesLoaded: 2,
    filesChanged: 1,
    estimatedTokens: 5000,
    sourceBreakdown: {
      vectorSearch: 1,
      keywordSearch: 1,
      gitChanged: 1,
      importGraph: 0
    }
  }
}

// 4. Profile 분석
const profile = await analyzer.analyze(codeContext.code, context.workingDir);
// Result:
{
  language: 'typescript',
  framework: 'react',
  buildTool: 'vite',
  packageManager: 'pnpm'
}

// 5. Memory 검색 (Long-term Knowledge)
const memory = await retrieveMemory(
  directive || design,
  context.project
);
// Result:
`
Previous Learnings:
- Auth 구현 시 async/await 필수
- JWT 토큰은 httpOnly 쿠키 사용
- bcrypt로 비밀번호 해싱

Architecture & Design:
- Clean Architecture 적용
- Domain 레이어 분리
- Hexagonal Architecture
`
```

---

## 📝 **Prompt 구성: 우선순위**

### **6-Layer Prompt Assembly Pipeline**

```typescript
// Layer 1: Normalize (입력 정규화)
const normalized = normalizer.normalizeExecuteInput(task, context, artifacts, mode);

// Layer 2: Assemble Context (소스 취합)
const assembled = await assembler.assemble(
  task,
  context,
  { git, memory, analyzer },
  contextLoader,
  artifacts
);
// Result:
{
  directive: "사용자 인증 기능 추가",
  designDoc: "# System Design\n...",
  currentCode: "FILE: src/Auth.ts\n...",
  originalFiles: "FILE: src/Auth.ts [Git HEAD]\n...",
  currentTask: {
    name: "Implement user authentication",
    type: "feature",
    priority: 2,
    description: "Add login/logout functionality"
  },
  memory: "Previous learnings:\n- Auth 구현 시...",
  codebaseProfile: {
    language: 'typescript',
    framework: 'react'
  },
  stats: {
    hasDirective: true,
    hasDesign: true,
    hasOriginalFiles: true,
    hasCurrentCode: true,
    hasMemory: true,
    codebaseDetected: true
  }
}

// Layer 3: Mode Control (모드 결정)
const modeConfig = controller.determineMode(
  task,
  "execute",
  assembled,
  mode,
  taskType
);
// Result:
{
  task: 'code',
  phase: 'execute',
  mode: undefined,
  templates: {
    base: 'code/phases/execute/base',
    rules: 'code/phases/execute/rules',
    injections: [
      'base/injections/memory',           // Memory 있을 때
      'code/base/injections/profiles',    // Profile 있을 때
      'code/base/injections/current-task' // Task 정보
    ]
  },
  llmParams: {
    maxTokens: 4096,
    temperature: 0.2,
    streaming: true
  },
  flags: {
    includeExamples: true,     // execute phase + code task
    includeProfiles: true,     // codebase detected
    includeMemory: true,       // memory available
    strictValidation: true     // code task
  }
}

// Layer 4: Compose (템플릿 렌더링)
const composed = await composer.compose(modeConfig, context, assembled);
// Result:
{
  system: `
You are a senior software engineer...
  `,
  profiles: `
# Codebase Profile
- Language: TypeScript
- Framework: React
- Build Tool: Vite
  `,
  base: `
# Project: my-project

## Current Task
Name: Implement user authentication
Type: feature
Priority: 2
Description: Add login/logout functionality

## User Request (Directive)
사용자 인증 기능 추가

## Design Document
# System Design
...

## Current Codebase
FILE: src/Auth.ts [CURRENT]
export class AuthService { ... }

FILE: src/Auth.ts [ORIGINAL - Git HEAD]
export class AuthService { ... }  // 변경 전
  `,
  rules: `
# Output Rules
1. Use <thinking> for reasoning
2. Use tool calls for file operations
3. NEVER write entire file, use apply_patch
  `,
  injections: `
# Memory (Long-term Knowledge)
- Auth 구현 시 async/await 필수
- JWT 토큰은 httpOnly 쿠키 사용

# Current Task Context
This is task 2/5 in the current job.
Focus on authentication implementation only.
  `,
  examples: `
# Good Example
<thinking>
I need to add login functionality...
</thinking>

<tool_call>
  <name>read_file</name>
  <arguments>{"path": "src/Auth.ts"}</arguments>
</tool_call>
  `
}

// Layer 5: Policy Injection (정책 주입)
const policySection = policyInjector.buildPolicySection(modeConfig);
const guardrailSection = policyInjector.buildGuardrailSection(modeConfig);

// Layer 6: Format (최종 포맷)
const formatted = formatter.format(promptWithPolicies, modeConfig);
```

### **최종 Prompt 구조 (우선순위 순)**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣ GUARDRAILS (최우선 - 안전 규칙)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- NEVER delete files without user confirmation
- NEVER modify .git directory
- NEVER expose secrets

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2️⃣ SYSTEM PROMPT (역할 정의)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are a senior software engineer...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3️⃣ PROFILES (코드베이스 환경)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Codebase Profile
- Language: TypeScript
- Framework: React
- Build Tool: Vite

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4️⃣ CURRENT TASK (작업 컨텍스트)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Current Task (Task 2/5)
Name: Implement user authentication
Type: feature
Priority: 2
Description: Add login/logout functionality

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5️⃣ DIRECTIVE (사용자 요청) - 최우선 입력
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
사용자 인증 기능 추가
- 로그인/로그아웃
- JWT 토큰 사용
- 비밀번호 해싱

⚠️ 우선순위:
  1. Chat Input (overrideDirective) ← 최우선!
  2. directive.md (파일 시스템)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6️⃣ DESIGN DOCUMENT (설계 문서)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# System Design

## Architecture
- Clean Architecture
- Domain-driven design

## Authentication Flow
1. User submits credentials
2. Server validates
3. Return JWT token

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7️⃣ MEMORY (장기 지식)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Previous Learnings
- Auth 구현 시 async/await 필수
- JWT 토큰은 httpOnly 쿠키 사용
- bcrypt로 비밀번호 해싱

# Architecture & Design Patterns
- Repository pattern for data access
- Service layer for business logic

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8️⃣ CURRENT CODE (현재 코드베이스)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILE: src/Auth.ts [CURRENT - Working Tree]
export class AuthService {
  // 현재 상태
}

FILE: src/api/user.ts [CURRENT]
export function getUser() { ... }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9️⃣ ORIGINAL CODE (Git HEAD - 비교용)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILE: src/Auth.ts [ORIGINAL - Git HEAD]
export class AuthService {
  // 변경 전 상태
}

⚠️ MODIFICATION MODE: Copy original, then modify

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔟 RULES (출력 규칙)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Always use <thinking> for reasoning
2. Use tool calls for file operations
3. NEVER write entire file, use apply_patch
4. Read files before modifying

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣1️⃣ EXAMPLES (예시)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Good Example:
<thinking>...</thinking>
<tool_call>...</tool_call>

# Bad Example:
<write_file>...</write_file>  ← 전체 파일 덮어쓰기 금지!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1️⃣2️⃣ POLICIES (정책)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Minimal changes principle
- Test first approach
- Follow existing patterns
```

### **소스 우선순위 정리**

```
입력 소스 우선순위:
1. Guardrails (안전 규칙) - 최우선
2. Chat Input (overrideDirective) - 사용자 최우선
3. Current Task (작업 컨텍스트)
4. Directive File (directive.md)
5. Design Document
6. Memory (Vector DB)
7. Current Code (Hybrid Retrieval)
8. Original Code (Git HEAD)
9. Rules & Examples
10. Policies
```

---

## 🤖 **LLM 판단 및 응답**

### **LLM이 받는 최종 메시지**

```typescript
// codeGen 노드에서 LLM 호출
const messages = [
  {
    role: 'system',
    content: <위의 전체 프롬프트>
  },
  {
    role: 'user',
    content: `
Current Task: Implement user authentication

Please proceed with the implementation.
    `
  }
];

// Tool definitions
const tools = [
  {
    name: 'read_file',
    description: 'Read file contents',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Create new file',
    input_schema: { ... }
  },
  {
    name: 'apply_patch',
    description: 'Apply incremental changes',
    input_schema: { ... }
  },
  {
    name: 'delete_file',
    description: 'Delete file',
    input_schema: { ... }
  },
  {
    name: 'list_directory',
    description: 'List directory contents',
    input_schema: { ... }
  }
];

// LLM 호출
const response = await llmClient.streamWithTools(messages, tools);
```

### **LLM 응답 구조**

```typescript
// Response Stream:
{
  // 1. Thinking (사고 과정)
  thinking: `
먼저 Auth.ts 파일을 읽어서 현재 구조를 파악해야 합니다.
그 다음 validateUser 메서드를 추가하겠습니다.
비밀번호 검증은 bcrypt를 사용하겠습니다.
  `,
  
  // 2. Text (설명)
  text: `
사용자 인증 기능을 구현하겠습니다.
먼저 기존 코드를 확인하겠습니다.
  `,
  
  // 3. Tool Calls (파일 작업)
  toolCalls: [
    {
      id: 'call_1',
      name: 'read_file',
      arguments: {
        path: 'src/Auth.ts'
      }
    }
  ]
}
```

---

## 🔄 **Tool Calling 루프**

### **CodeGen ↔ Tool 순환**

```
┌─────────────────────────────────────────────────────┐
│ CodeGen 노드                                         │
│                                                      │
│ LLM 호출:                                            │
│   messages = [system, user, ...history]            │
│   tools = [read_file, write_file, apply_patch...]  │
│                                                      │
│ Response:                                            │
│   thinking: "먼저 Auth.ts를 읽어야..."              │
│   text: "코드를 확인하겠습니다"                      │
│   toolCalls: [                                      │
│     { name: 'read_file', args: {...} }             │
│   ]                                                  │
└─────────────────────────────────────────────────────┘
  ↓ toolCalls 있음?
┌─────────────────────────────────────────────────────┐
│ Tool 노드                                            │
│                                                      │
│ 1. Tool 실행:                                        │
│    read_file('src/Auth.ts')                         │
│    → content = "export class AuthService { ... }"   │
│                                                      │
│ 2. Result 기록:                                      │
│    toolResults.push({                               │
│      toolCallId: 'call_1',                          │
│      result: content                                │
│    })                                                │
│                                                      │
│ 3. Conversation History 업데이트:                   │
│    history.push({                                   │
│      role: 'assistant',                             │
│      content: [                                     │
│        { type: 'thinking', text: "..." },          │
│        { type: 'text', text: "..." },              │
│        { type: 'tool_use', id: 'call_1', ... }     │
│      ]                                               │
│    })                                                │
│    history.push({                                   │
│      role: 'user',                                  │
│      content: [                                     │
│        { type: 'tool_result',                      │
│          tool_use_id: 'call_1',                    │
│          content: "export class AuthService..." }   │
│      ]                                               │
│    })                                                │
└─────────────────────────────────────────────────────┘
  ↓ 다시 CodeGen으로
┌─────────────────────────────────────────────────────┐
│ CodeGen 노드 (2nd call)                             │
│                                                      │
│ LLM 호출:                                            │
│   messages = [                                      │
│     system,                                         │
│     user,                                           │
│     assistant (thinking + text + tool_use),        │
│     user (tool_result: "export class...")          │
│   ]                                                  │
│                                                      │
│ Response:                                            │
│   thinking: "AuthService에 validateUser 추가..."   │
│   text: "검증 메서드를 추가하겠습니다"               │
│   toolCalls: [                                      │
│     { name: 'apply_patch',                         │
│       args: {                                       │
│         path: 'src/Auth.ts',                       │
│         patch: "..."                                │
│       }                                              │
│     }                                                │
│   ]                                                  │
└─────────────────────────────────────────────────────┘
  ↓ toolCalls 있음?
┌─────────────────────────────────────────────────────┐
│ Tool 노드 (2nd call)                                │
│                                                      │
│ 1. Tool 실행:                                        │
│    apply_patch('src/Auth.ts', patch)                │
│    → File updated: +15 -3                           │
│                                                      │
│ 2. Result 기록 + History 업데이트                   │
└─────────────────────────────────────────────────────┘
  ↓ 다시 CodeGen으로
┌─────────────────────────────────────────────────────┐
│ CodeGen 노드 (3rd call)                             │
│                                                      │
│ LLM 호출 (full history)                             │
│                                                      │
│ Response:                                            │
│   thinking: "Auth 구현 완료, 다음은 API..."        │
│   text: "인증 서비스 구현이 완료되었습니다"          │
│   toolCalls: []  ← 더 이상 없음                     │
└─────────────────────────────────────────────────────┘
  ↓ toolCalls 없음
┌─────────────────────────────────────────────────────┐
│ Router (routeAfterCodeGen)                          │
│                                                      │
│ Priority 판단:                                       │
│   currentTask.priority === 1 (setup)?               │
│     → installDeps                                   │
│   currentTask.priority === 2 (feature)?             │
│     → checkTaskStatus                               │
│   currentTask.priority === 3 (error)?               │
│     → runtimeValidate                               │
└─────────────────────────────────────────────────────┘
```

### **Conversation History 누적**

```typescript
// 1st Turn
messages = [
  { role: 'system', content: <프롬프트> },
  { role: 'user', content: "Task: Implement auth" }
];

// 2nd Turn (after read_file)
messages = [
  { role: 'system', content: <프롬프트> },
  { role: 'user', content: "Task: Implement auth" },
  { role: 'assistant', content: [
    { type: 'thinking', text: "먼저 Auth.ts를 읽어야..." },
    { type: 'text', text: "코드를 확인하겠습니다" },
    { type: 'tool_use', id: 'call_1', name: 'read_file', input: {...} }
  ]},
  { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'call_1', content: "export class..." }
  ]}
];

// 3rd Turn (after apply_patch)
messages = [
  { role: 'system', content: <프롬프트> },
  { role: 'user', content: "Task: Implement auth" },
  { role: 'assistant', content: [...]},  // 1st turn
  { role: 'user', content: [...]},       // 1st tool result
  { role: 'assistant', content: [
    { type: 'thinking', text: "validateUser 추가..." },
    { type: 'text', text: "검증 메서드를 추가하겠습니다" },
    { type: 'tool_use', id: 'call_2', name: 'apply_patch', input: {...} }
  ]},
  { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'call_2', content: "Updated: +15 -3" }
  ]}
];

// ✅ LLM은 전체 대화 히스토리를 기억
```

---

## 🎬 **실제 시나리오**

### **시나리오: "사용자 로그인 기능 추가해줘"**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1. RESOLVE] 소스 수집
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Design Doc: ✅ 로드
   "# System Design\n인증 시스템 설계..."

2. Directive: ✅ Chat 입력 (최우선)
   "사용자 로그인 기능 추가해줘"

3. Codebase Retrieval:
   Query: "사용자 로그인 기능"
   
   Vector Search (0.3s):
     - src/Auth.ts (score: 0.92, git-changed)
     - src/api/user.ts (score: 0.85)
   
   Keyword Search (0.1s):
     - src/components/LoginForm.tsx (matches: 15)
   
   Git Changes:
     - src/Auth.ts (modified)
   
   → Hybrid Merge:
     files: [
       'src/Auth.ts' (vector + git-changed, high priority),
       'src/api/user.ts' (vector, normal),
       'src/components/LoginForm.tsx' (keyword, normal)
     ]
   
   → Load Content:
     code: "FILE: src/Auth.ts [CURRENT]\n..."
     codeHead: "FILE: src/Auth.ts [ORIGINAL]\n..."

4. Profile 분석:
   language: 'typescript'
   framework: 'react'
   buildTool: 'vite'

5. Memory 검색:
   "- Auth 구현 시 async/await 필수
    - JWT 토큰은 httpOnly 쿠키 사용"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[2. DECOMPOSE] 작업 분해 (LLM #1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LLM Input:
  - Directive: "사용자 로그인 기능 추가해줘"
  - Design: "인증 시스템 설계..."
  - Codebase: "src/Auth.ts, src/api/user.ts..."

LLM Output:
  <task_list>
    <task priority="2" type="feature">
      <name>Implement authentication service</name>
      <description>Add validateUser method to AuthService</description>
    </task>
    <task priority="2" type="feature">
      <name>Create login API endpoint</name>
      <description>Add POST /api/login</description>
    </task>
    <task priority="2" type="feature">
      <name>Build login form UI</name>
      <description>Create LoginForm component</description>
    </task>
  </task_list>

State Update:
  taskQueue = [Task1, Task2, Task3]
  currentTask = Task1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3. PLAN] 실행 계획 (LLM #2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LLM Input:
  - Current Task: "Implement authentication service"
  - Codebase: "src/Auth.ts [CURRENT + ORIGINAL]"
  - Memory: "Auth 구현 시 async/await 필수..."

LLM Output:
  <plan>
    1. Read current Auth.ts to understand structure
    2. Add validateUser method with async/await
    3. Use bcrypt for password hashing
    4. Return JWT token on success
  </plan>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4. CODEGEN] 코드 생성 (LLM #3)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LLM Input:
  messages: [
    { role: 'system', content: <전체 프롬프트> },
    { role: 'user', content: "Task: Implement authentication service" }
  ]
  tools: [read_file, write_file, apply_patch, ...]

LLM Response:
  {
    thinking: "먼저 Auth.ts를 읽어서 현재 구조를 파악해야 합니다.",
    text: "코드를 확인하겠습니다.",
    toolCalls: [
      {
        id: 'toolu_1',
        name: 'read_file',
        input: { path: 'src/Auth.ts' }
      }
    ]
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[5. TOOL] 파일 읽기
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tool Execution:
  read_file('src/Auth.ts')
  → content = `
export class AuthService {
  constructor(private db: Database) {}
  
  async hashPassword(password: string) {
    return bcrypt.hash(password, 10);
  }
}
  `

State Update:
  toolResults.push({
    toolCallId: 'toolu_1',
    result: content
  })
  
  conversationHistory.push(
    { role: 'assistant', content: [thinking, text, tool_use] },
    { role: 'user', content: [tool_result] }
  )

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4. CODEGEN] 코드 생성 (LLM #4 - 2nd turn)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LLM Input:
  messages: [
    { role: 'system', content: <프롬프트> },
    { role: 'user', content: "Task: ..." },
    { role: 'assistant', content: [thinking, text, tool_use('read_file')] },
    { role: 'user', content: [tool_result: "export class AuthService..."] }
  ]

LLM Response:
  {
    thinking: "AuthService에 validateUser 메서드를 추가하겠습니다.
               async/await를 사용하고, bcrypt로 비밀번호를 검증합니다.",
    text: "인증 메서드를 추가하겠습니다.",
    toolCalls: [
      {
        id: 'toolu_2',
        name: 'apply_patch',
        input: {
          path: 'src/Auth.ts',
          patch: `
--- src/Auth.ts
+++ src/Auth.ts
@@ -4,4 +4,15 @@
   async hashPassword(password: string) {
     return bcrypt.hash(password, 10);
   }
+
+  async validateUser(email: string, password: string) {
+    const user = await this.db.findUserByEmail(email);
+    if (!user) return null;
+    
+    const isValid = await bcrypt.compare(password, user.passwordHash);
+    if (!isValid) return null;
+    
+    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
+    return { user, token };
+  }
 }
          `
        }
      }
    ]
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[5. TOOL] 패치 적용
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tool Execution:
  apply_patch('src/Auth.ts', patch)
  → File updated: +11 -0
  → chatAPI.completeFileEdit('src/Auth.ts', +11, -0)

State Update:
  toolResults.push({
    toolCallId: 'toolu_2',
    result: "File updated successfully"
  })

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4. CODEGEN] 코드 생성 (LLM #5 - 3rd turn)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LLM Input:
  messages: [
    ...previous history...,
    { role: 'assistant', content: [thinking, text, tool_use('apply_patch')] },
    { role: 'user', content: [tool_result: "File updated"] }
  ]

LLM Response:
  {
    thinking: "인증 서비스 구현이 완료되었습니다. 다음 작업으로 진행합니다.",
    text: "AuthService에 validateUser 메서드가 추가되었습니다.
           이제 JWT 토큰 기반 인증이 가능합니다.",
    toolCalls: []  ← 더 이상 없음!
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Router] 다음 단계 결정
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

currentTask.priority = 2 (feature)
  → checkTaskStatus

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[checkTaskStatus] Task 완료 판단
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

violations = []  (no errors)
currentTask = Task1 ✅ 완료

taskQueue.dequeue()
  → currentTask = Task2 (Create login API endpoint)

다음 작업 있음? YES
  → [3. PLAN] 으로 돌아가서 Task2 계획

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
... Task2, Task3 반복 ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[7. LEARN] 학습 저장
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

learnings = `
## 작업 완료: 사용자 로그인 기능

### 구현 내용
- AuthService.validateUser 메서드 추가
- bcrypt를 사용한 비밀번호 검증
- JWT 토큰 생성 및 반환
- POST /api/login 엔드포인트
- LoginForm 컴포넌트

### 학습된 패턴
- 인증 로직은 Service 레이어에 구현
- 비밀번호는 항상 bcrypt로 해싱
- JWT 토큰은 httpOnly 쿠키로 전달
- 프론트엔드는 토큰 자동 관리

### 주의사항
- JWT_SECRET은 환경 변수로 관리
- 토큰 만료 시간 설정 필수
- 실패 시 명확한 에러 메시지
`

→ Vector DB 저장
  type: 'learning'
  task: 'code'
  content: learnings

✅ 완료!
```

---

## ✅ **최종 정리**

### **전체 흐름 요약**

```
1. RESOLVE (소스 수집)
   ├─ Design Doc 로드
   ├─ Directive 로드 (Chat > File)
   ├─ Codebase Retrieval (Vector + Keyword + Git)
   ├─ Profile 분석
   └─ Memory 검색

2. DECOMPOSE (작업 분해) - LLM #1
   └─ Task Queue 생성

3. PLAN (실행 계획) - LLM #2
   └─ Current Task 계획 수립

4. CODEGEN (코드 생성) - LLM #3+
   ├─ Thinking (사고)
   ├─ Text (설명)
   └─ Tool Calls (파일 작업)
        ↓
5. TOOL (도구 실행)
   ├─ 파일 읽기/쓰기/수정
   ├─ Tool Results 기록
   └─ History 업데이트
        ↓
4. CODEGEN (재호출)
   └─ Tool Results 반영하여 계속...
        ↓
   Tool Calls 없음?
        ↓
6. Router (우선순위 판단)
   ├─ Setup → installDeps
   ├─ Feature → checkTaskStatus
   └─ Error → runtimeValidate

7. LEARN (학습 저장)
   └─ Vector DB에 패턴/교훈 저장
```

### **소스 우선순위**

```
1. Chat Input (overrideDirective) ← 최우선!
2. Directive File (directive.md)
3. Design Document
4. Current Code (Hybrid Retrieval)
   ├─ Vector Search (의미적 유사도)
   ├─ Keyword Search (텍스트 매칭)
   └─ Git Changes (로컬 변경사항)
5. Original Code (Git HEAD)
6. Memory (Vector DB - 장기 지식)
7. Profile (언어/프레임워크)
```

### **LLM 호출 횟수**

```
최소: 3회 (decompose + plan + codegen)
평균: 5-10회 (codegen + tool calls)
최대: 무제한 (tool calling 루프)
```

### **Tool Calling 특징**

```
✅ 멀티턴 대화
✅ History 누적
✅ 점진적 작업
✅ 실시간 파일 수정
✅ 오류 시 재시도
```

**완벽한 흐름입니다!** 🎉

