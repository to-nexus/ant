# Frontend Architecture

## 개요

ant-ui는 React + Vite 기반 SPA이다. Clean Architecture 레이어 구조를 따르며, Zustand로 상태를 관리하고, SSEManager를 통해 백엔드와 실시간 통신한다.

## 레이어 구조

```
Presentation -> Application -> Domain <- Infrastructure
```

| 레이어 | 역할 | 디렉토리 |
|--------|------|----------|
| Presentation | React UI 컴포넌트, 페이지, 레이아웃 | `src/presentation/` |
| Application | 유스케이스 훅, 도메인과 UI 연결 | `src/application/` |
| Domain | Zustand 스토어, 슬라이스, 모델 | `src/domain/` |
| Infrastructure | HTTP 클라이언트, SSE, 스토리지 | `src/infrastructure/` |
| Shared | 유틸리티, 상수 | `src/shared/` |

### 의존 방향

- Presentation은 Application 훅을 사용한다 (Domain 직접 접근 금지)
- Application은 Domain(스토어)을 사용한다
- Domain은 Infrastructure(SSE, HTTP)를 사용한다
- Infrastructure는 Domain을 import하지 않는다

## 상태 관리 (Zustand)

12개 슬라이스로 구성된 단일 스토어:

| 슬라이스 | 역할 |
|----------|------|
| projectSlice | 프로젝트/피처 선택, 목록 |
| fileSlice | 파일 트리, 파일 편집 |
| jobSlice | Job 실행 상태, currentJobId |
| sseSlice | SSE 연결, Kanban/Chat/FileTree 핸들러 |
| uiSlice | UI 상태 (탭, 레이아웃, pendingClarifyAnswers) |
| gitSlice | Git 상태 |
| previewSlice | Preview 상태 |
| authSlice | 인증 상태 |
| configSlice | 프로젝트/계정 설정 |
| chatSlice | 채팅 메시지 |
| transferSlice | 전송 상태 |
| resetSlice | 상태 초기화 |

### 영속화

- `localStorage`: 테마, 사용자 이메일, 백엔드 모드
- `sessionStorage`: 선택된 프로젝트/피처

## 백엔드 연동

### HTTP

`infrastructure/http/api.ts`에 정의. 모드에 따라 base URL이 결정된다:
- Local: Vite 프록시를 통해 `localhost:4100` (API), `localhost:4101` (Realtime)
- Cloud: `VITE_CLOUD_BACKEND_BASE` 환경변수

인증: Cloud 모드에서 `x-user-email` 헤더 전송.

### SSE

`infrastructure/sse/SSEManager.ts`가 싱글톤으로 관리:
- Unified 연결: `REALTIME_BASE()/projects/{project}/features/{feature}/stream`
- Workflow 연결: `/jobs/{jobId}/workflow/stream`
- 메시지 타입: `kanban`, `chat`, `fileTree`, `workflow`, `preview`, `gitChange`, `transfer`, `unseenArtifacts`
- 자동 재연결: 5회 브라우저 자동 + exponential backoff

## 메인 패널 탭

| 탭 | 컴포넌트 | 용도 |
|----|----------|------|
| `job` | Kanban + Workflow | 태스크 큐, 워크플로우 |
| `projectConfig` | ConfigEditor | 프로젝트 설정 |
| `accountConfig` | ConfigEditor | 계정 설정 |
| `fileEdit` | CodeEditor | 파일 편집 |
| `transfer` | TransferPanel | 코드 전송 |
| `previewConfig` | PreviewConfigEditor | Preview 설정 |

## 국제화 (i18n)

i18next 기반. `en/`, `ko/` 로케일 디렉토리에 JSON 파일로 관리. 도메인별 분리: artifacts, chat, common, config, explorer, kanban, nav, onboarding, transfer.

## 경계

- SSE 연결 상세: [21-realtime-system.md](21-realtime-system.md)
- Chat UI: [31-chat-system.md](31-chat-system.md)
- 공유 타입: [01-shared-contracts.md](01-shared-contracts.md)
