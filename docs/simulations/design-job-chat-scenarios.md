# Design Job 채팅 지시 시나리오 시뮬레이션

> **목적**: Design job에서 UI 문서와 시스템 문서가 일부 또는 전부 존재할 때, 채팅 지시가 어떻게 처리되는지 시뮬레이션

## 🏗️ 아키텍처 개요

Design job은 다음 노드를 통해 실행됩니다:

```
resolve → detectEnvironment → decompose → docGen → tool (선택적) → (반복) → END
```

### 주요 컴포넌트

1. **resolve**: 기존 문서 로드 (PRD, directive, design, UI context)
2. **detectEnvironment**: 작업 타입 분류 (ui-design vs system-design)
3. **decompose**: 태스크 분해 및 세션 복원
4. **docGen**: LLM 기반 문서 생성
5. **tool**: 외부 도구 호출 (codebase_search, read_file 등)

---

## 📋 시나리오 분류

### 1️⃣ 문서 상태별 분류

| 상태 | UI 문서 | 시스템 문서 | 설명 |
|------|---------|-------------|------|
| A | 없음 | 없음 | Greenfield - 새 프로젝트 |
| B | 있음 (완전) | 없음 | UI만 완성, 시스템 설계 필요 |
| C | 없음 | 있음 (완전) | 시스템만 완성, UI 설계 필요 |
| D | 있음 (부분) | 없음 | UI 일부 작성됨 |
| E | 없음 | 있음 (부분) | 시스템 일부 작성됨 |
| F | 있음 (완전) | 있음 (완전) | 모든 문서 완성 |
| G | 있음 (부분) | 있음 (부분) | 모든 문서 부분 작성 |

### 2️⃣ 지시 타입별 분류

| 타입 | 설명 | 예시 |
|------|------|------|
| 새로작성 | 새 문서 생성 요청 | "UI 문서 작성해줘", "시스템 설계 문서 만들어줘" |
| 수정 | 기존 내용 변경 | "버튼 색상을 파란색으로 바꿔줘", "API 엔드포인트 수정해줘" |
| 추가 | 기존 문서에 섹션/내용 추가 | "인증 섹션 추가해줘", "다크모드 지원 추가해줘" |
| 삭제 | 특정 섹션/기능 제거 | "관리자 기능 제거해줘" |
| 질문 | 문서 내용 확인 (tool calling) | "현재 UI 토큰은 뭐야?", "API 구조 보여줘" |

---

## 🎬 시나리오별 시뮬레이션

### 시나리오 A: Greenfield (문서 없음) + 새로작성

#### 입력
```
채팅: "뉴스 애플리케이션 UI 문서 작성해줘"
상태:
  - outputs/design/: 비어있음
  - inputs/references/screens/: home.png, article.png 존재
```

#### 처리 흐름

