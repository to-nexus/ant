# Mode-Specific Context Priority

각 모드별로 필요한 컨텍스트의 우선순위와 프롬프트 주입 전략

---

## 📊 Mode별 컨텍스트 우선순위

### **1. Generate Mode** (새 기능 생성)

**우선순위**:
```
1. 💬 Directive          (100%) - 사용자 요청 (최고 우선순위, NEVER truncate)
2. 🎯 Design Doc         (90%)  - 무엇을 만들지 명확히 정의
3. 📁 Codebase (Current) (85%)  - 기존 구조, 패턴, 중복 방지 (CRITICAL!)
4. 📚 Lessons            (80%)  - 아키텍처 패턴, 코딩 스타일
5. 🗂️  Related Files     (75%)  - 타입 정의, 인터페이스, 유틸
6. ❌ Original Files     (0%)   - 없음 (Git HEAD와 동일, 중복)
```

**❗ 중요**: Generate ≠ "기존 코드 무시"
- ✅ **기존 구조 파악**: 어디에 파일을 만들지 (디렉토리 구조)
- ✅ **중복 방지**: 이미 있는 기능인지 확인
- ✅ **패턴 일치**: 기존 코드 스타일, 아키텍처 따르기
- ✅ **의존성 파악**: Import할 타입, 유틸, 서비스
- ❌ **기존 코드 수정**: 새 파일만 생성 (기존 파일 변경 최소화)

**예시**:
```
User: "Add a new UserProfile API endpoint"

LLM이 봐야 하는 것:
  ✅ 기존 API 엔드포인트들 (src/api/controllers/*.ts)
     → 파일 위치 파악: src/api/controllers/UserProfileController.ts
     → 네이밍 패턴: XxxController.ts
     → 구조 패턴: class + @Route decorator
  
  ✅ 기존 타입 정의 (src/types/User.ts)
     → 중복 방지: User 타입 이미 있음, 재사용
  
  ✅ 기존 서비스 레이어 (src/services/*.ts)
     → 아키텍처 패턴: Controller → Service → Repository
     → 새로운 UserProfileService 필요
  
  ✅ 기존 미들웨어 (src/middleware/auth.ts)
     → 인증 패턴: @UseAuth() decorator 사용
  
  ❌ Git HEAD (Original Files)
     → Generate 모드에서는 불필요 (Current Code와 동일)
```

**프롬프트 구성**:
```
System Prompt
  ├─ Base Template (generate mode)
  ├─ Directive (FULL)
  ├─ Design Doc (FULL)
  ├─ Codebase Context (SMART SELECTION)
  │   ├─ Directory Structure (어디에 만들지)
  │   ├─ Similar Files (패턴 참고)
  │   ├─ Type Definitions (재사용)
  │   └─ Related Services (의존성)
  ├─ Lessons (high-score only, 0.7+)
  └─ Language/Framework Profile
```

**토큰 배분** (총 ~30K):
- Directive: ~1K
- Design Doc: ~10K (최대한 유지)
- **Codebase Context: ~10K** ← ✅ 증가! (기존 구조 파악)
  - Directory tree: ~1K
  - Similar files (3-5개): ~6K
  - Type definitions: ~2K
  - Related services: ~1K
- Lessons: ~5K (3-5개, 고품질)
- System/Rules: ~2K
- Language Profile: ~2K

---

### **2. Refactor Mode** (기존 코드 개선)

**우선순위**:
```
1. 💬 Directive          (100%) - 사용자 요청 (최고 우선순위, NEVER truncate)
2. 🎯 Original Files     (95%)  - 변경 전 코드 (MUST)
3. 📁 Current Code       (90%)  - 현재 상태
4. 💭 Session History    (85%)  - 이전 대화 컨텍스트 (특히 같은 세션 내 수정)
5. 📚 Lessons            (70%)  - 리팩토링 패턴
6. 🗂️  Related Files     (60%)  - 의존성 파일
7. ⚠️  Design Doc        (30%)  - 아키텍처 참고용 (선택적)
```

**✅ Session-Aware Refinement**:
```
If (same session AND previous turn was generate/refactor):
  Priority Boost:
  1. 💬 Current Directive     (100%)
  2. 💭 Previous Directive    (95%)  ← ✅ 이전 요청 추가!
  3. 📄 Previous Output       (90%)  ← ✅ 방금 생성한 코드
  4. 🎯 Original Files        (85%)  ← 우선순위 약간 하락
  5. 📁 Current Code          (80%)
  ...
```

