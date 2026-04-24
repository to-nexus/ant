# Frontend Architecture

## 개요

ant-ui는 React 19 + Vite 기반 SPA이다. Clean Architecture 레이어 구조를 따르며, Zustand로 상태를 관리하고, SSEManager를 통해 백엔드와 실시간 통신한다. 브랜드명은 **1 Ant**.

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
| Shared | 유틸리티, 상수, canonical-dirs | `src/shared/` |

### 의존 방향

- Presentation은 Application 훅을 사용한다 (Domain 직접 접근 금지)
- Application은 Domain(스토어)을 사용한다
- Domain은 Infrastructure(SSE, HTTP)를 사용한다
- Infrastructure는 Domain을 import하지 않는다

## 상태 관리 (Zustand)

단일 Zustand 스토어는 아래 슬라이스로 구성된다 (Phase 7 cutover 이후 정식 목록).

| 슬라이스 | 역할 |
|----------|------|
| projectSlice | 프로젝트/피처 선택, 목록, 세션 restore 플래그. 전환 시 project-config 스크러브만 수행 (git-world 리셋은 `useProjectLifecycle` 소유) |
| fileSlice | 파일 트리, 파일 편집 |
| jobSlice | Job 실행 상태, currentJobId |
| sseSlice | 단일 EventSource 연결 관리자. `gitState` 포함 10개 SSE type에 대해 핸들러를 등록 |
| uiSlice | UI 상태 (탭, 레이아웃, pendingClarifyAnswers) |
| git-world (`domain/git-world`) | Git SSOT — `snapshot: AsyncFields<GitSnapshot>`, `operation: GitOperationState` (FSM), `pat: AsyncFields<GitPatState>`. writer 3개 (`fetchGitWorldState`, `runGitOperation`, `savePat/deletePat`). 세부는 [24-git-operations.md §0](24-git-operations.md#0-git-world-계약-greenfield-ssot) |
| projectConfigSlice | `.ant/config.json` 내용 (`AsyncFields<ProjectConfig>`) |
| previewSlice | Preview 상태 |
| authSlice | 인증 상태 |
| configSlice | 시스템 설정 (backendMode, localBackendPort, recursionLimit) |
| chatSlice | 채팅 메시지 |
| transferSlice | 전송 상태 |
| deploySlice | Deploy 상태 |
| resetSlice | 상태 초기화 |

### Git / ProjectConfig SSOT

Git 상태는 `domain/git-world/` 슬라이스가 유일한 SSOT이다. 프리젠테이션은 절대 `useStore` 로 git-world 슬라이스 필드에 직접 접근하지 않고 공용 훅만 사용한다:

- 읽기: `useGitSnapshot` · `useGitOperation` · `useGitPat` · `useGitCta` · `useGitMenu` · `useGitBadge` · `useGitSetupCta`
- 쓰기: `useGitDispatch().runGitOperation` / `fetchGitWorldState` / `clearGitOperation`, `useGitPatDispatch().savePat / deletePat / fetchGitPat`
- SSE 진입: `registerGitStateHandler()` (통상 `sseSlice.initializeSSE` 가 자동 등록)

`projectConfigSlice` 는 AsyncFields envelope (`{status, data, error, refreshing}`) 를 담는다. `githubRepo` 는 이 envelope 안의 `data.githubRepo` 위치에만 존재한다. `domain/project-world/useProjectConfigSnapshot` · `useGithubRepo` 훅이 envelope unwrap + primitive 단위 read 를 담당해 non-primitive 객체를 `useStore` 안에서 생성하지 않는다 (Zustand 참조 동등성 위반 방지). 상세는 [24-git-operations.md §0](24-git-operations.md#0-git-world-계약-greenfield-ssot).

### 프로젝트 라이프사이클 오케스트레이션

`(selectedProject, selectedFeature)` 전환 시 일어나야 할 모든 부수효과는 **app 루트 한 곳**에서 `useProjectLifecycle` 훅이 담당한다 — `clearGitWorld()` → `clearProjectConfig()` → `initializeSSE()` (`reconnectRefill` SSE 유도) → `fetchProjectConfig()` → `fetchGitWorldState()`. 슬라이스의 setter 는 순수 setter 에 가깝고, 세션 복원 polling 은 `useSessionLoader` 만이 소유한다.

### 영속화

- `localStorage`: 테마, 사용자 이메일, 백엔드 모드, 로컬 백엔드 포트
- `sessionStorage`: 선택된 프로젝트/피처

## 백엔드 연동

### HTTP

`infrastructure/http/api/client.ts`에 base URL 결정 로직. `API_BASE()`, `REALTIME_BASE()` 함수로 접근:
- Local: 상대 경로 (Vite 프록시가 `localhost:4100`/`4101`로 라우팅)
- Cloud: `VITE_CLOUD_BACKEND_BASE` 환경변수

인증: Cloud 모드에서 `x-user-email` 헤더 전송.

### SSE

`infrastructure/sse/SSEManager.ts`가 싱글톤으로 관리:
- Unified 연결: `REALTIME_BASE()/projects/{project}/features/{feature}/stream`
- Workflow 연결: `/jobs/{jobId}/workflow/stream`
- 메시지 타입: `kanban`, `chat`, `fileTree`, `workflow`, `preview`, `deploy`, `gitChange`, `transfer`, `unseenArtifacts`, `bridge` (canonical union은 `@ant/shared/sse-events.ts`의 `SSEMessageType`)
- 자동 재연결: exponential backoff, 재연결 시 스트리밍 중인 채팅 메시지 유실 방지 로직 포함

## 에이전트 워터마크

채팅 패널 빈 상태에 에이전트별 캐릭터 워터마크를 표시한다:

| 에이전트 | 파일 |
|----------|------|
| architect | `public/watermarks/architect-color.png`, `architect-mono.png` |
| creator | `public/watermarks/creator-color.png`, `creator-mono.png` |
| planner | `public/watermarks/planner-color.png`, `planner-mono.png` |

## Visual Job UI

Visual Job(creator 에이전트)은 이미지 생성/수정 워크플로우를 위한 전용 UI를 가진다:
- `ImageLightbox`: 생성된 이미지 확대 보기
- 드래프트 선택 UI: 스케치 결과 중 선택하는 clarify 카드
- 채팅 내 이미지 인라인 표시

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

i18next 기반. `en/`, `ko/` 로케일 디렉토리에 JSON 파일로 관리. 도메인별 분리: artifacts, auth, chat, common, config, explorer, kanban, nav, onboarding, transfer.

## 경계

- SSE 연결 상세: [21-realtime-system.md](21-realtime-system.md)
- Chat UI: [31-chat-system.md](31-chat-system.md)
- 공유 타입: [01-shared-contracts.md](01-shared-contracts.md)
- Figma Desktop 연동: [26-figma-integration-infra.md](26-figma-integration-infra.md)
