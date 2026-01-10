# Design Job ui-spec.md 생성 실패 진짜 근본 원인

**날짜**: 2026-01-10  
**세션**: mk828f7kt444uu  
**파일**: Desktop 2560 +.png (4.1MB)

---

## 🚨 진짜 문제

### Ant의 **과도하게 보수적인 3MB 제한**

```typescript
// tool.ts Line 618-619
// Using 3MB limit to be safe (Code job uses 2MB)
const MAX_IMAGE_BYTES = parseInt(
  process.env.ANT_UI_IMAGE_MAX_BYTES || `${3 * 1024 * 1024}`, 
  10
);

// Line 623-633: 3MB 초과 시 이미지를 로드하지 않고 텍스트 에러 메시지 반환
if (stats.size > MAX_IMAGE_BYTES) {
  return `⚠️ Image "${imagePath}" is too large (${sizeMB}MB). 
          Anthropic API limit is 5MB per image (base64 encoded). 
          Please resize or compress...`;
}
```

**실제 상황**:
```
Desktop 2560 +.png: 4.06MB
Ant 제한: 3MB
Anthropic API 제한: 5MB (base64)

결과:
- Ant가 4.06MB 이미지를 거부 ❌
- Anthropic은 받을 수 있었음 (4.06MB × 1.33 = 5.4MB < 실제 5MB) ⚠️
```

---

## 📊 상세 분석

### 1. Anthropic API의 실제 제한

| 제한 | 값 | 비고 |
|------|-----|------|
| API 요청 최대 | 5MB (base64) | 실제 제한 |
| 권장 원본 크기 | < 3.75MB | Base64 오버헤드 33% 고려 |
| Ant 설정 | 3MB | **과도하게 보수적** |

**계산**:
```
Desktop 2560 +.png: 4.06MB
Base64 인코딩 후: 4.06 × 1.33 = 5.4MB

문제: 5.4MB > 5MB (Anthropic 제한)
→ Anthropic도 거부할 것임 (Ant 판단 정확)
```

**하지만**: Anthropic은 **자동 리사이징** 기능이 있음!

---

### 2. Anthropic의 자동 리사이징

**공식 스펙** (MULTIMODAL_IMAGE_PROCESSING.md):
```
트리거 조건:
- 장변 > 1,568 픽셀 OR
- 토큰 수 > 1,600

처리:
1. 종횡비 유지하며 리사이징
2. 장변을 1,568px로 축소
3. 최종 토큰: ~1,600 tokens

예시:
- 2560 × 1440 이미지
  → 1,568 × 882로 자동 리사이징
  → API로 전송 전에 처리
```

**문제**: Ant는 이미지를 **API로 보내기 전**에 거부함  
→ Anthropic의 자동 리사이징 기회조차 없음!

---

### 3. 실제 로그 흐름

```log
Line 597: 🎨 [DocGen] Building UI Design prompt for task: ui-spec
Line 607: 🔥 [API CALL] messages=1 tools=8
Line 609: 🔧 [DocGen] Tool call detected: list_reference_images
          → 이미지 목록 확인 ✅

--- Tool 실행 ---

Line 646: 📝 [DocGen] Starting document generation (2차)
Line 648: 🎨 UI Design continuing with existing conversation (3 messages)
Line 657: 🔥 [API CALL] messages=3 tools=8

LLM 출력:
"Perfect! I can see there's 1 full screen reference and 2 component snapshots. 
 Let me now load and analyze the main desktop screen first."

Line 665: ✅ [DocGen] XML streaming complete (0 files, 0 tool calls)
          → LLM이 텍스트만 출력하고 tool call 안 함 ❌
          → 왜? 다음에 read_reference_image 하려고 했는데...
```

**의문**: LLM이 왜 read_reference_image tool call을 안 했나?

---

## ❓ LLM이 Tool Call을 안 한 이유

### 가설 A: 프롬프트의 "MANDATORY CHECK"가 제약

