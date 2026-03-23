# Plan: ANT 코드잡 프롬프트 개선 — 3가지 결함 수정

## Context

prediction-fe 코드잡 결과물에서 3가지 체계적 결함 발견. 모두 프롬프트 가이드라인 부재/약점이 원인.

| 결함 | 현상 | 근본 원인 |
|------|------|----------|
| A: 토큰 키 이중 접두사 | fontSize 키 `text-medium-xs` → 클래스 `text-text-medium-xs` | 디자인/코드 프롬프트에 유틸리티 접두사 충돌 경고 없음 |
| B: SVG 하드코딩 색상 | `stroke="white"` → 라이트 모드에서 불가시 | 에셋/코드 프롬프트에 SVG 테마 가이드 없음 |
| C: Preview 에셋 전부 깨짐 | 모든 이미지 broken image | LLM이 (1) bare `<img>` 사용 (basePath 미적용) (2) Next.js Image 최적화 미비활성화 |

결함 A, B는 이미 수정 완료(FPOP 준수). 결함 C를 추가 수정한다.

---

## 이미 완료된 작업 (커밋 대상)

### 결함 A: 토큰 키 접두사 충돌 — FPOP 준수 버전
- `ui-tokens-guide.md`: CSS utility framework 범용 원칙 (Tailwind 미특정)
- `base.md`: design-system 태스크 블록(priority 190-199)에 blind spot 추가
- `browser/rules.md`: 이전 Tailwind 특정 블록 제거

### 결함 B: SVG 테마 호환성 — 브라우저 범용 원칙
- `ui-assets-guide.md`: `themeAdaptation` 필드 가이드
- `browser/rules.md`: SVG Theme Compatibility 섹션

---

## 추가 작업: 결함 C — Preview 에셋 깨짐

### 근본 원인 분석

Preview server가 `NEXT_PUBLIC_BASE_PATH="/to.nexus--probe--prediction-fe--probe"`를 주입하면:

1. **bare `<img src="/icons/foo.svg">`** → basePath 미적용 → 브라우저가 `/icons/foo.svg` 요청 → 프록시가 전달 → Next.js가 basePath 컨텍스트에서 404 반환
2. **`<Image src="/icons/foo.svg" />`** → Next.js가 basePath 자동 적용 → BUT 이미지 최적화 엔드포인트 `/_next/image`가 프록시 통해 비정상 작동 → 깨짐

### 프롬프트 결함 위치

**`preview-setup.md:46-51`** (SSR Image Optimization 섹션):
```
**Constraint**: ... image optimization MUST be disabled.
**Observation Target**: Does the framework perform server-side image optimization?
If NOT observed, do NOT add any image optimization toggle.
```

"Constraint"와 "Observation Target"이 모순. Constraint는 "반드시 비활성화"라 하면서, Observation Target은 "감지되지 않으면 추가하지 마라"라 한다. Next.js는 기본으로 Image Optimization이 활성화되어 있으므로 LLM이 "관찰되지 않음"으로 판단하여 건너뛸 수 있다.

또한 **bare `<img>` 대신 프레임워크 Image 컴포넌트 사용** 규칙이 없다.

### 수정 내용

**파일: `packages/ant-cli/src/core/prompt/templates/code/base/injections/preview-setup.md`**

#### 수정 1: SSR Image Optimization 섹션 강화 (line 46-51)

기존:
```markdown
**Observation Target**: Does the framework perform server-side image optimization? If NOT observed, do NOT add any image optimization toggle.
```

변경:
```markdown
**Constraint**: Next.js performs image optimization by default (`<Image>` component routes through `/_next/image`). When `NEXT_PUBLIC_BASE_PATH` is set, add `images: { unoptimized: true }` to `next.config`. When absent, omit this setting (production uses optimization normally).
```

"Observation Target" 조건을 **Constraint**로 승격. Next.js를 명시적으로 지목하는 것은 이 파일이 이미 프레임워크별 설정 테이블(line 25-28)에 Next.js를 특정하고 있으므로 FPOP 위배가 아님.

#### 수정 2: Blind Spot에 Image 컴포넌트 사용 규칙 추가 (line 55-59)

기존 Blind Spot 리스트에 추가:
```markdown
- **Framework image component is EASILY SKIPPED.** Bare `<img>` tags do NOT receive basePath prefix. Use the framework's image component (Next.js `<Image>`, Nuxt `<NuxtImg>`) for ALL image references so that basePath is automatically applied. Reserve bare `<img>` only for external URLs.
```

---

## 수정 파일 요약 (전체)

| # | 파일 | 결함 | 상태 |
|---|------|------|------|
| 1 | `.../design/.../ui-tokens-guide.md` | A | ✅ 완료 |
| 2 | `.../code/.../browser/rules.md` | A+B | ✅ 완료 |
| 3 | `.../code/phases/execute/base.md` | A | ✅ 완료 |
| 4 | `.../design/.../ui-assets-guide.md` | B | ✅ 완료 |
| 5 | `.../code/base/injections/preview-setup.md` | C | 🔲 미완료 |

## 검증

1. `pnpm build:cli` — 빌드 통과
2. `pnpm test:cli` — 기존 테스트 통과
3. 수동 검증: 새 코드잡에서 Next.js 프로젝트 생성 시 (a) `next.config`에 `images.unoptimized` 조건부 설정, (b) bare `<img>` 대신 `<Image>` 사용 확인
