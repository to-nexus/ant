# Code Job RAG 완전 리팩토링 설계서

## 🎯 목표

**문제점**:
1. Resolve의 Vector DB 검색이 대부분 낭비됨
2. 각 노드가 task-specific context를 가지지 못함
3. state.files와 gitDiff의 역할 중복
4. planText가 레거시로 사용되지 않음
5. Reference 프로젝트 처리가 체계적이지 않음

**개선 방향**:
- **Resolve**: Profile 분석만
- **DetectEnvironment**: 환경 감지 + RAG 필요성 판단 + 검색 키워드 생성
- **Decompose**: 조건부 RAG + Task 분해
- **Plan**: LLM 기반 키워드 생성 + Task-specific RAG
- **CodeGen**: 키워드로 검색된 context 사용

---

## 📊 현재 vs 개선 후 비교

### 현재 구조
```
resolve
  ├─ Vector DB 검색 (15 files, ~75KB)  ← 낭비
  └─ Profile 분석

detectEnvironment
  └─ 환경 감지만

decompose
  ├─ state.code 사용 안 함  ← 문제
  └─ Task 분해

plan
  ├─ Smart context loading (Git grep만)
  └─ planText 생성  ← 레거시 (사용 안 됨)

codeGen
  ├─ state.code (resolve에서, task-specific 아님)
  ├─ state.gitDiff
  ├─ state.files  ← gitDiff와 중복?
  └─ Tool calling
```

### 개선 후 구조
```
resolve
  └─ Profile 분석만  ← 최소화

detectEnvironment
  ├─ 환경 감지 (frontend/backend/fullstack)
  ├─ RAG 필요성 판단 (requireCodebase flag)
  ├─ 검색 키워드 생성:
  │   ├─ codebaseKeywords (main project)
  │   └─ referenceKeywords (per reference project)
  └─ Output: {
        environment,
        requireCodebase,
        codebaseKeywords,
        referenceKeywords: Map<project, keywords>
      }

decompose
  ├─ IF requireCodebase:
  │   ├─ Vector DB 검색 (codebaseKeywords)
  │   ├─ Git diff 추출
  │   └─ Reference 검색 (referenceKeywords)
  ├─ LLM Input:
  │   ├─ directive
  │   ├─ designDoc
  │   ├─ profile
  │   ├─ codeContext (optional)
  │   ├─ gitDiff (optional)
  │   └─ referenceContexts (optional)
  └─ Task 분해

plan
  ├─ LLM: Task → keywords (task-specific)
  ├─ Vector DB 검색 (keywords)
  ├─ Git diff 추출
  ├─ Reference 검색 (if needed)
  └─ Save keywords to state

codeGen
  ├─ Use pre-searched context from plan:
  │   ├─ codeContext (from plan)
  │   ├─ gitDiff (from plan)
  │   └─ referenceContexts (from plan)
  └─ Tool calling (as needed)
```

---

## 🔴 핵심 변경사항

### 1. state.files vs gitDiff 통합

#### 분석:
```typescript
// state.files (resolve.ts Line 325-338)
const files: { path: string; content: string }[] = [];
// → Full file contents from Vector DB search

// state.gitDiff (FileLoader.ts)
interface GitDiffSummary {
  hasChanges: boolean;
  summary: string;  // Compact summary
  changedFiles: Array<{
    path: string;
    status: 'modified' | 'added' | 'deleted';
    additions: number;
    deletions: number;
  }>;
}
// → Compact diff summary
```

#### 결론: **역할이 다름!**
- **state.files**: Vector DB에서 검색된 전체 파일 (semantic search)
- **state.gitDiff**: Working tree의 변경사항 요약 (git diff)

