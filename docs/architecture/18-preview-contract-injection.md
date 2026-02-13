# Preview 환경변수 계약 주입 시스템

## 1. 개요

Preview Server에서 Dev Server를 실행할 때, 프록시 기반 라우팅이 정상 작동하려면 프레임워크별 환경변수가 올바르게 주입되어야 합니다. 이 문서는 **환경변수 계약(Contract)이 어떻게 코드 생성 단계(Layer 1)와 런타임 단계(Layer 2)에서 보장되는지** 설명합니다.

---

## 2. 2-Layer 아키텍처

```
Layer 1: 코드 생성 가이드 (예방)
  ├── preview-env-contract.md    → "환경변수를 읽어라" (WHAT 원칙)
  ├── preview-setup.md           → "base path를 설정해라" (HOW 원칙)
  └── constraints.md             → "인프라 파일 생성 제한" (제약)

Layer 2: 런타임 주입 + 검증 (보정)
  ├── ProcessSpawner             → 환경변수 자동 주입 (PORT, VITE_BASE_PATH, VITE_API_BASE_URL 등)
  ├── Validator                  → base path 설정 검증 (React/Vue/Next)
  ├── IssueDetector              → 비치명적 이슈 감지 (api-base-missing, cross-project-api-missing)
  └── Fix Workflow               → suggestedFix → 채팅 자동 입력 → AI 코드 수정
```

### Layer 1: 코드 생성 가이드

AI가 새 프로젝트를 생성할 때 올바른 설정을 포함하도록 프롬프트 템플릿이 가이드합니다.

| 파일 | 역할 | FPOP 원칙 |
|------|------|-----------|
| `preview-env-contract.md` | 플랫폼 런타임 계약 (환경변수 목록, 시나리오별 동작) | Principle, Constraint |
| `preview-setup.md` | 프레임워크별 base path 설정 원칙 | Observation Target, Blind Spot Reminder |
| `constraints.md` (TS/Go) | 셋업 단계 제약 (인프라 가드레일 포함) | Environment Constraint |

### Layer 2: 런타임 주입 + 검증

Dev Server 프로세스 생성 시 환경변수를 자동 주입하고, 프로젝트 설정이 올바른지 검증합니다.

| 컴포넌트 | 역할 |
|----------|------|
| `ProcessSpawner` | `PORT`, `VITE_BASE_PATH`, `NEXT_PUBLIC_BASE_PATH`, `ANT_BASE_PATH` 주입 |
| `PreviewService` | `VITE_API_BASE_URL` 주입 (same-project 또는 cross-project linkedBackend) |
| `ProjectValidator` | 프레임워크 감지 → 해당 Validator 위임 |
| `ReactValidator` | Vite base + React Router basename 검증 |
| `VueValidator` | Vite base + Vue Router base 검증 |
| `NextValidator` | basePath + NEXT_PUBLIC_BASE_PATH 참조 검증 |
| `IssueDetector` | 비치명적 이슈 감지 (warning 레벨) |

---

## 3. 환경변수 계약 테이블

| 변수 | 주입 대상 | 용도 | 주입 시점 |
|------|----------|------|----------|
| `VITE_BASE_PATH` | Vite 프론트엔드 | 에셋/라우트 경로 prefix | ProcessSpawner |
| `NEXT_PUBLIC_BASE_PATH` | Next.js 프로젝트 | basePath (SSR + CSR) | ProcessSpawner |
| `ANT_BASE_PATH` | 모든 프론트엔드 | 범용 fallback | ProcessSpawner |
| `VITE_API_BASE_URL` | 백엔드 연결 프론트엔드 | API 라우팅 경로 | PreviewService |
| `PORT` | 모든 패키지 | 동적 포트 바인딩 | ProcessSpawner |

---

## 4. Cross-Project 계약 주입

### 4.1 시나리오

프론트엔드와 백엔드가 별도 프로젝트인 경우, `VITE_API_BASE_URL` 주입 경로:

```
사용자: Preview Config UI에서 linkedBackend 설정 저장
    │
    ├── type='project': resolvedUrlKey 자동 생성 (toUrlKey)
    │   └── VITE_API_BASE_URL = /{resolvedUrlKey}
    │
    └── type='url': 사용자 입력 URL 그대로 사용
        └── VITE_API_BASE_URL = {url}
    │
    ▼
Redis PreviewState.linkedBackend에 저장
    │
    ▼
Preview Start 시 PreviewService가 읽어서 환경변수 주입
```

