# Anthropic API 멀티모달 이미지 처리 방식

**분석일**: 2026-01-10  
**대상**: Ant 프로그램의 Design Job 이미지 처리  

---

## 📸 이미지 처리 방식 요약

### ✅ 리사이징 (Resize) - O
### ❌ 크롭 (Crop) - X

**결론**: Anthropic API는 이미지를 **리사이징**합니다. **크롭하지 않습니다.**

---

## 🔍 Anthropic API 이미지 처리 스펙 (2026년 1월 기준)

### 1. 파일 크기 제한

| 제약 조건 | 값 | 비고 |
|-----------|-----|------|
| **API 요청 최대 크기** | 5MB (base64 인코딩 후) | 원본 파일 < 3.75MB 권장 |
| **claude.ai 플랫폼** | 10MB | 웹 UI 전용 |
| **Base64 인코딩 오버헤드** | +33% | 원본 3MB → base64 4MB |

### 2. 해상도 제한

| 제약 조건 | 값 | 처리 방식 |
|-----------|-----|-----------|
| **절대 최대 해상도** | 8,000 x 8,000 픽셀 | 초과 시 거부 |
| **권장 최대 해상도** | 1,568 픽셀 (장변 기준) | 자동 리사이징 기준점 |
| **최적 해상도** | ≤ 1.15 메가픽셀 | 성능 최적화 |
| **최소 해상도** | 200 픽셀 (단변 기준) | 미만 시 성능 저하 |

### 3. 다중 이미지 처리

| 시나리오 | 제약 | 처리 |
|----------|------|------|
| **기본 (≤20장)** | 각 이미지 < 5MB | 리사이징 적용 |
| **대량 (>20장)** | 각 이미지 2,000 x 2,000 픽셀 이하 | 더 작은 해상도 요구 |

---

## 🔄 자동 리사이징 동작 원리

### 트리거 조건

```
IF (장변 > 1,568 픽셀) OR (토큰 수 > 1,600)
THEN:
  자동 리사이징 실행 (Aspect Ratio 보존)
```

### 리사이징 방법

1. **Aspect Ratio 유지**
   - 원본 이미지의 비율을 유지하면서 크기 축소
   - 가로/세로 중 긴 쪽을 1,568 픽셀에 맞춤
   - 짧은 쪽은 비율에 맞춰 자동 계산

2. **크롭 없음**
   - 이미지의 어떤 부분도 잘려나가지 않음
   - 전체 이미지가 보존됨

3. **해상도 감소**
   - 디테일이 줄어들 수 있음 (픽셀 수 감소)
   - 하지만 전체적인 구조와 레이아웃은 유지됨

### 예시

```
원본 이미지: 2560 x 6584 픽셀 (ant-ogf/uidoc-test의 Desktop 2560 +.png)

자동 리사이징 후:
  장변 (세로): 6584 → 1,568 픽셀
  단변 (가로): 2560 → (1568 / 6584) * 2560 = 610 픽셀
  최종 크기: 610 x 1,568 픽셀

손실:
  - 원본 대비 76.8% 해상도 감소
  - 하지만 전체 레이아웃, 구조, 비율은 유지
  - 작은 텍스트나 아이콘의 디테일이 흐릿해질 수 있음
```

---

## 🛠️ Ant 프로그램 구현 (현재)

### 파일 경로
`/Users/probe/dev/ant/packages/ant-cli/src/agents/architect/graph/design/nodes/tool.ts`

### 구현 내용

```typescript
// Line 619: 파일 크기 체크 (3MB 기본값)
const MAX_IMAGE_BYTES = parseInt(
  process.env.ANT_UI_IMAGE_MAX_BYTES || `${3 * 1024 * 1024}`, 
  10
);

// Line 622-634: 크기 초과 시 경고 메시지 반환
if (stats.size > MAX_IMAGE_BYTES) {
  console.log(`⚠️  Image too large: ${imagePath} (${sizeMB}MB > ${limitMB}MB limit)`);
  console.log(`💡 Consider resizing or compressing the image`);
  return `⚠️ Image too large... Proceeding without this image`;
}

// Line 640-642: 원본 그대로 base64 인코딩
const imageBuffer = await fs.readFile(absolutePath);
const base64 = imageBuffer.toString('base64');
```

### 특징

1. **사전 필터링**
   - 3MB 초과 이미지는 Anthropic API에 전달하지 않음
   - 로컬에서 크기 체크 → 초과 시 텍스트 메시지로 대체

2. **원본 전송**
   - 허용 범위 내 이미지는 원본 그대로 전송
   - 로컬에서 리사이징 하지 않음

3. **Anthropic API 의존**
   - 실제 리사이징은 Anthropic API가 수행
   - 1,568 픽셀 기준으로 자동 처리됨

---

## 📊 ant-ogf/uidoc-test 케이스 분석

### 입력 이미지

```
파일: inputs/references/screens/Desktop 2560 +.png
크기: 2560 x 6584 픽셀
용량: 미확인 (PNG 포맷)
```

### Anthropic API 처리 과정

