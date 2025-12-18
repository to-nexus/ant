# Code Job Prompt Architecture

> **Last Updated**: 2024-12-18  
> **Purpose**: 전체 Code Job 프롬프트 구조와 각 파일의 역할 정의. Violations enforcement 최적화 포함.

---

## 📐 전체 구조 (Composition)

Code Job의 최종 프롬프트는 다음과 같이 조합됩니다:

```
Final Prompt = system.md 
             + phase-specific (base.md + rules.md)
             + injections (conditional)
             + runtime context (directive, design doc, retrieved code, etc.)
```

### 조합 순서 (Phase별):

#### 1. **detectEnvironment Phase**
```
[system.md] + [detect/base.md] + [detect/rules.md]
```

#### 2. **decompose Phase**
```
[system.md] 
+ [decompose/base.md] 
+ [decompose/mode-guide.md]
+ [decompose/error-or-general.md]
+ [decompose/existing-code-check.md]
+ [decompose/design-doc-guide.md]
+ [decompose/rules.md]
```

#### 3. **plan Phase (per task)**
```
[system.md] 
+ [plan/base.md] 
+ [plan/rules.md]
+ [conditional: violations context if retry]
```

#### 4. **execute Phase (codeGen, per task)**
```
[system.md] 
+ [execute/base.md] 
+ [execute/rules.md]
+ [language-specific: typescript/javascript/python/etc.]
+ [environment-specific: browser/node-api/fullstack/etc.]
+ [conditional injections: retry-context, runtime-error-fix, etc.]
+ [violations enforcement header if retry]
```

---

## 📂 파일 구조 (Tree)

```
packages/ant-cli/src/core/prompt/templates/code/
├── base/
│   ├── system.md                          # [SYSTEM] Identity & Critical Rules
│   ├── examples.md                        # [REFERENCE] Example patterns
│   └── injections/
│       ├── behavioral-debugging.md        # [INJECTION] Behavioral bug diagnosis
│       ├── design-document-guide.md       # [INJECTION] Design doc reading strategy
│       ├── git-diff.md                    # [INJECTION] Git diff context
│       ├── reference-code.md              # [INJECTION] Reference project code
│       ├── retrieved-code.md              # [INJECTION] Retrieved codebase code
│       ├── text-format-compact.md         # [INJECTION] Text format rules
│       └── tool-calling-rules-compact.md  # [INJECTION] Tool usage rules
│
├── languages/
│   └── typescript/
│       ├── environments/
│       │   ├── browser/
│       │   │   └── rules.md               # [ENV] Browser/React/Vue rules
│       │   ├── node-api/
│       │   │   └── rules.md               # [ENV] Node API/Express rules
│       │   ├── node-cli/
│       │   │   └── rules.md               # [ENV] CLI application rules
│       │   ├── fullstack/
│       │   │   └── rules.md               # [ENV] Fullstack project rules
│       │   └── config/
│       │       └── rules.md               # [ENV] Config file rules
│       ├── execute/
│       │   └── missing-dependency-fix.md  # [INJECTION] Dependency fix guide
│       └── setup/
│           ├── config.md                  # [SETUP] Initial config
│           └── constraints.md             # [SETUP] TypeScript constraints
│
└── phases/
    ├── detect/
    │   ├── base.md                        # [PHASE] Environment detection strategy
    │   └── rules.md                       # [PHASE] Detection output format
    │
    ├── decompose/
    │   ├── base.md                        # [PHASE] Task breakdown strategy
    │   ├── mode-guide.md                  # [INJECTION] Mode-specific guidance
    │   ├── error-or-general.md            # [INJECTION] Error vs feature handling
    │   ├── existing-code-check.md         # [INJECTION] Existing code analysis
    │   ├── design-doc-guide.md            # [INJECTION] Design doc reading
    │   └── rules.md                       # [PHASE] Task output format rules
    │
    ├── plan/
    │   ├── base.md                        # [PHASE] Task planning strategy
    │   └── rules.md                       # [PHASE] Plan output format
    │
    ├── execute/
    │   ├── base.md                        # [PHASE] Code generation context
    │   ├── rules.md                       # [PHASE] Code output format rules
    │   └── injections/
    │       ├── lessons.md                 # [INJECTION] Learned lessons from errors
    │       ├── missing-dependency-fix.md  # [INJECTION] Dependency fix context
    │       ├── retry-context.md           # [INJECTION] Retry attempt context
    │       ├── runtime-error-fix.md       # [INJECTION] Runtime error diagnosis
    │       └── session-context.md         # [INJECTION] Session-level context
    │
    └── replan/
        └── decision.md                    # [PHASE] Replan decision strategy
```

