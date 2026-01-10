# 프롬프트 리팩토링 분석 - 신중한 접근 필요

**날짜**: 2026-01-10  
**대상**: ui-spec-guide.md (404줄)  
**사용자 지적**: "400줄이나 되는 프롬프트가 문제없는지, 잘못된 방향인지 생각해봐라"

---

## 🚨 문제 인식

### 사용자 핵심 지적
> "프롬프트는 원칙을 기반으로 LLM에게 가이드를 줘야 하는건데..."

**맞습니다!**
- ✅ 원칙 기반 (Principle-based)
- ❌ 규칙 나열 (Rule enumeration)

### 현재 상황
```bash
ui-spec-guide.md: 404줄

구성:
- Core Principles: ~30줄
- Layout Structure Analysis: ~60줄  
- Layout Direction Analysis: ~80줄
- Grid Layout Documentation: ~40줄
- Image Role Detection: ~50줄
- Section Header Layout: ~30줄
- What to EXCLUDE (STRICTLY FORBIDDEN): ~70줄
- Quality Criteria: ~30줄
- Documentation Format: ~20줄
```

---

## ❌ 즉시 축소한 시도 (위험)

### 무작정 수정
```
404줄 → 173줄 (57% 축소)
```

### 사용자 경고
> "방금의 리팩토링으로 인해 기대되던 산출물이 안나오면 어떻게 하나? 무작정 수정한건 아닌가?"

**완전히 맞습니다!**

---

## 🔍 올바른 접근법

### 1단계: 현재 프롬프트 효과성 검증

**질문**:
- 404줄 프롬프트로 생성된 ui-spec.md는 어땠는가?
- Technology 섹션 레이아웃 오류: 프롬프트 때문? LLM 한계?
- "## Implementation Notes" 생성: 프롬프트가 막지 못함

**검증 필요**:
```bash
# 기존 프롬프트 (404줄)로 생성된 결과
- ✅ 6/7 섹션 레이아웃 정확
- ❌ Technology 레이아웃 오류 (하지만 프롬프트에 Direction Analysis 추가 전)
- ❌ Implementation Notes 포함 (프롬프트에 금지 명시 前)

# 최근 개선 (c32f9ed, 9d967eb)
- ✅ Direction Analysis 추가 → 레이아웃 정확도 향상 예상
- ✅ Implementation 금지 강화 → 구현 세부사항 제거 예상
```

### 2단계: 긴 프롬프트가 필요했던 이유 파악

**가설 1: LLM의 기본 편향 교정을 위해**
```
- "3개 = 3열" 추론 방지 → Layout Direction Analysis (80줄) 필요
- "bg-* = background" 가정 방지 → Image Role Detection (50줄) 필요
- Framework 언급 방지 → What to EXCLUDE (70줄) 필요
```

**가설 2: 실제 사례 기반 학습**
```
프롬프트에 포함된 예시들:
- ❌ WRONG / ✅ CORRECT 패턴 반복
- 실제 위반 사례 명시 ("Next.js App Router", "## Implementation Notes")
- Detection Questions (5개 질문으로 이미지 역할 판단)
```

**가설 3: 단계별 프로토콜 제공**
```
- Layout Direction: STEP 1 → STEP 2 → STEP 3
- Image Role: Background vs Content → Detection Questions → Test
- Grid Layout: Indicators → Critical Check → Document
```

### 3단계: 실제 효과 vs 프롬프트 길이 분석

| 섹션 | 줄 수 | 필요성 평가 | 비고 |
|------|-------|------------|------|
| **Core Principles** | 30 | ✅ 필수 | 근본 원칙 |
| **Layout Direction Analysis** | 80 | ⚠️ 검증 필요 | Technology 오류 해결용 |
| **Image Role Detection** | 50 | ⚠️ 검증 필요 | "bg-* = background" 방지 |
| **Grid Layout Documentation** | 40 | ⚠️ 검증 필요 | Token 7장 배치 정확도 |
| **Section Header Layout** | 30 | ⚠️ 검증 필요 | 필요성 불명확 |
| **STRICTLY FORBIDDEN** | 70 | ✅ 필요 (축소 가능) | Implementation 방지 핵심 |
| **Quality Checklist** | 30 | ✅ 필수 | 제출 전 검증 |

**총평**:
- ✅ 필수: ~130줄
- ⚠️ 검증 필요: ~200줄
- ❌ 중복/불필요: ~70줄 (예상)

---

## 🎯 올바른 리팩토링 프로세스

### Phase 1: 효과성 검증 (먼저!)

**실험 설계**:
```
1. 현재 프롬프트 (404줄, 9d967eb)로 Design Job 재실행
   → ui-spec.md 결과 확인
   → Technology 레이아웃 정확? (Direction Analysis 효과)
   → Implementation Notes 제거? (STRICTLY FORBIDDEN 효과)

2. 결과 분석
   → 6/7 섹션 정확 → 7/7 섹션 정확? (개선 효과 측정)
   → 어떤 섹션이 여전히 문제?
   → 프롬프트의 어느 부분이 작동했는가?
```

