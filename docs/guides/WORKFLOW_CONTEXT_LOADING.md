# 작업 시작 시 컨텍스트 로딩 플로우 🔄

## 전체 워크플로우 (시작부터 실행까지)

```
사용자 명령
    ↓
orchestrator (Composition Root)
    ↓
architectAgent (Entry Point)
    ↓
1️⃣ 벡터 메모리 검색 (retrieve)
    → 이전 학습 내용을 Vector DB에서 검색
    → 결과: 문자열 (장기 지식)
    ↓
2️⃣ 세션 히스토리 로드 (session)
    → 이전 턴 내역을 Session 파일에서 로드
    → 결과: 문자열 (단기 맥락)
    ↓
3️⃣ ProjectContext 생성
    → context = { 
        project, feature, workingDir,
        memory: 벡터검색결과,          // 장기 지식
        sessionHistory: 세션히스토리     // 단기 맥락
      }
    ↓
4️⃣ Graph 실행
    ├─ resolve: 파일 로드 (directive, design, PRD)
    ├─ plan: PromptEngine으로 프롬프트 빌드
    │   └─ ContextAssembler: memory + sessionHistory + 파일들 조합
    ├─ execute: LLM 호출 (프롬프트에 memory + sessionHistory 포함)
    ├─ validate: 검증
    └─ learn: 결과 저장
        ├─ Session 파일에 이번 턴 추가 (sessionId, turnId 확보)
        └─ Vector DB에 학습 저장 (sessionId, turnId 포함)
```

---

## 📍 1단계: Vector 메모리 검색 (장기 지식)

**위치**: `src/agents/architect/index.ts` (42-43줄)

```typescript
// 2. Retrieve long-term knowledge from Vector DB
console.log(`🔍 Retrieving vector memory for ${task}...`);
const vectorMemory = await retrieve(
  task, 
  project, 
  featureFolder, 
  deps?.memory ? { memory: deps.memory } : undefined
);
```

**역할**: Cross-feature 장기 지식 (What/Why)
- "JWT authentication pattern"
- "Clean architecture 설계 원칙"
- "이전 프로젝트에서 배운 교훈"

**타이밍**: 
- ✅ Graph 실행 **이전**
- ✅ 모든 노드가 실행되기 전에 한 번만 실행
- ✅ 검색 결과를 `vectorMemory` 변수에 문자열로 저장

---

## 📍 2단계: Session 히스토리 로드 (단기 맥락)

**위치**: `src/agents/architect/index.ts` (45-61줄)

```typescript
// 3. Load short-term context from Session
let sessionHistory = "";
if (deps?.session && featureFolder) {
  try {
    console.log(`📖 Loading session history for feature: ${featureFolder}...`);
    const session = await deps.session.load(project, featureFolder);
    if (session.turns.length > 0) {
      sessionHistory = formatSessionContext(session);
      console.log(`✅ Loaded ${session.turns.length} previous turn(s)`);
    } else {
      console.log(`ℹ️  This is the first turn in this feature`);
    }
  } catch (error) {
    console.warn(`⚠️  Could not load session history:`, error);
  }
}
```

**역할**: Feature-specific 단기 맥락 (When/Where)
- "Turn 1에서 JWT 인증 설계를 요청했음"
- "Turn 2에서 User 모델을 구현했음"
- "Turn 3에서 비밀번호 해싱 버그를 수정했음"

**포맷팅**: `formatSessionContext()` 함수로 변환

```typescript
// 결과 예시
🔄 Current Feature Work History
==================================================
Feature: auth
Session ID: 550e8400-e29b-41d4-a716-446655440000
Started: 2025-10-28 10:00:00
Total Turns: 3

━━━ Turn 1 (design) ━━━
Time: 2025-10-28 10:00:00
Input: JWT 인증 시스템 설계

Output:
  📄 Design: design-auth-jwt-20251028.md
  ✅ Decisions:
     JWT with refresh token
     bcrypt for password hashing

━━━ Turn 2 (code) ━━━
Time: 2025-10-28 10:30:00
Input: User 모델 구현

Output:
  🌿 Branch: feature/auth-user-model
  📝 Files Modified: src/models/User.ts, src/db/schema.sql
```