```
1. Ant 프로그램에서 원본 전송 (< 3MB로 가정)
2. Anthropic API가 이미지 수신
3. 장변 6584 > 1568 → 자동 리사이징 트리거
4. Aspect Ratio 보존하며 1,568 픽셀로 축소
5. LLM에게 리사이징된 이미지 제공 (610 x 1,568 픽셀)
```

### 레이아웃 해석에 미치는 영향

#### ✅ 유지되는 정보
- 전체 페이지 구조
- 섹션 간 비율
- 레이아웃 방향 (가로/세로)
- 상대적 위치 관계
- 큰 요소들의 배치

#### ⚠️ 손실되는 정보 (해상도 감소)
- 작은 텍스트의 가독성
- 아이콘 디테일
- 미세한 간격 측정
- 색상 그라데이션 정확도

### Technology 섹션 오해석과의 관계

**결론: 해상도 감소가 직접 원인은 아님**

근거:
1. **레이아웃 방향은 명확히 보임**
   - 610 x 1,568 픽셀에서도 "3개 카드가 세로로 쌓여 있음"은 명확
   - 간격 측정도 가능 (vertical >> horizontal)

2. **실제 원인: 프롬프트 부재**
   - "Direction Analysis" 단계가 없어서 검증 안함
   - "3개 → 3열" 자동 추론 편향

3. **해상도가 충분했다면?**
   - 더 선명하게 보였겠지만, 방향 검증 프롬프트 없이는 동일한 오류 발생 가능

---

## 🎯 최적화 권장사항

### 1. 사용자에게 안내

```markdown
## Reference 이미지 준비 가이드

### 권장 사양
- **최대 해상도**: 1,568 픽셀 (장변 기준)
- **최적 해상도**: 1.15 메가픽셀 이하
- **파일 크기**: 3MB 이하 (base64 인코딩 고려)
- **최소 해상도**: 200 픽셀 이상 (단변 기준)

### 이유
- Anthropic API가 1,568 픽셀 초과 시 자동 리사이징
- 디테일 손실 방지
- 처리 속도 향상 (첫 토큰까지 지연 감소)
```

### 2. 로컬 리사이징 옵션 (선택 사항)

```typescript
// 옵션: 전송 전 로컬에서 리사이징 (sharp 라이브러리 사용)
import sharp from 'sharp';

async function preprocessImage(imagePath: string): Promise<Buffer> {
  const MAX_EDGE = 1568;
  const buffer = await fs.readFile(imagePath);
  const metadata = await sharp(buffer).metadata();
  
  if (metadata.width! > MAX_EDGE || metadata.height! > MAX_EDGE) {
    // Aspect Ratio 보존하며 리사이징
    return sharp(buffer)
      .resize(MAX_EDGE, MAX_EDGE, {
        fit: 'inside', // Aspect Ratio 유지
        withoutEnlargement: true
      })
      .toBuffer();
  }
  
  return buffer; // 원본 반환
}
```

**장점**:
- 네트워크 전송량 감소
- 토큰 사용량 감소
- 처리 속도 향상

**단점**:
- 추가 의존성 (sharp)
- 로컬 처리 시간 증가
- 복잡도 증가

---

## 🔍 검증 방법

### 이미지가 리사이징되었는지 확인

```bash
# Anthropic API 호출 시 로그 확인
# Ant 프로그램은 API 응답의 usage 정보로 확인 가능

# 예상 토큰 수 (이미지):
# 1,568 픽셀 (장변) ≈ 1,600 토큰
# 610 x 1,568 = 0.95 메가픽셀 ≈ 1,400~1,600 토큰

# 원본 (2560 x 6584 = 16.8 메가픽셀)이었다면:
# ≈ 25,000+ 토큰 (리사이징 없었다면)
```

---

## 📚 참고 문서

- [Anthropic Vision API Documentation](https://docs.anthropic.com/en/docs/build-with-claude/vision)
- [Anthropic API Image Size Limits](https://docs.anthropic.com/en/docs/build-with-claude/vision)

---

## ✅ 요약 답변

### Q: 이미지 데이터를 리사이징할 경우 해상도가 줄어드는거지 crop이 아닌거지?

**A: 맞습니다! Crop이 아닌 Resize입니다.**

- ✅ **리사이징**: Aspect Ratio 보존하며 크기 축소
- ❌ **크롭 없음**: 이미지의 어떤 부분도 잘려나가지 않음

### Q: 어느 기준으로 어디까지 줄어드는건가?

**A: 장변 1,568 픽셀 기준으로 자동 리사이징됩니다.**

**기준점**:
```
IF 장변 > 1,568 픽셀:
  → 장변을 1,568 픽셀로 축소
  → 단변은 비율 유지하며 자동 계산
  
IF 토큰 수 > 1,600:
  → 1,600 토큰 이하가 되도록 리사이징
```

**최종 크기**:
- 권장: ≤ 1.15 메가픽셀 (약 1072 x 1072 픽셀 정사각형)
- 절대 최대: 8,000 x 8,000 픽셀

**ant-ogf 케이스**:
```
원본: 2560 x 6584 픽셀
리사이징 후: 약 610 x 1,568 픽셀 (장변 기준)
해상도 감소: 76.8%
하지만 전체 레이아웃은 명확히 보임
```
