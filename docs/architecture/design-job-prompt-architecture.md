# Design Job Prompt Architecture

> **Last Updated**: 2024-12-18  
> **Purpose**: 전체 Design Job 프롬프트 구조와 각 파일의 역할 정의. 향후 리팩토링 시 참조 문서.

---

## 📐 전체 구조 (Composition)

Design Job의 최종 프롬프트는 다음과 같이 조합됩니다:

```
Final Prompt = system.md 
             + phase-specific (base.md + rules.md)
             + injections (conditional)
             + runtime context (PRD, tasks, etc.)
```

### 조합 순서 (Phase별):

#### 1. **detectEnvironment Phase**
```
[system.md] + [detect/base.md]
```

#### 2. **decompose Phase**
```
[system.md] + [decompose/base.md] + [decompose/rules.md]
```

#### 3. **execute Phase (docGen)**
```
[system.md] 
+ [execute/base.md] 
+ [execute/rules.md] 
+ [document-type injection (fe/be/api/service/game)]
+ runtime context (PRD, task, previous sections)
```

---

## 📂 파일 구조 (Tree)

```
packages/ant-cli/src/core/prompt/templates/design/
├── base/
│   ├── system.md                          # [SYSTEM] Identity & Core Principles
│   └── injections/
│       ├── api-contract-guide.md          # [INJECTION] API Contract 특화 가이드
│       ├── backend-guide.md               # [INJECTION] Backend 특화 가이드
│       └── frontend-guide.md              # [INJECTION] Frontend 특화 가이드
│
└── phases/
    ├── detect/
    │   └── base.md                        # [PHASE] Environment detection strategy
    │
    ├── decompose/
    │   ├── base.md                        # [PHASE] Task breakdown strategy
    │   └── rules.md                       # [PHASE] Task output format rules
    │
    └── execute/
        ├── base.md                        # [PHASE] Document generation context
        ├── rules.md                       # [PHASE] Document output format rules
        └── injections/
            ├── game-domain-guide.md       # [INJECTION] Game domain 특화 가이드
            └── service-domain-guide.md    # [INJECTION] Service domain 특화 가이드
```

---

## 🎭 파일별 역할 정의

### **1. base/system.md**

**Type**: `SYSTEM` (Identity)  
**Role**: Design Agent의 정체성과 전체 Job에 걸친 핵심 원칙 정의  
**Scope**: 모든 Phase에 공통 적용  

**포함 내용:**
- ✅ **역할 정의**: "Architectural Design Document 작성자"
- ✅ **핵심 원칙**: "WHAT vs HOW", "10-way implementation test"
- ✅ **Three-Tier Abstraction Model**: Tier 1/2/3 정의
- ✅ **Golden Test**: 문장마다 적용할 자가 검증 기준
- ✅ **Heuristic Rules**: 언제 abstract/omit 해야 하는가
- ✅ **금지 사항**: 절대 추가하면 안 되는 내용 (ops, monitoring 등)
- ✅ **보편적 작성 규칙**: 간결성, bullet list, no tutorials

**특징:**
- 구체적 예시 최소화 (원칙 중심)
- Phase/document-type 무관하게 항상 적용
- PRD Reading Strategy 포함 (Intent extraction)

**수정 이력:**
- 2024-12-18: Tier 2를 구체적 예시에서 Heuristic 기반으로 변경
- 2024-12-18: "Golden Test" 추가 (WHAT vs HOW, proper noun check)

---

### **2. phases/detect/base.md**

**Type**: `PHASE` (Strategy)  
**Role**: Project environment 감지 전략 (domain, environment 판단)  
**Scope**: detectEnvironment node에서만 사용  

**포함 내용:**
- Domain detection (game vs service)
- Environment detection (frontend vs backend vs fullstack)
- 판단 근거 (keywords, architecture patterns)

**특징:**
- 상대적으로 단순 (분류 규칙만 존재)
- Output: domain, environment, reasoning

---

### **3. phases/decompose/base.md**

**Type**: `PHASE` (Strategy)  
**Role**: PRD를 Task로 분해하는 전략 정의  
**Scope**: decompose node에서만 사용  

**포함 내용:**
- ✅ **Complexity Analysis**: Simple/Medium/Complex 판단 기준
- ✅ **Line Budget 산정**: Complexity에 따른 총 라인 수 결정
- ✅ **Task Breakdown Strategy**: 몇 개의 task로 나눌지, 각 task의 주제
- ✅ **⚠️ CRITICAL: Task Description Abstraction**: Task 설명에 구체적 기술 금지
- ✅ **Document Type 결정**: Unified vs Contract-First (fe/be/api 분리)