---

## 🎭 파일별 역할 정의

### **1. base/system.md**

**Type**: `SYSTEM` (Identity)  
**Role**: Code Agent의 정체성과 전체 Job에 걸친 핵심 규칙 정의  
**Scope**: 모든 Phase에 공통 적용  

**포함 내용:**
- ✅ **RULE 1: Task Priority Hierarchy**: DIRECTIVE > DESIGN DOC > ORIGINAL FILES > PRD
- ✅ **RULE 2: Preserve Existing Code**: 필요한 것만 수정, 기존 패턴 유지
- ✅ **RULE 3: Code Completeness**: Placeholder 금지, 완전한 코드만
- ✅ **RULE 4: Self-Verification**: 출력 전 mental check (syntax, imports, completeness)
- ✅ **Directive Interpretation**: 질문 + 수정 요청 동시 처리
- ✅ **Syntax Validation Checklist**: Bracket counting, string closure, etc.

**특징:**
- 매우 간결 (72 lines)
- Critical rules만 포함 (4개)
- Mental checks 강조 (자동 validation 실행 금지)
- Directive 우선순위 명확

**수정 이력:**
- Initial: 핵심 규칙 4개로 단순화
- 2024-12-18: Violations enforcement 최적화와 무관 (system은 안정적)

---

### **2. phases/detect/base.md**

**Type**: `PHASE` (Strategy)  
**Role**: Development directive 분석 → mode/environment/RAG strategy 결정  
**Scope**: detectEnvironment node에서만 사용  

**포함 내용:**
- Mode detection (generate/refactor/explain)
- Environment detection (frontend/backend/fullstack/unknown)
- RAG requirement (decompose가 codebase context 필요한지)
- Search keywords generation
- Profile detection (language/framework)

**Output Format:**
```xml
<detect>
{
  "mode": "generate|refactor|explain",
  "environment": "frontend|backend|fullstack",
  "requireRagForDecompose": true|false,
  "decomposeKeywords": {...},
  "profile": { "language": "typescript", "framework": "react" }
}
</detect>
```

**특징:**
- Workflow 전체를 결정하는 Phase
- TypeScript를 기본값으로 설정
- XML tag 사용 (markdown 아님)

---

### **3. phases/decompose/base.md**

**Type**: `PHASE` (Strategy)  
**Role**: Specification을 executable tasks로 분해  
**Scope**: decompose node에서만 사용  

**포함 내용:**
- ✅ **Task Granularity**: 너무 크지도 작지도 않게
- ✅ **Priority Assignment**: 100 (setup) → 200-899 (features) → 1000 (final)
- ✅ **Task Dependencies**: 논리적 순서
- ✅ **⚠️ CRITICAL: Read Spec Carefully**: Architecture는 spec에 있음, 발명하지 말 것

**Injections (conditional):**
- `mode-guide.md`: Mode별 decompose 전략 (generate vs refactor)
- `error-or-general.md`: Error fixing vs feature development 구분
- `existing-code-check.md`: 기존 코드 확인 전략
- `design-doc-guide.md`: Design document 읽기 전략

**특징:**
- Specification을 "그대로" 읽기 강조
- Architecture 발명 금지
- Task priority 명확한 규칙

---

### **4. phases/decompose/rules.md**

**Type**: `PHASE` (Format Rules)  
**Role**: Task 출력 형식 정의 (JSON structure)  
**Scope**: decompose node output format  

**포함 내용:**
- Task JSON schema
- Priority guidelines
- Validation checklist
- Examples

**Output Format:**
```json
{
  "tasks": [
    {
      "name": "Task name",
      "description": "Task description",
      "priority": 200,
      "type": "feature|fix|test"
    }
  ]
}
```

---

### **5. phases/plan/base.md**

**Type**: `PHASE` (Strategy)  
**Role**: Task 구현 계획 수립 (HOW to implement)  
**Scope**: plan node (각 task마다 실행)  

**포함 내용:**
- ✅ **Task vs Directive**: Task description은 hypothesis, directive는 ground truth
- ✅ **Retry Context** (if retry): Previous violations analysis
- ✅ **Error Context Analysis**: Stack trace, error message 분석 전략
- ✅ **Behavioral Bug Diagnosis**: Runtime observation 전략
- ✅ **Root Cause Analysis**: 증상 → 원인 → 해결책