**프롬프트 구성**:
```
System Prompt
  ├─ Base Template (refactor mode)
  ├─ Original Files (FULL, Git HEAD)
  ├─ Current Code (FULL, working tree)
  ├─ Diff Analysis (변경 범위)
  ├─ Lessons (refactoring patterns)
  ├─ Related Files (dependencies)
  └─ Modification Warning
```

**토큰 배분** (총 ~30K):
- Directive (current): ~1K
- Original Files: ~12K (변경 전 전체)
- Current Code: ~10K (현재 전체)
- Lessons: ~3K (2-3개, 리팩토링 관련)
- Related Files: ~3K (의존성)
- System/Rules: ~1K

**✅ Session-Aware 토큰 배분** (같은 세션 내 연속 수정):
- Current Directive: ~1K
- **Previous Directive: ~0.5K** ← ✅ 추가
- **Previous Output: ~8K** ← ✅ 방금 생성한 코드
- Original Files: ~8K (줄임, Previous Output과 중복 가능)
- Current Code: ~8K
- Lessons: ~2K
- Related Files: ~2K
- System/Rules: ~0.5K

**특별 처리**:
- Git diff 하이라이트
- 변경 범위 명시
- 테스트 코드 우선 로드
- **✅ Session Turn 연결**: "You previously generated..." 추가

---

### **3. Explain Mode** (코드 이해/문서화)

**우선순위**:
```
1. 💬 Directive          (100%) - 사용자 요청 (최고 우선순위, NEVER truncate)
2. 🎯 Current Code       (95%)  - 설명할 코드 (MUST)
3. 📁 Related Files      (80%)  - 컨텍스트 이해
4. 📚 Lessons            (60%)  - 과거 설명, 아키텍처 문서
5. 🗂️  Codebase          (40%)  - 전체 구조 참고
6. ❌ Design Doc         (0%)   - 불필요
7. ❌ Original Files     (0%)   - 불필요 (변경 없음)
```

**프롬프트 구성**:
```
System Prompt
  ├─ Base Template (explain mode)
  ├─ Current Code (FULL)
  ├─ Related Files (dependencies, imports)
  ├─ Lessons (architecture, patterns)
  ├─ Documentation Style Guide
  └─ Language Profile
```

**토큰 배분** (총 ~30K):
- Current Code: ~15K (설명할 코드 전체)
- Related Files: ~8K (컨텍스트)
- Lessons: ~3K (아키텍처, 패턴)
- System/Rules: ~2K
- Documentation Style: ~2K

**특별 처리**:
- 코드 블록 구조 분석
- 함수/클래스 시그니처 추출
- 의존성 그래프 시각화

---

## 🔧 Mode별 프롬프트 Injection

### **Generate Mode Injections**

```typescript
// packages/ant-cli/src/core/prompt/engine/ModeController.ts

if (mode === 'generate') {
  injections.push(
    `${phasePrefix}/injections/design-doc`,      // 최고 우선순위
    `${phasePrefix}/injections/lessons`,         // 패턴, 스타일
    `${phasePrefix}/injections/related-files`,   // 타입, 인터페이스
    `${phasePrefix}/injections/code-examples`,   // 예제
    `${commonPrefix}/generation-best-practices`  // 생성 가이드
  );
  
  // Design Doc 전체 포함 (truncate 안함)
  context.designDoc = assembled.designDoc;  // NO truncation
}
```

### **Refactor Mode Injections**

```typescript
if (mode === 'refactor') {
  injections.push(
    `${phasePrefix}/injections/original-files`,     // 최고 우선순위
    `${phasePrefix}/injections/current-code`,       // 현재 상태
    `${phasePrefix}/injections/diff-analysis`,      // 변경 범위
    `${phasePrefix}/injections/lessons`,            // 리팩토링 패턴
    `${phasePrefix}/injections/modification-warning`, // 주의사항
    `${commonPrefix}/refactoring-best-practices`    // 리팩토링 가이드
  );
  
  // Original Files 전체 포함 (truncate 안함)
  context.originalFiles = assembled.originalFiles;  // NO truncation
  context.currentCode = assembled.currentCode;      // NO truncation
}
```

### **Explain Mode Injections**

