# Code Job에서 LLM에게 전달되는 모든 컨텍스트

## 📊 전체 문서 흐름 (Execute Phase)

### Phase 1: Document Loading (architect/index.ts → contextLoader)
```typescript
// ArtifactService를 통해 파일 시스템에서 로드:
1. directive (작업 지시사항)
2. designDocs (모든 설계 문서)
   - api-contract.md
   - fe-system-design.md
   - be-system-design.md
   - system-design.md
3. designDoc (통합 설계 문서 - backward compat)
4. prdSpec (inputs/sources/에서 로드 - ArtifactService.getSource())
```

### Phase 2: Context Assembly (ContextAssembler)
```typescript
assembled = {
  directive: "작업 지시사항",
  designDoc: "통합 설계 문서",
  designDocs: { apiContract, feDesign, beDesign, unifiedDesign },
  prdSpec: "PRD 명세",
  originalFiles: "Git HEAD 파일들",
  currentCode: "현재 작업 디렉토리 파일들",
  lessons: [...],  // Vector DB에서 검색한 과거 학습
  sessionContext: {...},  // 세션 히스토리
  referenceRequests: [...],  // 참조 프로젝트
  currentTask: {...}
}
```

### Phase 3: Document Filtering (TemplateComposer)
```typescript
// 환경별 필터링 (토큰 절약!)
Frontend task:
  → apiContract + feDesign (BE 문서 제외)

Backend task:
  → apiContract + beDesign (FE 문서 제외)

Unknown:
  → 모든 문서 포함
```

### Phase 4: Injection Assembly (ModeController)
```typescript
injections = [
  // 1. Common Injections (조건부)
  'base/injections/directive',           // directive가 있으면
  'base/injections/memory',              // vector memory가 있으면
  'base/injections/design-doc',          // 설계 문서가 있으면
  'base/injections/prd-spec',            // PRD가 있으면
  'base/injections/original-files',      // git diff가 있으면
  'base/injections/current-code',        // 현재 코드가 있으면
  
  // 2. Code-specific Injections
  'code/base/injections/tool-calling-rules-compact',  // 도구 호출 규칙
  'base/injections/output-format-markdown',           // MD 스트리밍
  
  // 3. Language/Environment-specific
  'code/languages/typescript/environments/browser/rules',  // 환경별 규칙
  'code/languages/typescript/setup/constraints',           // Setup task만
  
  // 4. Execute-specific (조건부)
  'code/phases/execute/injections/retry-context',          // 재시도 시
  'code/phases/execute/injections/lessons',                // 학습이 있으면
  'code/phases/execute/injections/session-context',        // 세션 히스토리
  'code/phases/execute/injections/runtime-error-fix',      // 런타임 에러 시
  'code/languages/typescript/execute/missing-dependency-fix'  // 의존성 누락 시
]
```

---

## 🎯 LLM에게 전달되는 최종 프롬프트 구조

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. SYSTEM PROMPT (system.md)                                    │
│    - 역할 정의, 핵심 규칙                                          │
│    - 846 토큰                                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 2. LANGUAGE/FRAMEWORK PROFILES (조건부)                          │
│    - TypeScript profile                                          │
│    - React/Vue/etc framework profile                            │
│    - ~500-1,000 토큰                                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 3. BASE PROMPT (execute/base.md)                                │
│    - 현재 작업 설명 (SETUP/FEATURE/ERROR/FINAL)                  │
│    - Design Document (환경별 필터링됨)                            │
│    - Existing Files (currentCode)                               │
│    - Reference Projects                                         │
│    - ~3,500 토큰                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 4. INJECTIONS (조건부로 포함)                                     │
│    ┌───────────────────────────────────────────────────────────┐│
│    │ A) 작업 컨텍스트 (항상 포함)                                ││
│    │    - directive.md: 작업 지시사항                           ││
│    │    - design-doc.md: 설계 문서 (환경별 필터링)               ││
│    │    - current-code.md: 현재 코드베이스                       ││
│    │    - original-files.md: Git HEAD 원본 파일                ││
│    └───────────────────────────────────────────────────────────┘│
│    ┌───────────────────────────────────────────────────────────┐│
│    │ B) 추가 소스 (조건부)                                        ││
│    │    - prd-spec.md: PRD 원본 명세 (있으면)                   ││
│    │    - memory.md: Vector DB 관련 메모리 (있으면)              ││
│    │    - lessons.md: 과거 학습 내용 (있으면)                    ││
│    │    - session-context.md: 세션 히스토리 (있으면)             ││
│    └───────────────────────────────────────────────────────────┘│
│    ┌───────────────────────────────────────────────────────────┐│
│    │ C) 재시도/에러 컨텍스트 (조건부)                              ││
│    │    - retry-context.md: 재시도 이유 (재시도 시)              ││
│    │    - runtime-error-fix.md: 런타임 에러 (에러 시)            ││
│    │    - missing-dependency-fix.md: 의존성 누락 (누락 시)       ││
│    └───────────────────────────────────────────────────────────┘│
│    ~1,000-5,000 토큰 (상황에 따라)                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 5. RULES (execute/rules.md)                                     │
│    - text-format-compact: 텍스트 포맷팅 규칙                      │
│    - XML tag 규칙 (write_file, edit, etc)                       │
│    - Tips & Common mistakes                                     │
│    - ~2,500 토큰                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 6. ENVIRONMENT-SPECIFIC RULES (조건부)                           │
│    - browser/node-api/fullstack/cli 규칙                        │
│    - tool-calling-rules-compact                                 │
│    - ~2,700-3,100 토큰                                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 7. EXAMPLES (execute에서만, 조건부)                               │
│    - base/examples.md                                           │
│    - ~1,594 토큰                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📋 실제 전달 문서 체크리스트

