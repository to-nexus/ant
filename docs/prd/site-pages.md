# ANT Works Site Pages PRD

## Overview

ANT Works Site(`ant.crosstoken.io`)의 퍼블릭 마케팅 페이지 5개에 대한 제품 요구사항 문서.
각 페이지의 목적, 대상 사용자, 콘텐츠 구조, SEO 요구사항을 정의한다.

---

## 공통 요구사항

### SiteNavBar

```
[ANT Works 로고]  제품소개  Figma 연동  기술스택  요금제  다운로드  ──  [Sign In]  [Get Started]
```

- "Sign In" → `/app` (미인증 시 자동으로 OAuth 진행)
- "Get Started" → `/app` (동일, 시각적으로 Primary CTA)
- 현재 페이지에 해당하는 메뉴 하이라이트
- 스크롤 시 배경 블러 + 그림자 트랜지션
- 모바일: 햄버거 메뉴

### SiteFooter

- 좌측: ANT Works 로고 + 한 줄 소개
- 중앙: 페이지 링크 (제품소개, Figma 연동, 기술스택, 요금제, 다운로드)
- 우측: GitHub(공개 시), 이용약관, 개인정보처리방침
- 하단: © 2025 CrossToken. All rights reserved.

### SEO / OG

모든 페이지에 다음을 설정한다 (Next.js `metadata` export):

- `title`: 페이지별 고유 타이틀
- `description`: 160자 이내 요약
- `og:title`, `og:description`, `og:image`: 링크 공유 미리보기용
- `og:type`: `website`
- `og:url`: canonical URL

### 디자인 원칙

- ANT Works 브랜드 컬러 기반 (현재 ant-ui의 다크 테마 계열)
- 어두운 배경 + 밝은 텍스트 (기존 WelcomePage 톤 유지)
- 필요 시 라이트 모드 토글 지원 (후순위)
- 모바일 반응형 필수

---

## 1. 홈페이지 (`/`)

### 목적

ANT Works가 무엇인지 30초 안에 이해시키고, 가입 또는 다운로드로 전환한다.

### SEO

```
title: "ANT Works — AI 에이전트 기반 소프트웨어 개발 플랫폼"
description: "아이디어를 스펙으로, 스펙을 제품으로. AI 에이전트가 PRD 작성부터 설계, 코드 생성, 미리보기까지 전체 개발 사이클을 수행합니다."
```

### 콘텐츠 구조

#### Section 1: Hero

- **헤드라인**: "Ideas to Specs. Specs to Product."
- **서브헤드**: AI 에이전트가 PRD 작성부터 설계, 코드 생성, 실시간 미리보기까지 전체 개발 사이클을 수행합니다.
- **CTA 1** (Primary): "무료로 시작하기" → `/app`
- **CTA 2** (Secondary): "데스크탑 앱 다운로드" → `/download`
- **배경**: 기존 WelcomePage의 별/오브 애니메이션 재활용 가능

#### Section 2: 워크플로우 — "어떻게 동작하는가"

4단계 흐름을 시각적으로 보여준다. 각 단계에 아이콘 또는 짧은 GIF/스크린샷.

| 단계 | 에이전트 | 설명 |
|------|---------|------|
| **1. Plan** | Planner | 대화를 통해 아이디어를 PRD(제품 요구사항 문서)로 구체화합니다. 에이전트가 명확하지 않은 부분을 질문하고, 정제된 스펙을 작성합니다. |
| **2. Design** | Architect | PRD와 Figma 디자인(또는 레퍼런스 이미지)을 분석해 UI 토큰, 에셋, 컴포넌트 스펙 문서를 생성합니다. 시스템 설계(API 계약 등)도 포함됩니다. |
| **3. Code** | Architect | 설계 문서를 기반으로 실제 코드를 생성합니다. 빌드 실패 시 자동 진단 후 수정하며, 태스크를 병렬로 실행합니다. |
| **4. Preview** | — | 생성된 코드를 실시간으로 미리보기합니다. 브라우저에서 바로 결과를 확인하고, 피드백을 반영해 반복합니다. |

#### Section 3: 핵심 차별점 — 3개 카드

**카드 1: Figma 네이티브 연동**
> Figma 디자인을 직접 읽어 코드로 변환합니다. 스크린샷이 아닌 실제 컴포넌트 구조, 변수, 스타일을 분석합니다.
> [자세히 보기 →](/figma)

**카드 2: 폭넓은 기술스택**
> 프론트엔드, 백엔드, 풀스택. TypeScript, Python, Go, Java, Rust 등 주요 언어와 Next.js, Django, Spring 등 프레임워크를 지원합니다.
> [지원 스택 보기 →](/capabilities)