**특징:**
- Task description이 abstract해야 execute phase에서 leakage 방지
- "LocalStorage", "React Router" 같은 용어 금지 명시 (Line 105-136)
- 전략적 사고 (WHAT to cover, not HOW to implement)

**핵심 규칙 (Line 105-136):**
```markdown
❌ FORBIDDEN: "LocalStorage", "React Router", "Zustand"
✅ REQUIRED: "client-side persistence", "routing structure", "state management"

Why? Task descriptions → Execute prompts → LLM copies them
```

---

### **4. phases/decompose/rules.md**

**Type**: `PHASE` (Format Rules)  
**Role**: Task 출력 형식 정의 (JSON structure)  
**Scope**: decompose node output format  

**포함 내용:**
- Task JSON schema (name, description, targetFile, maxLines)
- Validation checklist
- Examples (good vs bad)
- ✅ **Description uses ABSTRACT terms** 체크리스트

**특징:**
- Output format 강제
- Abstraction 예시 포함 (storage/routing/state)

---

### **5. phases/execute/base.md**

**Type**: `PHASE` (Context + Strategy)  
**Role**: 현재 Task의 context 제공 + 문서 생성 전략  
**Scope**: docGen node (execute phase)  

**포함 내용:**
- ✅ **Current Task Context**: Task name, description, line budget
- ✅ **🚨 CRITICAL: Task Description vs Prompt Rules 우선순위**
  - Task description = TOPICS (WHAT)
  - Prompt rules = ABSTRACTION (HOW)
  - Conflict 시 → Prompt rules win!
- ✅ **PRD Context**: 전체 PRD 텍스트 + Intent Extraction 가이드
- ✅ **Document Type Detection**: fe/be/api/unified 구분
- ✅ **Chapter/Line Budget**: Task별 할당량
- ✅ **First Principles + Heuristic Rules**: 추상화 자가 검증 기준
- ✅ **External Services Documentation**: PRD의 모든 서비스 명시적 나열
- ✅ **Negative Constraints**: PRD 제외 항목 처리

**특징:**
- Task description을 guidance로만 취급 (절대 규칙 아님)
- PRD "Intent extraction" 강조 (verbatim copy 금지)
- 가장 복잡한 프롬프트 (모든 context 포함)

**핵심 섹션 (Line 87-109):**
```markdown
🚨 CRITICAL: Task Description is GUIDANCE, not absolute instruction

Task description = TOPICS to cover (WHAT)
Prompt rules = HOW to write (abstraction, terminology)

When conflict:
- Task: "Design LocalStorage integration"
- Prompt rule: "Abstract implementation technologies"
- YOU MUST follow prompt rule! Write: "Design persistence strategy"
```

**수정 이력:**
- 2024-12-18: 금지 목록 제거, First Principles + Heuristics로 교체
- 2024-12-18: PRD Reading Strategy 강화 (Intent extraction examples)
- 2024-12-18: "WHAT vs HOW" Golden Test 추가

---

### **6. phases/execute/rules.md**

**Type**: `PHASE` (Format Rules)  
**Role**: System Design 문서 출력 형식 정의  
**Scope**: docGen node output format  

**포함 내용:**
- ✅ **XML Tag Usage**: `<file>` vs `<append>` 선택 규칙
- ✅ **Path Requirements**: outputs/design/ 경로 강제
- ✅ **Markdown Formatting**: Header levels, bullet points, code blocks
- ✅ **LAST_SECTION Metadata**: 섹션 번호 tracking
- ✅ **Writing Quality Rules**: Architecture vs Implementation 구분
- ✅ **Implementation Detail Filter**: LLM-chosen vs PRD-specified 구분
- ✅ **Self-Validation Checklist**: 출력 전 자가 검증 (abstraction, PRD alignment)

**특징:**
- 출력 형식 + 품질 기준 동시 정의
- "Who decided this?" test 강조 (Line 264-311)
- Responsibility & Boundary Guardrails (Layer consistency)

**핵심 섹션 (Line 264-311):**
```markdown
CRITICAL: "Did PRD specify this, or did I choose it?"

PRD specified → Document (architectural constraint)
YOU chose → Omit (implementation detail)
```

