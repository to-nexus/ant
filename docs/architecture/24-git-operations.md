# Git Operations

## 개요

ANT는 GitHub를 통한 Git 연동을 지원한다. 프로젝트 생성 후 Git을 연결하는 2가지 Setup Operation(Clone, Init)과 연결 후 사용하는 6가지 Operation(Push, Pull, Fetch, Commit, Sync, Discard)이 있다.

## Operation 정의

| Operation | 역할 | 원격 레포 | 로컬 .git | Feature |
|-----------|------|:---------:|:---------:|:-------:|
| **Clone** | 기존 원격 레포를 로컬로 다운로드 | 있어야 함 | 없어야 함 | OK (worktree 자동 생성) |
| **Init** | 로컬 코드로 새 원격 레포 생성 후 push | 없어야 함 | 없거나 remote 없는 local-only 허용 | OK (worktree 자동 생성) |
| **Commit** | 변경사항을 로컬 커밋 | 연결됨 | 있어야 함 | - |
| **Push** | 로컬 커밋을 원격에 업로드 (upstream 없으면 자동 설정) | 연결됨 | 있어야 함 | - |
| **Pull** | 원격 변경사항을 로컬로 다운로드 | 연결됨 | 있어야 함 | - |
| **Fetch** | 원격 refs 업데이트 (코드 변경 없음) | 연결됨 | 있어야 함 | - |
| **Sync** | Fetch + Pull + Push 순차 실행 | 연결됨 | 있어야 함 | - |
| **Discard** | 커밋되지 않은 변경사항 되돌리기 | - | 있어야 함 | - |

## 상황별 가능 여부

```
                    원격 레포 없음              원격 레포 있음
              +----------------------+   +------------------------+
Feature 없음  |  Clone  X (레포없음)  |   |  Clone  O              |
              |  Init   O            |   |  Init   X (레포존재)    |
              +----------------------+   +------------------------+
Feature 있음  |  Clone  X (레포없음)  |   |  Clone  O              |
              |  Init   O            |   |  Init   X (레포존재)    |
              +----------------------+   +------------------------+

.git 이미 존재 + remote 있음 → Clone/Init 불필요, Push/Pull/Fetch/Commit/Sync/Discard 사용
.git 이미 존재 + remote 없음 (local-only) → Init 허용 (프로젝트 생성 시 자동 초기화된 상태)
```

### UI 메뉴 구조

| 상태 | Git 메뉴 항목 |
|------|--------------|
| Setup Mode (`!hasGit`) | Clone / Initialize |
| Connected Mode (`hasGit`) | Push / Pull / Fetch |

Connected Mode에서 ActionButton이 상황에 따라 Commit / Publish Branch / Push / Pull / Sync / No Changes를 자동 표시한다.

## Worktree 생명주기

### .git 파일 vs .git 디렉터리

- `projectPath/codebase/.git/` (디렉터리) — main worktree, 실제 git 데이터 저장
- `features/{name}/codebase/.git` (파일) — worktree 참조 파일, `gitdir: ../../codebase/.git/worktrees/{name}` 형태

### Feature의 Git 상태 전이

```
[Feature 생성] → NoGit (codebase 디렉터리만 존재, .git 없음)
                    │
                    ├── Init/Clone 성공 → Worktree (.git 파일 생성)
                    │                       │
                    │                       ├── 코드 변경 → Uncommitted Changes
                    │                       ├── Commit → Local Commits
                    │                       ├── Push → Synced with Remote
                    │                       ├── Publish Branch → upstream 설정됨
                    │                       └── Discard → Clean State
                    │
                    └── Push/Commit 시도 → Lazy Worktree Creation (자동 생성)
                                            └── backup → create worktree → restore → 계속
```

### Clone/Init 시 Feature Worktree 자동 생성