**타이밍**: 
- ✅ Vector 검색 **직후**
- ✅ Graph 실행 **이전**
- ✅ 결과를 `sessionHistory` 변수에 문자열로 저장

---

## 📍 3단계: ProjectContext 생성 (Vector + Session 통합)

**위치**: `src/agents/architect/index.ts` (64-71줄)

```typescript
// 4. Create ProjectContext with both Vector and Session
const context: ProjectContext = {
  project,
  featureFolder,
  workingDir: process.cwd(),
  config,
  memory: vectorMemory,           // Long-term knowledge
  sessionHistory: sessionHistory  // Short-term context
};
```

**타이밍**: 
- ✅ Graph 실행 **직전**
- ✅ Vector + Session 검색이 모두 완료된 후
- ✅ 이 context가 모든 Graph 노드에서 공유됨

---

## 🔍 Vector 검색 상세 플로우

**파일**: `src/agents/architect/memory/index.ts`

### 검색 대상 (카테고리별)

```typescript
// Design Task일 때
{
  learnings: [
    "What design patterns were used?",
    "What architecture decisions were made?",
    "What were the key technical considerations?"
  ],
  architecture: [
    "System architecture and component structure",
    "Integration patterns and data flow"
  ],
  project: [
    "Project goals and requirements",
    "Technical constraints and preferences"
  ],
  feedback: [
    "Previous design reviews and improvements",
    "Lessons learned from past iterations"
  ]
}

// Code Task일 때
{
  learnings: [
    "What code patterns were implemented?",
    "What refactorings were done?",
    "What bugs were fixed and how?"
  ],
  codebase: [
    "Coding conventions and style guide",
    "Common patterns and utilities"
  ],
  // ... 동일한 architecture, project, feedback
}
```

### 검색 필터

```typescript
await memory.query(query, project, {
  k: 10,                    // 상위 10개 결과
  where: { 
    type: 'learning',       // learning만 가져옴
    task: 'design'          // design 또는 code
  },
  minScore: 0.5            // 50% 이상 유사도
});
```

### Feature별 추가 검색

```typescript
if (feature) {
  // Feature-specific context 추가
  where: { 
    feature: feature,       // 예: "auth"
    type: 'learning'
  }
}
```

### 결과 포맷

```typescript
// 카테고리별로 정리된 문자열
`
📚 Previous Learnings
---------------------
### What design patterns were used?
JWT authentication with bcrypt hashing [relevance: 87%]

Implemented refresh token rotation for security [relevance: 82%]

🏗️ Architecture & Design
------------------------
### System architecture
RESTful API with clean architecture [relevance: 91%]

🎯 Feature-Specific Context
---------------------------
### auth feature patterns
OAuth2 integration patterns [relevance: 78%]
`
```

---

## 📍 4단계: Graph Resolve 노드 (파일 로드)

**위치**: `src/agents/architect/graph/*/nodes/resolve.ts`

### Design Graph Resolve

```typescript
export async function resolve(state: DesignGraphState) {
  const { context } = state;

  // 1. PRD 파일 로드
  const source = getSource(context);
  const spec = source.prd;

  // 2. Directive 파일 로드 (선택)
  const directive = getDirective(context, 'design') || "";

  // 3. 이전 Design 파일 로드 (선택)
  const previousDesign = findLatestDesign(context) || "";

  // ⚠️ context.memory와 context.sessionHistory는 이미 1-2단계에서 로드됨!
  
  return { ...state, spec, directive, previousDesign };
}
```

### Code Graph Resolve

