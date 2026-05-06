# Git Operations

> **Greenfield SSOT (git-world)** — 이 문서는 Ant 의 Git 도메인 어휘·상태·SSE
> 이벤트·REST 엔드포인트의 단일 진실 원천이다. 새 Git 관련 코드를 작성하기
> 전 본 문서와 `.claude/skills/update-git-world/SKILL.md` 를 먼저 읽는다.

## 0. git-world 계약

**Ant Git 어휘 (FE 공식)** — `publish`, `push`, `pull`, `fetch`, `sync`,
`commit`, `discard`, `clone` 의 8개 user operation 만이 FE 가 디스패치한다.
canonical git 어휘 (`status`, `changes`, `initialize`, `publish-branch`) 는
FE 타입 표면에 등장하지 않는다.

### 타입 SSOT — `@ant/shared/src/git.ts`

| 타입 | 역할 |
|------|------|
| `GitSnapshot` | 통합 readonly 상태 (hasGit/hasRemote/ahead/behind/staged/unstaged/untracked 등). `Object.freeze` + `Readonly<>` 로 mutation 금지 |
| `GitUserOperation` | 8개 user op 의 discriminated union |
| `GitOperationState` | 4-state FSM (`idle` / `running` / `failed` / `succeeded`) |
| `GitOperationError` | `{ kind, message, retryable, suggestedAction }` |
| `GitSuggestedAction` | `configurePat` / `resolveConflict` / `reconfigureRepo` / `runClone` |
| `GitPatState` | `{ configured, username? }` |
| `GitStateEventData` | SSE `gitState` 이벤트의 discriminated union (`workingTreeChange` / `operationComplete` / `reconnectRefill`) |

### SSE 1 이벤트 — `gitState`

- `cause: 'workingTreeChange'` — 디스크 변경 힌트. payload 에 snapshot 없음. FE 는 debounce 후 `fetchGitWorldState` 재호출.
- `cause: 'operationComplete'` — 전체 snapshot + pat + operation FSM. FE 는 바로 replace.
- `cause: 'reconnectRefill'` — SSE open 시 서버가 발행. 전체 snapshot + pat.

### REST 2 엔드포인트

- `GET  /projects/:id/git/state?feature=...&fresh=true` → `GitStateResponse`
- `POST /projects/:id/git/ops/:userOp`                 → `GitOperationResponse`

그 외 Git REST 엔드포인트 추가 금지.

### Writer 3개 (FE)

`domain/git-world/` 외부에서 호출 가능한 writer 는 아래 3개 뿐이다:

- `runGitOperation(projectId, op)`
- `savePat(pat)`
- `deletePat()`

이 외의 Git/PAT 관련 writer 가 추가되면 ESLint `no-restricted-imports` 및
`scripts/git-sweep.mjs` 의 P11/P13/P14 패턴에서 걸러진다.

### BE `GitOperation.onSuccess` 대칭 훅

모든 8 operation 은 `run()` 성공 직후 **대칭적으로**:

1. `StatusService.getSnapshot(projectId)` 를 호출해 최신 snapshot 계산
2. `GitStateBroadcaster.notifyOperationComplete(...)` 로 `gitState` SSE publish
3. `gitWatcher.retryDeferredWatchers(projectId)` 호출 (deferred watcher 재시도)
4. 프로젝트 레벨 op (feature 없음) 이면 `autoIndexCodebase` 트리거

특정 op 만 훅 추가/제거하는 비대칭 설계 금지. `scripts/git-sweep.mjs`
P9 패턴이 이를 감시한다.

### Publish 폴리모픽

`GitUserOperation.kind === 'publish'` 는 상태에 따라 4 가지 BE 동작으로 해결된다:

| 상태 (S) | BE 동작 |
|----------|---------|
| S1: `!hasGit && !hasRemote` | `git init` + GitHub repo 생성 + initial push (initialize) |
| S2: `!hasGit && hasRemote` | `git init` + remote 연결 + push (initialize-with-remote) |
| S3: `hasGit && !hasRemote` | GitHub repo 생성 + `git push -u` (init-remote) |
| S4: `hasGit && hasRemote && !hasUpstream` | `git push -u` (publish-branch) |

FE 는 어느 분기인지 알지 못한 채 `{ kind: 'publish' }` 만 디스패치한다.

---

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
- `features/{name}/codebase/.git` (파일) — worktree 참조 파일, **항상 절대경로** `gitdir: <absolute path>/codebase/.git/worktrees/{id}` 형태로 git 이 작성한다 (CLI flag 로 변경 불가). worktree 메타 디렉토리 이름은 worktree 경로의 마지막 path 컴포넌트(보통 `codebase`)에서 파생되며, 충돌 시 git 이 자동 disambiguate 해 `codebase1` 등으로 만든다.

### Worktree validity (Stage-4 SSOT)

**`GitHelper.isWorktreeStructureValid(featureCodebasePath)`** 가 단일 진실 원천이다. 4 단계 검사:

1. `.git` 파일 존재 (worktree marker 있음)
2. `gitdir:` 형식 파싱 성공
3. 그 절대경로 디렉토리 (`<main>/.git/worktrees/<id>/`) 존재
4. 그 디렉토리에 `HEAD` + `commondir` 두 파일 모두 존재

검사가 cheap (4 stat) 이라 모든 critical path 에서 호출. 새 helper 추가 금지 — partial worktree (NFS partial write / interrupted `git worktree add`) 는 단일 SSOT 로 검출.

### Worktree validity 호출 site

| Phase | Call site | 효과 |
|-------|-----------|------|
| pre-existing dir 검사 | `WorktreeService.createWorktree` | partial gitdir 가 valid 로 false-positive 되는 회귀 차단 |
| post-create probe | `WorktreeService.createWorktree` | `git worktree add` exit-code 0 인데 partial 인 케이스 검출 + throw |
| orphan 강화 | `WorktreeService.pruneCorruptWorktreeMeta` | partial meta 디렉토리도 자동 회수 |
| Stage-4 self-heal | `ensureGitRepository` | git instance 만들어진 partial worktree 도 backup → recreate → restore |
| defense-in-depth | `StatusService.getGitChanges` | "not a git repository" 에러 시 structured `worktreeValidityFailure` 로그 emit |

### IDE Pod Multi-Mount Topology (Cloud / K8s)

worktree marker 가 절대경로를 가리키므로, IDE pod 가 그 절대경로를 컨테이너 안에서 실제로 해소할 수 있어야 한다. K8s pod 는 단일 subPath 마운트만 가지면 `/mnt/workspaces/<...>/codebase/.git/worktrees/<id>` 경로가 컨테이너 안에 존재하지 않아 git 인식 실패.

해결: **alias-model multi-mount** (Docker `resolveWorktreeBindMounts` 와 K8s `resolveK8sWorktreeMounts` 모두 동형):

| Mount | mountPath | subPath | 책임 |
|-------|-----------|---------|------|
| Primary alias | `/workspace` | `<tenant>/<user>/<project>[/features/<feat>]/codebase` | 사용자에게 노출되는 작업 경로 |
| mainGitDir | `<base>/<...>/codebase/.git` (절대) | 동일 prefix | worktree marker 의 gitdir 절대경로가 컨테이너 안에서 해소되도록 |
| worktreePath | `<base>/<...>/features/<feat>/codebase` (절대) | 동일 prefix | 메타 dir 의 back-reference (`<gitdir>/gitdir` 파일이 가리키는 worktree 절대경로) 가 해소되도록 |

기준 브랜치 (`_base`) 는 `.git` 가 디렉토리이므로 worktree mount 0 — primary alias 만 마운트.

`.git` 파싱은 `GitHelper.resolveWorktreeAbsPaths` 가 단일 SSOT — Docker/K8s 두 함수는 path 결과만 받아 자기 format (Docker bind 문자열 / K8s mount 객체) 만 책임. 새로 같은 파싱 로직 만들면 `tests/policy/worktree-mount-dedup.test.ts` 가 차단.

### ANT_WORKSPACE_BASE_PATH 동일성 invariant

API 서버 / IDE pod / job worker 가 **모두 같은** `ANT_WORKSPACE_BASE_PATH` 값을 보아야 한다. 다르면 worktree marker 의 절대경로가 한쪽에서만 해소돼 IDE 가 git 을 인식 못하거나 API 서버가 worktree 를 valid 로 잘못 판정한다. `KubernetesIDEOrchestrator.assertWorkspacePathInBase` 가 startup 시 fail-fast 검증.

### IDE Pod Mount Drift Auto-Recreate

존재하는 pod 의 `volumeMounts.length` 가 `resolveK8sWorktreeMounts` 가 지금 돌려주는 expected count 와 다르면 (예: 옛 race 케이스에서 만들어진 1-mount pod 가 지금은 worktree valid 라 3 mount 가 expected) `KubernetesIDEOrchestrator.start` 가 자동으로 pod 를 delete + recreate. pod spec 은 immutable 이므로 stale broken pod 는 이 경로로만 복구 가능.

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
1. `GitHelper.isWorktreeStructureValid` (Stage-4: `.git` marker + gitdir 디렉토리 + HEAD + commondir) 로 검증
2. valid → early return (재생성 불필요)
3. 손상/누락 (`worktreeValidityFailure` 로그 emit) → `git worktree remove` → `git worktree prune` → 재생성

`git worktree add` 직후에는 `pollWorktreeValidity` (3 회 × 100ms) 로 EFS NFS 의 eventual consistency lag 흡수 후 최종 invalid 면 `GitOperationError` throw — silent partial create 차단.

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
        ├── plan/
        ├── architecture/
        ├── visual/
        ├── assets/
        ├── meta/
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

모든 Git 상태 읽기는 **단일 REST 엔드포인트**가 담당한다.

| 엔드포인트 | 반환 | 특징 |
|------------|------|------|
| `GET /projects/:id/git/state?feature=...&fresh=true` | `{ snapshot: GitSnapshot, pat: GitPatState }` | `snapshot` 은 deep-frozen 읽기 전용. `fresh=true` 는 `remoteExists` 캐시(60s TTL) 를 우회 |

레거시 `/git/status` · `/git/changes` · `/push` · `/pull` · `/fetch` · `/initialize` · `/clone` · `/git/sync` · `/git/commit` · `/git/discard` 는 Phase 7 컷오버에서 전부 제거됐다. 유일하게 남은 helper 는 Wizard 의 clone 후 폴링용 `GET /projects/:id/clone/status` 뿐이다. Operation 디스패치는 모두 `POST /projects/:id/git/ops/:userOp` 로 수렴.

`ahead` / `behind` 는 로컬이 아는 원격 ref 기준이며, 최신화가 필요하면 사용자가 명시적으로 `fetch` 혹은 `sync` operation 을 디스패치한다.

## Realtime: gitState 이벤트

**SSE 타입은 `gitState` 하나**. `cause` 디스크리미넌트로 3 가지 경로를 실어 나른다:

| cause | 발행자 | 페이로드 | FE 리액션 |
|-------|--------|----------|-----------|
| `workingTreeChange` | `FileTreeBroadcaster` co-emit 및 `GitWatcherService` 폴링 | `{project, feature?, timestamp}` | `_refreshWorkingTreeDebounced` → 300ms 디바운스 후 `fetchGitWorldState` |
| `operationComplete` | `GitOperation.onSuccess` | `{project, feature?, snapshot, operation, pat, timestamp}` | `_applyGitStateEvent` — snapshot + pat 즉시 교체, operation FSM `succeeded` 반영 |
| `reconnectRefill` | 서버 SSE onOpen | `{project, feature?, snapshot, pat, timestamp}` | `_applyGitStateEvent` — 새로고침·리로드 직후 정합 상태 진입 |

발행 경로가 두 가지로 분리되는 이유 (`workingTreeChange`):

| 경로 | 트리거 | 커버 |
|------|--------|------|
| `FileTreeBroadcaster` co-emit | `notifyFileTreeUpdate` 시 함께 발행 | Job 중 워킹트리 파일 생성/수정 (`.git/index` 미변경) |
| `GitWatcherService` 폴링 | `.git/index` mtime 변화 (1s interval) | 외부 터미널 `git add/commit/checkout`, 사용자 직접 조작 |

`GitStateBroadcaster` 는 transport-agnostic (`publisher: (channel, payload) => Promise<unknown>`). Job Worker 자식 프로세스는 자체 ioredis 연결을 사용하고, HTTP/Realtime Server 는 `stateStore.publish` 를 재사용한다. 페이로드 타입은 `@ant/shared` 의 `SSEMessageMap['gitState']` (= `GitStateEventData` discriminated union).

## Frontend Git State

### SSOT — `domain/git-world/` 슬라이스

모든 Git UI 상태는 단일 Zustand 슬라이스가 소유한다:

```
git-world/
├── state.ts              # { snapshot: AsyncFields<GitSnapshot>, operation: GitOperationState, pat: AsyncFields<GitPatState> }
├── selectors.ts          # deriveGitCta / deriveGitMenu / deriveGitBadge / deriveGitSetupCta (순수 함수)
├── hooks.ts              # useGitSnapshot / useGitOperation / useGitPat / useGitCta / useGitMenu / useGitBadge / useGitSetupCta / useGitDispatch / useGitPatDispatch
├── sse-handler.ts        # registerGitStateHandler — 단일 gitState 진입
├── infrastructure/
│   └── api.ts            # git-world 내부 전용 REST 클라이언트 (ESLint 로 봉인)
└── index.ts              # 공개 API — hooks, selectors, createSlice, registerGitStateHandler, dispatchGitOpOneShot
```

`AsyncFields<T> = { data: T | null; refreshing: boolean; error: string | null; lastFetchedAt: number | null }` 는 `snapshot` / `pat` 두 곳에 공통 적용된다. `operation` 은 `GitOperationState` FSM 그대로.

### Writer 3 개 외에 mutation 없음

`domain/git-world/**` 외부에서 허용되는 쓰기는 정확히 세 가지:

- `useGitDispatch().runGitOperation(projectId, op)` — `POST /git/ops/:userOp` 디스패치. FSM 을 `running → succeeded|failed` 로 전이
- `useGitDispatch().fetchGitWorldState(projectId, opts?)` — `GET /git/state` 로 authoritative snapshot + pat 재동기화
- `useGitPatDispatch()` 의 `savePat` / `deletePat` / `fetchGitPat` — PAT 저장/삭제 후 슬라이스를 자동으로 재프라임하고 최신 PAT 상태를 반환

그 외 Git/PAT mutation 은 ESLint `no-restricted-imports` + `scripts/git-sweep.mjs` 의 P5/P13/P14/P15 패턴에서 차단된다. `infrastructure/api.ts` 는 `git-world/**` 밖에서 import 불가.

### `dispatchGitOpOneShot` (예외)

Wizard 처럼 **프로젝트가 선택되지 않은 상태에서 프로젝트를 생성하는 중**에 clone/publish 를 호출해야 하는 경우에만 사용하는 fire-and-forget 헬퍼. 슬라이스 FSM 에 영향을 주지 않고 REST 만 호출한다. 일반 소비자는 `useGitDispatch().runGitOperation` 을 사용한다.

### UI 분기는 selector 로만

프리젠테이션은 `snapshot.hasGit` 같은 필드 분기를 직접 쓰지 않고 selector hook 을 소비한다:

| Hook | 반환 union |
|------|------------|
| `useGitCta` | `loading \| noChanges \| commit(count) \| publish(variant) \| sync \| push \| pull` |
| `useGitMenu(githubRepo)` | `loading \| disabled(reason) \| setup(actions) \| publish(source) \| synced(canPush,canPull,canFetch,pullBlockedByChanges)` |
| `useGitBadge(githubRepo)` | `none \| notConfigured \| configured(branch)` |
| `useGitSetupCta` | `clone \| publish \| ambiguous` (remoteExists 프로브 결과) |

### 프로젝트/피처 전환 오케스트레이션

`(selectedProject, selectedFeature)` 전환 시 부수효과는 **app 루트의 `useProjectLifecycle` 훅 하나**가 담당한다. 슬라이스 setter 는 pure setter 에 가깝다.

```
(selectedProject, selectedFeature) 변경
  └─ useProjectLifecycle (app root, 단일 effect)
        ├─ clearGitWorld()           ; snapshot / pat 리셋 (operation 은 보존)
        ├─ clearProjectConfig()      ; projectConfigSlice 초기화
        ├─ initializeSSE()           ; 새 (project, feature) 로 재구독 → 서버가 reconnectRefill 발행
        ├─ fetchProjectConfig()      ; githubRepo 프라임
        └─ fetchGitWorldState()      ; authoritative snapshot + pat (refill 누락 대비 safety net)
```

세션 복원 루프는 `useSessionLoader` 하나만 소유한다 (`pollForFeatures` 중복 제거).

### Operation 상태 UI

`useGitOperation()` 이 `idle → running → succeeded|failed` FSM 을 반환한다. `running` / `failed` 는 `OperationProgress` 배너 컴포넌트가 인라인으로 표시하고, modal 수명과 operation 수명은 분리된다 (`AlertModal.isProcessing` 제거, `ConfirmAndDispatch` 패턴).

`failed.error.suggestedAction` 이 있으면 배너가 컨텍스트 버튼을 함께 렌더한다:

| suggestedAction | 컨텍스트 버튼 |
|-----------------|---------------|
| `configurePat` | PAT 설정 페이지 열기 |
| `resolveConflict` | IDE 에서 충돌 해결 |
| `reconfigureRepo` | 프로젝트 Config 편집 |
| `runClone` | Clone 다시 실행 |

## 관련 코드

### Backend

| 역할 | 파일 |
|------|------|
| `GitOperation<TIn,TOut>` 추상 템플릿 | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/GitOperation.ts` |
| 8 op 구체 클래스 (Publish/Push/Pull/Fetch/Sync/Commit/Discard/Clone) + `resolveGitOperation` 팩토리 | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/userOps.ts` |
| `StatusService` (`getSnapshot`, `getPat`, `checkCloneStatus`) | `packages/ant-cli/src/periphery/adapters/http/services/GitService/status/index.ts` |
| `RemoteService` (clone/init/push/pull/fetch/sync/commit/discard 구현, GitOperation 서브클래스가 내부 소비) | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/index.ts` |
| `GitService` Facade — `getSnapshot`/`getPat`/`resolveOperation`/`checkCloneStatus` | `packages/ant-cli/src/periphery/adapters/http/services/GitService/index.ts` |
| `.git/index` 폴링 → `notifyWorkingTreeChange` | `packages/ant-cli/src/periphery/adapters/http/services/GitWatcherService.ts` |
| `GitStateBroadcaster` (3 cause 발행) | `packages/ant-cli/src/core/realtime/GitStateBroadcaster.ts` |
| FileTree co-emit (`notifyWorkingTreeChange`) | `packages/ant-cli/src/core/realtime/FileTreeBroadcaster.ts` |
| REST 라우트 (`/git/state`, `/git/ops/:userOp`, `/clone/status`, PAT) | `packages/ant-cli/src/periphery/adapters/http/routes/projects.routes.ts`, `github.routes.ts` |
| SSE reconnectRefill 발행 | `packages/ant-cli/src/periphery/adapters/http/routes/sse.routes.ts`, `infrastructure/realtime/RealtimeServer.ts` |
| Feature CRUD | `packages/ant-cli/src/periphery/adapters/http/services/ProjectService/FeatureCrudService.ts` |
| Worktree | `packages/ant-cli/src/periphery/adapters/http/services/GitService/worktree/index.ts` |

### Frontend

| 역할 | 파일 |
|------|------|
| git-world 슬라이스 (`snapshot`/`operation`/`pat` SSOT) | `packages/ant-ui/src/domain/git-world/state.ts` |
| 순수 selectors (`deriveGitCta`/`Menu`/`Badge`/`SetupCta`) | `packages/ant-ui/src/domain/git-world/selectors.ts` |
| 공용 hooks (`useGitSnapshot`/`useGitOperation`/`useGitPat`/…) | `packages/ant-ui/src/domain/git-world/hooks.ts` |
| 단일 SSE 핸들러 등록 | `packages/ant-ui/src/domain/git-world/sse-handler.ts` |
| 내부 REST 클라이언트 (lint 봉인) | `packages/ant-ui/src/domain/git-world/infrastructure/api.ts` |
| 공개 API 배럴 | `packages/ant-ui/src/domain/git-world/index.ts` |
| project-world 라이프사이클 훅 | `packages/ant-ui/src/domain/project-world/lifecycle.ts` |
| project-world 훅/셀렉터 (`useGithubRepo`/`useProjectConfigSnapshot` 등) | `packages/ant-ui/src/domain/project-world/hooks.ts`, `selectors.ts` |
| Operation FSM primitive | `packages/ant-ui/src/common/operation/OperationDispatcher.ts`, `useOperation.ts`, `ConfirmAndDispatch.tsx` |
| 통합 Git UI 패널 (GitPanel / GitCta / GitBadge / GitSetupMenu / GitSyncedMenu / OperationProgress) | `packages/ant-ui/src/presentation/git-panel/**` |
| ProjectSection (GitPanel 소비) | `packages/ant-ui/src/presentation/components/ProjectSection.tsx` |
| Wizard clone/init → `dispatchGitOpOneShot` | `packages/ant-ui/src/presentation/components/ProjectWizardModal/ProjectWizardModal.tsx` |
| Clone 폴링 헬퍼만 남긴 레거시 파일 | `packages/ant-ui/src/infrastructure/http/api/github.ts` |
| SSE bridge (slice → handler) | `packages/ant-ui/src/domain/store/slices/sseSlice.ts` |

### Shared

| 역할 | 파일 |
|------|------|
| SSE 이벤트 타입 (`SSEMessageType`, `SSEMessageMap`, `GitStateEventData`) | `packages/ant-shared/src/sse-events.ts` |
| Git 도메인 계약 (`GitSnapshot`, `GitUserOperation`, `GitOperationState`, `GitOperationError`, `GitSuggestedAction`, `GitPatState`, `FileChange`) | `packages/ant-shared/src/git.ts` |

### Enforcement

| 역할 | 파일 |
|------|------|
| 18 구조적 패턴 CI 게이트 | `scripts/git-sweep.mjs` (`pnpm git:sweep`) |
| 경계 ESLint (`no-restricted-imports` error) | `packages/ant-ui/.eslintrc.cjs` |
| 에이전트 스킬 (Git 작업 전 필독) | `.claude/skills/update-git-world/SKILL.md` |
| 셀렉터/디스패처 스펙 | `packages/ant-ui/tests/git-world/**`, `tests/common/**`, `tests/project-world/**` |

## 경계

- 워크스페이스 격리: [20-workspace-isolation.md](20-workspace-isolation.md)
- 인프라 (Redis, BullMQ): [02-infrastructure.md](02-infrastructure.md)
- 실시간 시스템 전반: [21-realtime-system.md](21-realtime-system.md)
- 프론트엔드 레이어 구조: [30-frontend-architecture.md](30-frontend-architecture.md)
