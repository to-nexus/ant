# Design Job ui-spec.md 생성 실패 근본 원인 분석

**날짜**: 2026-01-10  
**세션**: mk828f7kt444uu  
**로그**: architect-design-2026-01-10T08-45-39-997Z.log  
**프롬프트**: 수정된 356줄 버전 (강제 메커니즘 추가)

---

## 🚨 심각한 문제 발견

### 증상

```
design.json:
- ui-spec task: completed: true ✅
- elapsedTime: 11178ms
- tokenUsage: 16196 total

실제:
- ui-spec.md 파일: 생성 안 됨 ❌
```

**태스크는 "완료"로 표시되었지만, 파일이 생성되지 않음!**

---

## 📊 로그 분석

### 1. ui-spec 태스크 실행 흐름

```log
Line 578: 📋 Processing task: "Generate UI Specification"
Line 595: 📝 [DocGen] Starting document generation...
Line 597: 🎨 [DocGen] Building UI Design prompt for task: ui-spec

Line 607: 🔥 [API CALL] messages=1 tools=8 thinking=true
Line 608: 💰 [CACHE] create=4522
Line 609: 🔧 [DocGen] Tool call detected: list_reference_images

--- Tool 실행 ---

Line 646: 📝 [DocGen] Starting document generation... (2차)
Line 648: 🎨 [DocGen] UI Design continuing with existing conversation (3 messages)

Line 657: 🔥 [API CALL] messages=3 tools=8 thinking=false
Line 658: 💰 [CACHE] create=4499
Line 660: [XMLStreamParser] 🔚 Flushing 136 chars: "Perfect! I can see there's 1 full screen reference..."

Line 665: ✅ [DocGen] XML streaming complete (0 files generated, 0 tool calls pending)
Line 667: Tokens: 8065 total (8029 in, 36 out)
                            ^^^^^^ 겨우 36 토큰 출력!

Line 669: ✅ Task "Generate UI Specification" completed in 11s!
```

---

## 🎯 근본 원인

### LLM이 텍스트만 출력하고 파일 생성 없이 종료

**2차 LLM 호출 결과**:
```
Input: 8029 tokens
Output: 36 tokens  ← 문제!

출력 내용:
"Perfect! I can see there's 1 full screen reference and 2 component snapshots. Let me now load and analyze the main desktop screen first."
```

**LLM이 다음에 할 일을 말하고 멈췄습니다!**

---

## ❓ 왜 멈췄는가?

### 가설 1: 이미지 로딩 실패 (파일 크기)

```log
Line 621-622 (ui-tokens, ui-assets 생성 시):
"I see the main screen image is too large to load."
```

**Desktop 2560 +.png**가 너무 커서 로드 실패 → LLM이 할 수 없다고 판단?

---

### 가설 2: PRE-SUBMISSION CHECK가 역효과

**수정된 프롬프트 (356줄)**:
```markdown
## 🔍 PRE-SUBMISSION MANDATORY CHECK

**CRITICAL**: You MUST run this self-check BEFORE submitting.

Step 1: Section Count Verification
Step 2: Forbidden Content Scan
Step 3: Token Reference Verification
Step 4: Platform-Agnostic Check
Step 5: Final Verification

⚠️ ONLY AFTER ALL CHECKS PASS → Submit
```

**LLM 사고 과정 추정**:
```
1. list_reference_images 실행 ✅
2. "Let me load the main screen" (텍스트 출력)
3. 프롬프트 확인: "ONLY AFTER ALL CHECKS PASS → Submit"
4. 이미지를 아직 로드 안 했음 → 체크 못 함
5. → 제출하면 안 됨 → 멈춤
```

**역설적 상황**: 강제 체크가 너무 강해서 LLM이 **아무것도 안 하고 멈춤**!

---

### 가설 3: "Next Steps" 지시 부족

**uiDesignPrompt.ts (Line 163-180)**:
```typescript
// ✅ 5. Add next step instruction after tool call (CRITICAL FIX)
if (task?.id === 'ui-spec') {
  const hasDiscoveredImages = state.uiReferences?.screens?.length || ...;
  
  if (hasDiscoveredImages) {
    content.push({
      type: 'text',
      text: `\n\n# Next Steps

You have discovered reference images. Now proceed to Analysis phase:

1. Use read_reference_image tool
2. Analyze layout
3. Generate ui-spec.md

⚠️ Do NOT stop after discovering images.`
    });
  }
}
```

**문제**: 이 지시는 **Fresh Prompt**에만 추가됨!

**실제 호출**:
```typescript
Line 648: UI Design continuing with existing conversation (3 messages)
          → buildUiDesignFreshPrompt() 호출
          → Next Steps 주입 ✅

하지만 LLM은 이미지 발견 후:
- "Let me load the main screen" 출력
- 36 토큰만 출력하고 멈춤
```