Clone 또는 Init 수행 시 기존 feature를 모두 순회하며 worktree를 생성한다:
- 원격에 `origin/feature/{name}` 브랜치가 존재 → `--track`으로 생성 (hasUpstream=true, Push/Pull 가능)
- 원격에 해당 브랜치 없음 → 새 로컬 브랜치 생성 (hasUpstream=false, "Publish Branch" 가능)
- 기존 로컬 코드는 backup → worktree 생성 → restore 과정을 거쳐 uncommitted changes로 복원

### Lazy Worktree Creation

Push 또는 Commit 시 feature codebase에 유효한 `.git`이 없으면:
1. 기존 코드를 backup
2. WorktreeService로 worktree 생성
3. backup에서 코드 복원
4. 원래 작업 (push/commit) 계속 진행

### Worktree 안전성

WorktreeService.createWorktree는 기존 디렉터리 발견 시:
1. `.git` 파일이 존재하면 gitdir 경로의 유효성 검증
2. 유효한 worktree → early return (재생성 불필요)
3. 손상/누락 → `git worktree remove` → `git worktree prune` → 재생성

## Publish Branch

Feature에서 처음 Push할 때 upstream이 설정되지 않은 경우:
- `git push -u origin {branchName}` 실행 (Publish Branch)
- UI에서는 ActionButton에 "Publish Branch" 버튼으로 표시
- 이후 Push는 일반 `git push origin {branchName}`

> 참고: "Publish Branch"는 per-branch 작업으로, Setup Mode의 Init/Clone과는 별개이다.
> Init/Clone은 프로젝트 수준의 Git 연결이고, Publish Branch는 개별 feature 브랜치를 원격에 처음 push하는 작업이다.

## 선택적 커밋

- Commit API는 `files` 파라미터를 지원
- 파일 지정 시 해당 파일만 `git add` 후 커밋
- 미지정 시 전체 `git add .` 후 커밋

## Discard Operation

변경사항 되돌리기:
1. `git reset HEAD` — staged 변경사항 unstage
2. 파일 지정 시: tracked 파일은 `git checkout -- {files}`, untracked는 `git clean -f {files}`
3. 전체 discard: `git checkout -- .` + `git clean -fd`

## 프로젝트 생성 시 로컬 Git 자동 초기화

프로젝트 생성(`ProjectCrudService.createProject`) 시 `initializeLocalGit()`을 자동 실행한다:

1. codebase 디렉터리 생성
2. `git init --initial-branch={branchBase}` 실행
3. `.gitignore` 자동 생성 (`GitignoreGenerator`)
4. Initial commit 생성

이 과정은 non-fatal — 실패해도 프로젝트 생성은 계속된다. 결과로 remote 없는 local-only `.git`이 생성된다. 이 상태에서 Init이 허용되며, Init은 remote 설정 후 이 local git을 연결한다.

## 공통 전제 조건

- `config.json`의 `githubRepo` 필드 설정 필수 (Clone/Init/Push/Pull/Fetch/Sync)
- GitHub PAT 설정 필수 (Account Configuration)
- `.git` + remote 이미 존재 시 Clone/Init 불가 (이미 연결됨)

## isBaseBranch

`core/utils/branchUtils.ts`의 `isBaseBranch(featureName, _branchBase?)` 함수는 `featureName === RESERVED_FEATURE_NAME('_base')`으로만 판단한다. `_branchBase` 파라미터는 시그니처에 남아 있으나 무시된다.

## 상태 전이

```
[프로젝트 생성] → LocalGit (local-only, remote 없음, .git 자동 초기화)
                    │
                    ├── feature 생성 → LocalGit + HasFeatures
                    │
                    ├── Clone 성공 ──→ Connected (연동됨, feature worktree 자동 생성)
                    └── Init 성공 ──→ Connected (연동됨, feature worktree 자동 생성)
                                        │
                                        ├── Commit → Local Changes
                                        ├── Push/Pull/Fetch/Sync → Connected
                                        ├── Publish Branch → upstream 설정
                                        ├── Discard → Clean State
                                        │
                                        └── config URL 임의 변경 → Error (오류)
                                                                    │
                                                                    └── URL 복원 또는 re-clone → Connected
```

## 뱃지 상태 (UI)