#### 개선: 통합하지 않고 명확히 분리
```typescript
// NEW state structure
interface ArchitectGraphState {
  // ✅ Task-specific code context (from Vector DB)
  codeContext?: {
    code: string;  // Full file contents
    files: Array<{path: string; content: string}>;
    stats: { filesLoaded: number; estimatedTokens: number };
  };
  
  // ✅ Git changes (working tree diff)
  gitDiff?: GitDiffSummary;
  
  // ✅ Reference project contexts
  referenceContexts?: Array<{
    project: string;
    code: string;
    files: Array<{path: string; content: string}>;
  }>;
}
```

### 2. planText 제거

#### 확인:
```typescript
// codeGen.ts (Line 327-340, 440-444)
if (state.planText && state.currentTask) {
  // planText를 prompt에 inject
}

if (state.planText) {
  lines.push(`# Execution Plan`);
  lines.push(state.planText);
}
```

#### 결론: **실제로 사용되고 있음!**

**문제**: 사용자 분석이 틀림 - planText는 레거시가 아님!
- Plan 노드가 LLM 호출 안 하지만, planText는 여전히 필요
- CodeGen의 buildRuntimeContext에서 사용

#### 수정: planText 유지 → taskKeywords 추가
```typescript
interface ArchitectGraphState {
  planText: string;  // ✅ 유지 (사용 중)
  taskKeywords?: string[];  // 🔥 NEW: Plan에서 LLM이 생성한 검색 키워드
}
```

---

## 🏗️ 새로운 State 구조

```typescript
export interface ArchitectGraphState extends TaskArtifacts {
  // ... existing fields ...
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔥 NEW: DetectEnvironment Output
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  requireCodebase?: boolean;  // decompose에 RAG 필요 여부
  codebaseKeywords?: string[];  // Main project 검색 키워드
  referenceKeywords?: Map<string, string[]>;  // Reference project별 키워드
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔥 NEW: Task-specific Context (from plan node)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  taskKeywords?: string[];  // Plan에서 LLM이 생성한 task 키워드
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ✅ REFACTORED: Code Context (task-specific, from Vector DB)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  codeContext?: {
    code: string;  // Full file contents (formatted)
    files: Array<{path: string; content: string}>;
    stats: { filesLoaded: number; estimatedTokens: number };
    source: 'resolve' | 'decompose' | 'plan';  // Where it came from
  };
  
  // ✅ KEPT: Git Diff (working tree changes)
  gitDiff?: GitDiffSummary;
  
  // ✅ REFACTORED: Reference Contexts (per reference project)
  referenceContexts?: Array<{
    project: string;
    branch?: string;
    code: string;
    files: Array<{path: string; content: string}>;
    stats: { filesLoaded: number; estimatedTokens: number };
  }>;
  