```typescript
// 1. resolve 노드
{
  prd: "뉴스 애플리케이션 PRD 내용...",
  directive: undefined,  // 파일 없음
  overrideDirective: "뉴스 애플리케이션 UI 문서 작성해줘",  // ✅ 채팅 입력
  design: undefined,
  hasUiDoc: false
}

// 2. detectEnvironment 노드
// LLM이 directive + 파일 시스템 스캔 결과 분석
{
  designWorkType: "ui-design",  // ✅ "UI 문서" 키워드 감지
  workTypeReasoning: "사용자가 명시적으로 UI 문서 작성을 요청했고, 레퍼런스 이미지가 존재함",
  // domain/environment는 ui-design에서 불필요
}

// 3. decompose 노드
// UI 문서는 3개 파일로 분해됨
{
  taskQueue: [
    {
      id: "ui-tokens",
      name: "Extract UI Tokens",
      targetFile: "ui-tokens.md",
      description: "화면 캡처에서 색상, 타이포그래피, 간격 등 디자인 토큰 추출",
      priority: 1,
      estimatedLineCount: 300  // 최대 토큰 제한 계산에 사용
    },
    {
      id: "ui-assets",
      name: "Document UI Assets",
      targetFile: "ui-assets.md",
      description: "로고, 아이콘, 이미지 등 에셋 정리 및 구현 가이드",
      priority: 2,
      estimatedLineCount: 200
    },
    {
      id: "ui-spec",
      name: "Create UI Specification",
      targetFile: "ui-spec.md",
      description: "화면별 레이아웃, 컴포넌트, 인터랙션 상세 명세",
      priority: 3,
      estimatedLineCount: 800
    }
  ],
  currentTask: undefined  // 첫 태스크는 다음 루프에서 꺼냄
}

// 4. 첫 번째 docGen 루프 (ui-tokens)
{
  currentTask: taskQueue.pop(),  // ui-tokens
  
  // LLM 프롬프트 구성:
  messages: [
    {
      role: "user",
      content: [
        // 베이스 프롬프트 (PromptEngine)
        "UI Design Token 추출 전문가입니다...",
        
        // Runtime Context (buildRuntimeContext)
        "# Target Document\nWrite to: `outputs/design/ui-tokens.md`",
        "# Current Task\n**Extract UI Tokens**\n화면 캡처에서...",
        "# Directive\n뉴스 애플리케이션 UI 문서 작성해줘",  // ✅ overrideDirective
        
        // 레퍼런스 이미지들 (vision)
        { type: "image", source: { data: "base64..." } },  // home.png
        { type: "image", source: { data: "base64..." } },  // article.png
        
        // PRD (optional context)
        "# PRD\n뉴스 애플리케이션...",
      ]
    }
  ],
  
  // LLM 응답 스트리밍:
  llmResponse: {
    thinking: "화면을 분석하여 일관된 색상 팔레트와 타이포그래피를 추출하겠습니다...",
    textResponse: "",
    toolCalls: [],  // 도구 호출 없음
  }
}

// XML 스트리밍 출력:
`
<thinking>화면을 분석하여...</thinking>

<file path="outputs/design/ui-tokens.md" action="create">
# UI Tokens

## 색상
- Primary: #1a73e8
- Secondary: #5f6368
- Background: #ffffff
- Text Primary: #202124
...
</file>
`

// 5. FileRenderer가 즉시 파일 작성
// outputs/design/ui-tokens.md 생성됨 ✅

// 6. 두 번째 docGen 루프 (ui-assets)
// 동일한 패턴으로 ui-assets.md 생성 ✅

// 7. 세 번째 docGen 루프 (ui-spec)
// ui-spec.md 생성 ✅

// 8. taskQueue 비어있음 → END
```

#### 결과
```
✅ 생성된 파일:
  - outputs/design/ui-tokens.md (300줄)
  - outputs/design/ui-assets.md (200줄)
  - outputs/design/ui-spec.md (800줄)

✅ 세션 저장:
  - sessions/chat.json (대화 히스토리)
  - sessions/code.json (상태 스냅샷)
    {
      taskQueue: [],
      completedTasks: ["ui-tokens", "ui-assets", "ui-spec"],
      completedTasksDetails: [...],
      tokenUsage: { input: 15000, output: 8000, total: 23000 }
    }
```

---

### 시나리오 B: UI 문서 완전 + 시스템 문서 없음 + 새로작성

#### 입력
```
채팅: "시스템 설계 문서 작성해줘"
상태:
  - outputs/design/ui-tokens.md ✅
  - outputs/design/ui-assets.md ✅
  - outputs/design/ui-spec.md ✅
  - outputs/design/system-design.md ❌
```

#### 처리 흐름

