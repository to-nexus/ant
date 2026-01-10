# Design Job ui-spec.md 심각한 품질 문제 분석

**날짜**: 2026-01-10  
**파일**: ant-ogf/uidoc-test/outputs/design/ui-spec.md  
**생성 시간**: Jan 10 17:34:16 2026  
**프롬프트 수정 시간**: Jan 10 17:20:25 2026 (수정 후 생성!)

---

## 🚨 심각한 문제 발견

### 프롬프트를 수정했는데도 문제 내용이 포함됨!

**수정한 프롬프트 (237줄)**:
- ✅ "🚫 STRICTLY FORBIDDEN: Implementation Details"
- ✅ "Specification vs Verification" 원칙
- ✅ Framework 금지, Testing 금지

**하지만 생성된 ui-spec.md (1057줄)**:
- ❌ "## Technical Implementation Notes" (Line 958-1057)
- ❌ "Next.js App Router (Required)" (Line 960)
- ❌ "Tailwind CSS v3 Configuration" (Line 984)
- ❌ "## Testing Checklist" (Line 1061-1103)
- ❌ Framework 언급: 19회

---

## 📊 정량 분석

### 구현 세부사항 (Line 958-1057, 100줄)

**포함된 내용**:
```markdown
## Technical Implementation Notes

### Next.js App Router (Required)
- File Structure: app/layout.tsx, page.tsx, components/*.tsx
- SSR Considerations: Hydration, Image optimization

### Tailwind CSS v3 Configuration
- tailwind.config.js 전체 코드
- CSS Variables (globals.css) 전체 코드

### State Management
- Use React useState for...

### Third-Party Libraries
- framer-motion, react-intersection-observer
```

**문제**: 이건 **system-design.md** 영역!

---

### Testing/QA 내용 (Line 1061-1103, 43줄)

**포함된 내용**:
```markdown
## Testing Checklist

### Visual Testing
- [ ] All sections render correctly...

### Performance Testing
- [ ] Lighthouse score >90
- [ ] LCP <2.5s

### Cross-Browser Testing
- [ ] Chrome, Firefox, Safari, Edge
```

**문제**: 이건 **QA/Test Plan** 영역!

---

### Framework 언급 (19회)

```bash
주요 위치:
- Line 960: "Next.js App Router (Required)"
- Line 981: "Next.js <Image> component"
- Line 984: "Tailwind CSS v3 Configuration"
- Line 1049: "Use React useState"
- Line 1116: "Technical Stack: Next.js, Tailwind, TypeScript"
```

**문제**: Platform-agnostic 원칙 완전 위반!

---

## 🎯 근본 원인

### 왜 프롬프트가 작동하지 않았는가?

#### 가설: LLM의 "Helpful" 편향이 너무 강함

**증거**:
```
프롬프트: "NO implementation code"
LLM 사고: "하지만 개발자에게 도움이 될텐데..."
결과: Implementation Notes 추가

프롬프트: Forbidden sections 리스트
LLM: "알겠어. 근데 Testing은 유용하니까 추가하자"
결과: Testing Checklist 추가
```

**패턴**: LLM이 프롬프트를 "권장사항"으로 해석

---

## 🔧 해결 방안

### 1. 출력 형식 강제 (가장 강력)

```markdown
## MANDATORY OUTPUT STRUCTURE

Your ui-spec.md MUST contain ONLY these sections (in this order):

```
# ui-spec.md

## Overview
## Layout Structure  
## Component Specifications
## Responsive Behavior
## Accessibility Requirements

---
END OF DOCUMENT
```

**NO OTHER SECTIONS PERMITTED.**

Any section with "Implementation", "Testing", "Technical", "Browser Support" → FORBIDDEN.
```

### 2. Self-Validation 강제

```markdown
## BEFORE YOU RESPOND

Self-check your ui-spec.md:

□ Contains "Next.js", "React", "Tailwind", "Vue"? → DELETE those sections
□ Contains "## Testing" or "## Implementation"? → DELETE those sections  
□ Contains code blocks (`.tsx`, `module.exports`)? → DELETE those sections

**ONLY AFTER** passing all checks, submit your response.
```

### 3. 명시적 경고

```markdown
🚨 WARNING: LLMs want to be "helpful" by adding implementation/testing content.

**RESIST THIS.**

If you write "## Implementation Notes" or "## Testing" → You FAILED the task.
```

---

## 📈 프롬프트 개선 제안

### 현재 (237줄, 효과 없음)
```
✅ 원칙 명시
✅ Forbidden 리스트
❌ 강제력 없음
```

### 제안 (280줄, 강제력 강화)
```
✅ MANDATORY OUTPUT STRUCTURE
✅ Self-Validation
✅ 명시적 경고
✅ 기존 원칙 유지
```

**증가**: +43줄 (18% 증가)
**목표**: LLM이 규칙을 "권장"이 아닌 "명령"으로 인식

---

## 🔍 Footer 레이아웃 오류

### 실제 스크린샷
```
┌─────────────────────────────────────┐
│ © 2025 Opengame Foundation          │ ← 좌측
│ OPENGAME FOUNDATION        [↑]      │ ← 로고 좌측, 버튼 우측
└─────────────────────────────────────┘
```

### ui-spec.md 기술 (Line 769-785)
```
│     [Large Logo]           │ ← 중앙
│ © 2025 ... · Contact us    │ ← 중앙
│     [Back to Top ↑]        │ ← 중앙
```

**불일치**: 좌/우 배치 → 중앙 배치

**원인**: "Describe What You SEE" 원칙 위반

---

## 📊 전체 평가

### 품질 점수

| 항목 | 점수 | 평가 |
|------|------|------|
| 컴포넌트 명세 (1-770줄) | 90% | ✅ 우수 |
| Token 참조 (247회) | 100% | ✅ 완벽 |
| Layout 정확도 | 71% (5/7) | ⚠️ Technology, Footer 오류 |
| Platform-agnostic | 0% | ❌ Framework 19회 언급 |
| Spec vs Implementation | 0% | ❌ 100줄 구현 내용 |
| Spec vs Verification | 0% | ❌ 43줄 Testing 내용 |

**종합**: C+ (70점)

---

## 🎯 액션 아이템

### 즉시 필요

**1. 프롬프트 강제력 강화**
- MANDATORY OUTPUT STRUCTURE
- Self-Validation
- 명시적 경고

**2. Design Job 재실행**
- 강화된 프롬프트로 재생성
- 결과 비교

### 검증 지표

**성공 기준**:
```bash
grep -c "Next\.js\|React\|Tailwind" ui-spec.md
→ 0 (현재 19)

grep "## Testing\|## Implementation" ui-spec.md
→ No matches (현재 2개 섹션)

Section count: 5개만 (Overview, Layout, Components, Responsive, Accessibility)
→ 현재 11개 섹션
```

---

**다음 단계**: 프롬프트에 강제 메커니즘 추가할까요?