```typescript
export async function resolve(state: ArchitectGraphState) {
  const { context } = state;

  // 1. 최신 Design 문서 로드 (선택)
  const latestDesign = findLatestDesign(context) || "";

  // 2. Code Directive 로드 (선택)
  const directive = getDirective(context, 'code') || "";
  
  // 3. Git에서 변경된 파일의 원본 가져오기
  const git = state.deps?.git;
  const changes = await git.diff();
  let originalFilesBlock = "";
  
  if (changes.length > 0) {
    // HEAD에서 원본 파일 내용 가져오기
    const originals = await git.getOriginalFiles();
    originalFilesBlock = formatFiles(originals);
  }

  // 4. Codebase 분석 (언어/프레임워크 감지)
  let codebaseProfile = null;
  if (originalFilesBlock && analyzer) {
    codebaseProfile = await analyzer.analyze(originalFilesBlock);
  }

  // ⚠️ context.memory와 context.sessionHistory는 이미 1-2단계에서 로드됨!
  
  return { ...state, latestDesign, directive, originalFilesBlock, codebaseProfile };
}
```

---

## 📍 5단계: Plan 노드 (PromptEngine에서 컨텍스트 조합)

**위치**: `src/agents/architect/graph/*/nodes/plan.ts`

```typescript
export async function plan(state: DesignGraphState) {
  const engine = state.deps?.promptEngine;

  const artifacts = {
    directive: state.directive || undefined,
    designDoc: undefined,
    prdSpec: state.spec || undefined,
    originalFiles: undefined,
    currentCode: undefined
  };

  // PromptEngine으로 프롬프트 빌드
  // 👇 여기서 모든 컨텍스트가 조합됨
  const result = await engine.buildPlanPrompt(
    "design",
    state.context,  // ← memory + sessionHistory 포함!
    artifacts
  );

  const planText = await llm.invoke(result.formatted.messages);
  
  return { planText };
}
```

---

## 🎯 PromptEngine 내부 - ContextAssembler

**파일**: `src/core/prompt/engine/ContextAssembler.ts`

### 컨텍스트 조합 순서

```typescript
async assemble(task, context, deps, loader) {
  const assembled = {};
  
  // 1. 파일 로드 (loader 함수)
  if (loader) {
    const loaded = await loader(task, context);
    // directive, designDoc, prdSpec 등
    Object.assign(assembled, loaded);
  }
  
  // 2. Git에서 원본 파일 로드
  if (deps?.git) {
    assembled.originalFiles = await loadOriginalFiles(git);
    
    // Codebase 분석
    if (assembled.originalFiles && deps.analyzer) {
      assembled.codebaseProfile = await analyzeCodebase(...);
    }
  }
  
  // 3. 벡터 메모리 가져오기
  assembled.memory = context.memory || undefined;
  //                  ⬆️ 1단계에서 이미 검색된 결과!
  
  // 4. 세션 히스토리 가져오기
  assembled.sessionHistory = context.sessionHistory || undefined;
  //                          ⬆️ 2단계에서 이미 로드된 결과!
  
  // 5. 통계 생성
  const stats = {
    hasDirective: Boolean(assembled.directive),
    hasDesign: Boolean(assembled.designDoc),
    hasOriginalFiles: Boolean(assembled.originalFiles),
    hasMemory: Boolean(assembled.memory),
    hasSessionHistory: Boolean(assembled.sessionHistory),
    codebaseDetected: Boolean(assembled.codebaseProfile)
  };
  
  return { ...assembled, stats };
}
```

---

## 🔗 최종 프롬프트 구성

**파일**: `src/core/prompt/engine/TemplateComposer.ts`

### 프롬프트에 포함되는 모든 컨텍스트

```markdown
# System Prompt (템플릿)

## Role
You are an expert architect...

## Long-term Knowledge (Vector Memory)
[context.memory]  ← 벡터 메모리 검색 결과 (1단계)

📚 Previous Learnings
---------------------
JWT authentication with bcrypt...

🏗️ Architecture & Design
------------------------
RESTful API with clean architecture...

## Short-term Context (Session History)
[context.sessionHistory]  ← 세션 히스토리 (2단계)

🔄 Current Feature Work History
================================
Turn 1: JWT 인증 설계 → design-auth-jwt.md
Turn 2: User 모델 구현 → User.ts, schema.sql
Turn 3: 비밀번호 해싱 버그 수정

## Current Task
[prdSpec]         ← PRD 파일 (resolve 노드)
[directive]       ← Directive 파일 (resolve 노드)
[designDoc]       ← Design 문서 (resolve 노드)
[originalFiles]   ← Git HEAD 파일 (resolve 노드)

## Codebase Profile
Language: TypeScript
Framework: Next.js
[codebaseProfile] ← 코드베이스 분석 결과 (resolve 노드)
```