```markdown
## 🔍 PRE-SUBMISSION MANDATORY CHECK

Step 1: Section Count Verification
...
⚠️ ONLY AFTER ALL CHECKS PASS → Submit
```

**LLM 해석 가능성**:
```
"이미지를 분석해야 체크를 통과할 수 있음
 → 하지만 이미지 로드를 '말'만 하고 실제로 안 함
 → tool call 없이 텍스트만 출력
 → 왜? 프롬프트가 너무 복잡해서 혼란?"
```

---

### 가설 B: "Next Steps" 지시의 혼란

**uiDesignPrompt.ts (Line 169-177)**:
```typescript
content.push({
  type: 'text',
  text: `\n\n# Next Steps

You have discovered reference images. Now proceed to Analysis phase:

1. Use read_reference_image tool
2. Analyze layout
3. Generate ui-spec.md

⚠️ Do NOT stop after discovering images.`
});
```

**문제**: 이 지시는 `buildUiDesignFreshPrompt()`에만 있음  
→ 2차 LLM 호출 시 주입됨  
→ LLM이 읽었을 것임

**그런데 왜 tool call 안 했나?**

---

### 가설 C: LLM의 "Thinking" 비활성화 영향

```log
Line 607: 🔥 [API CALL] thinking=true (1차)
Line 657: 🔥 [API CALL] thinking=false (2차)
          ^^^^^^^^^^^^^ Tool call 후에는 Thinking 비활성화
```

**Code Job 패턴**:
```typescript
// docGen/index.ts Line 112
enableThinking: !isAfterToolCall
```

**이유**: Anthropic API가 tool call 후 thinking을 지원하지 않음

**영향**:
```
Thinking 없이:
- LLM이 계획을 세우지 못함?
- 즉흥적으로 텍스트만 출력?
- Tool call 판단 능력 저하?
```

---

## 🎯 진짜 근본 원인 (종합)

### 1. Ant의 3MB 제한은 합리적

```
Desktop 2560 +.png: 4.06MB
Base64: 5.4MB > 5MB (Anthropic 제한)
→ Ant가 거부한 것은 정상 ✅

하지만: Anthropic의 자동 리사이징 기회를 박탈
```

---

### 2. LLM이 Tool Call을 안 한 이유 (추정)

**복합적 원인**:

#### A. 프롬프트 과부하
```markdown
- MANDATORY OUTPUT STRUCTURE (44줄)
- PRE-SUBMISSION CHECK (56줄)
- CRITICAL MANDATE (명령형 언어)
+ Next Steps 지시
+ PRD
+ ui-tokens.md
+ ui-assets.md

총 프롬프트: ~2000줄 추정
```

→ LLM이 혼란스러워서 **텍스트만 출력**?

#### B. Thinking 비활성화
```
Tool call 후 thinking=false
→ LLM이 계획 세우기 어려움
→ 즉흥적 텍스트 출력?
```

#### C. "ONLY AFTER CHECKS PASS" 제약
```
LLM: "체크를 통과해야 제출 가능"
LLM: "이미지 분석이 필요"
LLM: "이미지 로드하려는데..."
LLM: "일단 텍스트로 '다음에 할 일' 설명"
LLM: → 멈춤 (tool call 안 함)
```

---

## 💡 해결 방안

### Option A: 3MB 제한 완화 (비권장)

```bash
# 환경변수 설정
export ANT_UI_IMAGE_MAX_BYTES=$((5 * 1024 * 1024))  # 5MB
```

**문제**:
- Base64 오버헤드로 여전히 Anthropic 제한 초과 가능
- Anthropic의 자동 리사이징도 5MB 전에 트리거 안 될 수 있음

---

### Option B: 이미지 사전 최적화 (권장)

```bash
cd inputs/references/screens
magick "Desktop 2560 +.png" \
  -resize 1920x1080 \
  -quality 85 \
  "Desktop-1920.png"

# 또는 1568px (Anthropic 권장)
magick "Desktop 2560 +.png" \
  -resize 1568x \
  -quality 90 \
  "Desktop-optimized.png"
```