---

## 🔍 세부 분석

### LLM 응답 타임라인

**1차 LLM 호출** (Line 607-616):
```
Input: 7810 tokens (프롬프트 + PRD + ui-tokens + ui-assets)
Output: 321 tokens
Thinking: enabled
Tool call: list_reference_images ✅

결과: Tool call 정상
```

**Tool 실행** (Line 618-642):
```
list_reference_images() 성공
→ 3개 파일 발견 (screens: 1, components: 2)
```

**2차 LLM 호출** (Line 646-665):
```
Input: 8029 tokens (Fresh prompt + history)
Output: 36 tokens ← 문제!
Thinking: disabled (after tool call)

출력:
"Perfect! I can see there's 1 full screen reference and 2 component snapshots. 
 Let me now load and analyze the main desktop screen first."

Tool call: 없음 ❌
File generation: 없음 ❌
```

**LLM이 멈춘 이유**:
1. ✅ 이미지 발견했음
2. ✅ "다음 할 일" 명시 ("Let me load...")
3. ❌ 하지만 실제로 **안 함**
4. ❌ 다음 tool call 없음
5. ❌ 파일 생성 없음

---

## 💡 근본 원인 확정

### 원인 1: 이미지 로딩 실패 (Desktop 2560 +.png 크기)

**증거**:
```
ui-tokens, ui-assets 생성 시:
"I see the main screen image is too large to load."
→ Component 이미지로 대체 분석

ui-spec 생성 시:
"Let me load the main desktop screen first." → 멈춤
```

**Desktop 2560 +.png**:
- 너무 큰 파일
- Anthropic API 이미지 크기 제한 초과?
- LLM이 로드하려다 실패 → 포기

---

### 원인 2: PRE-SUBMISSION CHECK의 과도한 제약

**문제**:
```markdown
## 🔍 PRE-SUBMISSION MANDATORY CHECK

Step 1: Section Count Verification
...
Step 5: Final Verification

⚠️ ONLY AFTER ALL CHECKS PASS → Submit
```

**LLM 해석**:
```
"이미지를 분석해야 ui-spec를 작성할 수 있음
 → 이미지 로드 시도
 → 실패
 → 분석 불가
 → 체크 통과 불가
 → 제출 불가
 → 멈춤"
```

**역효과**: 강제 체크가 너무 엄격해서 **생성 자체를 막음**!

---

### 원인 3: Tool Loop 종료 조건 문제

**Code Job vs Design Job**:

**Code Job** (정상 동작):
```typescript
// Plan → CodeGen 루프
while (hasToolCalls || !taskComplete) {
  if (hasToolCalls) → tool.ts 실행
  else if (!taskComplete) → codeGen.ts 재실행
}
```

**Design Job** (문제):
```typescript
// DocGen → Tool 루프
if (hasToolCalls) → tool.ts 실행 → docGen.ts 재실행
else → Learn (종료)

문제:
- 2차 docGen 호출 시 tool call 없음
- hasToolCalls = false
- → 즉시 Learn으로 종료
- → 파일 생성 기회 없음
```

---

## 📊 비교: ui-tokens vs ui-assets vs ui-spec

### ui-tokens (성공)

```
1차 LLM: Tool call (list_reference_images, read_reference_image) × 3회
2차 LLM: Tool call (read_reference_image) × 2회
3차 LLM: 파일 생성 ✅

총 출력: 3295 tokens
파일: ui-tokens.md (7150 chars)
```

### ui-assets (성공)

```
1차 LLM: Tool call (list_assets)
2차 LLM: Tool call (list_reference_images)
3차 LLM: Tool call (read_reference_image) × 2회
4차 LLM: 파일 생성 ✅

총 출력: 3910 tokens
파일: ui-assets.md (10706 chars)
```

### ui-spec (실패)

```
1차 LLM: Tool call (list_reference_images)
2차 LLM: 텍스트만 출력 (36 tokens) → 멈춤 ❌

총 출력: 357 tokens
파일: 없음 ❌
```

**차이점**:
- ui-tokens, ui-assets: 이미지를 **component** 파일로 분석 (작은 파일)
- ui-spec: **Desktop 2560 +.png** 로드 시도 → 실패 → 멈춤

---

## 🎯 해결 방안

### Option A: 이미지 크기 제한 우회

**방법 1**: Desktop 이미지 압축
```bash
# 2560px 이미지를 1920px로 리사이즈
magick "Desktop 2560 +.png" -resize 1920x1080 "Desktop-1920.png"
```