### 항상 포함되는 것
- ✅ **directive**: 작업 지시사항 (예: "로그인 기능 추가")
- ✅ **designDoc**: 설계 문서 (환경별 필터링됨)
  - Frontend: api-contract + fe-system-design
  - Backend: api-contract + be-system-design
- ✅ **currentCode**: 현재 작업 디렉토리의 파일들
- ✅ **currentTask**: 현재 실행 중인 태스크 정보

### 조건부로 포함되는 것
- 🔶 **prdSpec**: PRD 원본 (inputs/sources/에 있으면)
  - ⚠️ **주의**: Design job 이후에는 거의 사용 안됨
  - Design doc에 이미 PRD 내용이 반영되어 있기 때문
- 🔶 **originalFiles**: Git diff가 있으면 (수정 모드)
- 🔶 **memory**: Vector DB 검색 결과가 있으면
- 🔶 **lessons**: 과거 학습 내용이 있으면
- 🔶 **sessionContext**: 세션 히스토리가 있으면
- 🔶 **referenceRequests**: 참조 프로젝트가 지정되면

### 재시도/에러 시에만 포함
- 🔴 **retryContext**: 이전 시도 실패 정보
- 🔴 **enforcementReason**: 검증 실패 이유
- 🔴 **runtime-error-fix**: 런타임 에러 수정 가이드
- 🔴 **missing-dependency-fix**: 의존성 누락 해결 가이드

---

## 🤔 PRD의 역할과 문제점

### 현재 PRD 사용 현황
```typescript
// codeGen.ts - Line 284
{
  directive: state.directive,
  designDoc: state.design,
  prdSpec: state.prd,  // ← PRD가 전달됨!
  currentCode: state.code,
  ...
}
```

### PRD가 포함되는 조건
```typescript
// ModeController.ts - Line 149-150
if (context.prdSpec) {
  injections.push(`${commonPrefix}/prd-spec`);
}
```

### 문제점 분석

#### 1. 중복 가능성
- **Design Document**: PRD 내용을 기반으로 생성됨
- **PRD Spec**: 원본 PRD
- **문제**: 설계 문서에 이미 PRD 요구사항이 반영되어 있는데, 원본 PRD를 또 전달하는가?

#### 2. 토큰 낭비 가능성
- PRD는 보통 길다 (2,000-5,000 토큰)
- Design doc에 이미 요약/정리되어 있음
- Code job에서는 PRD 원본이 아니라 Design doc만 있으면 충분

#### 3. 실제 필요성
**필요한 경우:**
- Design job이 없이 바로 Code job 실행 (드문 케이스)
- PRD에 Design doc에 없는 중요한 디테일이 있는 경우

**불필요한 경우 (대부분):**
- Design job → Code job 정상 흐름
- Design doc에 모든 요구사항 반영됨

---

## 💡 PRD 관련 제안

### 옵션 1: PRD를 Code job에서 제거 (추천)
```typescript
// codeGen.ts - buildMessages()
{
  directive: state.directive,
  designDoc: state.design,  // Design doc만 있으면 충분
  // prdSpec: state.prd,  ← 제거
  currentCode: state.code,
  ...
}
```

**이유:**
- Design doc에 이미 PRD 내용 반영
- 2,000-5,000 토큰 추가 절약
- 불필요한 중복 제거

### 옵션 2: PRD를 조건부로만 포함
```typescript
// Design doc이 없을 때만 PRD 포함
if (!state.design && state.prd) {
  prdSpec: state.prd
}
```

**이유:**
- Design job 없이 Code job 실행 케이스 대응
- 대부분 케이스에서는 제외

### 옵션 3: 현재 유지 (비추천)
- 중복이지만 안전하게 모든 정보 제공
- 토큰 낭비

---

## 📊 현재 Code Job LLM 전달 문서 최종 정리

### 필수 문서 (항상)
| 문서 | 크기 | 출처 | 역할 |
|------|------|------|------|
| **directive** | ~500-1,000 토큰 | inputs/directives/code/ | 작업 지시 |
| **designDoc** | ~5,000-15,000 토큰 | outputs/design/ | 설계 가이드 (환경별 필터링) |
| **currentCode** | ~2,000-10,000 토큰 | Working tree | 현재 코드 |

### 조건부 문서
| 문서 | 크기 | 포함 조건 | 역할 |
|------|------|----------|------|
| **prdSpec** | ~2,000-5,000 토큰 | inputs/sources/ 존재 | PRD 원본 ⚠️ 중복? |
| **originalFiles** | ~2,000-10,000 토큰 | Git diff 존재 | 수정 전 원본 |
| **memory** | ~1,000-3,000 토큰 | Vector search 결과 | 관련 메모리 |
| **lessons** | ~1,000-2,000 토큰 | Vector search 결과 | 과거 학습 |
| **sessionContext** | ~500-2,000 토큰 | 세션 히스토리 존재 | 이전 작업 |
| **referenceRequests** | ~1,000-5,000 토큰 | 참조 프로젝트 지정 | 참조 코드 |

### 프롬프트 템플릿
| 항목 | 크기 | 역할 |
|------|------|------|
| **system** | 846 토큰 | 시스템 역할 |
| **base** | 3,500 토큰 | 작업 컨텍스트 |
| **rules** | 2,500 토큰 | 출력 규칙 |
| **environment rules** | 2,700-3,100 토큰 | 환경별 규칙 |
| **examples** | 1,594 토큰 | 예제 |

---

## 🔢 토큰 사용량 시나리오

### Scenario 1: 신규 프로젝트 (Setup Task)
```
system:              846
base:              3,500
rules:             2,500
env rules:         2,700
tool-calling:        400
text-format:         400
examples:          1,594
directive:           500
designDoc:        10,000
prdSpec:           3,000  ← PRD 포함
─────────────────────────
합계:            ~25,440 토큰
```

### Scenario 2: 기능 추가 (Feature Task)
```
system:              846
base:              3,500
rules:             2,500
env rules:         2,700
tool-calling:        400
text-format:         400
examples:          1,594
directive:           500
designDoc:         8,000  ← 환경 필터링으로 축소
currentCode:       5,000
originalFiles:     3,000
memory:            1,500
lessons:           1,000
sessionContext:      800
─────────────────────────
합계:            ~31,740 토큰
```

### Scenario 3: 버그 수정 (Error Task)
```
system:              846
base:              3,500
rules:             2,500
env rules:         2,700
tool-calling:        400
text-format:         400
directive:           800  ← 에러 메시지 포함
designDoc:         6,000
currentCode:       3,000
originalFiles:     2,000
retryContext:      1,000
runtime-error-fix: 1,500
─────────────────────────
합계:            ~24,646 토큰
```

---

## ⚠️ PRD 중복 문제

### 현재 상황
```
PRD 원본 (3,000 토큰)
    ↓
Design Job (PRD 분석)
    ↓
Design Document (8,000 토큰)
    ↓
Code Job 실행
    ├─ designDoc: 8,000 토큰 ✅ 필요
    └─ prdSpec: 3,000 토큰   ❌ 중복?
```

### 문제
- Design doc은 PRD를 분석하고 구체화한 것
- Code job에서 PRD 원본이 필요한가?
- **3,000 토큰 낭비 가능성**

### 제안: PRD를 Code job에서 제거
```typescript
// Code job은 Design doc만으로 충분
✅ Design doc: 아키텍처, 컴포넌트, API, DB 스키마
❌ PRD: 요구사항 나열 (이미 Design doc에 반영됨)
```

**절약 가능**: ~3,000 토큰 추가

---

## 🎯 추천 사항

### 즉시 적용 가능
1. ✅ **PRD를 Code job에서 제거** (3,000 토큰 절약)
   - Design doc에 이미 반영됨
   - 중복 제거

### 결과 예상
- **현재 절약**: 4,894 토큰 (26%)
- **PRD 제거 후**: 7,894 토큰 (35%)
- **총 개선**: 35% 토큰 절약!

적용하시겠습니까?