**카드 3: 로컬에서도, 클라우드에서도**
> 로컬 머신에서 즉시 시작하거나, 클라우드에서 팀과 함께 사용하세요. 동일한 아키텍처, 동일한 경험.

#### Section 4: CTA 밴드

- "지금 시작하세요 — 베타 기간 무료" + [시작하기] 버튼
- 하단 보조 문구: "데스크탑 앱으로 Figma 연동까지" + [다운로드] 링크

---

## 2. Figma 연동 (`/figma`)

### 목적

Figma 연동이 ANT의 핵심 차별점임을 설명하고, 설정 방법을 안내한다.

### SEO

```
title: "Figma 연동 — ANT Works"
description: "Figma 디자인을 AI가 직접 분석하여 코드로 변환합니다. Ant Desktop 설치부터 연동까지 3단계 가이드."
```

### 콘텐츠 구조

#### Section 1: Hero

- **헤드라인**: "Figma 디자인, 그대로 코드로"
- **서브헤드**: 스크린샷 캡처가 아닙니다. Figma의 실제 컴포넌트 구조, 디자인 토큰, 변수를 AI가 직접 읽고 분석합니다.

#### Section 2: 동작 원리

```
Figma Desktop → (MCP) → Ant Desktop → (WebSocket) → ANT Cloud → 설계 문서 생성
```

다이어그램으로 시각화. 핵심 메시지: Figma Desktop App의 MCP(Model Context Protocol)를 통해 디자인 데이터에 직접 접근합니다.

**ANT가 Figma에서 읽는 것:**
- 레이어 구조 및 컴포넌트 계층
- 디자인 토큰 (색상, 타이포그래피, 간격)
- 컴포넌트 변수 및 바리언트
- 오토 레이아웃 속성
- 에셋 (아이콘, 이미지)

**ANT가 생성하는 것:**
- `ui-tokens` — 디자인 토큰 정의 (색상 팔레트, 타이포그래피 스케일, 간격 시스템)
- `ui-assets` — 에셋 목록 및 활용 가이드
- `ui-spec` — 컴포넌트별 상세 스펙 (레이아웃, 상태, 인터랙션)

#### Section 3: 설정 가이드 (3단계)