---

## 📊 전체 타임라인 (Design Task 예시)

```
T0: 사용자 실행
    npm run arch-design workspace/my-app/auth/inputs/directives/design/directive.md

T1: Orchestrator
    └─ FileSessionAdapter, ChunkAdapter, ChromaMemoryAdapter 생성

T2: architectAgent 시작
    └─ config.load("my-app")

T3: 🔍 Vector 검색 (장기 지식)
    ├─ Query 1: "What design patterns were used?" (k=10, minScore=0.5)
    ├─ Query 2: "System architecture" (k=10)
    ├─ Query 3: "Project goals" (k=10)
    ├─ MMR Reranking (diversity)
    └─ 결과를 문자열로 포맷팅
    
    📊 ChromaDB 호출:
    POST /api/v1/collections/my-app/query
    {
      "query_texts": ["What design patterns were used?"],
      "n_results": 10,
      "where": {
        "type": "learning",
        "task": "design",
        "sessionId": "550e8400-...",  ← 있으면 추가 필터
        "turnId": 1
      }
    }
    
    결과 예시:
    {
      "ids": [...],
      "documents": [
        "JWT authentication with bcrypt hashing for passwords...",
        "Implemented refresh token rotation for enhanced security..."
      ],
      "metadatas": [
        {
          "type": "learning",
          "task": "design",
          "project": "my-app",
          "feature": "auth",
          "sessionId": "550e8400-e29b-41d4-a716-446655440000",
          "turnId": 1,
          "timestamp": "2025-10-28T10:00:00Z"
        }
      ],
      "distances": [0.13, 0.18]  // 낮을수록 유사
    }

T4: 📖 Session 로드 (단기 맥락)
    ├─ session.load("my-app", "auth")
    ├─ formatSessionContext(session)
    └─ 결과: "🔄 Current Feature Work History\n..."
    
    📊 Session 파일 읽기:
    workspace/my-app/auth/session.json
    {
      "sessionId": "550e8400-...",
      "turns": [
        { "turnId": 1, "task": "design", "input": "JWT 인증", ... },
        { "turnId": 2, "task": "code", "input": "User 모델", ... }
      ]
    }

T5: ProjectContext 생성
    {
      project: "my-app",
      featureFolder: "auth",
      workingDir: "/Users/probe/dev/ai-dev-framework",
      config: { ... },
      memory: "📚 Previous Learnings\n..."          ← T3 Vector 결과
      sessionHistory: "🔄 Current Feature Work..."  ← T4 Session 결과
    }

T6: Design Graph 실행 시작

T7: resolve 노드
    ├─ PRD 로드: workspace/my-app/auth/inputs/sources/prd.md
    ├─ Directive 로드: workspace/my-app/auth/inputs/directives/design/directive.md
    └─ Previous Design 로드: workspace/my-app/auth/outputs/design/design-*.md

T8: plan 노드
    ├─ PromptEngine.buildPlanPrompt()
    │   ├─ InputNormalizer: 입력 정규화
    │   ├─ ContextAssembler: 모든 컨텍스트 조합
    │   │   ├─ loader(): directive, prdSpec 로드
    │   │   ├─ git: (Design은 없음)
    │   │   ├─ memory: context.memory (T3 Vector 재사용!)
    │   │   └─ sessionHistory: context.sessionHistory (T4 Session 재사용!)
    │   ├─ ModeController: Design 모드 설정
    │   ├─ TemplateComposer: 템플릿 + 컨텍스트 → 프롬프트
    │   ├─ PolicyInjector: 가드레일 추가
    │   └─ PromptFormatter: LLM API 포맷
    └─ LLM.invoke(formatted.messages)

T9: execute 노드
    └─ LLM에서 받은 plan으로 design 생성

T10: learn 노드
    ├─ 1. Session 저장
    │   ├─ session.load() → sessionId 확보
    │   ├─ session.addTurn() → turnId 확보
    │   └─ session.updateArtifacts()
    ├─ 2. Learnings 추출
    └─ 3. Vector DB 저장 (sessionId, turnId 포함!)
        POST /api/v1/collections/my-app/add
        {
          "documents": ["Design session for auth...", ...],
          "metadatas": [
            {
              "type": "learning",
              "task": "design",
              "project": "my-app",
              "feature": "auth",
              "sessionId": "550e8400-...",  ← 이번 세션!
              "turnId": 2,                   ← 이번 턴!
              "timestamp": "2025-10-28T11:00:00Z"
            }
          ]
        }

T11: 완료
     └─ 다음 실행 시:
        - T3에서 이 Vector 결과가 검색됨 (장기 지식)
        - T4에서 이 Session이 로드됨 (단기 맥락)
```