```typescript
if (mode === 'explain') {
  injections.push(
    `${phasePrefix}/injections/current-code`,       // 최고 우선순위
    `${phasePrefix}/injections/related-files`,      // 컨텍스트
    `${phasePrefix}/injections/lessons`,            // 아키텍처 참고
    `${commonPrefix}/documentation-style-guide`     // 문서화 가이드
  );
  
  // Design Doc 제외 (불필요)
  context.designDoc = undefined;
  
  // Current Code 전체 포함
  context.currentCode = assembled.currentCode;  // NO truncation
}
```

---

## 📝 Mode별 프롬프트 템플릿

### **Generate Mode Base Template**

```markdown
# Code Generation Task

You are generating NEW code for this project.

## Task
{{directive}}

## Design Specification
{{designDoc}}

## Existing Codebase Structure
{{codebaseStructure}}

### Directory Structure
```
{{directoryTree}}
```

### Similar Existing Files (for pattern reference)
{{similarFiles}}

### Type Definitions (reuse these)
{{typeDefinitions}}

### Related Services/Utils (you may need to import)
{{relatedServices}}

## Architecture Patterns (from past work)
{{lessons}}

## Instructions
1. Follow the design specification closely
2. **CRITICAL**: Match the existing codebase structure
   - Use the same directory patterns
   - Follow existing naming conventions
   - Reuse existing types and interfaces
   - Import existing utilities
3. **Avoid duplication**: Check if similar functionality exists
4. Use established patterns from lessons and similar files
5. Create complete, production-ready code
6. Include error handling and validation
7. Add appropriate tests in the test directory
```

### **Refactor Mode Base Template**

```markdown
# Code Refactoring Task

You are IMPROVING existing code while preserving functionality.

## Current Task
{{directive}}

{{#if sessionContext}}
## Previous Interaction Context
In the previous turn, you were asked to:
> {{sessionContext.previousDirective}}

You generated the following code:
```
{{sessionContext.previousOutput}}
```

The user is now requesting modifications to this code.
{{/if}}

## Original Code (before changes)
{{originalFiles}}

## Current Code (working tree)
{{currentCode}}

## Changes Made
{{diffAnalysis}}

## Refactoring Patterns (from past work)
{{lessons}}

## Instructions
1. Preserve ALL existing functionality
2. Address the user's specific request
{{#if sessionContext}}
3. Build upon your previous work - maintain consistency
4. Explain what changed from the previous version
{{/if}}
5. Improve code structure and readability
6. Optimize performance where possible
7. Maintain backward compatibility
8. Keep tests passing
9. Document significant changes
```

### **Explain Mode Base Template**

```markdown
# Code Explanation Task

You are explaining existing code.

## Task
{{directive}}

## Code to Explain
{{currentCode}}

## Related Context
{{relatedFiles}}

## Architecture Context (from past work)
{{lessons}}

## Instructions
1. Provide clear, concise explanations
2. Explain the "why" not just the "what"
3. Highlight important patterns and decisions
4. Point out potential issues or improvements
5. Use diagrams where helpful
```

---

## 🔄 CodebaseRetriever Mode Adaptation

```typescript
// packages/ant-cli/src/core/codebase/CodebaseRetriever.ts

async retrieve(
  directive: string,
  workingDir: string,
  deps: { git?, vectorDB? },
  options: RetrieveOptions & { mode?: CodeMode } = {}
): Promise<CodeContext> {
  const mode = options.mode || 'generate';
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Mode-specific adjustments
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let maxCodeFiles = 15;
  let maxLessons = 5;
  let minCodeScore = 0.6;
  let minLessonScore = 0.5;
  
  if (mode === 'generate') {
    maxLessons = 8;           // More lessons (patterns)
    minLessonScore = 0.7;     // Higher quality
    maxCodeFiles = 12;        // Fewer code files (types only)
  } else if (mode === 'refactor') {
    maxCodeFiles = 20;        // More code (dependencies)
    minCodeScore = 0.5;       // Lower threshold (context)
    maxLessons = 3;           // Fewer lessons
  } else if (mode === 'explain') {
    maxCodeFiles = 10;        // Minimal code (focus)
    maxLessons = 3;           // Fewer lessons
    minLessonScore = 0.6;
  }
  
  // ... use adjusted values in UnifiedSearchStrategy
}
```

---

## 📊 토큰 최적화 비교

