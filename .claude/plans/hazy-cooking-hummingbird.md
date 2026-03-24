# 디자인 프롬프트 전수 감사 결과 — 사이드이펙트 및 결함 보고서

## Context

"Who decided?" Entry Gate를 3개 디자인 프롬프트 파일에 적용한 후, 해당 변경의 사이드이펙트뿐 아니라 **프롬프트 전체의 품질/정합성**을 점검. 3개 Explore 에이전트가 각 파일을 8개 카테고리(내부 모순, 모호성, MECE, 중복, 누락참조, 순서/우선순위, FPOP, 구조)로 전수 감사.

## 분류 원칙

에이전트가 보고한 항목을 3계층으로 분류:
- **실제 결함**: LLM이 잘못된 출력을 생성할 가능성이 있는 것 → **수정 대상**
- **구조적 관찰**: 중복/순서 등 suboptimal이지만 의도된 설계 → **수정 불필요 (이유 기록)**
- **오탐**: 에이전트가 플래그했지만 실제로는 문제 없음 → **기각**

---

## A. 실제 결함 (수정 대상) — 4건

### A1. PostgreSQL이 Tier 1과 Tier 2 예시에 동시 등장

**파일/위치**:
- `base-system-design.md` L241 (Tier 1): `"Tailwind CSS", "PostgreSQL" (keep exact name)`
- `base-system-design.md` L251 (Tier 2): `"PostgreSQL" → "Data store"`
- `rules-system-design.md` L427 (ABSTRACT): `"PostgreSQL", "MongoDB" → "Database", "Data store"`

**문제**: 동일 기술이 "보존(Tier 1)"과 "추상화(Tier 2)" 예시에 모두 등장. L254의 "Applies only to technologies YOU choose" 한정어가 있지만, 예시 자체가 모순되어 LLM이 혼동.

**수정 방향**: Tier 2/ABSTRACT 예시에서 PostgreSQL 제거 또는 "YOUR PostgreSQL choice" 같은 한정어 추가. Tier 1에만 유지.

### A2. Self-Validation Q1의 종료 조건 불명확

**파일/위치**: `base-system-design.md` L268-270

**현재 텍스트**:
```
1. "Who decided this — PRD or me?"
   - PRD specified it? → Document exactly (Tier 1 constraint)
   - I chose it? → Apply questions 2-5 below
```

**문제**: PRD 분기에서 Q2-Q5를 **건너뛰라는 명시적 지시**가 없음. LLM이 PRD-specified 항목에도 Q2("proper noun → abstract?")를 적용할 수 있음.

**수정 방향**: PRD 분기에 "**Stop here. Do not apply Q2-Q5.**" 추가.

### A3. rules-system-design.md 최종 체크리스트에 Guardrail 항목 누락

**파일/위치**: `rules-system-design.md` L521-557

**문제**: 본문에서 정의한 4개 guardrail이 최종 체크리스트에 없음:
- Routing & Navigation Guardrail (L489-496)
- Layer Consistency Guardrail (L498-504)
- Cross-Section Consistency Guardrail (L506-510)
- Directory Structure Output Guardrail (L512-518) — L414에서 부분적으로만 언급

**수정 방향**: 체크리스트에 guardrail 검증 항목 추가.

### A4. system.md L188 "VERBATIM" 범위 모호

**파일/위치**: `system.md` L188

**현재 텍스트**: `Copy PRD constraints VERBATIM (including technology names). Abstract only technologies YOU chose to their architectural role.`

**문제**: "VERBATIM"이 platform constraint wording에도 적용되는 것으로 읽힐 수 있음. 하지만 L96에서는 platform constraints에 대해 "extract INTENT and abstract the wording"이라고 함. PRD "browser storage" → "VERBATIM" 복사? 아니면 INTENT 추출?

L96의 의도가 맞음: platform constraint **wording**은 추상화, technology **name**은 보존. 하지만 L188의 "VERBATIM"이 이를 오버라이드하는 것처럼 보임.

**수정 방향**: L188을 "Copy PRD technology names and service names VERBATIM. For platform constraints, extract intent per Tier 1 rule above."로 정밀화.