### 4.2 데이터 흐름

```
1. PUT /preview/projects/:id/preview-config
   { linkedBackend: { type: 'project', projectId: 'be', feature: 'main' } }
       │
       ▼
2. PreviewServer: resolvedUrlKey 생성 → Redis 저장
   { linkedBackend: { type: 'project', ..., resolvedUrlKey: 'org--user--be--main' } }
       │
       ▼
3. Preview Start → PreviewService:
   - portRegistry.getPreview() → linkedBackend 읽기
   - extraEnv.VITE_API_BASE_URL = '/org--user--be--main'
       │
       ▼
4. ProcessSpawner: Dev Server에 환경변수 전달
   - VITE_API_BASE_URL=/org--user--be--main
       │
       ▼
5. Frontend 코드: fetch(import.meta.env.VITE_API_BASE_URL + '/api/data')
   → GET /org--user--be--main/api/data
   → 프록시가 백엔드 Pod로 라우팅
```

---

## 5. 인프라 책임 분리

### 원칙

`frontend-only` 프로젝트는 인프라 관련 파일을 생성하지 않습니다.

### 구현

`constraints.md` (TypeScript, Golang) 에 Environment Constraint 추가:

> 이 프로젝트가 **frontend-only**인 경우: `docker-compose.yml`, `dev:infra` 스크립트, `.env.example` (외부 서비스용) 생성 금지. 인프라 프로비저닝은 별도 백엔드 프로젝트의 책임.

### 감지 방법

`ProjectStructureDetector`가 프로젝트 구조를 분석하여 `structureType`을 결정합니다:
- `frontend-only`: 프론트엔드 패키지만 존재
- `backend-only`: 백엔드 패키지만 존재
- `fullstack`: 프론트엔드 + 백엔드 동시 존재
- `monorepo`: 여러 패키지 (워크스페이스)

---

## 6. Preview Config UI

### 구성

| 섹션 | 내용 |
|------|------|
| **Project Info** | 자동 감지된 `structureType` 표시 |
| **Backend Connection** | Direct URL 입력 또는 Ant Project 선택 (`frontend-only`일 때 표시) |
| **Preview Controls** | Start/Stop/Restart + 현재 상태 배지 + Open 버튼 |
| **Status Console** | Fatal/Warning 이슈 목록 + 접을 수 있는 로그 |

### 진입점

- Explorer 사이드바: FeatureDropdown의 **Settings(기어) 아이콘** 클릭
- 메인 패널: `previewConfig` 탭으로 열림

### API 엔드포인트

| Method | Path | 용도 |
|--------|------|------|
| `GET` | `/preview/projects/:id/preview-config?feature=` | 현재 설정 조회 |
| `PUT` | `/preview/projects/:id/preview-config` | 설정 저장 (linkedBackend) |

---

## 7. 관련 파일

```
docs/architecture/
├── 02-preview-server.md             # Preview Server 아키텍처 (이 문서 참조)
└── 18-preview-contract-injection.md # 이 문서

packages/ant-cli/src/
├── core/ports/portRegistry.ts                              # PreviewState, LinkedBackendConfig 타입
├── core/prompt/templates/code/base/injections/
│   ├── preview-env-contract.md                             # Layer 1: 환경변수 계약
│   └── preview-setup.md                                    # Layer 1: base path 설정 원칙
├── core/prompt/templates/code/phases/execute/languages/
│   ├── typescript/setup/constraints.md                     # Layer 1: 인프라 가드레일
│   └── golang/setup/constraints.md                         # Layer 1: 인프라 가드레일
├── periphery/adapters/http/services/PreviewService/
│   ├── PreviewService.ts                                   # Layer 2: 환경변수 주입 로직
│   ├── types.ts                                            # PreviewIssueReasoning (cross-project-api-missing)
│   ├── managers/ProcessSpawner.ts                          # Layer 2: 프로세스 환경변수 전달
│   ├── detectors/IssueDetector.ts                          # Layer 2: 이슈 감지
│   └── validators/                                         # Layer 2: 설정 검증
└── infrastructure/preview/PreviewServer.ts                 # API 엔드포인트 (preview-config)

packages/ant-ui/src/
├── presentation/components/PreviewConfigEditor/index.tsx   # Preview Config 탭 UI
├── infrastructure/http/api.ts                              # getPreviewConfig, updatePreviewConfig
└── domain/store/types.ts                                   # previewConfig 탭 타입
```