| Mode | Directive | Session Context | Design Doc | Original Files | Current Code | Lessons | Related Files | Total |
|------|-----------|----------------|-----------|---------------|-------------|---------|---------------|-------|
| **Generate** | ~1K | 0 | ~10K (FULL) | 0 | ~5K (선택) | ~5K (8개) | ~8K | ~29K |
| **Refactor** | ~1K | 0 | ~3K (요약) | ~12K (FULL) | ~10K (FULL) | ~3K (3개) | ~3K | ~32K |
| **Refactor (Session)** | ~1K | ~8.5K* | ~2K (요약) | ~8K | ~8K | ~2K | ~2K | ~31.5K |
| **Explain** | ~1K | 0 | 0 | 0 | ~15K (FULL) | ~3K (3개) | ~8K | ~27K |

*Session Context = Previous Directive (0.5K) + Previous Output (8K)

**효과**:
- ✅ 각 모드에 최적화된 컨텍스트
- ✅ 불필요한 토큰 제거
- ✅ LLM 성능 향상 (관련 정보만 제공)
- ✅ Session-aware: 연속 대화에서 컨텍스트 유지

---

## 🚀 구현 계획

1. ✅ `ModeInferenceEngine` 구현
2. ⏳ `resolve` 노드에서 mode 추론
3. ⏳ Mode별 프롬프트 템플릿 생성
4. ⏳ `ModeController`에 mode-aware injection
5. ⏳ `CodebaseRetriever`에 mode 전달
6. ⏳ Session Context 추적 및 전달
7. ⏳ 테스트 및 검증

---

## 🔄 연속 채팅 시 모드 전환 (Session-Aware)

### **핵심 원칙**:
1. **각 턴마다 모드를 재추론**
2. **이전 턴의 컨텍스트를 고려**
3. **명확한 키워드가 있으면 그것을 우선**

### **시나리오별 모드 전환**

#### **Scenario 1: Generate → Refactor (버그 수정)**
```
[Turn 1]
User: "Create a login API"
Agent: Mode = Generate (new feature)
      Output: LoginController.ts

[Turn 2]
User: "The password validation is wrong, fix it"
Agent: Mode Inference:
       ✅ Session Context: previous mode = generate
       ✅ Fix Keywords: "wrong", "fix"
       ✅ Has Code: LoginController.ts exists
       → Mode = Refactor (session-aware fix)
       
      Context Priority:
       1. Current Directive (100%)
       2. Previous Directive (95%) ← "Create a login API"
       3. Previous Output (90%)    ← LoginController.ts
       4. Current Code (85%)
```

#### **Scenario 2: Generate → Generate (새 기능 추가)**
```
[Turn 1]
User: "Create a login API"
Agent: Mode = Generate
      Output: LoginController.ts

[Turn 2]
User: "Add a logout API"
Agent: Mode Inference:
       ✅ Session Context: previous mode = generate
       ✅ Generate Keywords: "Add", "new feature"
       ✅ Different Feature: logout ≠ login
       → Mode = Generate (independent new feature)
       
      Context Priority:
       1. Current Directive (100%)
       2. Design Doc (90%)
       3. Codebase (85%)    ← LoginController.ts 참고 (패턴)
       4. Lessons (80%)
       ❌ Previous Output (not needed, different feature)
```

#### **Scenario 3: Generate → Refactor (기존 기능 확장)**
```
[Turn 1]
User: "Create a login API"
Agent: Mode = Generate
      Output: LoginController.ts

[Turn 2]
User: "Add rate limiting to the login API"
Agent: Mode Inference:
       ✅ Session Context: previous mode = generate
       ✅ Modify Keywords: "Add to", "login API" (same feature)
       ✅ Extending: 기존 기능에 추가
       → Mode = Refactor (extending previous output)
       
      Context Priority:
       1. Current Directive (100%)
       2. Previous Output (95%)  ← LoginController.ts (확장 대상)
       3. Current Code (90%)
       4. Related Files (80%)    ← RateLimiter middleware
```

#### **Scenario 4: Generate → Explain**
```
[Turn 1]
User: "Create a login API"
Agent: Mode = Generate
      Output: LoginController.ts

[Turn 2]
User: "Explain how JWT authentication works here"
Agent: Mode Inference:
       ✅ Session Context: previous mode = generate
       ✅ Explain Keywords: "Explain", "how"
       ✅ No Code Changes: 설명만 원함
       → Mode = Explain
       
      Context Priority:
       1. Current Directive (100%)
       2. Previous Output (95%)  ← LoginController.ts (설명 대상)
       3. Related Files (80%)    ← JWT utils, middleware
       ❌ Design Doc (not needed)
```

