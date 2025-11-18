# PRD — ANT Works AutoDev Landing Page (Frontend-Only)

본 문서는 ANT Works AutoDev 엔진이 자동으로 생성할 “프론트엔드 단일 랜딩 페이지”를 정의하기 위한 **개발용 PRD**이다.  
백엔드, 데이터베이스, 인증 등은 일체 포함되지 않는다.  
**시스템 디자인 → 컴포넌트 구조화 → 코드 생성 자동화를 위한 기준 문서**이다.

---

# 1. 목적 (Purpose)

AutoDev 엔진의 데모를 위해, **하나의 정적 랜딩 페이지를 자동 생성**하는 것을 목표로 한다.  
대표/투자자가 즉시 이해할 수 있는 시각적 구조를 만들기 위함이며,  
핵심 목적은 다음과 같다:

- AutoDev가 “요구사항 → UI 설계 → 컴포넌트 구조 → 코드 생성 → 페이지 완성” 흐름을 스스로 수행함을 증명
- 프론트엔드 단일 페이지 구성만으로 충분히 효과적인 데모 제공
- 복잡성 최소화 + 시각적 임팩트 극대화

---

# 2. 산출물 (Deliverable)

다음 조건을 만족하는 **단일 랜딩 페이지**:

- Next.js 또는 React 기반 단일 페이지
- TailwindCSS 기반 스타일링
- 반응형 UI (모바일/데스크톱)
- 모든 데이터는 하드코딩된 mock 데이터
- 코드가 *컴포넌트 단위로 분리된 형태*로 생성될 것
- 빌드 후 바로 클라우드에서 실행 가능한 상태

---

# 3. 페이지 섹션 구성 (Page Structure)

페이지는 아래 5개 섹션으로 구성한다.

## 3.1 Hero Section
**목적:** 제품 정체성을 가장 먼저 전달.

**구성 요소:**
- 메인 타이틀:  
  “AI가 개발 전체를 자동화합니다.”
- 서브 타이틀:  
  “설계 → 코드 → 테스트 → 배포까지 하나의 AutoDev 파이프라인으로.”
- CTA 버튼 2개:  
  - Get Early Access  
  - Watch Demo  
- 간단한 파이프라인/코드 애니메이션 (Lottie 또는 이미지 placeholder)
- 전체 레이아웃: 중앙 정렬 + 반응형

---

## 3.2 Key Values Section
**목적:** 제품 핵심 가치를 3개의 카드로 요약.

**카드 3개:**
1. **Full AutoDev**  
   - PRD → 구조 생성 → 코드 생성 → 테스트까지 자동화  
2. **Team & Workflow Ready**  
   - 작업 로그, 설계-코드 연결, 변경 이력 구조  
3. **Cloud-native**  
   - 워크스페이스, 복구/재시도, 클라우드 상 실행

**UI 요구사항:**  
- 3열 카드 (모바일에서는 1열)  
- 아이콘 + 타이틀 + 1~2줄 설명

---

## 3.3 Workflow Overview Section
**목적:** AutoDev의 개발 단계 흐름을 시각적으로 전달.

**단계 (5-step Timeline):**
1. Directive 입력
2. Architecture 자동 생성
3. Code 자동 생성
4. Validate (테스트/린트)
5. Preview & Deploy

**UI 요구사항:**  
- 가로 타임라인  
- 각 단계는 아이콘 + 1줄 텍스트  
- 클릭 시 강조 효과(Optional)

---

## 3.4 Comparison Section
**목적:** Cursor/Copilot 대비 ANT Works의 위치 명확화.

**비교 표(3열 또는 4열):**

| 기능 | Cursor | Copilot | ANT Works |
|------|--------|---------|-----------|
| 개발 범위 | 코드 편집 | 코드 보조 | **전체 파이프라인 자동화** |
| 설계 연동 | 없음 | 없음 | **설계 → 코드 자동 반영** |
| 워크플로우 | 없음 | 없음 | **태스크 기반 AutoDev Engine** |
| 배포 준비 | 수동 | 없음 | **자동 Preview/Deploy Ready** |

**UI 요구사항:**  
- 테이블 형태  
- ANT Works 열에 강조 스타일 적용

---

## 3.5 Signup Section
**목적:** 페이지 완성용 최소 CTA.

**구성 요소:**
- 제목: “Join Early Access”
- 이메일 입력 필드
- CTA 버튼 (“Request Access”)
- 입력값은 콘솔 로그로 처리 (실제 submit 없음)

**UI 요구사항:**  
- 중앙 정렬  
- 데스크탑/모바일 대응

---

# 4. 기술 요구사항 (Tech Requirements)

## 4.1 필수 기술
- Next.js (권장) 또는 React + Vite
- TypeScript 권장
- TailwindCSS
- React 컴포넌트 기반 구조화
- 반응형 레이아웃 (모바일/데스크탑)
- 다크모드 optional (CSS 변수 기반)

## 4.2 비필수 (이번 버전에서는 사용 안 함)
- API 연동
- 서버 기능
- DB
- 인증/보안
- 이벤트 트래킹
- 실제 이메일 제출 폼

---

# 5. 구조적 요구사항 (Structural Requirements)

AutoDev 엔진이 생성하기 쉽게 하기 위해 **다음 기준을 명확히 충족**해야 한다.

### 5.1 컴포넌트 단위 분리
추천 컴포넌트 구조:

