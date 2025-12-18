# Design Prompt 개선: PRD 제약 보존 원칙

## 문제 상황

**발견된 버그**: PRD에 명시된 중요 제약이 System Design 문서에서 누락됨

**구체적 사례** (ant-news 프로젝트):
- PRD §4.2, §4.3: 사용할 뉴스 소스 명시 (NewsData.io, TheNewsAPI, Coindesk RSS, etc.)
- System Design 산출물: 추상적인 "NewsAPIClient", "RSSFeedClient"만 언급
- 결과: Code generation이 PRD 제약을 무시하고 임의의 API 선택

---

## 근본 원인

Design job 프롬프트의 **"Implementation Detail Filter"**가 과도하게 강력함:

```markdown
❌ Concrete URL paths and query formats
❌ Concrete storage keys or internal persistence shapes
❌ UI component trees, props contracts, or handler names
```

→ LLM이 PRD의 **외부 API 명시**를 "implementation detail"로 오해하여 필터링

---

## 해결 방법론: 원칙 기반 접근

### 핵심 원칙: "누가 결정했는가?"

```
┌─────────────────────────────────────────────────────┐
│  PRD가 명시한 제약 → System Design에 반드시 포함    │
│  LLM이 선택한 구현 → System Design에서 제외         │
└─────────────────────────────────────────────────────┘
```

### 판단 기준

**✅ MUST Document (PRD-Specified Constraints):**
- Required technologies: "React 18", "PostgreSQL only", "No Redux"
- Required external services: "NewsData.io", "Stripe API", "Firebase Auth"
- Required patterns: "Layered architecture", "Event-driven", "No microservices"
- Required libraries: "Zustand", "TanStack Router", specific versions
- Required platforms: "Vercel only", "AWS Lambda"
- Forbidden technologies: "No MongoDB", "No GraphQL"

**❌ MUST NOT Document (LLM-Chosen Details):**
- Internal identifiers YOU invent:
  - Storage keys: `"bookmarks"`, `"userData"`
  - Route paths: `"/dashboard"`, `"/settings"` (unless PRD defines)
  - Component names: `NewsCard`, `UserProfile`
  - Function names: `handleClick`, `fetchData`
- Algorithms/patterns YOU choose:
  - "Exponential backoff with 3 retries" (unless PRD specifies)
  - "Debounce search by 300ms" (unless PRD specifies)
- UI details YOU design:
  - Component hierarchies, prop interfaces, spinner types

---

## 수정된 프롬프트 파일

### 1. `design/phases/execute/base.md`

**Before:**
```markdown
⚠️ PRD = ABSOLUTE TRUTH
- Follow PRD's technical constraints exactly
```

**After:**
```markdown
🚨 CRITICAL: PRD-Specified Constraints vs Implementation Details

The Golden Rule:
- PRD-specified constraint → MUST document (architecture)
- LLM-chosen implementation → MUST NOT include (detail)

**Examples of PRD-Specified Constraints (MUST):
✅ Technologies, external services, patterns, libraries, platforms
**Rule**: Copy exact names from PRD, do NOT provide generic examples

Examples of Implementation Details (MUST NOT):
❌ Internal names/paths/keys YOU invent (unless PRD specifies)
```

### 2. `design/phases/execute/rules.md`

**Before:**
```markdown
DO NOT Write:
❌ Concrete URL paths and query formats
❌ Concrete storage keys
```

**After:**
```markdown
CRITICAL DISTINCTION: Who specified this detail?

If PRD specified it → Document (constraint)
If YOU chose it → Omit (implementation)

❌ DO NOT document details YOU choose:
  - Internal identifiers YOU invent
  - Algorithms/patterns YOU select
  - UI implementation YOU design

✅ ALWAYS document PRD-specified constraints:
  - Required technologies/services/patterns
  - Forbidden technologies
```

### 3. `design/base/system.md`

**Before:**
```markdown
❌ Concrete identifiers:
  - Storage key names, URL paths, Store names
```

**After:**
```markdown
Forbidden Content (LLM-Chosen Implementation Details):

CRITICAL: Apply "Who decided?" test
- PRD specified → Include (constraint)
- YOU chose → Exclude (detail)

✅ ALWAYS document PRD-specified constraints:
  - Required technologies, external services, patterns
  - Forbidden technologies
```

### 4. `design/base/injections/frontend-guide.md`