**수정 이력:**
- 2024-12-18: Abstraction Level Check를 Self-reasoning 방식으로 변경
- 2024-12-18: 금지 목록 제거, 원칙 기반 체크리스트로 교체

---

### **7. base/injections/frontend-guide.md**

**Type**: `INJECTION` (Domain-Specific Guide)  
**Role**: Frontend System Design 특화 가이드  
**Condition**: `targetFile === 'fe-system-design.md'`  

**포함 내용:**
- Frontend document의 required sections
- Component architecture 작성법
- State management 작성법
- API integration (consumer perspective)
- MECE rules (API definition 금지)

**특징:**
- Consumer perspective 강조 (API 정의 금지)
- Contract reference 강제 (DTO duplication 금지)
- 깨끗함 (leakage 없음)

---

### **8. base/injections/backend-guide.md**

**Type**: `INJECTION` (Domain-Specific Guide)  
**Role**: Backend System Design 특화 가이드  
**Condition**: `targetFile === 'be-system-design.md'`  

**포함 내용:**
- Backend document의 required sections
- Service layer architecture
- Database schema (conceptual level)
- Provider perspective

---

### **9. base/injections/api-contract-guide.md**

**Type**: `INJECTION` (Domain-Specific Guide)  
**Role**: API Contract 특화 가이드  
**Condition**: `targetFile === 'api-contract.md'`  

**포함 내용:**
- Binding specification 작성법
- Endpoint definitions (exact paths, methods)
- DTO definitions (exact fields, types)

**특징:**
- 예외적으로 implementation detail 허용 (contract 자체가 detail)

---

### **10. execute/injections/service-domain-guide.md**

**Type**: `INJECTION` (Domain-Specific Guide)  
**Role**: Service Domain (Dashboard, CRUD, API aggregator) 특화  
**Condition**: `domain === 'service'`  

**포함 내용:**
- Data aggregation patterns
- Multi-source integration
- Classification/normalization rules
- Dashboard-specific concerns

**특징:**
- Game과 대비되는 Service 특성 강조
- 깨끗함 (leakage 없음)

---

### **11. execute/injections/game-domain-guide.md**

**Type**: `INJECTION` (Domain-Specific Guide)  
**Role**: Game Domain 특화  
**Condition**: `domain === 'game'`  

**포함 내용:**
- Game loop architecture
- ECS/Component patterns
- State management (game state)
- Physics/collision (conceptual level)

---

## 🔄 파일 간 관계 (Flow)

### **Phase 1: detect**
```
system.md → detect/base.md → [LLM] → {domain, environment}
```

### **Phase 2: decompose**
```
system.md → decompose/base.md + decompose/rules.md → [LLM] → {tasks[]}
```
- **중요**: Task descriptions must be ABSTRACT
- "LocalStorage" → "persistence strategy"

### **Phase 3: execute (per task)**
```
system.md
  ↓
execute/base.md (task context + PRD + heuristics)
  ↓
execute/rules.md (output format + self-validation)
  ↓
+ [CONDITIONAL INJECTION]
  ├─ document-type injection (fe/be/api)
  └─ domain injection (game/service)
  ↓
[LLM] → <file> or <append> with markdown content
```

---

## 🎯 핵심 설계 원칙

### **1. Separation of Concerns**

| 파일 타입 | 책임 | 변경 빈도 |
|----------|------|----------|
| **system.md** | Identity, core principles | 낮음 (안정적) |
| **phase/base.md** | Strategy (WHAT to do) | 중간 |
| **phase/rules.md** | Format (HOW to output) | 낮음 |
| **injections/** | Domain/doc-type specifics | 중간 |

### **2. Abstraction Enforcement (Multi-Layer Defense)**

**Layer 1: decompose/base.md**
- Task description에서 구체적 기술 금지
- "LocalStorage" → "persistence strategy"

**Layer 2: execute/base.md**
- Task description은 guidance일 뿐
- Prompt rules (abstraction) 우선
- PRD Intent extraction

**Layer 3: execute/rules.md**
- Self-validation checklist
- "Who decided?" test

### **3. Heuristic-Driven (Not Blacklist-Driven)**

**Before (❌):**
```markdown
금지어: LocalStorage, React Router, Zustand, browser, CORS, tab, window...
(끝없이 늘어남)
```

**After (✅):**
```markdown
Heuristic: Any library/framework/tool → Architectural role
Heuristic: Any platform-specific API → Generic interface
Golden Test: "Could this be implemented 10+ ways?"
```

---

## ⚠️ 리팩토링 시 주의사항

### **DO NOT:**
1. ❌ 금지 단어 목록 추가하지 마라
   - 이유: 끝없이 늘어나고, LLM이 회피만 함
   - 대신: Heuristic 강화

2. ❌ system.md에 구체적 예시 추가하지 마라
   - 이유: LLM이 "이것만" 추상화한다고 학습
   - 대신: 원칙과 판단 기준 제시

3. ❌ Phase별 규칙을 system.md로 이동하지 마라
   - 이유: SoC 깨짐
   - 대신: Phase-specific에 유지

### **DO:**
1. ✅ 문제 발생 시 근본 원인 파악
   - Leakage가 어느 Phase에서 시작되는가?
   - decompose? execute? system?

2. ✅ Heuristic 보강
   - 새로운 패턴 발견 시 heuristic에 추가
   - 구체적 예시가 아닌 판단 기준 추가

3. ✅ Self-validation 강화
   - Checklist에 새로운 자가 검증 질문 추가
   - "Am I describing WHAT or HOW?"

---

## 📊 Leakage 문제 해결 히스토리

### **Problem: Implementation Leakage**

**증상:**
- System Design에 "브라우저 저장소", "LocalStorage", "React Router" 등장
- "CORS", "tab-based navigation", "browser history" 등 platform-specific terms
- Rubric 평가에서 "Implementation Leakage" 1-2/4 점수

**근본 원인 (2024-12-18 분석):**
1. **system.md Tier 2에 구체적 예시**
   - "LocalStorage → Persistence adapter" 나열
   - LLM이 "이것만 추상화"라고 학습

2. **PRD를 "ABSOLUTE TRUTH"로 verbatim copy**
   - PRD: "브라우저 저장소"
   - System Design: "브라우저 저장소" (그대로 복사)
   - Intent extraction 부재

3. **Task description이 구체적 기술 포함**
   - decompose phase가 "LocalStorage" 포함한 task description 생성
   - execute phase가 이를 그대로 사용

### **Solution: Three-Layer Defense + Heuristics (2024-12-18)**

**Layer 1: decompose/base.md (already good)**
- Line 105-136: Task descriptions must be ABSTRACT
- Concrete tech names 금지 명시

**Layer 2: execute/base.md (refactored)**
- Task description = GUIDANCE (not absolute)
- Prompt rules = PRIORITY
- PRD Intent extraction examples 추가
- First Principles + Heuristics 추가

**Layer 3: execute/rules.md (refactored)**
- Self-reasoning checklist
- "Who decided?" test
- "WHAT vs HOW" test

**Layer 0: system.md (refactored)**
- Tier 2를 Heuristic 기반으로 변경
- Golden Test 추가
- 구체적 예시 최소화

### **Expected Improvement:**
- Leakage score: 0-1/4 → 3-4/4 (90% 해결 예상)
- 새로운 용어 출현 시 자동 처리 (heuristic 적용)

---

## 🔮 Future Considerations

### **Potential Issues:**
1. **PRD Intent Extraction 실패**
   - LLM이 여전히 PRD 문구를 과신할 수 있음
   - 해결: Examples 추가, few-shot learning

2. **Domain-specific leakage**
   - Game: "Canvas API", "WebGL"
   - Service: "REST", "GraphQL"
   - 해결: Domain injection에 heuristic 추가

3. **API Contract 예외 처리**
   - api-contract.md는 implementation detail 필요
   - 다른 문서와 혼동 가능
   - 해결: Document type detection 강화

### **Monitoring:**
- 매 Design Job 실행 후 Rubric 평가
- Leakage 점수 tracking
- 새로운 패턴 발견 시 문서 업데이트

---

## 📝 Changelog

### 2024-12-18
- **Initial version**: 전체 프롬프트 구조 문서화
- **Major refactoring**: Leakage 문제 해결
  - system.md: Tier 2 → Heuristic
  - execute/base.md: First Principles + Heuristics
  - execute/rules.md: Self-reasoning checklist
- **Approach change**: Blacklist → Heuristic-driven

---

## 🔗 Related Documents

- `docs/rubric/system-design-rubric.md` - Design 품질 평가 기준
- `BRANCH_INDEXING_REFACTORING.md` - 전체 리팩토링 맥락
- `packages/ant-cli/src/agents/architect/graph/design/` - Design graph 구현

---

**END OF DOCUMENT**