프로젝트 설정과 위저드에서 GitHub Repository 필드 옆에 표시되는 연동 상태 뱃지:

| 상태 | 조건 | 색상 |
|------|------|------|
| 미연동 | `githubRepo` 설정됨 + `!hasGit` | gray |
| 연동됨 | `hasGit` + `remoteUrl` 존재 + config URL과 일치 | green |
| 오류 | `hasGit` + (config URL과 remote URL 불일치 OR remote 없음) | red |

오류 발생 원인:
- **URL 불일치**: Clone/Init 후 사용자가 config.json의 githubRepo를 임의로 변경
- **Remote 없음**: .git은 존재하지만 `git remote get-url origin`이 없음 (수동 조작 등)

## 디렉터리 구조

```
{projectPath}/
├── config.json           ← githubRepo, branchBase 등
├── codebase/             ← main worktree (base branch)
│   └── .git/             ← Clone/Init 후 생성 (디렉터리)
└── features/
    └── {featureName}/
        ├── codebase/     ← git worktree (feature branch)
        │   └── .git      ← worktree 참조 파일 (gitdir 포인터)
        ├── inputs/
        ├── outputs/
        └── sessions/
```

- Git 연결 전: `features/{name}/codebase/`는 일반 디렉터리 (.git 없음)
- Git 연결 후: `features/{name}/codebase/.git`은 main worktree를 가리키는 참조 파일
- Lazy creation: Push/Commit 시 .git 없으면 자동으로 worktree 생성

## .git 보호

LLM 코드 생성 시 `.git` 파일/디렉터리 손상 방지:
- `runCommand` 핸들러의 `detectWritePathViolations`에서 `.git` 경로 쓰기 차단
- `rm`, `mv`, `cp`, `touch` 등 명령이 `.git`을 타겟으로 하면 violation 발생

## 에러 분류 기준

라우트 핸들러에서 Operation 에러를 HTTP 상태 코드로 분류:

| 상태 코드 | 의미 | 예시 |
|-----------|------|------|
| 400 | 사전 조건 불충족 | config 미설정, 레포 not found |
| 401 | 인증 실패 | PAT 만료, 권한 부족 |
| 409 | 충돌 | 이미 clone됨, 원격 레포 이미 존재, feature 이미 존재 |
| 500 | 서버 에러 | 예상치 못한 git 명령 실패 |

프론트엔드는 400/401/409 응답의 `error` 필드를 모달로 표시한다. 500은 "Internal Server Error"로 대체되므로, known 에러는 반드시 400/401/409으로 분류해야 한다.

## Backend 상태 응답

두 개의 REST가 프론트엔드 상태를 채운다. 둘 다 `git fetch`를 수행하지 않는다.

| 엔드포인트 | 반환 필드 | 용도 |
|------------|-----------|------|
| `GET /projects/:id/git/status` | `hasGit, hasCodebase, codebaseHasFiles, hasFeatures, currentBranch, remoteUrl` | 디스크/연결 상태 |
| `GET /projects/:id/git/changes` | 위에 더해 `staged, unstaged, untracked, ahead, behind, isGitInitialized, hasUpstream` | 워킹트리·upstream 상태 |

`ahead/behind`는 로컬이 알고 있는 원격 ref 기준. 최신화는 명시적인 Fetch operation 또는 클라이언트의 `fetchFromRemote` 경로(피처 전환 시 `useGitRefresh`가 드라이브)로 수행한다.

## Realtime: gitChange 이벤트

`gitChange` SSE 이벤트는 프론트엔드의 `getGitChanges` 재조회를 트리거한다. 발행 경로는 두 개이며, 둘 다 `GitChangeBroadcaster`를 통한다.

| 경로 | 트리거 | 커버리지 |
|------|--------|----------|
| `FileTreeBroadcaster` co-emit | `notifyFileTreeUpdate` 호출 시 동반 발행 | Job 중 워킹트리 파일 생성/수정 (`.git/index` 미변경 케이스) |
| `GitWatcherService` 폴링 | `.git/index` mtime 변화 (1s interval) | 외부 터미널 `git add/commit/checkout`, 사용자 직접 조작 |