```typescript
// 1. resolve 노드
{
  prd: "...",
  overrideDirective: "시스템 설계 문서 작성해줘",
  design: undefined,  // system-design.md 아직 없음
  hasUiDoc: true  // ✅ ui-spec.md 존재 감지
}

// 2. detectEnvironment 노드
{
  designWorkType: "system-design",  // ✅ "시스템 설계" 키워드
  workTypeReasoning: "사용자가 시스템 설계 문서를 요청했고, UI 문서가 이미 존재함",
  domain: "service",  // PRD 분석 결과
  domainReasoning: "백엔드 API와 데이터베이스가 필요한 뉴스 서비스",
  environment: "fullstack",
  environmentReasoning: "프론트엔드(React) + 백엔드(Node.js) 필요"
}

// 3. decompose 노드
// ✅ fullstack이므로 3개 파일 생성
{
  taskQueue: [
    {
      id: "api-contract",
      name: "Define API Contract",
      targetFile: "api-contract.md",
      description: "프론트엔드-백엔드 간 API 명세 정의",
      priority: 1,
      estimatedLineCount: 400
    },
    {
      id: "fe-system-design",
      name: "Frontend System Design",
      targetFile: "fe-system-design.md",
      description: "프론트엔드 아키텍처, 상태관리, 라우팅",
      priority: 2,
      estimatedLineCount: 600,
      dependencies: ["api-contract"]
    },
    {
      id: "be-system-design",
      name: "Backend System Design",
      targetFile: "be-system-design.md",
      description: "백엔드 아키텍처, 데이터베이스, 인증",
      priority: 3,
      estimatedLineCount: 800,
      dependencies: ["api-contract"]
    }
  ]
}

// 4. docGen 루프들
// 각 태스크에서 LLM 프롬프트에 포함되는 내용:

// api-contract 태스크:
{
  messages: [
    {
      role: "user",
      content: [
        "API Contract 설계 전문가...",
        
        // ✅ CRITICAL: hasUiDoc=true이므로 UI 컨텍스트 포함
        "# UI Specification\n" + 
        "(ui-spec.md 전체 내용)",  // ✅ 화면 구조 참고용
        
        "# UI Tokens\n" +
        "(ui-tokens.md 요약)",  // 색상/폰트는 API와 무관하므로 요약만
        
        "# Target Document\napi-contract.md",
        "# Directive\n시스템 설계 문서 작성해줘",
        "# PRD\n..."
      ]
    }
  ]
}

// ✅ 결과: api-contract.md 생성
// UI 스펙에서 필요한 엔드포인트를 추론하여 정의

// fe-system-design 태스크:
{
  messages: [
    // ✅ 의존성 태스크 결과 포함
    "# API Contract\n" + "(api-contract.md 내용)",
    "# UI Specification\n" + "(ui-spec.md 내용)",
    // ✅ UI 컴포넌트 구조를 참고하여 프론트엔드 아키텍처 설계
  ]
}

// be-system-design 태스크:
{
  messages: [
    "# API Contract\n" + "(api-contract.md 내용)",
    // ✅ UI 스펙은 백엔드와 직접 관련 없으므로 생략 가능
  ]
}
```

#### 결과
```
✅ 생성된 파일:
  - outputs/design/api-contract.md (400줄)
  - outputs/design/fe-system-design.md (600줄)
  - outputs/design/be-system-design.md (800줄)

✅ UI 문서와의 일관성:
  - API 엔드포인트가 UI 화면 요구사항과 매칭됨
  - 프론트엔드 아키텍처가 ui-spec.md의 컴포넌트 구조 반영
```

---

### 시나리오 C: 시스템 문서 완전 + UI 문서 없음 + 새로작성

#### 입력
```
채팅: "UI 문서 작성해줘"
상태:
  - outputs/design/api-contract.md ✅
  - outputs/design/fe-system-design.md ✅
  - outputs/design/be-system-design.md ✅
  - outputs/design/ui-*.md ❌
  - inputs/references/screens/: 이미지들 존재
```

#### 처리 흐름