#### **Scenario 5: Refactor → Refactor (연속 수정)**
```
[Turn 1]
User: "Refactor the auth service to use dependency injection"
Agent: Mode = Refactor
      Output: AuthService.ts refactored

[Turn 2]
User: "Also extract the token logic into a separate class"
Agent: Mode Inference:
       ✅ Session Context: previous mode = refactor
       ✅ Refactor Keywords: "extract", "separate"
       ✅ Continuing: 같은 파일/영역 작업
       → Mode = Refactor (continuing refactor)
       
      Context Priority:
       1. Current Directive (100%)
       2. Previous Output (95%)  ← 방금 리팩토링한 코드
       3. Previous Directive (90%) ← "use dependency injection"
       4. Current Code (85%)
```

---

## 🆔 Job ID 관리: **Single Job, Multiple Turns**

### **원칙**: 
```
Job = 하나의 Feature 작업 단위
Turn = Job 내의 각 대화 단계
```

### **Job ID 유지 조건**:
1. ✅ **같은 Feature/파일**을 다루는 경우
2. ✅ **연속적인 수정/개선**인 경우
3. ✅ **명시적인 새 작업 시작 없음**

### **새 Job ID 발급 조건**:
1. ❌ **완전히 다른 Feature** (logout API vs login API)
2. ❌ **명시적 시작**: "Start a new task"
3. ❌ **세션 종료 후 재시작**

### **예시**:

```
[Job: job-001] (Feature: Login System)
  ├─ Turn 1: "Create login API" (generate)
  ├─ Turn 2: "Fix password validation" (refactor)
  ├─ Turn 3: "Add rate limiting" (refactor)
  └─ Turn 4: "Explain JWT logic" (explain)
  ✅ 모두 같은 Job ID (login 관련)

[Job: job-002] (Feature: Logout System)
  └─ Turn 1: "Add logout API" (generate)
  ✅ 새로운 Job ID (다른 feature)

[Job: job-001 resumed] (Feature: Login System)
  └─ Turn 5: "Add 2FA to login" (refactor)
  ✅ 같은 Job ID로 복귀 가능
```

---

## 🔍 Mode Inference 상세 로직 (Session-Aware)

### **Rule 0: Session Context Check (HIGHEST PRIORITY)**

```typescript
if (sessionContext?.previousMode) {
  const directive = context.directive.toLowerCase();
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Case 1: 명확한 버그 수정/변경 요청
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const fixKeywords = [
    'fix', 'wrong', 'error', 'bug', 'issue', 'broken',
    'not working', 'incorrect', 'mistake'
  ];
  
  if (fixKeywords.some(k => directive.includes(k))) {
    return {
      mode: 'refactor',
      confidence: 0.95,
      reasoning: 'Fixing previous output'
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Case 2: 기존 기능 확장 (같은 feature)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const extendKeywords = ['add to', 'also', 'extend', 'improve'];
  const refersToSameFeature = directive.includes(
    extractFeatureName(sessionContext.previousDirective)
  );
  
  if (extendKeywords.some(k => directive.includes(k)) || 
      refersToSameFeature) {
    return {
      mode: 'refactor',
      confidence: 0.85,
      reasoning: 'Extending previous feature'
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Case 3: 완전히 새로운 기능 (다른 feature)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const newFeatureKeywords = [
    'create new', 'add new', 'new feature', 
    'now create', 'next add'
  ];
  const refersToNewFeature = !refersToSameFeature;
  
  if (newFeatureKeywords.some(k => directive.includes(k)) ||
      refersToNewFeature) {
    return {
      mode: 'generate',
      confidence: 0.90,
      reasoning: 'New independent feature'
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Case 4: 설명 요청
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const explainKeywords = ['explain', 'how', 'why', 'what'];
  
  if (explainKeywords.some(k => directive.includes(k))) {
    return {
      mode: 'explain',
      confidence: 0.95,
      reasoning: 'Explanation request'
    };
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Default: 애매한 경우 - 이전 모드 유지 경향
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (sessionContext.previousMode === 'refactor') {
    return {
      mode: 'refactor',
      confidence: 0.70,
      reasoning: 'Continuing previous refactor work'
    };
  }
}

// Continue with normal inference rules...
```

