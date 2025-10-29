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

---

## 🔬 Code Evaluation (Optional)

코드 생성 후 품질을 자동으로 분석합니다.

### 사용법

```bash
# --eval 플래그로 평가 활성화
npm run dev arch-code workspace/myapp/feature/ --eval
```

### Workflow 통합

```
resolve → plan → execute → validate → evaluate → learn
                                          ↓
                                    (--eval 플래그 시)
                                    품질 분석 + 리포트
```

**Evaluate 노드**:
- `--eval` 플래그 **없으면**: 즉시 스킵 (no-op)
- `--eval` 플래그 **있으면**: 분석 실행

### 측정 메트릭

| 메트릭 | 설명 | 기준 |
|-------|------|------|
| **Lines of Code** | 총 라인 수 (논리적 라인) | - |
| **Cyclomatic Complexity** | 코드 복잡도 | 1-10: Simple<br>11-20: Moderate<br>21+: Complex |
| **Maintainability Index** | 유지보수성 점수 (0-100) | 85-100: Excellent<br>70-84: Good<br>50-69: Moderate<br>0-49: Poor |
| **Comment Density** | 주석 비율 (%) | 10-30%: Optimal<br>5-10%: Acceptable |

### 출력 구조

```
workspace/myapp/feature/
├── inputs/directives/eval/
│   ├── tests.json                # 요구사항 체크리스트
│   └── quality-thresholds.json   # 품질 기준 (선택)
└── outputs/eval/
    ├── report.json               # 구조화된 리포트
    └── report.md                 # 사람이 읽기 쉬운 리포트

Note: 생성된 코드는 저장소에 직접 작성됨 (src/, lib/ 등)
```

### tests.json 예시

```json
{
  "name": "feature-evaluation",
  "tasks": [
    {
      "id": "req-1",
      "description": "사용자 인증 기능 구현"
    },
    {
      "id": "req-2",
      "description": "JWT 토큰 발급 및 검증"
    }
  ]
}
```

### quality-thresholds.json 예시

```json
{
  "minMaintainabilityIndex": 70,
  "maxComplexity": 20,
  "enforceOnFail": false
}
```

### Console 출력 예시

```
🔬 Evaluating generated code...

═══════════════════════════════════════════════════════════
📊 EVALUATION SUMMARY
═══════════════════════════════════════════════════════════

📈 Code Metrics:
   Files:           5
   Total Lines:     342
   Complexity:      8.2
   Maintainability: 75.3/100
   Quality:         GOOD

💡 Recommendations:
   ✅ 코드 품질이 우수합니다!

📋 Requirements (3 items):
   Please verify manually in the report

═══════════════════════════════════════════════════════════

📄 Evaluation report saved: workspace/myapp/feature/outputs/eval/report.md
```

### 특징

- ✅ **간단한 정적 분석**: 외부 도구 없이 동작
- ✅ **빠른 실행**: VM 실행 없이 메트릭만 계산
- ✅ **선택적**: `--eval` 플래그로 제어
- ✅ **확장 가능**: 품질 기준 커스터마이징 가능

### 제한사항

**실제 테스트는 실행하지 않음**:
- 정적 분석만 수행 (복잡도, 유지보수성)
- 기능 테스트는 사용자가 직접 실행

```bash
# 기능 테스트는 수동으로
cd workspace/myapp/feature
npm test
```

**이유**: 
- 의존성 설치, 빌드, 환경 설정 필요
- 복잡하고 느리며 자주 실패
- 단순한 메트릭이 더 실용적