```typescript
// 1. resolve 노드
{
  overrideDirective: "UI 문서 작성해줘",
  design: "(api-contract + fe-system + be-system 통합 내용)",  // ✅ 기존 시스템 문서 로드
  hasUiDoc: false
}

// 2. detectEnvironment 노드
{
  designWorkType: "ui-design",
  workTypeReasoning: "UI 문서 요청, 레퍼런스 이미지 존재, 시스템 문서는 이미 완성됨"
}

// 3. decompose 노드
{
  taskQueue: [
    { id: "ui-tokens", targetFile: "ui-tokens.md", ... },
    { id: "ui-assets", targetFile: "ui-assets.md", ... },
    { id: "ui-spec", targetFile: "ui-spec.md", ... }
  ]
}

// 4. docGen - ui-spec 태스크 예시
{
  messages: [
    {
      role: "user",
      content: [
        "UI Specification 작성 전문가...",
        
        // ✅ CRITICAL: 기존 시스템 설계 참고
        "# Existing System Design\n" +
        "## API Contract\n" +
        "(api-contract.md 내용)" +
        "## Frontend Architecture\n" +
        "(fe-system-design.md 관련 부분)",
        
        "# UI Tokens\n(이전 태스크 결과)",
        
        "# Reference Images\n",
        { type: "image", ... },
        
        "# Directive\nUI 문서 작성해줘",
        
        // ✅ 가이드: API 스펙과 일관성 유지
        "⚠️ API Contract에 정의된 엔드포인트와 데이터 구조를 준수하세요"
      ]
    }
  ]
}

// LLM은 API 스펙을 참고하여 화면별 데이터 흐름 설계
```

#### 결과
```
✅ 생성된 파일:
  - outputs/design/ui-tokens.md
  - outputs/design/ui-assets.md
  - outputs/design/ui-spec.md

✅ 시스템 문서와의 일관성:
  - UI 화면이 api-contract.md의 엔드포인트 활용
  - 상태 관리가 fe-system-design.md의 아키텍처 준수
```

---

### 시나리오 D: UI 문서 부분 존재 + 수정 요청

#### 입력
```
채팅: "Primary 색상을 #FF6B6B로 바꿔줘"
상태:
  - outputs/design/ui-tokens.md ✅ (기존 Primary: #1a73e8)
  - outputs/design/ui-spec.md ✅
  - sessions/code.json ✅ (이전 작업 기록)
```

#### 처리 흐름

```typescript
// 1. resolve 노드
{
  overrideDirective: "Primary 색상을 #FF6B6B로 바꿔줘",
  design: undefined,  // ✅ design 변수는 system-design.md를 의미
  hasUiDoc: true
}

// 2. detectEnvironment 노드
{
  designWorkType: "ui-design",  // "색상" 키워드, ui-tokens.md 존재
  workTypeReasoning: "UI 토큰 수정 요청, 기존 ui-tokens.md가 존재함"
}

// 3. decompose 노드
// ✅ CRITICAL: 세션 복원 로직 작동
{
  // 3-1. 세션 로드
  session: {
    state: {
      completedTasks: ["ui-tokens", "ui-assets", "ui-spec"],
      completedTasksDetails: [
        { id: "ui-tokens", targetFile: "ui-tokens.md", status: "completed", ... },
        { id: "ui-assets", ... },
        { id: "ui-spec", ... }
      ],
      directive: "뉴스 애플리케이션 UI 문서 작성해줘",  // 이전 지시
    }
  },
  
  // 3-2. Directive Merge
  // 최신 것이 우선순위가 높음
  mergedDirective: 
    "Primary 색상을 #FF6B6B로 바꿔줘\n\n" +
    "---\n\n" +
    "뉴스 애플리케이션 UI 문서 작성해줘",
  
  // 3-3. LLM이 변경 범위 분석
  llmAnalysis: {
    documentType: "contract-first",
    targetFiles: ["ui-tokens.md", "ui-spec.md"],  // ✅ 색상 변경 → 두 파일 영향
    tasks: [
      {
        id: "update-ui-tokens",
        name: "Update UI Tokens",
        targetFile: "ui-tokens.md",
        description: "Primary 색상을 #FF6B6B로 변경",
        priority: 1,
        estimatedLineCount: 50  // 부분 수정이므로 작음
      },
      {
        id: "update-ui-spec",
        name: "Update UI Specification",
        targetFile: "ui-spec.md",
        description: "Primary 색상 사용 부분을 새 값으로 업데이트",
        priority: 2,
        estimatedLineCount: 100,
        dependencies: ["update-ui-tokens"]
      }
    ]
  },
  
  taskQueue: [...],
  designMode: "evolution"  // ✅ 기존 문서 수정
}

// 4. docGen - update-ui-tokens 태스크
{
  messages: [
    {
      role: "user",
      content: [
        "UI Tokens 업데이트 전문가...",
        
        // ✅ CRITICAL: evolution 모드이므로 기존 문서 포함
        "# Existing Design Document\n" +
        readFileSync("outputs/design/ui-tokens.md"),  // ✅ 전체 내용 로드
        
        "# Target Document\nui-tokens.md",
        
        "# Directive\n" +
        "Primary 색상을 #FF6B6B로 바꿔줘\n" +
        "---\n" +
        "뉴스 애플리케이션 UI 문서 작성해줘",
        
        "⚠️ 기존 문서를 수정합니다. <file action='append'>를 사용하여 변경사항을 추가하세요."
      ]
    }
  ],
  
  // LLM 응답:
  llmOutput: `
<thinking>
기존 ui-tokens.md에서 Primary 색상 정의 부분을 찾아 #FF6B6B로 변경하겠습니다.
전체 파일을 다시 작성하는 대신 append 액션으로 변경된 섹션만 제공하겠습니다.
</thinking>

<file path="outputs/design/ui-tokens.md" action="append">
## 색상 (업데이트됨)

### Primary Colors
- **Primary**: #FF6B6B
  - 사용처: 주요 CTA 버튼, 링크, 강조 요소
  - 접근성: WCAG AA 준수 (흰 배경 대비 4.5:1)
  
(나머지 색상은 변경 없음)
</file>
  `
}

// 5. FileRenderer 처리
// ✅ action="append"이지만 실제로는 섹션 교체 필요
// CommonRenderStrategy가 판단:
//   - 기존 파일 존재
//   - LLM이 전체 파일이 아닌 부분만 제공
//   - 실제 동작: 전체 파일 덮어쓰기 (create)

// ✅ 결과: outputs/design/ui-tokens.md 업데이트됨

// 6. update-ui-spec 태스크도 동일한 패턴으로 실행
```

#### 결과
```
✅ 수정된 파일:
  - outputs/design/ui-tokens.md (Primary: #1a73e8 → #FF6B6B)
  - outputs/design/ui-spec.md (Primary 색상 참조 부분 업데이트)

✅ 세션 업데이트:
  - sessions/code.json에 새 directive 추가
  - completedTasks에 "update-ui-tokens", "update-ui-spec" 추가
```

---

### 시나리오 E: 시스템 문서 부분 + 추가 요청

#### 입력
```
채팅: "소셜 로그인 기능 추가해줘"
상태:
  - outputs/design/api-contract.md ✅ (기본 인증만 있음)
  - outputs/design/fe-system-design.md ✅
  - outputs/design/be-system-design.md ✅
```

#### 처리 흐름

```typescript
// 1. resolve 노드
{
  overrideDirective: "소셜 로그인 기능 추가해줘",
  design: "(api-contract + fe-system + be-system 통합)",
  hasUiDoc: true  // UI 문서도 존재한다고 가정
}

// 2. detectEnvironment 노드
{
  designWorkType: "system-design",
  workTypeReasoning: "인증 기능 추가는 시스템 설계 변경이 필요함"
}

// 3. decompose 노드
{
  mergedDirective:
    "소셜 로그인 기능 추가해줘\n" +
    "---\n" +
    "(이전 directives...)",
  
  llmAnalysis: {
    documentType: "contract-first",
    targetFiles: ["api-contract.md", "be-system-design.md"],  // ✅ FE는 API만 호출하므로 변경 불필요
    tasks: [
      {
        id: "add-social-auth-api",
        name: "Add Social Auth to API Contract",
        targetFile: "api-contract.md",
        description: "Google/Facebook OAuth 엔드포인트 추가",
        priority: 1,
        estimatedLineCount: 200
      },
      {
        id: "add-social-auth-be",
        name: "Update Backend for Social Auth",
        targetFile: "be-system-design.md",
        description: "OAuth 2.0 플로우, 토큰 관리, 사용자 매핑",
        priority: 2,
        estimatedLineCount: 300,
        dependencies: ["add-social-auth-api"]
      }
    ]
  },
  
  designMode: "evolution"
}

// 4. docGen - add-social-auth-api 태스크
{
  messages: [
    {
      role: "user",
      content: [
        "API Contract 업데이트 전문가...",
        
        // ✅ 기존 API Contract 포함 (evolution 모드)
        "# Existing Design Document\n" +
        readFileSync("outputs/design/api-contract.md"),
        
        // ✅ 관련 문서들도 참고
        "# Backend System Design (Reference)\n" +
        "(be-system-design.md에서 인증 관련 부분 추출)",
        
        "# Directive\n소셜 로그인 기능 추가해줘",
        
        "⚠️ 기존 API를 유지하면서 새로운 엔드포인트를 추가하세요"
      ]
    }
  ],
  
  llmOutput: `