---

## 📊 실제 구현: Job & Turn 관리

### **Example 1: Generate → Fix (Session-Aware Refactor)**

```
[Turn 1]
User: "Create a login API endpoint with JWT authentication"
Agent: [Mode Inference] → Generate (confidence: 0.95)
      [Context] Directive + Design Doc + Lessons (auth patterns) + Related Files (types)
      [Output] Generates LoginController.ts

[Turn 2]  
User: "The password validation is wrong, it should check for special characters"
Agent: [Mode Inference] → Refactor (confidence: 0.95)
      [Reasoning] "Session continuation: fixing previous generate output"
      [Context] 
        - Current Directive: "password validation wrong..."
        - Previous Directive: "Create a login API..."  ← ✅ 추가!
        - Previous Output: [LoginController.ts code]  ← ✅ 추가!
        - Original Files: [Git HEAD]
        - Current Code: [LoginController.ts]
      [Prompt Injection]
        "In the previous turn, you generated LoginController.ts.
         The user now wants to fix the password validation..."
      [Output] Modifies LoginController.ts
```

### **Example 2: Refactor → Refactor (Iterative)**

```
[Turn 1]
User: "Refactor the authentication service to use dependency injection"
Agent: [Mode Inference] → Refactor (confidence: 0.9)
      [Context] Directive + Original Files + Current Code + Lessons
      [Output] Refactored AuthService.ts

[Turn 2]
User: "Also extract the token generation logic into a separate class"
Agent: [Mode Inference] → Refactor (confidence: 0.95)
      [Reasoning] "Session continuation: extending previous refactor"
      [Context]
        - Current Directive: "extract token generation..."
        - Previous Directive: "refactor auth service..."  ← ✅
        - Previous Output: [Refactored AuthService.ts]  ← ✅
        - Current Code: [AuthService.ts]
      [Output] Creates TokenGenerator.ts + updates AuthService.ts
```

### **Example 3: Generate (No Session)**

```
[Turn 1]
User: "Add a new user profile page"
Agent: [Mode Inference] → Generate (confidence: 0.95)
      [Reasoning] "No existing code - Generate mode"
      [Context] Directive + Design Doc + Lessons + Related Files
      [No Session Context] (first turn or unrelated to previous)
      [Output] Creates UserProfile.tsx
```

---

## 🔍 Session Context 추적 구현

### **Session Store 구조**

```typescript
// packages/ant-cli/src/agents/architect/session/SessionStore.ts

interface SessionTurn {
  turnId: number;
  directive: string;
  mode: CodeMode;
  output: {
    files: string[];
    summary: string;
  };
  timestamp: string;
}

class SessionStore {
  private turns: SessionTurn[] = [];
  
  addTurn(turn: SessionTurn): void {
    this.turns.push(turn);
  }
  
  getPreviousTurn(): SessionTurn | undefined {
    return this.turns[this.turns.length - 1];
  }
  
  getSessionContext(): SessionContext | undefined {
    const prev = this.getPreviousTurn();
    if (!prev) return undefined;
    
    return {
      previousDirective: prev.directive,
      previousMode: prev.mode,
      previousOutput: prev.output.summary,
      turnsSinceStart: this.turns.length
    };
  }
}
```

### **resolve 노드에서 사용**

```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/resolve.ts

// 1. Get session context
const sessionContext = state.deps?.session 
  ? await state.deps.session.getSessionContext()
  : undefined;

// 2. Infer mode
const modeEngine = new ModeInferenceEngine();
const modeResult = await modeEngine.infer({
  directive: state.directive,
  hasOriginalFiles: !!state.codeHead,
  hasCurrentCode: !!state.code,
  filesChanged: changedFiles.length,
  totalFiles: allFiles.length,
  sessionContext  // ✅ Pass session context
}, state.deps?.llm);

console.log(`🎯 [Mode] ${modeResult.mode} (${modeResult.confidence.toFixed(2)}) - ${modeResult.reasoning}`);

// 3. Pass to retriever
const codeContext = await retriever.retrieve(
  directive,
  workingDir,
  { git, vectorDB },
  { 
    project,
    mode: modeResult.mode,  // ✅ Pass mode
    sessionContext          // ✅ Pass session context
  }
);

// 4. Store in state
return {
  ...state,
  mode: modeResult.mode,
  sessionContext,
  ...codeContext
};
```