  // ❌ DEPRECATED: Remove these
  // code?: string;  // Use codeContext.code instead
  // files?: Array<{path: string; content: string}>;  // Use codeContext.files instead
  // codeHead?: string;  // Replaced by gitDiff
}
```

---

## 📝 각 노드별 상세 설계

### 1. Resolve 노드

#### 목적: Profile 분석만
```typescript
export async function resolve(state: ArchitectGraphState) {
  // ✅ Minimal code retrieval (profile 분석용만)
  const codeContext = await retriever.retrieve(
    directive || design || "",
    context.workingDir,
    { git: state.deps?.git, vectorDB: state.deps?.memory },
    {
      project: context.project,
      maxTokens: 20000,  // 100K → 20K (80% 감소)
      maxFiles: 5,       // 15 → 5 (67% 감소)
      exclude: ['test', 'tests', '__tests__', '*.test.*', '*.spec.*'],
      mode: modeResult.mode
    }
  );
  
  // ✅ Profile 분석
  let profile = undefined;
  if (codeContext.code && analyzer) {
    profile = await analyzer.analyze(codeContext.code, context.workingDir);
  }
  
  return {
    ...state,
    directive,
    design,
    designDocPath,
    profile,  // ✅ Only profile!
    mode: modeResult.mode,
    sessionContext: sessionContextForLLM,
    // ❌ NO code, files, lessons, documents
  };
}
```

---

### 2. DetectEnvironment 노드 (완전 리팩토링)

#### 새로운 책임:
1. 환경 감지 (frontend/backend/fullstack)
2. RAG 필요성 판단 (requireCodebase)
3. 검색 키워드 생성:
   - codebaseKeywords (main project)
   - referenceKeywords (per reference project)

```typescript
export async function detectEnvironment(
  state: ArchitectGraphState
): Promise<Partial<ArchitectGraphState>> {
  
  const llm = state.deps?.llm as LLMClient;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. Build Prompt
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const prompt = `You are analyzing a development directive to determine:
1. **Development Environment** (frontend/backend/fullstack/unknown)
2. **RAG Requirement** (does decompose need codebase context?)
3. **Search Keywords** (if RAG needed)

## Directive
${state.directive}

## Design Documents Available
${state.designDocs ? Object.keys(state.designDocs).join(', ') : 'none'}

## Project Profile
- Language: ${state.profile?.language || 'unknown'}
- Framework: ${state.profile?.framework || 'unknown'}

## Mode
${state.mode || 'unknown'}

---

## Analysis Guidelines

### Environment Detection
- **frontend**: UI, components, pages, styling, client-side
- **backend**: API, database, server, business logic
- **fullstack**: Both frontend and backend
- **unknown**: Unclear or non-code tasks

### RAG Requirement
- **Generate mode**: Usually NO (새 프로젝트, codebase 없음)
- **Refactor mode**: Usually YES (기존 코드 구조 파악 필요)
- **Explain mode**: Usually YES (코드 이해 필요)

### Keywords
If RAG is required, generate semantic search keywords:
- **Main Project Keywords**: 5-10 keywords for vector DB search
  - Focus on: files, functions, components, patterns
  - Examples: "authentication", "login form", "password validation"
  
- **Reference Project Keywords**: If directive mentions other projects
  - Per reference project: 3-5 specific keywords
  - Examples: {"backend": ["user API", "auth endpoint"]}

---

## Output Format (JSON only)

\`\`\`json
{
  "environment": "frontend" | "backend" | "fullstack" | "unknown",
  "reasoning": "Brief explanation",
  "requireCodebase": true | false,
  "codebaseKeywords": ["keyword1", "keyword2", ...],
  "referenceProjects": [
    {
      "project": "backend",
      "keywords": ["user API", "auth endpoint"]
    }
  ]
}
\`\`\`

Output ONLY valid JSON.`;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. Call LLM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const response = await llm.invoke([
    { role: 'user', content: prompt }
  ], {
    temperature: 0.3,
    maxTokens: 1000
  });
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. Parse Response
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/) || 
                    response.match(/{[\s\S]*}/);
  
  if (!jsonMatch) {
    throw new Error('DetectEnvironment: Failed to parse LLM response');
  }
  
  const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. Build referenceKeywords Map
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const referenceKeywords = new Map<string, string[]>();
  if (parsed.referenceProjects) {
    for (const ref of parsed.referenceProjects) {
      referenceKeywords.set(ref.project, ref.keywords || []);
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. Update selectedDesignFiles (기존 로직 유지)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const selectedDesignFiles: string[] = [];
  
  if (state.designDocs?.apiContract) {
    selectedDesignFiles.push('api-contract.md');
  }
  
  if (parsed.environment === 'frontend' && state.designDocs?.feDesign) {
    selectedDesignFiles.push('fe-system-design.md');
  } else if (parsed.environment === 'backend' && state.designDocs?.beDesign) {
    selectedDesignFiles.push('be-system-design.md');
  } else if (state.designDocs?.unifiedDesign) {
    selectedDesignFiles.push('system-design.md');
  }
  
  console.log(`✅ Environment: ${parsed.environment}`);
  console.log(`   Require Codebase: ${parsed.requireCodebase}`);
  if (parsed.requireCodebase) {
    console.log(`   Codebase Keywords: ${parsed.codebaseKeywords.join(', ')}`);
    if (referenceKeywords.size > 0) {
      console.log(`   Reference Keywords:`);
      referenceKeywords.forEach((keywords, project) => {
        console.log(`     - ${project}: ${keywords.join(', ')}`);
      });
    }
  }
  
  return {
    detectedEnvironment: parsed.environment,
    environmentReasoning: parsed.reasoning,
    selectedDesignFiles,
    requireCodebase: parsed.requireCodebase,
    codebaseKeywords: parsed.codebaseKeywords || [],
    referenceKeywords,
  };
}
```

---

### 3. Decompose 노드 (조건부 RAG)

```typescript
export async function decompose(state: ArchitectGraphState) {
  
  // ... session restore logic ...
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: Conditional RAG (if requireCodebase)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let codeContext: any = undefined;
  let gitDiff: any = undefined;
  let referenceContexts: any[] = [];
  
  if (state.requireCodebase && state.codebaseKeywords && state.codebaseKeywords.length > 0) {
    console.log(`🔍 [Decompose] RAG required - searching with keywords...`);
    
    const retriever = state.deps?.retriever;
    const vectorDB = state.deps?.vectorDB;
    const git = state.deps?.git;
    
    if (!retriever || !vectorDB) {
      console.warn(`⚠️  [Decompose] Retriever or VectorDB not available, skipping RAG`);
    } else {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 1a. Vector DB Search (main project)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const searchQuery = state.codebaseKeywords.join(' ');
      const searchResult = await retriever.retrieve(
        searchQuery,
        state.context.workingDir,
        { vectorDB, git },
        {
          project: state.context.project,
          maxTokens: 30000,  // ~23KB (moderate)
          maxFiles: 10,
          mode: state.mode || 'refactor'
        }
      );
      
      codeContext = {
        code: searchResult.code,
        files: extractFilesFromCode(searchResult.code),
        stats: searchResult.stats,
        source: 'decompose'
      };
      
      console.log(`   ✅ Main project: ${codeContext.stats.filesLoaded} files`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 1b. Git Diff
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (git) {
        const { generateGitDiffSummary } = await import('../../../../../core/codebase/GitDiffSummary');
        gitDiff = await generateGitDiffSummary(git, state.context.workingDir);
        
        if (gitDiff?.hasChanges) {
          console.log(`   ✅ Git diff: ${gitDiff.changedFiles.length} changed files`);
        }
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 1c. Reference Projects (if any)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (state.referenceKeywords && state.referenceKeywords.size > 0) {
        const workspaceResolver = state.deps?.workspaceResolver;
        
        if (workspaceResolver) {
          for (const [project, keywords] of state.referenceKeywords.entries()) {
            try {
              const userContext = {
                userId: state.context.userId || 'local',
                organizationId: state.context.organizationId || 'local',
                workspacePath: ''
              };
              
              const refProjectPath = workspaceResolver.getProjectPath(userContext, project);
              const refCodebasePath = require('path').join(refProjectPath, 'codebase');
              
              const refQuery = keywords.join(' ');
              const refResult = await retriever.retrieve(
                refQuery,
                refCodebasePath,
                { vectorDB, git },
                {
                  project,
                  maxTokens: 15000,  // ~11KB per reference
                  maxFiles: 5,
                  mode: 'refactor'
                }
              );
              
              referenceContexts.push({
                project,
                code: refResult.code,
                files: extractFilesFromCode(refResult.code),
                stats: refResult.stats
              });
              
              console.log(`   ✅ Reference [${project}]: ${refResult.stats.filesLoaded} files`);
            } catch (error) {
              console.warn(`⚠️  Failed to load reference project [${project}]:`, error);
            }
          }
        }
      }
    }
  } else {
    console.log(`ℹ️  [Decompose] RAG not required (generate mode or no keywords)`);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Prepare design documents
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { designDoc, hasDesignDoc } = prepareDesignDocument(state);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Build prompt and call LLM
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const prompt = buildDecomposePrompt({
    directive: state.directive || '',
    designDoc,
    hasDesignDoc,
    codeContext,  // 🔥 NEW
    gitDiff,      // 🔥 NEW
    referenceContexts,  // 🔥 NEW
    mode: state.mode || 'unknown',
    profile: state.profile
  });
  
  // ... LLM call and task parsing ...
  
  return {
    ...state,
    taskQueue,
    featureTasks,
    referenceRequests,
    codeContext,  // 🔥 Save for later use
    gitDiff,      // 🔥 Save for later use
    referenceContexts,  // 🔥 Save for later use
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper: Extract files from formatted code
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function extractFilesFromCode(code: string): Array<{path: string; content: string}> {
  const files: Array<{path: string; content: string}> = [];
  const fileSections = code.split(/\n\n---\n\n/);
  
  for (const section of fileSections) {
    const match = section.match(/^FILE:\s*([^\n]+)\n([\s\S]*)/);
    if (match) {
      files.push({
        path: match[1].trim(),
        content: match[2]
      });
    }
  }
  
  return files;
}
```

---

### 4. Plan 노드 (LLM 키워드 생성 + Task-specific RAG)

```typescript
export async function plan(state: ArchitectGraphState) {
  
  // ... task queue management, timing ...
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: LLM generates task-specific keywords
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const llm = state.deps?.llm as LLMClient;
  
  const keywordPrompt = `You are analyzing a task to generate semantic search keywords.

## Task
**${nextTask.name}**
${nextTask.description}

## Project Context
- Language: ${state.profile?.language || 'unknown'}
- Framework: ${state.profile?.framework || 'unknown'}
- Mode: ${state.mode || 'unknown'}

## Guidelines
Generate 5-10 semantic search keywords that will help find relevant code:
- File names, function names, component names
- Patterns, concepts, APIs
- Be specific to THIS task (not general)

## Examples
Task: "Add password visibility toggle to login form"
Keywords: ["login form", "password input", "visibility toggle", "eye icon", "input type password"]

Task: "Fix null pointer error in user service"
Keywords: ["user service", "null pointer", "error handling", "validation", "getUserById"]

---

Output ONLY a JSON array of keywords:
\`\`\`json
["keyword1", "keyword2", ...]
\`\`\``;

  let taskKeywords: string[] = [];
  
  try {
    const keywordResponse = await llm.invoke([
      { role: 'user', content: keywordPrompt }
    ], {
      temperature: 0.3,
      maxTokens: 500
    });
    
    const jsonMatch = keywordResponse.match(/```json\n([\s\S]*?)\n```/) ||
                      keywordResponse.match(/\[[\s\S]*\]/);
    
    if (jsonMatch) {
      taskKeywords = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      console.log(`   🔑 LLM Keywords: ${taskKeywords.join(', ')}`);
    }
  } catch (error) {
    console.warn(`⚠️  Keyword generation failed, falling back to task name`, error);
    // Fallback: Use task name
    taskKeywords = nextTask.name.toLowerCase().split(' ').filter(w => w.length > 3);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: Vector DB Search (task-specific)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const retriever = state.deps?.retriever;
  const vectorDB = state.deps?.vectorDB;
  const git = state.deps?.git;
  
  let codeContext: any = undefined;
  let gitDiff: any = undefined;
  let referenceContexts: any[] = [];
  
  if (retriever && vectorDB && taskKeywords.length > 0) {
    const searchQuery = taskKeywords.join(' ');
    
    // Main project search
    const searchResult = await retriever.retrieve(
      searchQuery,
      state.context.workingDir,
      { vectorDB, git },
      {
        project: state.context.project,
        maxTokens: 30000,  // ~23KB
        maxFiles: 8,
        mode: state.mode || 'refactor'
      }
    );
    
    codeContext = {
      code: searchResult.code,
      files: extractFilesFromCode(searchResult.code),
      stats: searchResult.stats,
      source: 'plan'
    };
    
    console.log(`   ✅ Task context: ${codeContext.stats.filesLoaded} files`);
    
    // Git diff
    if (git) {
      const { generateGitDiffSummary } = await import('../../../../../core/codebase/GitDiffSummary');
      gitDiff = await generateGitDiffSummary(git, state.context.workingDir);
    }
    
    // Reference projects (if this task needs them)
    // TODO: How to determine which references this task needs?
    // For now: Include all references from decompose
    if (state.referenceContexts && state.referenceContexts.length > 0) {
      referenceContexts = state.referenceContexts;
    }
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: Save to state (for codeGen)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return {
    ...state,
    currentTask: nextTask,
    taskKeywords,  // 🔥 NEW
    codeContext,   // 🔥 UPDATED (task-specific)
    gitDiff,       // 🔥 UPDATED
    referenceContexts,  // 🔥 UPDATED
  };
}
```

---

### 5. CodeGen 노드 (최소 변경)

```typescript
async function buildMessages(state: ArchitectGraphState) {
  const promptEngine = state.deps?.promptEngine as PromptEngine;
  
  // ✅ Build prompt using PromptEngine
  const promptResult = await promptEngine.buildExecutePrompt(
    'code',
    state.context,
    {
      directive: state.directive,
      designDoc: state.design,
      
      // 🔥 Use task-specific context from plan
      currentCode: state.codeContext?.code,  // ✅ Task-specific!
      gitDiff: state.gitDiff,
      
      lessons: Array.isArray(state.lessons) ? state.lessons : undefined,
      sessionContext: state.sessionContext,
      referenceRequests: state.referenceRequests,
      referenceContexts: state.referenceContexts,  // 🔥 NEW
      currentTask: {
        name: state.currentTask.name,
        type: state.currentTask.type,
        priority: state.currentTask.priority,
        description: state.currentTask.description,
      },
    } as any,
    state.codeMode,
    state.currentTask.type
  );
  
  // ... rest of buildMessages ...
}
```

---

## 🤔 설계 검토 및 문제점

### ✅ 장점

1. **Token 효율화**
   - Resolve: 75KB → 15KB (80% 절감)
   - Decompose: 조건부 RAG (필요시만)
   - Plan: Task-specific (불필요한 파일 제외)
   - **예상 절감**: ~63% (450KB → 165KB)

2. **검색 품질 향상**
   - LLM이 semantic keywords 생성
   - Task-specific context
   - Reference 프로젝트 체계적 처리

3. **명확한 책임 분리**
   - Resolve: Profile만
   - DetectEnvironment: RAG 판단 + 키워드
   - Decompose: 조건부 RAG
   - Plan: Task-specific RAG
   - CodeGen: 사전 검색된 context 사용

4. **Mode-aware**
   - Generate: RAG 최소화
   - Refactor: RAG 적극 활용

---

### ⚠️ 문제점 및 고민사항

#### 1. **LLM 호출 증가**
- DetectEnvironment: +1 LLM call (~100 tokens)
- Plan: +1 LLM call per task (~100 tokens × N tasks)
- **Trade-off**: 비용/속도 vs 품질

**해결책**:
```typescript
// Option A: DetectEnvironment만 LLM, Plan은 rule-based fallback
// Option B: 둘 다 LLM (권장 - 품질이 중요)
// Option C: 작은 모델 사용 (예: GPT-3.5-turbo for keyword generation)
```

#### 2. **Reference 프로젝트 처리 복잡도**
- Decompose에서 모든 reference 검색
- Plan에서 task별 reference filtering 필요?
- CodeGen에서 tool calling으로도 검색 가능

**현재 설계**:
- Decompose: 모든 reference 검색 (referenceKeywords 기반)
- Plan: Decompose에서 검색한 것 재사용
- CodeGen: Tool calling으로 추가 검색 가능

**문제**: Task별로 다른 reference가 필요한 경우?
```
Task 1: "Setup frontend structure" → backend reference 불필요
Task 2: "Call user API" → backend reference 필요

해결책:
Option A: Decompose에서 task별 reference mapping
Option B: Plan에서 task별 filtering
Option C: CodeGen tool calling에만 의존 (현재)
```

#### 3. **planText vs taskKeywords**
- planText: 여전히 사용 중 (사용자 분석이 틀림)
- taskKeywords: 새로 추가

**확인 필요**: planText가 정말 레거시인가?
→ **답변**: 아님! codeGen에서 사용 중

**해결**: 둘 다 유지
```typescript
planText: string;  // Execution plan (human-readable)
taskKeywords: string[];  // Search keywords (machine-readable)
```

#### 4. **state.files vs gitDiff 통합**
- 사용자: "gitDiff로 통합 필요한지 판단"
- 분석 결과: **역할이 다름, 통합 불필요**

**명확화**:
```typescript
// codeContext.files: Vector DB 검색 결과 (semantic)
codeContext?: {
  files: Array<{path: string; content: string}>;  // Full content
};

// gitDiff: Working tree 변경사항 (diff)
gitDiff?: {
  changedFiles: Array<{path, status, additions, deletions}>;  // Summary only
};
```

#### 5. **Backward Compatibility**
- 많은 state 필드 변경
- 기존 코드 호환성 문제 가능

**영향받는 곳**:
- PromptEngine
- ContextAssembler
- TemplateComposer
- Evaluate node
- Learn node

**해결책**: 점진적 마이그레이션
```typescript
// Phase 1: 새 필드 추가, 기존 필드 유지
codeContext?: ...;  // NEW
code?: string;  // DEPRECATED but kept

// Phase 2: 모든 노드 마이그레이션
// Phase 3: 기존 필드 제거
```

---

## 🚦 구현 단계

### Phase 1: Core Refactoring (필수)
1. ✅ State 확장 (codeContext, taskKeywords, requireCodebase 등)
2. ✅ DetectEnvironment 완전 리팩토링
3. ✅ Decompose 조건부 RAG 추가
4. ✅ Plan LLM 키워드 생성 + Task-specific RAG
5. ✅ CodeGen context 사용 방식 변경

### Phase 2: Legacy Cleanup (권장)
6. ⚠️ Resolve 최소화 (maxFiles, maxTokens 감소)
7. ⚠️ 기존 state.code, state.files deprecated 표시
8. ⚠️ PromptEngine artifacts 업데이트

### Phase 3: Optimization (선택)
9. 💡 Reference project task-level filtering
10. 💡 LLM model 최적화 (keyword generation용 작은 모델)
11. 💡 Caching 전략

---

## 📊 최종 평가

### 설계 품질: ⭐⭐⭐⭐☆ (4/5)

**강점**:
- ✅ Token 효율화 (63% 절감)
- ✅ 검색 품질 향상 (LLM keywords)
- ✅ 명확한 책임 분리
- ✅ Mode-aware RAG

**약점**:
- ⚠️ LLM 호출 증가 (비용/속도)
- ⚠️ Reference 프로젝트 복잡도
- ⚠️ Backward compatibility 이슈

**종합 판단**: ✅ **구현 권장**
- 장점이 단점을 상회
- Token 절감 효과가 큼
- 검색 품질 향상이 중요

---

## 🎯 권장사항

### 즉시 구현 (Phase 1)
1. DetectEnvironment 리팩토링
2. Decompose 조건부 RAG
3. Plan LLM 키워드 생성

### 점진적 개선 (Phase 2)
4. Resolve 최소화
5. Legacy field deprecation

### 향후 검토 (Phase 3)
6. Reference task filtering
7. LLM model optimization

---

**다음 단계**: 구현 시작하시겠습니까?

