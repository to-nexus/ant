# ANT (AI-Native Transformation) - 작업 워크플로우 가이드 (v2)

## 🎯 핵심 개념 정리

### 1. Task (산출물 유형)
- **design**: 시스템 디자인 문서 생성
- **code**: 소스 코드 생성/수정
- **learn**: 학습 데이터 저장

### 2. Mode (작업 방식 - code task 전용)
- **generate**: 신규 코드 생성 (빈 캔버스)
- **edit**: 기존 코드 수정 (최소 변경)
- **refactor**: 구조 개선 (기능 동일)
- **explain**: 코드 분석/설명 (변경 없음)

### 3. 입력 (모두 선택적 - 있으면 사용)
- **PRD/spec**: 원래 요구사항
- **design doc**: 시스템 디자인 (아키텍처, 구조)
- **directive**: 현재 작업 지시 (수정사항, 피드백)
- **originalFiles**: 기존 코드 (git HEAD)
- **memory**: 벡터 DB에서 검색된 컨텍스트

---

## 📋 입력 조합의 원칙

**모든 입력은 "있으면 사용":**
```typescript
const inputs = {
  directive: state.directive || null,          // 있으면 최우선
  designDoc: state.latestDesign || null,       // 있으면 참고
  prdSpec: state.spec || null,                 // 있으면 참고
  originalFiles: state.originalFilesBlock || null,  // 있으면 BASE
  memory: state.context.memory || null         // 있으면 컨텍스트
};
```

**단, resolve에서 최소 검증:**
- design doc OR directive 중 **하나는 있어야 함**
- 둘 다 없으면 에러

---

## 🔄 Mode 자동 추론 로직

**`inferCodeMode(directive, hasOriginalFiles)`**

```typescript
// 1순위: explain 키워드
if (directive.includes('explain', 'analyze', '설명', '분석'))
  → mode = 'explain'

// 2순위: refactor 키워드  
if (directive.includes('refactor', '리팩토링', 'cleanup', '정리'))
  → mode = 'refactor'

// 3순위: generate 키워드
if (directive.includes('create', '만들', 'new', '새로'))
  → mode = 'generate'

// 4순위: 기본값 (originalFiles 기준)
if (hasOriginalFiles)
  → mode = 'edit'
else
  → mode = 'generate'
```

**Mode는 프롬프트 톤/규칙에 영향:**
- `generate`: "빈 캔버스에서 만들어라"
- `edit`: "기존 코드 최소한만 수정해라"
- `refactor`: "기능 유지, 구조만 개선해라"
- `explain`: "분석만, 코드 변경하지 마라"

---

## 🎬 실제 워크플로우 시나리오

### 시나리오 1: 완전 신규 기능 (design → code)

**입력:**
- ✅ PRD: 새 기능 요구사항
- ❌ design doc: 없음
- ❌ directive: 없음
- ❌ originalFiles: 없음

**Step 1: design task**
```bash
npm run dev arch-design projects/my-app/ui-1.0.0
```
→ design doc 생성 (아키텍처, 컴포넌트, 파일 계획)

**Step 2: code task**
```bash
npm run dev arch-code projects/my-app/ui-1.0.0
```

**입력:**
- ✅ PRD: 있음
- ✅ design doc: 방금 생성됨
- ❌ directive: 없음
- ❌ originalFiles: 없음

**Mode 추론:** `generate` (originalFiles 없음)

**프롬프트:**
- design doc: "이 구조로 만들어라"
- PRD: "요구사항 참고"
- mode=generate: "신규 생성 모드"

---

### 시나리오 2: 버그 수정

**입력:**
- ✅ PRD: 있음 (과거)
- ✅ design doc: 있음 (과거)
- ✅ directive: "Fix button color bug"
- ✅ originalFiles: 있음 (git diff)

**실행:**
```bash
echo "Fix button color in Header.tsx" > directives/code/directive.md
npm run dev arch-code projects/my-app/ui-1.0.0
```

**Mode 추론:** `edit` (originalFiles 있음, 특수 키워드 없음)

**프롬프트:**
- directive: "이걸 고쳐라" (최우선)
- originalFiles: "이게 현재 코드" (BASE)
- design doc: "구조 참고" (선택)
- mode=edit: "최소 변경만"

---

### 시나리오 3: 리팩토링

**입력:**
- ✅ PRD: 있음
- ✅ design doc: 있음
- ✅ directive: "Refactor TabMenu to use hooks"
- ✅ originalFiles: 있음

**실행:**
```bash
echo "Refactor TabMenu component to use custom hooks" > directives/code/directive.md
npm run dev arch-code projects/my-app/ui-1.0.0
```

**Mode 추론:** `refactor` ("Refactor" 키워드 감지)

**프롬프트:**
- directive: "이렇게 리팩토링해라"
- originalFiles: "현재 코드"
- mode=refactor: "기능 유지, 구조만 개선"

---

### 시나리오 4: 코드 분석

**입력:**
- ⚪ PRD: 선택
- ⚪ design doc: 선택
- ✅ directive: "Explain auth flow in AuthProvider.tsx"
- ✅ originalFiles: 있음

**실행:**
```bash
echo "Explain the authentication flow" > directives/code/directive.md
npm run dev arch-code projects/my-app/ui-1.0.0
```

**Mode 추론:** `explain` ("Explain" 키워드 감지)

**프롬프트:**
- directive: "이걸 분석해라"
- originalFiles: "분석 대상"
- mode=explain: "코드 변경하지 마라, 분석만"

---

### 시나리오 5: 점진적 개발 (design → code → directive → code)

**Phase 1: 초기 구현**
- design doc → code task (mode=generate)

**Phase 2: 피드백 반영**
- directive: "Tab UI 개선해줘"
- 입력: design doc + directive + originalFiles
- mode=edit (originalFiles 있음)

**Phase 3: 리팩토링**
- directive: "리팩토링해줘"
- 입력: design doc + directive + originalFiles
- mode=refactor ("리팩토링" 키워드)

---

## 📊 입력/Mode/결과 매트릭스

| directive | design doc | originalFiles | Mode 추론 | 프롬프트 우선순위 |
|-----------|-----------|---------------|----------|------------------|
| ❌ | ✅ | ❌ | generate | design → PRD |
| ✅ "Fix bug" | ✅ | ✅ | edit | directive → originalFiles → design → PRD |
| ✅ "Refactor" | ✅ | ✅ | refactor | directive → originalFiles (기능 유지) |
| ✅ "Explain" | ⚪ | ✅ | explain | directive → originalFiles (분석만) |
| ✅ "Create new" | ✅ | ❌ | generate | directive → design → PRD |

---

## ✅ 핵심 원칙

1. **입력은 모두 선택적** - 있으면 사용, 없어도 됨 (최소 design OR directive)
2. **Mode는 자동 추론** - directive 키워드 + originalFiles 존재 여부
3. **Mode는 프롬프트 톤/규칙 결정** - 작업 크기가 아님
4. **우선순위는 항상 동일** - directive > design > originalFiles > PRD

**작업 크기는 Mode와 무관:**
- 소규모 버그픽스 → mode=edit
- 대규모 신규 기능 → mode=generate
- 대규모 리팩토링 → mode=refactor

**Mode는 "어떻게 작업할지":**
- generate: 빈 캔버스
- edit: 최소 변경
- refactor: 구조 개선
- explain: 분석만