**Step 1: Figma Desktop App 설치**
- Figma Desktop App이 필요합니다 (웹 버전만으로는 MCP 접근 불가)
- [Figma Desktop 다운로드](https://www.figma.com/downloads/) 링크 제공

**Step 2: Ant Desktop 설치**
- Ant Desktop은 로컬 Figma와 ANT 클라우드를 연결하는 브리지입니다
- macOS / Windows / Linux 다운로드 링크 → `/download` 페이지로 연결
- 설치 후 트레이에서 실행, ANT 계정으로 로그인

**Step 3: 프로젝트에서 Figma URL 연결**
- ANT Works에서 피처(Feature) 생성 시 Figma 파일 URL을 입력
- Design Job 실행 → Figma 데이터 자동 탐색 → 설계 문서 생성

#### Section 4: FAQ

- **Q: Figma 웹 버전도 되나요?**
  A: 아니요. MCP 접근을 위해 Figma Desktop App이 필요합니다.
  
- **Q: Ant Desktop이 Figma에 쓰기 권한을 가지나요?**
  A: 아니요. 읽기 전용입니다. 디자인 데이터를 분석만 하며, Figma 파일을 수정하지 않습니다.

- **Q: Figma 없이도 ANT를 쓸 수 있나요?**
  A: 네. 레퍼런스 이미지(스크린샷)를 업로드하거나, 텍스트 설명만으로도 설계 및 코드 생성이 가능합니다. Figma 연동은 더 정확한 결과를 위한 옵션입니다.

---

## 3. 기술스택 (`/capabilities`)

### 목적

ANT가 지원하는 언어, 프레임워크, 프로젝트 유형을 보여주어 "내 기술스택도 되나?" 질문에 답한다.

### SEO

```
title: "지원 기술스택 — ANT Works"
description: "프론트엔드, 백엔드, 풀스택. TypeScript, Python, Go, Java, Rust와 Next.js, Django, Spring 등 주요 프레임워크를 지원합니다."
```

### 콘텐츠 구조

#### Section 1: Hero

- **헤드라인**: "어떤 스택이든, 하나의 워크플로우"
- **서브헤드**: ANT는 특정 언어나 프레임워크에 종속되지 않습니다. 프로젝트의 기술스택을 분석하고 맞춤 코드를 생성합니다.

#### Section 2: 프로젝트 유형

| 유형 | 설명 |
|------|------|
| **Frontend** | SPA, SSR/SSG 웹 애플리케이션 |
| **Backend** | REST API, GraphQL 서버, 마이크로서비스 |
| **Fullstack** | 프론트엔드 + 백엔드 통합 프로젝트 |
| **Monorepo** | 다중 패키지 프로젝트 (Turborepo, pnpm workspace 등) |

#### Section 3: 언어

로고 아이콘과 함께 그리드 배치:

- **TypeScript / JavaScript** — 가장 폭넓은 지원. React, Vue, Angular, Svelte, Node.js 생태계 전체.
- **Python** — Django, Flask, FastAPI 등 웹 프레임워크 및 일반 Python 프로젝트.
- **Go** — 표준 라이브러리 기반 서버, Gin, Echo 등.
- **Java / Kotlin** — Spring Boot, Android (후순위).
- **Rust** — Axum, Actix 등 웹 프레임워크.

#### Section 4: 프레임워크 (주요 지원)

카테고리별로 구분:

**Frontend Frameworks:**
- Next.js, Nuxt, SvelteKit, Angular, Vite + React/Vue

**Backend Frameworks:**
- Express, NestJS, FastAPI, Django, Flask, Spring Boot, Gin

**CSS / UI:**
- Tailwind CSS, CSS Modules, styled-components 등 프로젝트 기존 설정에 맞춤

#### Section 5: 동작 방식

> ANT는 고정된 템플릿을 사용하지 않습니다. 프로젝트의 기존 코드를 학습(Learn)하여 코딩 컨벤션, 디렉토리 구조, 의존성을 파악한 뒤, 일관된 스타일의 코드를 생성합니다.

**Learn → Design → Code** 흐름을 짧은 다이어그램으로 설명.

#### Section 6: 정직한 고지

> **참고**: ANT의 코드 생성 품질은 언어와 프레임워크에 따라 차이가 있습니다. TypeScript/JavaScript 생태계에서 가장 높은 품질을 보이며, 다른 언어에서도 지속적으로 개선 중입니다. 지원 범위는 AI 모델의 발전과 함께 확장됩니다.

---

## 4. 요금제 (`/pricing`)

### 목적

현재 베타 상태임을 투명하게 안내하고, 향후 요금 방향성을 보여준다.

### SEO

```
title: "요금제 — ANT Works"
description: "ANT Works는 현재 베타 서비스 중입니다. 베타 기간 동안 모든 기능을 무료로 사용할 수 있습니다."
```

### 콘텐츠 구조

#### Section 1: Hero

- **헤드라인**: "지금은 베타, 모든 기능이 무료입니다"
- **서브헤드**: ANT Works는 현재 클로즈드 베타 운영 중입니다. 정식 출시 전까지 모든 기능을 무료로 제공합니다.

#### Section 2: 베타 기간 안내

**현재 포함된 기능:**
- AI 에이전트 (Planner, Architect) 무제한 사용
- Figma 연동
- 클라우드 IDE
- 실시간 미리보기
- 프로젝트 무제한 생성

**베타 참여 방법:**
- Google 계정으로 가입 → 즉시 사용 가능
- [베타 시작하기] → `/app`

#### Section 3: 향후 요금 계획 (예정)

> 아래는 현재 검토 중인 요금 구조입니다. 정식 출시 시 변경될 수 있습니다.

| | Free | Pro | Enterprise |
|---|------|-----|------------|
| AI 에이전트 사용 | 월 제한 | 무제한 | 무제한 |
| 프로젝트 수 | 제한적 | 무제한 | 무제한 |
| Figma 연동 | O | O | O |
| 클라우드 IDE | 제한적 | O | O |
| 우선 지원 | — | O | O |
| 온프레미스 배포 | — | — | O |
| SSO / SAML | — | — | O |
| 전담 지원 | — | — | O |

#### Section 4: 엔터프라이즈 문의

- **헤드라인**: "팀 도입을 검토하고 계신가요?"
- 온프레미스 배포, SSO 연동, 전담 지원이 필요한 조직을 위한 Enterprise 플랜을 준비 중입니다.
- [문의하기] → mailto 또는 Google Form 링크
- 보조 문구: "이메일: enterprise@crosstoken.io" (또는 해당 연락처)

#### Section 5: FAQ

- **Q: 베타 기간은 언제까지인가요?**
  A: 정확한 일정은 미정입니다. 베타 종료 최소 30일 전에 사전 공지합니다.

- **Q: 베타에서 만든 프로젝트는 유지되나요?**
  A: 네. 베타 기간에 생성한 프로젝트와 코드는 정식 출시 후에도 그대로 유지됩니다.

- **Q: LLM API 비용은 별도인가요?**
  A: 베타 기간에는 ANT가 LLM 비용을 부담합니다. 정식 출시 후에는 플랜별로 포함 여부가 달라질 수 있습니다.

---

## 5. 다운로드 (`/download`)

### 목적

Ant Desktop 앱을 다운로드할 수 있는 페이지. OS 자동 감지로 적절한 다운로드 버튼을 우선 표시한다.

### SEO

```
title: "다운로드 — ANT Desktop"
description: "Ant Desktop을 다운로드하세요. Figma 연동과 로컬 개발 환경 연결을 위한 데스크탑 앱입니다. macOS, Windows, Linux 지원."
```

### 콘텐츠 구조

#### Section 1: Hero

- **헤드라인**: "Ant Desktop 다운로드"
- **서브헤드**: Figma 디자인 연동과 로컬 개발 환경 연결을 위한 데스크탑 컴패니언 앱입니다.

#### Section 2: 메인 다운로드 (OS 자동 감지)

클라이언트 JS로 `navigator.userAgent`를 분석하여 현재 OS에 맞는 다운로드 버튼을 크게 표시.

- **macOS (Apple Silicon)**: `/downloads/desktop/latest/macos-arm64.dmg`
- **macOS (Intel)**: `/downloads/desktop/latest/macos-x64.dmg`
- **Windows**: `/downloads/desktop/latest/windows-x64.exe`
- **Linux (Debian)**: `/downloads/desktop/latest/linux-x64.deb`
- **Linux (AppImage)**: `/downloads/desktop/latest/linux-x64.AppImage`

감지된 OS를 Primary CTA로, "다른 OS 보기"를 Collapse/Accordion으로 제공.

#### Section 3: Ant Desktop이 하는 일

> Ant Desktop은 여러분의 로컬 환경과 ANT 클라우드를 연결하는 브리지입니다.

3가지 카드:

**1. Figma 브리지**
Figma Desktop App의 디자인 데이터를 ANT 클라우드로 안전하게 전달합니다. 아웃바운드 연결만 사용하며, 인바운드 포트를 열지 않습니다.

**2. 시스템 트레이 실행**
설치 후 시스템 트레이에서 조용히 실행됩니다. 필요할 때만 Figma 데이터를 전달하고, 리소스를 거의 사용하지 않습니다.

**3. 연결 상태 모니터링**
ANT 클라우드 및 Figma Desktop 연결 상태를 실시간으로 확인할 수 있습니다.

#### Section 4: 시스템 요구사항

| OS | 최소 버전 | 아키텍처 |
|----|---------|---------|
| macOS | 11 (Big Sur) 이상 | Apple Silicon (arm64), Intel (x64) |
| Windows | 10 이상 | x64 |
| Linux | Ubuntu 20.04 이상 | x64 |

#### Section 5: 설치 안내

**macOS:**
1. `.dmg` 파일 다운로드
2. 디스크 이미지 열기 → Applications 폴더로 드래그
3. 처음 실행 시 "확인되지 않은 개발자" 경고 → 시스템 설정 > 보안에서 허용
   (코드 서명은 준비 중이며, 향후 업데이트에서 해결됩니다)

**Windows:**
1. `.exe` 설치 파일 다운로드
2. 실행하여 설치
3. SmartScreen 경고 시 "추가 정보" → "실행" 클릭

**Linux:**
1. `.deb` 또는 `.AppImage` 다운로드
2. Debian/Ubuntu: `sudo dpkg -i ant-desktop_*.deb`
3. AppImage: `chmod +x` 후 실행

#### Section 6: 코드 서명 안내

> 현재 Ant Desktop은 코드 서명이 적용되지 않은 베타 빌드입니다. 설치 시 OS 보안 경고가 표시될 수 있습니다. 정식 출시 전에 코드 서명을 적용할 예정입니다.

---

## 페이지 우선순위

1. **홈페이지** (`/`) — 필수 최우선. 제품의 첫인상.
2. **다운로드** (`/download`) — 데스크탑 앱 배포와 동시에 필요.
3. **Figma 연동** (`/figma`) — 핵심 차별점 설명. 다운로드 페이지와 연계.
4. **기술스택** (`/capabilities`) — 사용자 판단 근거 제공.
5. **요금제** (`/pricing`) — 베타 안내. 가장 간단한 페이지.

---

## 향후 확장 고려 (이번 범위 아님)

- **블로그** (`/blog`): 업데이트 노트, 기술 블로그. 별도 CMS 연동 필요.
- **문서** (`/docs`): API 문서, 사용 가이드. Nextra 또는 Docusaurus 별도 프로젝트 검토.
- **변경 로그** (`/changelog`): 버전별 변경사항.
- **i18n**: 영문/한국어 동시 지원. Next.js의 국제화 기능 활용.