두 경로를 함께 사용하는 이유: `.git/index`는 워킹트리 파일이 `git add` 되기 전에는 변하지 않으므로 Watcher 단독으론 Job 중 파일 생성을 감지하지 못한다. Co-emit 경로가 이 맹점을 채운다.

`GitChangeBroadcaster`는 transport-agnostic으로, 생성 시점에 `publisher: (channel, payload) => Promise<unknown>` 콜백을 받는다:

- Job Worker 자식 프로세스: `BroadcasterOptions`를 넘겨 자체 ioredis 연결 생성
- Realtime Server / HTTP Server: `stateStore.publish.bind(stateStore)`를 넘겨 기존 연결 재사용

페이로드는 `@ant/shared`의 `SSEMessageMap['gitChange']`로 고정된다 (`{project, feature, timestamp}`).

## Frontend Git State

### 필드별 SSOT

Git 관련 필드는 백엔드 응답 단위로 소스가 쪼개져 저장된다. 공유 계약 타입(`@ant/shared`)을 그대로 Zustand에 담고, 파생 필드 병합이나 플래그 주입은 하지 않는다.

| 필드 집합 | 계약 타입 | 소스 엔드포인트 | 저장 위치 |
|-----------|-----------|-----------------|-----------|
| `hasGit, hasCodebase, codebaseHasFiles, hasFeatures, currentBranch, remoteUrl` | `GitStatusResponse` | `GET /projects/:id/git/status` | `gitSlice.gitStatus` |
| `staged, unstaged, untracked, ahead, behind, hasUpstream, isGitInitialized, hasUncommittedChanges, hasChanges` + 위의 status 필드 | `GitChangesResponse` (status 포함) | `GET /projects/:id/git/changes` | `gitSlice.gitChanges` |
| `githubRepo, branchBase, …` | `ProjectConfig` | `GET /projects/:id/config` | `projectConfigSlice` |

동일 필드가 `gitStatus`와 `gitChanges` 양쪽에 나타나도 두 객체는 독립적으로 교체된다 — status-only 호출은 `gitStatus`만, changes 호출은 `gitChanges`만 쓰고, `GitStatusResponse` 타입 소비자는 `gitStatus`를, `GitChangesResponse` 타입 소비자는 `gitChanges`를 읽는다. selector가 두 소스를 머지해서 쓰는 경우 `gitChanges`가 있으면 그쪽을, 없으면 `gitStatus`를 사용한다.

### Fetch / phase 액션

| 액션 | 역할 | 중복 제거 |
|------|------|----------|
| `fetchGitStatus(projectId, feature?)` | `GET /git/status` 호출 → `gitStatus` 교체. `statusFetchState`(`idle/loading/success/error`) 업데이트 | `${projectId}:${feature\|\|'base'}` 키 in-flight Map |
| `fetchGitChanges(projectId, feature?)` | `GET /git/changes` 호출 → `gitChanges` 교체. `changesFetchState` 업데이트 | 동일 키 in-flight Map |
| `fetchGitAll(projectId, feature?)` | status + changes를 병렬 호출 후 두 객체를 한 번에 교체 | 키 단위 in-flight 재사용 |
| `fetchFromRemote(projectId, feature?)` | `fetchFromGitHub` REST 호출 후 `fetchGitAll` 연쇄. `gitStatusPhase='fetching'`을 자동 세팅 | — |
| `setGitStatusPhase(phase)` | Git operation 진행 상태(`'fetching'\|'pushing'\|…\|null`). null 전이 자체는 별도 fetch를 트리거하지 않는다 | — |
| `clearGitState()` | 프로젝트/피처 전환 시 `gitStatus/gitChanges/gitStatusPhase/*FetchState` 전체 초기화 | — |

모든 fetch 액션은 호출 당시 selected project·feature 스냅샷을 찍고, 완료 시점에 `isStillActive(snapshot)`로 선택이 바뀌지 않았는지 확인한 뒤에야 스토어에 반영한다(stale guard). 빠른 feature 전환이 생겨도 이전 fetch 결과가 덮어쓰지 않는다.