**특징:**
- 계획 수립에 집중 (실행 아님)
- Violations 발생 시: root cause 분석 + 다른 approach 제시
- Behavioral bug는 empirical diagnosis 필요

**핵심 섹션 (Line 106-112):**
```markdown
**Your plan MUST address these failures:**
- ✅ Analyze root cause of each violation
- ✅ Understand WHY the previous approach failed
- ✅ Propose fundamentally different approach
- ❌ DO NOT blindly retry the exact same operations
```

**수정 이력:**
- 2024-12-18: Violations enforcement 최적화 (과도한 강압 제거는 execute에 해당)

---

### **6. phases/plan/rules.md**

**Type**: `PHASE` (Format Rules)  
**Role**: Plan 출력 형식 정의  
**Scope**: plan node output format  

**포함 내용:**
- Plan JSON schema
- Reasoning structure
- Key decisions tracking

---

### **7. phases/execute/base.md**

**Type**: `PHASE` (Context + Strategy)  
**Role**: 실제 코드 생성을 위한 context 제공 + 구현 전략  
**Scope**: codeGen node (execute phase, 각 task마다 실행)  

**포함 내용:**
- ✅ **🚨 CRITICAL: Specification Compliance**: API contract는 immutable
- ✅ **Core Principles**:
  - Layer-Aware Fix Principle (Contract vs Implementation)
  - Config Over Code (tsconfig/package.json 먼저 확인)
  - No Over-Engineering (필요한 것만)
- ✅ **Task Type Handling**: explain/feature/fix별 전략
- ✅ **Design Specification**: Design doc reading strategy
- ✅ **Validation Process**: Automatic validation (tsc, build, lint)
- ✅ **Error Categories**: Structural vs Behavioral
- ✅ **Self-Validation Checklist**: 출력 전 점검

**특징:**
- 가장 복잡한 프롬프트 (모든 context 포함)
- Layer-aware thinking 강조 (Contract layer 수정 금지)
- Configuration 우선 (source code 수정은 최후)

**핵심 원칙 (Line 19-71):**
```markdown
### 1. LAYER-AWARE FIX PRINCIPLE
Contract Layer (stable) → API endpoints, routes, function signatures
Implementation Layer (flexible) → Types, logic, config

Decision Framework:
- If CONTRACT layer: Check spec first, fix implementation to match
- If IMPLEMENTATION layer: Safe to modify

### 2. CONFIG OVER CODE
Build errors? → Check tsconfig.json first
Module errors? → Check moduleResolution, paths
Runtime errors? → Check env variables, config files

### 3. NO OVER-ENGINEERING
Do exactly what's needed, nothing more
```

**수정 이력:**
- Initial: Layer-aware principle, config over code
- 2024-12-18: Violations enforcement 최적화 (promptBuilder.ts에서 처리)

---

### **8. phases/execute/rules.md**

**Type**: `PHASE` (Format Rules)  
**Role**: Code 출력 형식 정의 + Quality rules  
**Scope**: codeGen node output format  

**포함 내용:**
- ✅ **Two Ways to Interact**:
  - XML Streaming (`<file>`, `<append>`) - 새 파일 생성
  - Tool Calling (`edit_file`, `read_file`, etc.) - 기존 파일 수정
- ✅ **Critical: `edit_file` Tool Rules**:
  - Always read file first
  - Exact match required (whitespace, indentation)
  - Include 3-5 lines context
- ✅ **XML Tag Safety**: Nesting 금지, closing tag in strings 금지
- ✅ **Do NOT Regenerate Existing Files**: `edit_file` 사용
- ✅ **Code Quality Rules**: DRY principle, use existing constants
- ✅ **Common Mistakes**: Checklist

**특징:**
- Tool usage와 XML streaming 명확히 구분
- `edit_file`의 정확한 사용법 상세 설명
- Constants 재사용 강조 (hardcoding 금지)

**핵심 섹션 (Line 89-128):**
```markdown
## ⚠️ CRITICAL: `edit_file` TOOL RULES

1. Always read the file first
2. The `old_str` must match EXACTLY
3. Include enough context (3-5 lines)
4. If search block not found: read_file again
```

---

### **9. phases/execute/injections/**

**Type**: `INJECTION` (Conditional Context)  
**Role**: 특정 상황에서만 주입되는 추가 context  