<file path="outputs/design/api-contract.md" action="append">
## 인증 API (업데이트됨)

### 기존 엔드포인트
(변경 없음)

### 새 엔드포인트 - 소셜 로그인

#### POST /api/auth/social/google
**설명**: Google OAuth 2.0 로그인
**요청**:
\`\`\`json
{
  "token": "google_id_token",
  "provider": "google"
}
\`\`\`
**응답**:
\`\`\`json
{
  "accessToken": "jwt_token",
  "user": { "id": "...", "email": "...", "name": "..." }
}
\`\`\`

(Facebook도 동일한 패턴)
</file>
  `
}

// 5. add-social-auth-be 태스크
// be-system-design.md에 OAuth 플로우, 보안 고려사항, DB 스키마 추가
```

#### 결과
```
✅ 업데이트된 파일:
  - outputs/design/api-contract.md (소셜 로그인 엔드포인트 추가)
  - outputs/design/be-system-design.md (OAuth 구현 가이드 추가)

✅ 영향도 분석:
  - fe-system-design.md는 변경 불필요 (API만 호출)
  - ui-spec.md는 별도 업데이트 필요할 수 있음 (UI 변경 시)
```

---

### 시나리오 F: 모든 문서 완전 + 질문 (Tool Calling)

#### 입력
```
채팅: "현재 Primary 색상이 뭐야?"
상태:
  - outputs/design/: 모든 파일 존재
```

#### 처리 흐름

```typescript
// 1~3. resolve → detectEnvironment → decompose
// 동일하게 진행되지만, LLM이 "정보 검색" 태스크로 판단

// 4. docGen 루프
{
  messages: [
    {
      role: "user",
      content: [
        "Design 문서 분석 전문가...",
        "# Directive\n현재 Primary 색상이 뭐야?",
        
        // ✅ 도구 사용 가이드
        "# Available Tools\n" +
        "- read_file: 파일 내용 읽기\n" +
        "- codebase_search: 의미 기반 검색\n" +
        "사용자 질문에 답하기 위해 도구를 사용하세요."
      ]
    }
  ],
  
  // LLM 응답:
  llmResponse: {
    thinking: "ui-tokens.md 파일을 읽어서 Primary 색상을 확인하겠습니다",
    textResponse: "",
    toolCalls: [
      {
        id: "call_1",
        name: "read_file",
        args: {
          target_file: "outputs/design/ui-tokens.md",
          limit: 50  // 색상 부분만 읽기
        }
      }
    ],
    done: false  // ✅ 아직 응답 완료 안됨
  }
}

// 5. tool 노드로 라우팅
{
  toolResult: `
## 색상
- Primary: #FF6B6B
- Secondary: #5f6368
...
  `,
  
  // conversationHistory에 추가:
  conversationHistory: [
    { role: "user", content: "현재 Primary 색상이 뭐야?" },
    {
      role: "assistant",
      content: [
        { type: "thinking", text: "ui-tokens.md 파일을 읽어서..." },
        {
          type: "tool_use",
          id: "call_1",
          name: "read_file",
          input: { target_file: "outputs/design/ui-tokens.md", limit: 50 }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_1",
          content: "## 색상\n- Primary: #FF6B6B\n..."
        }
      ]
    }
  ]
}