---

## 🔄 Session 로드 시점

### 1. 작업 시작 시 (architectAgent)
**용도**: 이전 대화 맥락을 LLM에게 제공

```typescript
// architectAgent 시작 시 (2단계)
const session = await deps.session.load(project, featureFolder);
const sessionHistory = formatSessionContext(session);

// ProjectContext에 포함
context.sessionHistory = sessionHistory;

// 결과: LLM 프롬프트에 포함됨! ✅
```

### 2. 작업 완료 시 (learn 노드)
**용도**: 이번 턴을 Session에 추가

```typescript
// learn 노드에서
const session = await state.deps.session.load(project, feature);
const sessionId = session.sessionId;  // UUID 확보

// 이번 턴 추가
await state.deps.session.addTurn(project, feature, turn);

// turnId 확보
const updatedSession = await state.deps.session.load(project, feature);
const turnId = updatedSession.turns[updatedSession.turns.length - 1]?.turnId;

// Vector 메타데이터에 연결 정보 추가
metadata: { sessionId, turnId, ... }
```

**Session 역할 정리**:
- ✅ 작업 시작: **프롬프트 컨텍스트로 사용** (단기 맥락)
- ✅ 작업 완료: **턴 저장 및 추적**
- ✅ Vector 연결: **Traceability 확보**

---

## 📋 프롬프트 구성 요소 전체 목록

LLM 태스크에 영향을 주는 모든 입력 요소를 레벨별로 정리한 표입니다.

| 레벨 | 요소 | 출처 | 로드 시점 | 역할 |
|------|------|------|----------|------|
| **Context** | `memory` | Vector DB | Graph 실행 **전** | 장기 지식 (What/Why) |
| **Context** | `sessionHistory` | Session 파일 | Graph 실행 **전** | 단기 맥락 (When/Where) |
| **Context** | `config` | Config 파일 | Graph 실행 **전** | 프로젝트 설정 |
| **Resolved** | `directive` | 파일 시스템 | Resolve 노드 | 유저 명령 |
| **Resolved** | `spec` (PRD) | 파일 시스템 | Resolve 노드 | 요구사항 문서 |
| **Resolved** | `previousDesign` | 파일 시스템 | Resolve 노드 | 이전 설계 (전체 내용) |
| **Resolved** | `originalFiles` | Git HEAD | Resolve 노드 | 원본 코드 |
| **Assembled** | `codebaseProfile` | 실시간 분석 | ContextAssembler | 언어/프레임워크 감지 |
| **Template** | `system` | 템플릿 파일 | TemplateComposer | AI 역할 정의 |
| **Template** | `rules` | 템플릿 파일 | TemplateComposer | 규칙/제약사항 |
| **Template** | `examples` | 템플릿 파일 | TemplateComposer | 예시 (선택적) |
| **Policy** | `guardrails` | 정책 코드 | PolicyInjector | 품질 가드레일 |

### 레벨 설명

**Context**: Graph 실행 전에 미리 준비되는 컨텍스트
- 한 번만 로드되고 모든 노드에서 재사용
- Vector 검색과 Session 로드가 여기서 수행

**Resolved**: Resolve 노드에서 파일 시스템/Git에서 로드
- Task별로 필요한 파일들이 다름
- Design: PRD, Directive, Previous Design
- Code: Latest Design, Directive, Original Files