**Before:**
```markdown
API Client Pattern:
- Auth API: login(), logout()
- User API: getProfile()
```

**After:**
```markdown
TWO TYPES OF APIs:

A. Internal Backend (api-contract.md exists)
   → Reference contract, don't redefine

B. External Services (PRD specifies)
   → Document ALL PRD-required services
   
Example:
### External Service Integration (Per PRD)
- NewsData.io: News aggregation (PRD §4.2)
- Stripe API: Payments (PRD §7.2)
- Firebase Auth: Authentication (PRD §6.1)
```

---

## 효과

### Before (문제)
```markdown
## Infrastructure Layer
- NewsAPIClient: 외부 뉴스 API 호출
- CryptoPanicClient: 블록체인 뉴스 수집
```
→ **어떤 API인지 불명확** → Code generation이 임의 선택

### After (해결)
```markdown
## Infrastructure Layer

### External Services (Per PRD Requirements)
- NewsData.io: Blockchain/AI keyword search (PRD §4.2)
- TheNewsAPI: Web3 news (PRD §4.2)
- Coindesk RSS: Crypto news feed (PRD §4.2)

### Service Adapters
- NewsDataClient: NewsData.io wrapper
- TheNewsAPIClient: TheNewsAPI wrapper
- RSSFeedClient: RSS parsing (Coindesk, Cointelegraph)
```
→ **PRD 제약 정확히 반영** → Code generation이 올바른 API 사용

---

## 일반화된 원칙

### Design Document의 역할 재정의

**System Design은:**
- ✅ PRD 제약을 Code generation에 전달하는 **Bridge**
- ✅ 아키텍처 결정과 컴포넌트 상호작용 설명
- ❌ LLM이 선택한 구현 세부사항 나열 아님

### 판단 프로세스

```
1. 문서화할 내용 발견
   ↓
2. 질문: "이것을 PRD가 명시했는가?"
   ↓
   YES → 문서화 (아키텍처 제약)
   NO  → 생략 (구현 세부사항)
```

### 적용 범위

이 원칙은 **모든 종류의 PRD 제약**에 적용:
- 기술 스택 (React, PostgreSQL, etc.)
- 외부 서비스 (Stripe, Firebase, NewsData.io)
- 아키텍처 패턴 (Layered, Event-driven)
- 라이브러리 (Zustand, TanStack Router)
- 플랫폼 (Vercel, AWS Lambda)
- 금지 사항 (No Redux, No microservices)

---

## 검증 방법

### Design Job 체크리스트

System Design 문서 생성 후 확인:

1. ✅ PRD에 명시된 모든 기술/서비스가 문서화되었는가?
2. ✅ PRD에 명시된 금지 사항이 언급되었는가?
3. ✅ LLM이 임의로 선택한 식별자가 제거되었는가?
4. ✅ 외부 서비스는 PRD 섹션 번호와 함께 인용되었는가?

### Code Job 검증

생성된 코드에서:

1. ✅ PRD 명시 API만 사용하는가?
2. ✅ PRD 금지 기술이 포함되지 않았는가?
3. ✅ PRD 요구 라이브러리가 올바르게 사용되는가?

---

## 향후 개선 방향

### 1. PRD Constraint Extraction (자동화 가능)
```typescript
// PRD 파싱하여 제약 추출
extractConstraints(prd: string): {
  requiredTech: string[],
  requiredServices: string[],
  forbiddenTech: string[],
  requiredPatterns: string[]
}
```

### 2. Design Validation Hook
```typescript
// System Design 검증
validateDesign(design: string, constraints: Constraints): {
  missingConstraints: string[],
  violatedProhibitions: string[]
}
```

### 3. Prompt 계층 구조 명확화
```
System Prompt (불변 원칙)
  ↓
PRD Constraints (프로젝트별)
  ↓
Task Context (태스크별)
```

---

## 결론

**핵심 통찰**:
- "Implementation Detail Filter"는 필요하지만, **PRD 제약과 구분**해야 함
- 판단 기준은 **"누가 결정했는가"** (PRD vs LLM)
- 원칙 기반 접근으로 **모든 종류의 제약**을 올바르게 처리 가능

**기대 효과**:
- PRD → System Design → Code 체인에서 제약 보존
- Code generation이 PRD 요구사항 정확히 준수
- 불필요한 구현 세부사항은 여전히 필터링됨