// 6. docGen으로 다시 라우팅 (대화 계속)
{
  messages: [
    { role: "user", content: "..." },  // 초기 프롬프트
    ...conversationHistory  // ✅ 도구 호출 히스토리 포함
  ],
  
  // LLM 최종 응답:
  llmResponse: {
    thinking: "",
    textResponse: "현재 Primary 색상은 **#FF6B6B**입니다. 이 색상은 주요 CTA 버튼과 링크에 사용됩니다.",
    toolCalls: [],
    done: true  // ✅ 완료
  }
}

// 7. 파일 작성 없음 → taskQueue에서 다음 태스크 (없음) → END
```

#### 결과
```
✅ 채팅 응답:
  "현재 Primary 색상은 **#FF6B6B**입니다. 이 색상은 주요 CTA 버튼과 링크에 사용됩니다."

❌ 파일 변경 없음
✅ 세션에 대화 기록 저장
```

---

### 시나리오 G: 복잡한 수정 (여러 파일 영향)

#### 입력
```
채팅: "다크모드 지원 추가해줘"
상태:
  - outputs/design/ui-tokens.md ✅
  - outputs/design/ui-spec.md ✅
  - outputs/design/fe-system-design.md ✅
```

#### 처리 흐름

```typescript
// decompose 노드에서 LLM이 영향 범위 분석:
{
  llmAnalysis: {
    documentType: "contract-first",
    targetFiles: ["ui-tokens.md", "ui-spec.md", "fe-system-design.md"],
    tasks: [
      {
        id: "add-dark-mode-tokens",
        name: "Add Dark Mode Tokens",
        targetFile: "ui-tokens.md",
        description: "다크모드 색상 팔레트 정의",
        priority: 1,
        estimatedLineCount: 200
      },
      {
        id: "update-ui-spec-dark",
        name: "Update UI Spec for Dark Mode",
        targetFile: "ui-spec.md",
        description: "각 화면의 다크모드 동작 명세",
        priority: 2,
        estimatedLineCount: 300,
        dependencies: ["add-dark-mode-tokens"]
      },
      {
        id: "update-fe-arch-dark",
        name: "Update Frontend Architecture",
        targetFile: "fe-system-design.md",
        description: "테마 전환 로직, 상태 관리, 로컬 저장소",
        priority: 3,
        estimatedLineCount: 250,
        dependencies: ["add-dark-mode-tokens"]
      }
    ]
  }
}

// docGen 루프에서 순차 실행:
// 1. ui-tokens.md에 dark 토큰 추가
// 2. ui-spec.md에 다크모드 동작 추가 (ui-tokens 참고)
// 3. fe-system-design.md에 구현 가이드 추가 (ui-tokens + ui-spec 참고)
```

#### 결과
```
✅ 업데이트된 파일:
  - outputs/design/ui-tokens.md (dark 팔레트 추가)
  - outputs/design/ui-spec.md (다크모드 스펙 추가)
  - outputs/design/fe-system-design.md (테마 전환 로직 추가)

✅ 의존성 관리:
  - 태스크 간 순서 보장 (tokens → spec → architecture)
  - 각 태스크가 이전 태스크 결과 참고
```

---

## 🔑 핵심 메커니즘

### 1. Directive 우선순위

```typescript
// resolve 노드에서:
if (state.overrideDirective) {
  // ✅ 채팅 입력 (최우선)
  directive = state.overrideDirective;
} else {
  // 파일 시스템에서 로드
  directive = await ArtifactService.getDirective(...);
}
```

### 2. 문서 존재 여부 감지

```typescript
// resolve 노드:
const hasUiDoc = !!(uiContext?.uiDoc && uiContext.uiDoc.trim().length > 100);