### 애플리케이션 레이어 훅

프리젠테이션은 `domain/store`에 직접 접근하지 않고 `application/hooks/git/`의 세 훅만 사용한다.

| 훅 | 반환 | 쓰임 |
|----|------|------|
| `useGitState()` | `{gitStatus, gitChanges, gitStatusPhase, statusFetchState, changesFetchState, isFetchBlockingCta}` | 읽기 전용. 모든 컴포넌트/훅이 git 상태를 볼 때 사용 |
| `useGitActions()` | `{fetchGitStatus, fetchGitChanges, fetchGitAll, fetchFromRemote, setGitStatusPhase, clearGitState}` | Git operation 디스패치 |
| `useGitRefresh()` | void | `App.tsx`에서 한 번 호출. 프로젝트·피처 변화, SSE `gitChange`, 초기 마운트, 주기적 remote fetch를 단일 훅에서 오케스트레이션 |

`useGitRefresh`는 이전 아키텍처에서 `ProjectSection`/`GitStatusButton`/`useFeatureBranchManager`에 흩어져 있던 fetch 트리거를 단일 지점으로 집약한다.

### Fetch 트리거 경로

1. **프로젝트/피처 변화** — `useGitRefresh`가 변화를 감지하고 `clearGitState()` → `fetchGitAll()`. 피처 전환이면 추가로 `fetchFromRemote()`로 원격 refs 동기화.
2. **SSE gitChange 이벤트** — `sseSlice.initializeSSE`가 `fetchGitChanges`를 등록. 핸들러는 `get()`으로 현재 project/feature를 동적 참조해 stale closure를 피한다.
3. **Git operation 완료** — `useGitActions` 훅(GitStatusButton용)이 push/pull/commit/discard 성공 후 `fetchGitAll()`을 명시 호출.
4. **Job 완료 / 계정 설정 변경** — `useJobExecution`, `AccountConfigEditor` 등에서 필요 시 `fetchGitAll()` 직접 호출.

### Feature 전환 시퀀스

```
setSelectedFeature(name)
  └─ projectSlice에서 clearGitState() 호출          ; 이전 피처 데이터 제거
        ↓
useGitRefresh (effect)
  ├─ fetchGitAll(projectId, feature)                 ; 즉시 상태 채움 (Setup 버튼 표시용)
  └─ fetchFromRemote(projectId, feature)             ; origin/* 동기화 후 재차 fetchGitAll
```

`gitStatusPhase`는 `fetchFromRemote` 진입 시 `'fetching'`으로 설정되고 완료 시 `null`로 돌아온다. phase 전이 자체가 fetch를 일으키지는 않는다.

### UI 분기 selector

selector 바깥에서 `hasGit/hasUpstream/remoteUrl`로 분기하는 코드는 없다. 두 selector 모두 `gitStatus`(Status 계약)와 `gitChanges`(Changes 계약)를 분리해 받는다.

| Selector | 입력 | 소비자 | 결과 union |
|----------|------|--------|-----------|
| `deriveGitMenuState({gitStatus, gitChanges, githubRepo, isFetching})` | Status + Changes + Config | ProjectSection 드롭다운 | `loading \| disabled \| setup \| publishBranch \| synced` |
| `deriveGitActionCta({gitChanges, gitStatus, isLoading})` | Changes(주) + Status(폴백) | GitStatusButton/ActionButton | `loading \| noChanges \| commit \| publish(variant) \| sync \| push \| pull` |

Changes가 아직 없으면 두 selector 모두 `loading`으로 취급해 새로고침 직후 오분류를 방지한다.

### Publish variant 처리

`ActionButton`은 CTA가 `publish`일 때 `cta.variant`에 따라 서로 다른 핸들러를 호출한다. dispatch 단계에서는 원본 필드를 다시 읽지 않는다.

| variant | 핸들러 | 동작 |
|---------|--------|------|
| `noRemoteWithFeatures` | `handlePublishRepo` | confirm → `initializeGitHubRepo` (remote 생성 + push) → `fetchGitAll` |
| `noUpstream` | `handlePush` | `pushToGitHub` (BE `PushOperation`이 `-u` 자동 설정) → `fetchGitAll` |

## 관련 코드

### Backend

| 역할 | 파일 |
|------|------|
| Clone | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/CloneOperation.ts` |
| Init | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/InitOperation.ts` |
| Push | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/PushOperation.ts` |
| Commit | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/CommitOperation.ts` |
| Discard | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/DiscardOperation.ts` |
| Sync | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/SyncOperation.ts` |
| Worktree | `packages/ant-cli/src/periphery/adapters/http/services/GitService/worktree/index.ts` |
| Backup/Restore | `packages/ant-cli/src/periphery/adapters/http/services/GitService/worktree/FeatureCodebaseBackup.ts` |
| Feature CRUD | `packages/ant-cli/src/periphery/adapters/http/services/ProjectService/FeatureCrudService.ts` |
| Git 상태 조회 | `packages/ant-cli/src/periphery/adapters/http/services/GitService/status/index.ts` |
| `.git/index` 폴링 | `packages/ant-cli/src/periphery/adapters/http/services/GitWatcherService.ts` |
| gitChange 브로드캐스터 | `packages/ant-cli/src/core/realtime/GitChangeBroadcaster.ts` |
| FileTree co-emit | `packages/ant-cli/src/core/realtime/FileTreeBroadcaster.ts` |
| 라우트 | `packages/ant-cli/src/periphery/adapters/http/routes/projects.routes.ts` |

### Frontend

| 역할 | 파일 |
|------|------|
| gitSlice (status + changes 분리 SSOT, stale guard) | `packages/ant-ui/src/domain/store/slices/gitSlice.ts` |
| projectConfigSlice | `packages/ant-ui/src/domain/store/slices/projectConfigSlice.ts` |
| 메뉴/CTA selector | `packages/ant-ui/src/domain/git/selectors.ts` |
| SSE gitChange 핸들러 등록 | `packages/ant-ui/src/domain/store/slices/sseSlice.ts` |
| 프로젝트/피처 전환 훅 (clearGitState 호출) | `packages/ant-ui/src/domain/store/slices/projectSlice.ts` |
| Git 상태 읽기 훅 | `packages/ant-ui/src/application/hooks/git/useGitState.ts` |
| Git 액션 디스패치 훅 | `packages/ant-ui/src/application/hooks/git/useGitActions.ts` |
| Git refresh 오케스트레이션 훅 | `packages/ant-ui/src/application/hooks/git/useGitRefresh.ts` |
| 드롭다운 | `packages/ant-ui/src/presentation/components/ProjectSection.tsx` |
| Git 버튼 컨테이너 | `packages/ant-ui/src/presentation/components/GitStatusButton/index.tsx` |
| Git operation dispatch | `packages/ant-ui/src/presentation/components/GitStatusButton/hooks/useGitActions.ts` |
| 변경 패널 | `packages/ant-ui/src/presentation/components/GitStatusButton/components/GitChangesPanel.tsx` |
| REST API 클라이언트 (공유 계약 타입 사용) | `packages/ant-ui/src/infrastructure/http/api/github.ts` |

### Shared

| 역할 | 파일 |
|------|------|
| SSE 이벤트 타입 (SSEMessageType, SSEMessageMap) | `packages/ant-shared/src/sse-events.ts` |
| Git 응답 계약 타입 (GitStatusResponse, GitChangesResponse, FileChange) | `packages/ant-shared/src/git.ts` |

## 경계

- 워크스페이스 격리: [20-workspace-isolation.md](20-workspace-isolation.md)
- 인프라 (Redis, BullMQ): [02-infrastructure.md](02-infrastructure.md)
- 실시간 시스템 전반: [21-realtime-system.md](21-realtime-system.md)
- 프론트엔드 레이어 구조: [30-frontend-architecture.md](30-frontend-architecture.md)