**Assembled**: ContextAssembler에서 실시간으로 생성/분석
- Codebase 분석 (언어/프레임워크 감지)
- 통계 정보 (hasMemory, hasDirective 등)

**Template**: PromptEngine이 사용하는 템플릿
- Task별 템플릿 (design/code)
- Phase별 템플릿 (plan/execute)

**Policy**: 품질 및 출력 형식 제어
- Validation rules
- Output format requirements
- Guardrails

### 최종 프롬프트 구성

```
최종 LLM 프롬프트 = 
  System Prompt (Template)
  + Language/Framework Profiles (Assembled)
  + Vector Memory (Context)
  + Session History (Context)
  + Resolved Files (Resolved)
  + Base Template (Template)
  + Injections (Resolved + Context)
  + Rules (Template)
  + Examples (Template)
  + Guardrails (Policy)
```

---

## 💡 핵심 요약

### 컨텍스트 로딩 순서

1. **Vector 메모리 검색** (Graph 실행 전)
   - 위치: `architectAgent()` 시작 시
   - 저장: `context.memory` (문자열)
   - 역할: 장기 지식 (What/Why)
   - 용도: 프롬프트에 포함 ✅

2. **Session 히스토리 로드** (Graph 실행 전)
   - 위치: `architectAgent()` 시작 시
   - 저장: `context.sessionHistory` (문자열)
   - 역할: 단기 맥락 (When/Where)
   - 용도: 프롬프트에 포함 ✅

3. **파일 로드** (Resolve 노드)
   - PRD, Directive, Design 문서
   - Git HEAD 파일 (Code task)
   - 용도: 프롬프트에 포함 ✅

4. **컨텍스트 조합** (PromptEngine)
   - ContextAssembler가 모든 것을 조합
   - Vector + Session + 파일들
   - 프롬프트 템플릿에 주입
   - LLM에 전달

5. **결과 저장** (Learn 노드)
   - Session에 이번 턴 추가 (sessionId, turnId 확보)
   - Vector DB에 학습 저장 (연결 정보 포함)
   - 다음 실행 시:
     - Vector에서 검색됨 (장기 지식)
     - Session에서 로드됨 (단기 맥락)

### Vector vs Session

| 구분 | Vector Memory | Session History |
|------|---------------|-----------------|
| **역할** | 장기 지식 | 단기 맥락 |
| **내용** | What/Why (패턴, 이유) | When/Where (시점, 위치) |
| **로드 시점** | Graph 실행 **이전** (1단계) | Graph 실행 **이전** (2단계) |
| **용도** | 프롬프트 컨텍스트 | 프롬프트 컨텍스트 |
| **포함 내용** | 정제된 학습 | 원본 대화 히스토리 (전체 턴) |
| **범위** | Cross-feature | Feature-specific |
| **검색 방식** | 의미 기반 (Vector) | 파일 읽기 (JSON) |
| **LLM 전달** | ✅ Yes | ✅ Yes |
| **저장 시점** | Learn 노드 (마지막) | Learn 노드 (마지막) |
| **Traceability** | sessionId, turnId 포함 | sessionId 기준 |

**둘 다 중요!** Vector(장기) + Session(단기) = 완전한 컨텍스트

---

## 🔍 디버깅 팁

### Vector 검색 결과 확인

```bash
# context.memory 내용 확인 (로그 추가)
console.log("🔍 Vector Memory Context:", context.memory);
```

### 프롬프트 전체 확인

```bash
# PromptEngine 결과 확인
console.log("📝 Final Prompt:", result.formatted.messages);
```

### ChromaDB 직접 조회

```bash
# ChromaDB에서 직접 검색
curl -X POST http://localhost:8000/api/v1/collections/my-app/query \
  -H "Content-Type: application/json" \
  -d '{
    "query_texts": ["authentication patterns"],
    "n_results": 5,
    "where": {
      "type": "learning",
      "task": "design"
    }
  }'
```

---

**작성일**: 2025-10-28  
**버전**: 2.0  
**업데이트**: Session을 프롬프트 컨텍스트로 활용 (Vector + Session 통합)