**방법 2**: 프롬프트에 이미지 로딩 전략 명시
```markdown
## Image Loading Strategy

If main screen image fails to load (file too large):
1. Use component screenshots instead
2. Infer full layout from component patterns
3. Generate ui-spec.md based on available images

DO NOT stop if main screen fails. Continue with available resources.
```

---

### Option B: PRE-SUBMISSION CHECK 완화

**현재 (너무 엄격)**:
```markdown
⚠️ ONLY AFTER ALL CHECKS PASS → Submit
```

**수정 (유연)**:
```markdown
⚠️ Run these checks BEFORE submitting. Fix any issues found, then submit.

If you cannot complete analysis due to technical limitations (e.g., image load failure):
- Generate ui-spec.md based on available information
- Document limitations in comments
- DO NOT stop without generating the document
```

---

### Option C: Tool Loop 강제 계속

**uiDesignPrompt.ts 수정**:
```typescript
// Line 163-180: Next Steps 지시 강화
if (task?.id === 'ui-spec') {
  content.push({
    type: 'text',
    text: `\n\n# CRITICAL: Continue Until Document Generated

You MUST generate ui-spec.md in this turn.

If main screen image fails to load:
1. Use component screenshots (card_back.png, example_mouse_hover.png)
2. Infer layout from available images
3. Generate ui-spec.md with available information

DO NOT output text-only responses. You MUST:
- Use <file path="outputs/design/ui-spec.md"> tag
- Generate complete ui-spec.md document
- This is MANDATORY. Task is NOT complete without the file.`
  });
}
```

---

### Option D: Desktop 이미지 로딩 실패 시 자동 폴백

**uiDesignPrompt.ts 로직 추가**:
```typescript
// Read main screen, fallback to components if fails
const mainScreen = "inputs/references/screens/Desktop 2560 +.png";
const componentImages = [
  "inputs/references/components/card_back.png",
  "inputs/references/components/example_mouse_hover.png"
];

// Add fallback instruction
content.push({
  type: 'text',
  text: `## Image Loading Instructions

Primary: Load ${mainScreen}
Fallback: If main screen fails, use component images: ${componentImages.join(', ')}

CRITICAL: Generate ui-spec.md regardless of which images you can load.`
});
```

---

## 🎓 학습 포인트

### 1. 강제 메커니즘의 역효과

```
의도: "체크 통과 후 제출" → 품질 보장
결과: "체크 불가 → 제출 불가" → 생성 자체 중단

교훈: 강제 규칙은 "실패 시 대안"도 제공해야 함
```

### 2. Tool Loop의 중요성

```
Code Job: 명시적 루프 제어 (hasToolCalls, taskComplete)
Design Job: 암묵적 종료 (tool call 없으면 즉시 종료)

교훈: 파일 생성이 필수인 경우, 명시적 완료 조건 필요
```

### 3. 이미지 크기 제한

```
Component 이미지 (작음): 로드 성공 → 작업 완료
Desktop 이미지 (큼): 로드 실패 → 작업 중단

교훈: 대용량 이미지는 사전 압축 또는 폴백 전략 필수
```

---

## 📋 즉시 조치 사항

### 1. Desktop 이미지 압축 (임시 해결)

```bash
cd /Users/probe/dev/ant-workspaces/to.nexus/probe/ant-ogf/features/uidoc-test/inputs/references/screens
magick "Desktop 2560 +.png" -resize 1920x1080 -quality 85 "Desktop-1920.png"
```

### 2. 프롬프트 수정 (근본 해결)

**ui-spec-guide.md에 추가**:
```markdown
## ⚠️ Technical Limitations Handling

If you encounter technical limitations (e.g., image load failure, file size):

1. **Continue with available resources**
   - Use component screenshots if main screen fails
   - Infer layout from partial information
   
2. **Generate document anyway**
   - DO NOT stop without generating ui-spec.md
   - Document limitations as comments if needed
   
3. **This is MANDATORY**
   - Task is NOT complete until <file> tag is submitted
   - "I cannot proceed" is NOT acceptable

**Remember**: Partial specification is better than no specification.
```

### 3. uiDesignPrompt.ts 강화

```typescript
// Explicit file generation mandate for ui-spec
if (task?.id === 'ui-spec' && hasDiscoveredImages) {
  content.push({
    type: 'text',
    text: `\n\n🚨 CRITICAL MANDATE

You MUST generate ui-spec.md in this session.

If image loading fails:
- Use available component images
- Infer from PRD and previous documents
- Generate with available information

DO NOT stop without <file path="outputs/design/ui-spec.md"> tag.
Task completion requires the file, not just text output.`
  });
}
```

---

## 🎯 다음 단계

**Option 1**: 이미지 압축 후 재실행 (빠름)
**Option 2**: 프롬프트 수정 후 재실행 (근본 해결)
**Option 3**: 둘 다 (권장)

어떻게 진행할까요?