// detectEnvironment 노드:
const hasUiTokens = await fileExists("outputs/design/ui-tokens.md");
const hasSystemDesign = await fileExists("outputs/design/system-design.md");
// → LLM 프롬프트에 전달하여 작업 타입 결정
```

### 3. 세션 복원 및 Directive Merge

```typescript
// decompose 노드:
const session = await state.deps.session.load(...);
if (session.state?.completedTasksDetails) {
  // 이전 작업 복원
  
  // Directive 병합 (최신 것이 먼저)
  const allDirectives = [
    state.overrideDirective,
    ...session.state.directives || []
  ].filter(Boolean);
  
  const mergedDirective = allDirectives.join("\n\n---\n\n");
}
```

### 4. Design Mode 결정

```typescript
// decompose 노드 LLM이 분석:
if (existingDesignFiles.length === 0) {
  return { designMode: "greenfield" };  // 새로 작성
} else if (directive.includes("수정") || directive.includes("변경")) {
  return { designMode: "evolution" };  // 부분 수정
} else if (directive.includes("리팩토링")) {
  return { designMode: "refactor" };  // 전체 재구성
}
```

### 5. 기존 문서 로드 전략

```typescript
// docGen 노드 - buildRuntimeContext:
if (state.designMode === 'evolution' || state.designMode === 'refactor') {
  // ✅ evolution/refactor: 전체 문서 포함
  if (state.design) {
    lines.push(`# Existing Design Document`);
    lines.push(state.design);
  }
} else {
  // ❌ greenfield: 기존 문서 포함 안함
  // (lastSectionNumber만으로 순차 생성)
}
```

### 6. 파일 액션 타입 결정

```typescript
// FileRenderer:
let finalActionType: 'create' | 'append';

if (existingFiles.has(canonicalPath)) {
  // ✅ 기존 파일 존재 → 기본적으로 append
  finalActionType = actionType || 'append';
  
  // ✅ 하지만 LLM이 전체 파일을 제공하면 create로 처리
  if (isFullFileContent(contentBuffer)) {
    finalActionType = 'create';
  }
} else {
  // ✅ 새 파일 → create
  finalActionType = 'create';
}
```

### 7. Tool Calling 루프

```typescript
// graph.ts - routing:
if (state.llmResponse?.toolCalls && state.llmResponse.toolCalls.length > 0) {
  return "tool";  // tool 노드로 이동
} else {
  return "checkTaskStatus";  // 다음 태스크로
}

// tool 노드 → docGen으로 다시 라우팅 (conversationHistory에 결과 추가)
```

---

## 📊 요약 테이블

| 시나리오 | UI 문서 | 시스템 문서 | 지시 타입 | designMode | 주요 동작 |
|---------|---------|------------|----------|------------|----------|
| A | 없음 | 없음 | 새로작성 | greenfield | 3개 UI 파일 생성 |
| B | 완전 | 없음 | 새로작성 | greenfield | 3개 시스템 파일 생성, UI 참고 |
| C | 없음 | 완전 | 새로작성 | greenfield | 3개 UI 파일 생성, 시스템 참고 |
| D | 부분 | - | 수정 | evolution | 1-2개 파일 업데이트 |
| E | - | 부분 | 추가 | evolution | 2-3개 파일에 섹션 추가 |
| F | 완전 | 완전 | 질문 | - | Tool calling, 파일 변경 없음 |
| G | 완전 | 완전 | 복잡 수정 | evolution | 여러 파일 동시 업데이트 |

---

## 🎯 결론

Design job의 채팅 지시 처리는 다음 원칙을 따릅니다:

1. **Context-Aware**: 기존 문서 상태를 감지하여 작업 범위 결정
2. **Directive Merge**: 이전 지시사항과 새 지시사항을 누적하여 컨텍스트 유지
3. **Session Continuity**: 세션 복원으로 중단된 작업 재개 가능
4. **Cross-Reference**: UI ↔ 시스템 문서 간 상호 참조로 일관성 유지
5. **Incremental Updates**: evolution 모드에서 전체 문서 컨텍스트 제공
6. **Tool Integration**: 질문 응답을 위한 도구 호출 지원

이를 통해 사용자는 자연어로 점진적으로 문서를 발전시킬 수 있습니다.