**효과**:
```
2560 × 1440 (4.06MB) 
→ 1568 × 882 (~800KB)
→ Base64: ~1.06MB
→ 3MB 제한 통과 ✅
→ Anthropic도 리사이징 안 해도 됨 ✅
```

---

### Option C: Tool 강제 실행 프롬프트 추가

**uiDesignPrompt.ts 수정**:
```typescript
if (task?.id === 'ui-spec' && hasDiscoveredImages) {
  content.push({
    type: 'text',
    text: `\n\n🚨 CRITICAL: IMMEDIATE ACTION REQUIRED

You MUST now execute read_reference_image tool.

**Do NOT output explanatory text.**
**Do NOT say "Let me do X".**
**JUST CALL THE TOOL.**

If image fails to load:
- Try component images instead
- Generate ui-spec.md with available info
- DO NOT stop without generating the file

Next tool call: read_reference_image
Path: inputs/references/screens/Desktop 2560 +.png (or component if unavailable)

EXECUTE NOW.`
  });
}
```

---

### Option D: PRE-SUBMISSION CHECK 완화

**ui-spec-guide.md 수정**:
```markdown
## 🔍 PRE-SUBMISSION CHECK (Optional Guidelines)

These are quality guidelines. Run them if possible:

Step 1: Section count → Aim for 5 sections
Step 2: Framework names → Avoid if possible
...

⚠️ If you cannot complete all checks due to limitations:
- Generate ui-spec.md anyway
- Partial spec > No spec
- File generation is MANDATORY

The document MUST be generated regardless of check results.
```

---

## 🎓 학습

### 1. 보수적 제한의 양날

```
✅ 장점: API 오류 방지
❌ 단점: Anthropic 자동 리사이징 기회 박탈

교훈: 제한은 API의 실제 동작을 고려해야 함
```

### 2. 프롬프트 과부하

```
의도: 강제 메커니즘으로 품질 보장
결과: LLM 혼란 → 텍스트만 출력 → tool call 없음

교훈: 프롬프트는 명확하되 간결해야 함
```

### 3. Thinking의 중요성

```
Thinking 있음: 계획 → 실행
Thinking 없음: 즉흥 → 불완전

교훈: Tool call 시나리오에서 Thinking 전략 재고
```

---

## 📋 권장 조치

### 즉시 (임시 해결)

```bash
# 1. 이미지 최적화
cd /Users/probe/dev/ant-workspaces/to.nexus/probe/ant-ogf/features/uidoc-test/inputs/references/screens
magick "Desktop 2560 +.png" -resize 1568x -quality 90 "Desktop-optimized.png"
rm "Desktop 2560 +.png"
mv "Desktop-optimized.png" "Desktop 2560 +.png"

# 2. Design Job 재실행
cd ../../..
ant design
```

### 단기 (프롬프트 개선)

1. **PRE-SUBMISSION CHECK 완화**
   - "MANDATORY" → "Optional Guidelines"
   - "ONLY AFTER PASS" → "Generate anyway if checks fail"

2. **Tool 실행 강제 지시 추가**
   - "EXECUTE NOW" 명령
   - "No explanatory text" 금지

### 장기 (시스템 개선)

1. **Tool Loop 명시적 제어**
   - Code Job 패턴 도입
   - `taskComplete` 조건 명확화
   - Tool call 없으면 재시도 로직

2. **이미지 자동 최적화**
   - inputs/references 폴더 감시
   - 3MB 초과 이미지 자동 리사이즈
   - 최적화 완료 후 Job 실행

3. **Thinking 전략 재고**
   - Tool call 후에도 light thinking 허용?
   - 또는 Tool call 전략을 프롬프트에 명시

---

## 🎯 다음 단계

**권장**: 이미지 최적화 (빠르고 확실)

```bash
magick "Desktop 2560 +.png" -resize 1568x -quality 90 "Desktop-optimized.png"
```

이후 Design Job 재실행하면 정상 생성될 것으로 예상.

프롬프트 수정은 그 다음에 검증 후 적용.