#### **a. retry-context.md**
- **Condition**: Retry attempt (state.retryContext exists)
- **Content**: 
  - Original directive
  - Original plan (attempt 1)
  - Key decisions
  - Current error
  - Previous attempts
  - Fix principles (preserve approach, fix error only)

#### **b. runtime-error-fix.md**
- **Condition**: Runtime error occurred
- **Content**: Runtime error diagnosis strategy

#### **c. missing-dependency-fix.md**
- **Condition**: Missing dependency error
- **Content**: package.json 수정 전략

#### **d. lessons.md**
- **Condition**: Lessons learned from previous errors
- **Content**: Session-level learned patterns

#### **e. session-context.md**
- **Condition**: Session-level context exists
- **Content**: Conversation-level context

**특징:**
- Conditional injection (상황별 추가)
- Context overload 방지
- Focused guidance

---

### **10. languages/typescript/environments/**

**Type**: `INJECTION` (Environment-Specific Rules)  
**Role**: TypeScript 환경별 특화 규칙  

#### **a. browser/rules.md**
- **Condition**: environment === 'frontend' (React/Vue/etc.)
- **Content**: Browser-specific rules, React patterns, component structure

#### **b. node-api/rules.md**
- **Condition**: environment === 'backend' (Express/Fastify)
- **Content**: API design patterns, middleware, error handling

#### **c. node-cli/rules.md**
- **Condition**: CLI application
- **Content**: CLI patterns, argument parsing, output formatting

#### **d. fullstack/rules.md**
- **Condition**: environment === 'fullstack'
- **Content**: Full-stack coordination, shared types

#### **e. config/rules.md**
- **Condition**: Config file modification
- **Content**: tsconfig.json, package.json rules

**특징:**
- Environment-specific best practices
- Language + framework 조합
- Opinionated but flexible

---

### **11. base/injections/**

**Type**: `INJECTION` (Common Injections)  
**Role**: Phase 무관하게 필요시 주입되는 공통 context  

#### **a. design-document-guide.md**
- Design document reading strategy
- Contract vs implementation 구분

#### **b. retrieved-code.md**
- RAG로 가져온 codebase code
- Reference for implementation

#### **c. reference-code.md**
- Reference project code
- Pattern examples

#### **d. behavioral-debugging.md**
- Behavioral bug diagnosis
- Empirical observation strategy

#### **e. git-diff.md**
- Git diff context
- Change analysis

---

## 🔄 파일 간 관계 (Flow)

### **Phase 1: detect**
```
system.md → detect/base.md + detect/rules.md → [LLM] → {mode, environment, profile}
```

### **Phase 2: decompose**
```
system.md
  ↓
decompose/base.md
  ↓
+ [CONDITIONAL INJECTIONS]
  ├─ mode-guide.md (generate vs refactor)
  ├─ error-or-general.md (error vs feature)
  ├─ existing-code-check.md (if refactor)
  └─ design-doc-guide.md (if design doc exists)
  ↓
decompose/rules.md
  ↓
[LLM] → {tasks[]}
```

### **Phase 3: plan (per task)**
```
system.md
  ↓
plan/base.md
  ↓
+ [CONDITIONAL: violations context if retry]
  ↓
plan/rules.md
  ↓
[LLM] → {plan, reasoning, key_decisions}
```

### **Phase 4: execute (per task)**
```
system.md
  ↓
execute/base.md (core principles, layer-aware, config over code)
  ↓
execute/rules.md (tool usage, xml tags, quality rules)
  ↓
+ [LANGUAGE + ENVIRONMENT]
  ├─ languages/typescript/environments/browser/rules.md (if frontend)
  ├─ languages/typescript/environments/node-api/rules.md (if backend)
  └─ ... (other combinations)
  ↓
+ [CONDITIONAL INJECTIONS]
  ├─ retry-context.md (if retry)
  ├─ runtime-error-fix.md (if runtime error)
  ├─ missing-dependency-fix.md (if missing dependency)
  └─ lessons.md (if lessons exist)
  ↓
+ [VIOLATIONS ENFORCEMENT HEADER - if violations exist]
  ↓
[LLM] → <file> or edit_file() with code
```

**🚨 CRITICAL: Violations Enforcement (promptBuilder.ts)**
```typescript
if (state.violations && state.violations.length > 0) {
  const enforcementHeader = `
──────────────────────────────────────────────────────────────
⚠️  PREVIOUS ATTEMPT FAILED - FIX REQUIRED
──────────────────────────────────────────────────────────────

${violationsText}

Focus on fixing the root cause, not workarounds.

──────────────────────────────────────────────────────────────
`;
  
  finalPrompt = enforcementHeader + finalPrompt;
}
```

---

## 🎯 핵심 설계 원칙

### **1. Separation of Concerns**

| 파일 타입 | 책임 | 변경 빈도 |
|----------|------|----------|
| **system.md** | Identity, critical rules | 매우 낮음 (안정적) |
| **phase/base.md** | Strategy (WHAT to do) | 중간 |
| **phase/rules.md** | Format (HOW to output) | 낮음 |
| **injections/** | Conditional context | 중간 |
| **languages/** | Language/env specifics | 낮음 |

### **2. Layer-Aware Thinking**

**Contract Layer (Stable):**
- API endpoints, routes
- Function signatures (public)
- Data schemas, event names
- **수정 전 spec 확인 필수**

**Implementation Layer (Flexible):**
- Type definitions
- Internal logic, algorithms
- Error handling, validation
- Configuration files
- **자유롭게 수정 가능**

**Decision Framework:**
```
Error occurs:
1. Identify layer: Contract or Implementation?
2. If Contract → Check spec, fix implementation to match
3. If Implementation → Safe to modify
```

### **3. Config Over Code**

**우선순위:**
```
Build/Module errors:
1. Check tsconfig.json (paths, moduleResolution)
2. Check package.json (dependencies, scripts)
3. Check env variables (.env)
4. LAST: Modify source code
```

**Why?**
- Configuration changes are safer
- Less code churn
- Easier to rollback

### **4. Trust the LLM (Violations Enforcement)**

**Before (❌ - 2024-12-18 이전):**
```markdown
════════════════════════════════════════════════════════
🚨 CRITICAL: PREVIOUS ATTEMPT FAILED - MANDATORY FIX!
════════════════════════════════════════════════════════

**VIOLATIONS ARE NOT SUGGESTIONS - ABSOLUTE REQUIREMENTS:**

${violations}

🚨 YOU MUST:
1. READ EACH VIOLATION ABOVE CAREFULLY
2. UNDERSTAND THE ROOT CAUSE
3. FOLLOW THE EXACT FIX INSTRUCTIONS
4. DO NOT PROCEED UNTIL ALL FIXED

⚠️ Ignoring violations = Task fails permanently!

════════════════════════════════════════════════════════
🔴 MANDATORY RESPONSE FORMAT:
════════════════════════════════════════════════════════

YOU MUST START YOUR RESPONSE WITH:

"⚠️ VIOLATION ACKNOWLEDGED: I have read the X violations..."

If you do NOT start with "VIOLATION ACKNOWLEDGED",
your response will be REJECTED!
════════════════════════════════════════════════════════
```

**After (✅ - 2024-12-18 최적화):**
```markdown
──────────────────────────────────────────────────────────────
⚠️  PREVIOUS ATTEMPT FAILED - FIX REQUIRED
──────────────────────────────────────────────────────────────

${violations}

Focus on fixing the root cause, not workarounds.

──────────────────────────────────────────────────────────────
```

**개선:**
- 500+ tokens → 50 tokens (90% 절감)
- Format enforcement 제거
- 과도한 강압 제거
- LLM 자율성 존중

### **5. Priority-Based Violation Handling**

**Before (❌):**
```typescript
// Show all same-type errors, max 5
const focusedViolations = sameTypeErrors.slice(0, 5);
```

**After (✅):**
```typescript
// Show max 2 same-type errors for clear focus
const focusedViolations = sameTypeErrors.slice(0, 2);
```

**Why?**
- Better to fix 1-2 completely than 5 partially
- Sequential fixing (cascading fixes)
- Clear progress

---

## ⚠️ 리팩토링 시 주의사항

### **DO NOT:**

1. ❌ **system.md에 Phase-specific rules 추가하지 마라**
   - 이유: SoC 깨짐, system은 identity만
   - 대신: phase/base.md에 추가

2. ❌ **Violations enforcement를 더 강압적으로 만들지 마라**
   - 이유: Token 낭비, LLM focus 저하
   - 대신: 간결하고 명확하게

3. ❌ **Format enforcement 추가하지 마라**
   - 이유: "VIOLATION ACKNOWLEDGED" 같은 cargo cult
   - 대신: 명확한 진단만 제공

4. ❌ **Multiple violations 동시 처리하지 마라**
   - 이유: LLM이 일부만 고치고 놓침
   - 대신: Top 1-2개 focus

### **DO:**

1. ✅ **Layer-aware thinking 강화**
   - Contract vs Implementation 구분 명확히
   - Spec compliance 강조

2. ✅ **Config over code 강화**
   - Configuration 먼저 확인
   - Source code 수정은 최후

3. ✅ **Violations를 diagnosis로 취급**
   - WHAT is wrong (시스템 제공)
   - HOW to fix (LLM이 찾기)

4. ✅ **Prompt 단순화**
   - Less is more
   - 명확하고 간결하게

---

## 📊 Violations Enforcement 최적화 히스토리

### **Problem: Repeated "VIOLATION ACKNOWLEDGED" Messages**

**증상 (2024-12-18 사용자 피드백):**
```
Retry 1: ⚠️ VIOLATION ACKNOWLEDGED: I have read 5 violations...
Retry 2: ⚠️ VIOLATION ACKNOWLEDGED: I have read 2 violations...
Retry 3: ⚠️ VIOLATION ACKNOWLEDGED: I have read 1 violation...

사용자: "왜 계속 VIOLATION ACKNOWLEDGED 반복하냐?"
```

### **근본 원인 분석:**

**1. 과도한 Enforcement (500+ tokens)**
- `promptBuilder.ts` Line 90-118
- Format enforcement에만 500+ tokens 사용
- LLM이 format에 집중, 실제 문제 해결 소홀

**2. Multiple Violations 동시 처리**
```
violations: [A, B, C, D, E]
→ LLM: A, B 고침, C, D, E 놓침
→ Retry: "VIOLATION ACKNOWLEDGED..."
→ LLM: C 고침, D, E 놓침
→ Retry: "VIOLATION ACKNOWLEDGED..."
```

**3. Plan vs Execute 역할 혼란**
- Plan에서 이미 분석했는데
- Execute에서 또 분석 요구
- 중복된 지시

### **Solution: Three-Part Refactoring (2024-12-18)**

#### **Part 1: promptBuilder.ts 단순화**

**File**: `packages/ant-cli/src/agents/architect/graph/code/nodes/codeGen/promptBuilder.ts`

**Before (500+ tokens):**
```typescript
const enforcementHeader = `
════════════════════════════════════════════════════════
🚨 CRITICAL: PREVIOUS ATTEMPT FAILED - MANDATORY FIX!
════════════════════════════════════════════════════════

**VIOLATIONS ARE NOT SUGGESTIONS - ABSOLUTE REQUIREMENTS:**

${violationsText}

🚨 YOU MUST:
1. READ EACH VIOLATION ABOVE CAREFULLY
2. UNDERSTAND THE ROOT CAUSE
3. FOLLOW THE EXACT FIX INSTRUCTIONS
4. DO NOT PROCEED UNTIL ALL VIOLATIONS FIXED

⚠️ Ignoring violations = Task fails permanently!

════════════════════════════════════════════════════════
🔴 MANDATORY RESPONSE FORMAT:
════════════════════════════════════════════════════════

YOU MUST START YOUR RESPONSE WITH THE FOLLOWING:

"⚠️ VIOLATION ACKNOWLEDGED: I have read the ${state.violations.length} violation(s) above.
I will now fix: [briefly describe what you will fix]
Fix approach: [briefly describe your approach]"

If you do NOT start your response with "⚠️ VIOLATION ACKNOWLEDGED", 
it means you did not see the violations and your response will be rejected!
════════════════════════════════════════════════════════
`;
```

**After (50 tokens):**
```typescript
const enforcementHeader = `──────────────────────────────────────────────────────────────
⚠️  PREVIOUS ATTEMPT FAILED - FIX REQUIRED
──────────────────────────────────────────────────────────────

${violationsText}

Focus on fixing the root cause, not workarounds.

──────────────────────────────────────────────────────────────

`;
```

**개선:**
- ✅ 500+ tokens → 50 tokens (90% 절감)
- ✅ "VIOLATION ACKNOWLEDGED" 강제 제거
- ✅ 과도한 경고 제거
- ✅ LLM 자율성 존중

#### **Part 2: enforce.ts - Top Priority Focus**

**File**: `packages/ant-cli/src/agents/architect/graph/code/nodes/enforce.ts`

**Before:**
```typescript
// Show all same-type errors, max 5
const focusedViolations = sameTypeErrors.slice(0, 5).map(err => err.violation);
```

**After:**
```typescript
// Show max 2 same-type errors for clear focus
// LLM works better with focused scope than trying to fix many at once
const focusedViolations = sameTypeErrors.slice(0, 2).map(err => err.violation);
```

**개선:**
- ✅ 최대 5개 → 2개 (focus 향상)
- ✅ 순차적 해결 (완전한 해결)
- ✅ 일부만 고치는 것 방지

#### **Part 3: enforce.ts - Repeated Error Message 단순화**

**Before (200+ tokens):**
```typescript
formattedViolations = `
⚠️⚠️⚠️ CRITICAL: REPEATED ERRORS DETECTED ⚠️⚠️⚠️

You have seen these EXACT SAME ERRORS before and your previous fix DID NOT WORK.
This means your previous approach was WRONG.

🔴 YOU MUST:
1. **STOP and READ** the error messages MORE CAREFULLY
2. **THINK DIFFERENTLY** - your previous approach failed
3. **CHECK YOUR ASSUMPTIONS** - you may have misunderstood
4. **BE MORE PRECISE** - follow the error message LITERALLY

... (20+ more lines)

${formattedViolations}
`;
```

**After (30 tokens):**
```typescript
formattedViolations = `
⚠️  REPEATED ERROR - Previous fix didn't work.

${formattedViolations}

Try a different approach. Read error message literally.
`;
```

**개선:**
- ✅ 200+ tokens → 30 tokens (85% 절감)
- ✅ 과도한 강압 제거
- ✅ 핵심 메시지만 전달

### **Expected Improvement:**

| 항목 | Before | After | 개선 |
|-----|--------|-------|------|
| **Token per Retry** | 700+ | 80 | **88% 절감** |
| **Violations Focus** | 5개 동시 | 2개 순차 | **완전 해결** |
| **Retry 횟수** | 평균 3-4회 | 평균 2-3회 (예상) | **25-33% 감소** |
| **사용자 경험** | 혼란 ("왜 반복?") | 명확 (progress 가시적) | **이해도 향상** |

### **Philosophy Change:**

**Before:**
```
"🚨 CRITICAL! MANDATORY! YOU MUST START WITH 'VIOLATION ACKNOWLEDGED'..."
→ Format enforcement, 과도한 강압
```

**After:**
```
"⚠️ PREVIOUS ATTEMPT FAILED - FIX REQUIRED
[violations]
Focus on fixing the root cause."

→ 간결한 진단, LLM 신뢰
```

**핵심:**
```markdown
Violations = Diagnosis (WHAT is wrong)
LLM = Solution (HOW to fix)

Trust the LLM.
Less is more.
Focus beats quantity.
```

---

## 🔮 Future Considerations

### **Potential Issues:**

1. **Layer Confusion**
   - LLM이 여전히 Contract layer를 쉽게 수정할 수 있음
   - 해결: execute/base.md의 Layer-aware principle 강화

2. **Config Over Code 미준수**
   - LLM이 tsconfig.json 대신 source code 수정
   - 해결: Error message에 config hint 추가

3. **Tool Usage Mistakes**
   - `<file>` vs `edit_file` 혼동
   - 해결: execute/rules.md 예시 추가

### **Monitoring:**

- 매 Code Job 실행 후 violations tracking
- Retry 횟수 측정
- Token 사용량 측정
- 사용자 피드백 수집

---

## 📝 Changelog

### 2024-12-18
- **Initial version**: 전체 프롬프트 구조 문서화
- **Major refactoring**: Violations enforcement 최적화
  - promptBuilder.ts: Enforcement header 단순화 (500→50 tokens)
  - enforce.ts: Top priority focus (5→2 violations)
  - enforce.ts: Repeated error message 단순화 (200→30 tokens)
- **Philosophy change**: 강압 → 신뢰, Format enforcement 제거

---

## 🔗 Related Documents

- `docs/code-job-violation-enforcement-analysis.md` - Violations 최적화 상세 분석
- `CODE_JOB_VIOLATIONS_REFACTORING.md` - Refactoring changelog
- `docs/design-job-prompt-architecture.md` - Design Job 프롬프트 구조
- `packages/ant-cli/src/agents/architect/graph/code/` - Code graph 구현

---

**END OF DOCUMENT**