### Phase 2: 불필요한 부분 식별

**기준**:
```
각 섹션에 대해:
1. 이 섹션을 제거하면 어떤 문제가 재발하는가?
2. 이 섹션이 실제로 LLM 행동을 바꿨는가?
3. 더 짧게 표현 가능한가?
```

**예시**:
```markdown
# Before (80줄)
────────────────────────────────────────────────────────────────
## 🚨 MANDATORY: PRIMARY AXIS DETERMINATION
────────────────────────────────────────────────────────────────

**Analysis Protocol:**
1. **Measure relative spacing...**
2. **Identify alignment pattern...**
3. **Verify consistency...**

**Forbidden Inference Patterns:**
❌ Count-based assumption...
❌ Semantic assumption...

# After (20줄, 축소 가능?)
## Layout Direction

**Principle**: Measure spacing, don't infer from count.

**Protocol**:
1. Vertical gap vs horizontal gap → Primary axis
2. Pattern: Horizontal (columns) or Vertical (alignment)
3. Document explicitly

**Forbidden**: "N items → N columns"
```

### Phase 3: 원칙 기반 재작성

**목표 줄 수**: 150~200줄 (현재 404줄의 50%)

**구조**:
```markdown
## Core Principles (5개, ~60줄)
1. Specification, Not Implementation
2. Token-First
3. Observation Over Inference
4. Platform-Agnostic Language
5. Image Role Clarity

## Analysis Protocols (3개, ~60줄)
1. Layout Direction (간결화)
2. Grid Structure (간결화)
3. Component States

## Quality Gates (~30줄)
- Pre-submission checklist
- Common mistakes

## Examples (~40줄)
- ✅/❌ pairs (핵심만)
```

---

## 📊 실험 계획

### Experiment 1: 현재 프롬프트 효과 측정

**목적**: 404줄이 정말 필요한지 검증

**방법**:
```bash
cd /Users/probe/dev/ant-workspaces/to.nexus/probe/ant-ogf/features/uidoc-test
ant design --directive "디자인을 다시 시작해라"
```

**측정 지표**:
1. Technology 레이아웃: Vertical (Zigzag) 정확도
2. Implementation Notes: 생성 여부 (있으면 ❌)
3. Token 참조: Raw value 사용 비율
4. Framework 언급: 횟수 (0회여야 함)

**결과 예측**:
- Best Case: 7/7 섹션 정확, Implementation 없음 → 404줄 효과 입증
- Worst Case: 여전히 6/7, Implementation 있음 → 404줄도 불충분

### Experiment 2: 축소 프롬프트 비교

**조건**: Experiment 1 결과가 Best Case일 때만 진행

**방법**:
1. 핵심만 남긴 150줄 버전 작성
2. 동일한 Design Job 재실행
3. 결과 비교

**성공 기준**:
- 150줄 버전도 7/7 정확도 달성
- Implementation Notes 여전히 없음
- **실패 시**: 404줄 유지 또는 점진적 축소

---

## ✅ 결론 및 권장사항

### 즉각 실행 (Phase 1)

**DO**:
1. ✅ 현재 프롬프트 (404줄)로 Design Job 재실행
2. ✅ 결과 정확도 측정
3. ✅ 어떤 섹션이 효과적이었는지 분석

**DON'T**:
1. ❌ 검증 없이 즉시 축소
2. ❌ "400줄 = 나쁨" 가정
3. ❌ 원칙만 남기고 전부 삭제

### 장기 방향 (Phase 2-3)

**IF** 404줄이 효과적:
- 점진적 축소 (10% 단위)
- 각 축소 후 재검증
- 목표: 200~250줄 (효과 유지 하에)

**IF** 404줄도 불충분:
- 더 강화 (예시 추가)
- 또는 다른 접근법 (Rules 분리, Few-shot examples)

---

## 🎓 교훈

### 사용자가 옳았다
> "무작정 수정한건 아닌가?"

**Yes.** 검증 없이 축소 시도는 위험.

### 올바른 프로세스
```
1. 현재 상태 측정 (Baseline)
2. 변경 (Treatment)
3. 효과 측정 (Outcome)
4. 비교 (Baseline vs Outcome)
```

### 프롬프트 길이에 대한 통찰
```
길이 자체는 문제가 아니다.
문제는:
- 중복인가?
- 불필요한가?
- 더 간결하게 표현 가능한가?
- 실제로 LLM 행동을 바꾸는가?

이것은 실험으로만 알 수 있다.
```

---

**Next Step**: Design Job 재실행 → 404줄 효과 검증 → 데이터 기반 리팩토링 결정