---

## B. 구조적 관찰 (수정 불필요) — 6건

### B1. system.md / base-system-design.md 간 Three-Tier 모델 중복

**에이전트 보고**: HIGH — 동일 모델이 두 파일에 반복.

**기각 이유**: **의도된 설계**. system.md는 system prompt, base-system-design.md는 user message. LLM은 system/user 메시지에 다른 가중치를 부여하므로 핵심 규칙의 양쪽 반복은 준수율을 높이는 프롬프트 엔지니어링 패턴. 실제로 이 중복은 프로젝트 초기부터 의도적.

### B2. Writing Quality Rules vs Implementation Detail Filter 중복 (rules-system-design.md)

**에이전트 보고**: MEDIUM — L324-361과 L364-441이 같은 내용을 다른 형식으로 반복.

**기각 이유**: **보완적 역할**. Writing Quality는 "어떤 스타일로 쓸 것인가" (STRUCTURE not STEPS), Implementation Detail Filter는 "무엇을 포함/제외할 것인가" (PRD vs YOU). 관점이 다르며 각각 다른 LLM 실패 모드를 방지.

### B3. Golden Test 4개 질문의 논리 연산자(AND/OR) 미명시

**에이전트 보고**: LOW — 질문들이 독립적인지 순차적인지 불명확.

**기각 이유**: 독립 필터로 설계됨. 각 질문은 서로 다른 관점에서 동일 문장을 검증하는 체크포인트. AND/OR가 아니라 "하나라도 ❌이면 재검토" 패턴. 실제 사용에서 문제 없음.

### B4. Entry Gate 위치가 Golden Test 뒤 (system.md L79)

**에이전트 보고**: MEDIUM — Entry Gate가 문서 중간에 위치.

**기각 이유**: Golden Test(L58-77)는 모든 문장에 적용되는 일반 필터, Entry Gate(L79-83)는 기술명에만 적용되는 특수 필터. 일반→특수 순서는 올바름. Entry Gate를 앞으로 옮기면 "모든 문장" 관점이 "기술명만" 관점 뒤로 밀림.

### B5. Heuristic Rules 1-5가 Tier에 명시적 매핑 안됨

**에이전트 보고**: MEDIUM — Rule 1-5가 어떤 Tier를 생산하는지 불명확.

**기각 이유**: Entry Gate가 Tier 분류의 진입점이므로, Heuristic Rules는 "어떻게 추상화할지"의 가이드이지 "어떤 Tier인지"의 분류 도구가 아님. Entry Gate → Tier 결정 → Heuristic Rules = 추상화 방법. 매핑을 추가하면 오히려 Entry Gate의 진입 조건 역할이 약해짐.

### B6. Context Gathering과 Content Quality가 rules-system-design.md에 혼재

**에이전트 보고**: MEDIUM — L1-104 (도구 사용)과 L106-557 (콘텐츠 규칙)이 한 파일에.

**기각 이유**: 이 파일은 PromptEngine의 TemplateComposer가 단일 rules partial로 주입. 파일 분리는 Handlebars partial 구조 변경이 필요하며, 현재 작업 범위 밖. 또한 도구 사용 규칙은 "어떻게 정보를 수집하는가"로, 콘텐츠 품질과 같은 실행 단계에서 필요.

---

## C. 오탐 (기각) — 4건

### C1. DO NOT Write vs ALWAYS Write 충돌 (rules-system-design.md)

**에이전트 보고**: HIGH — "Service/class names YOU invented" vs "External services from PRD" 충돌.

**기각 이유**: 이미 올바르게 스코핑됨. L383: "Service/class names **YOU invented**" (명시적 한정), L420: "External services: **Exact service names from PRD**". "YOU invented" 한정어가 충돌을 해소.

### C2. Intent Extraction이 기술명에도 적용될 수 있음

**에이전트 보고**: MEDIUM — "browser storage" 추상화 예시가 기술명 추상화로 확대 해석 가능.

**기각 이유**: Intent Extraction 예시(base-system-design.md L134-155)는 **모두 platform constraint** 사례("browser storage", "static hosting", "CORS"). Golden Rule L160-161에서 "Use X technology → Document X as Tier 1"로 기술명은 명시적으로 분리. Entry Gate가 이 구분을 강제.

### C3. "Project boundary" 정의 부재 (Infrastructure Independence Guardrail)

**에이전트 보고**: MEDIUM — 모노레포에서 백엔드가 "외부"인지 불명확.

**기각 이유**: 이 guardrail은 Who decided? 변경과 무관한 기존 규칙. blind spot 문단(L483-486)이 이미 프론트엔드/백엔드 분리와 교차 프로젝트 의존성 사례를 다룸. 더 정밀한 정의는 이번 작업 범위 밖.

### C4. Heuristic Rules가 모든 케이스를 커버하지 않음 (architecture patterns, testing tools 등)

**에이전트 보고**: LOW — Rule 1-5 외에 커버 안 되는 카테고리 존재.

**기각 이유**: Heuristic Rules는 exhaustive 목록이 아니라 common case 가이드. Golden Test와 Three-Tier model이 fallback으로 기능. "Heuristic"이라는 이름 자체가 비완전성을 내포.

---

## 수정 계획

### 수정 1: Tier 2/ABSTRACT 예시에서 PostgreSQL 제거

**파일**: `base-system-design.md` L251, `rules-system-design.md` L427

```
// base-system-design.md L251 Before:
"LocalStorage" / "Redis" / "PostgreSQL" → "Persistence adapter" / "Cache layer" / "Data store"

// After:
"LocalStorage" / "Redis" / "SQLite" → "Persistence adapter" / "Cache layer" / "Data store"

// rules-system-design.md L427 Before:
- 🔄 **Database**: "PostgreSQL", "MongoDB" → "Database", "Data store"

// After:
- 🔄 **Database**: "SQLite", "MongoDB" → "Database", "Data store"
```

Why: PostgreSQL은 Tier 1 예시("PRD-specified technology choices: PostgreSQL")에서 이미 사용. Tier 2 예시에도 등장하면 MECE 위반. SQLite로 교체하면 "YOU chose a lightweight DB" 시나리오를 보여주면서 Tier 1과 충돌하지 않음.

### 수정 2: Self-Validation Q1에 종료 지시 추가

**파일**: `base-system-design.md` L268-270

```
// Before:
1. **"Who decided this — PRD or me?"**
   - PRD specified it? → Document exactly (Tier 1 constraint)
   - I chose it? → Apply questions 2-5 below

// After:
1. **"Who decided this — PRD or me?"**
   - PRD specified it? → Document exactly (Tier 1 constraint). **Stop — skip Q2-Q5.**
   - I chose it? → Apply questions 2-5 below
```

### 수정 3: 최종 체크리스트에 Guardrail 항목 추가

**파일**: `rules-system-design.md` L554 직후

```markdown
### Guardrail Compliance
- [ ] **Routing**: Application/Domain boundaries do NOT depend on concrete routing APIs?
- [ ] **Layer consistency**: All sections maintain the same boundary ownership model?
- [ ] **Cross-section consistency**: Overlapping infrastructure defined ONCE, referenced elsewhere?
```

### 수정 4: system.md L188 "VERBATIM" 범위 정밀화

**파일**: `system.md` L188

```
// Before:
- **Rule**: Copy PRD constraints VERBATIM (including technology names). Abstract only technologies YOU chose to their architectural role.

// After:
- **Rule**: Copy PRD technology names and service names VERBATIM. For platform constraints, extract intent per Tier 1 rule. Abstract only technologies YOU chose to their architectural role.
```

## Verification

1. `cd packages/ant-cli && pnpm vitest run` — 기존 테스트 통과
2. `grep -n "PostgreSQL"` in base-system-design.md → Tier 1에서만 등장
3. `grep -n "PostgreSQL"` in rules-system-design.md → ABSTRACT 예시에서 제거됨
4. Self-Validation Q1에 "Stop" 명시 확인
5. 최종 체크리스트에 Guardrail 섹션 존재 확인
