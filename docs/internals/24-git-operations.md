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
| `GitCloneResult` | clone 응답 result — `{ defaultBranch, feature }` (clone 이 자동 생성한 feature 이름 포함) |

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
| S1/S2: `!hasGit` (anchor 없음 = feature 0개) | 도달 불가 — init variant 는 feature ≥ 1 을 요구하고, 첫 feature 가 anchor 를 생성하므로 feature 가 있으면 항상 `hasGit=true`. feature 0개 publish 는 guard 로 거부 |
| S3: `hasGit && !hasRemote` | GitHub repo 생성 → `remote add origin` + fetch refspec → `git push -u origin {branchBase}` (사용자가 고른 base 가 GitHub default branch) → `remote set-head origin {branchBase}` best-effort (init). 실패 시 rollback 은 `remote remove origin` 만 — `repo.git` 은 절대 삭제하지 않는다 |
| S4: `hasGit && hasRemote && !hasUpstream` | `git push -u` (publish-branch) |

FE 는 어느 분기인지 알지 못한 채 `{ kind: 'publish' }` 만 디스패치한다. init variant 의
구현 SSOT 는 `GitService/anchor/GitAnchorSSOT.ts` — 옛 `GitBootstrapSSOT` /
`BaseGitSetupOperation` 은 삭제됐다.

---

## 개요

ANT는 GitHub를 통한 Git 연동을 지원한다. 프로젝트 생성 후 Git을 연결하는 2가지 Setup Operation(Clone, Init)과 연결 후 사용하는 6가지 Operation(Push, Pull, Fetch, Commit, Sync, Discard)이 있다.

## Operation 정의

| Operation | 역할 | 원격 레포 | 로컬 anchor (`repo.git`) | Feature |
|-----------|------|:---------:|:---------:|:-------:|
| **Clone** | 기존 원격 레포를 bare anchor 로 다운로드 + default-branch feature 자동 생성 | 있어야 함 | 없어야 함 | **0개 필수** (BE hard guard → 409) |
| **Init** | 로컬 anchor 로 새 원격 레포 생성 후 push | 없어야 함 | 존재 (첫 feature 가 lazy 생성) | **≥ 1 필수** |
| **Commit** | 변경사항을 로컬 커밋 | 연결됨 | 있어야 함 | - |
| **Push** | 로컬 커밋을 원격에 업로드 (upstream 없으면 자동 설정) | 연결됨 | 있어야 함 | - |
| **Pull** | 원격 변경사항을 로컬로 다운로드 | 연결됨 | 있어야 함 | - |
| **Fetch** | 원격 refs 업데이트 (코드 변경 없음) | 연결됨 | 있어야 함 | - |
| **Sync** | Fetch + Pull + Push 순차 실행 | 연결됨 | 있어야 함 | - |
| **Discard** | 커밋되지 않은 변경사항 되돌리기 | - | 있어야 함 | - |

## 상황별 가능 여부

```
                    원격 레포 없음                       원격 레포 있음
              +------------------------------+   +------------------------------+
Feature 없음  |  Clone  X (레포없음)          |   |  Clone  O (default-branch     |
              |  Init   X (feature 필요)      |   |           feature 자동 생성)  |
              |                              |   |  Init   X (레포존재)          |
              +------------------------------+   +------------------------------+
Feature 있음  |  Clone  X (feature 존재 →409) |   |  Clone  X (feature 존재 →409) |
              |  Init   O                    |   |  Init   X (레포존재)          |
              +------------------------------+   +------------------------------+

anchor 존재 + remote 있음 → Clone/Init 불필요, Push/Pull/Fetch/Commit/Sync/Discard 사용
anchor 존재 (feature ≥ 1) + remote 없음 → Init(publish) 허용
```

### UI 메뉴 구조

| 상태 | Git 메뉴 항목 |
|------|--------------|
| Setup Mode (`!hasGit`) | Clone / Initialize |
| Connected Mode (`hasGit`) | Push / Pull / Fetch |

Connected Mode에서 ActionButton이 상황에 따라 Commit / Publish Branch / Push / Pull / Sync / No Changes를 자동 표시한다.

feature 가 하나라도 있으면 Clone 항목은 disabled + notice 로 표시된다
(`deriveGitMenu.cloneBlockedByFeatures`) — Clone 은 feature 0개일 때만 허용.

## Worktree 생명주기

### Bare anchor vs .git marker 파일

- `{projectPath}/repo.git/` (bare anchor) — 프로젝트의 **유일한 실제 저장소**. 숨김 bare repo 로, `HEAD` 는 `refs/heads/{branchBase}` 로의 symref, worktree 메타는 `repo.git/worktrees/{id}/` 에 저장된다. 옛 `{project}/codebase/` main worktree 는 존재하지 않는다.
- `features/{name}/codebase/.git` (파일) — linked worktree 참조 파일, **항상 절대경로** `gitdir: <absolute path>/repo.git/worktrees/{id}` 형태로 git 이 작성한다 (CLI flag 로 변경 불가). worktree 메타 디렉토리 이름은 worktree 경로의 마지막 path 컴포넌트(보통 `codebase`)에서 파생되며, 충돌 시 git 이 자동 disambiguate 해 `codebase1` 등으로 만든다.

feature 가 하나도 없는 프로젝트는 codebase 도, git 도 없다 — anchor 는 **첫 feature 생성 시 lazy 하게** 만들어진다 (`GitAnchorSSOT.ensureAnchor`; empty 상태의 initial commit 은 `hash-object -t tree` / `commit-tree` / `update-ref` plumbing 으로 생성).

### 브랜치 명명

브랜치 이름 == feature 이름 **정확히 동일** — `feature/` prefix 없음, sanitization 없음. feature 이름은 `/` 를 포함할 수 있으며(`feature/base`, `release/1.0`), 브랜치명으로 그대로 쓰인다. git `check-ref-format` 위반(`~`, `//`, leading/trailing `/`, `..`, `.lock` 세그먼트 등)만 생성 시점에 거부된다 (`@ant/shared` `validateFeatureName`). `GitHelper.sanitizeBranchName` 은 삭제됐다.

feature 이름은 파일시스템 디렉토리 세그먼트·URL 경로 세그먼트·redis 키(IDE serverKey)에서 `/`-free **슬러그**로 투영된다 (`@ant/shared` `featureNameToSlug`/`featureSlugToName`, `/ ↔ ~`). 디스크상 worktree 는 `features/{slug}/codebase/` 이고 git 브랜치는 날 이름(`release/1.0`)이다. clone 은 remote 기본 브랜치에 `/` 가 있어도 그대로 내려받아 동명 feature 를 만들고 `origin/{name}` 을 트래킹한다.

### Bare anchor 접근 (GIT_DIR)

anchor 를 대상으로 하는 모든 git 명령은 명시적 `GIT_DIR` 로 실행한다 (`GitHelper.bareAnchorEnv` / `getBareGitInstance`) — `safe.bareRepository=explicit` 환경에서도 동작한다. env 는 whitelist 방식 (simple-git 이 editor/pager 류 var 를 거부하므로).

### Worktree validity (Stage-4 SSOT)

**`GitHelper.isWorktreeStructureValid(featureCodebasePath)`** 가 단일 진실 원천이다. 4 단계 검사:

1. `.git` 파일 존재 (worktree marker 있음)
2. `gitdir:` 형식 파싱 성공
3. 그 절대경로 디렉토리 (`<project>/repo.git/worktrees/<id>/`) 존재
4. 그 디렉토리에 `HEAD` + `commondir` 두 파일 모두 존재

검사가 cheap (4 stat) 이라 모든 critical path 에서 호출. 새 helper 추가 금지 — partial worktree (NFS partial write / interrupted `git worktree add`) 는 단일 SSOT 로 검출.

### Worktree validity 호출 site

| Phase | Call site | 효과 |
|-------|-----------|------|
| pre-existing dir 검사 | `WorktreeService.createWorktree` | partial gitdir 가 valid 로 false-positive 되는 회귀 차단 |
| post-create probe | `WorktreeService.createWorktree` | `git worktree add` exit-code 0 인데 partial 인 케이스 검출 + throw |
| orphan 강화 | `WorktreeService.pruneCorruptWorktreeMeta` | partial meta 디렉토리도 자동 회수 |
| Stage-4 self-heal | `ensureGitRepository` | corrupt worktree 를 `createWorktree` re-attach 로 복구 (브랜치는 anchor 에 살아있음; corrupt worktree 의 uncommitted changes 는 폐기) |
| defense-in-depth | `StatusService.getGitChanges` | "not a git repository" 에러 시 structured `worktreeValidityFailure` 로그 emit |

### IDE Pod Multi-Mount Topology (Cloud / K8s)

worktree marker 가 절대경로를 가리키므로, IDE pod 가 그 절대경로를 컨테이너 안에서 실제로 해소할 수 있어야 한다. K8s pod 는 단일 subPath 마운트만 가지면 `/mnt/workspaces/<...>/repo.git/worktrees/<id>` 경로가 컨테이너 안에 존재하지 않아 git 인식 실패.

해결: **alias-model multi-mount** (Docker `resolveWorktreeBindMounts` 와 K8s `resolveK8sWorktreeMounts` 모두 동형):

| Mount | mountPath | subPath | 책임 |
|-------|-----------|---------|------|
| Primary alias | `/workspace` | `<tenant>/<user>/<project>/features/<feat>/codebase` | 사용자에게 노출되는 작업 경로 |
| mainGitDir | `<base>/<...>/repo.git` (절대) | 동일 prefix | worktree marker 의 gitdir 절대경로 (`repo.git/worktrees/<id>`) 가 컨테이너 안에서 해소되도록 |
| worktreePath | `<base>/<...>/features/<feat>/codebase` (절대) | 동일 prefix | 메타 dir 의 back-reference (`<gitdir>/gitdir` 파일이 가리키는 worktree 절대경로) 가 해소되도록 |

IDE pod 는 **feature 필수** — feature 없는 프로젝트는 codebase 자체가 없으므로 "base branch pod" 는 더 이상 존재하지 않는다.

`.git` 파싱은 `GitHelper.resolveWorktreeAbsPaths` 가 단일 SSOT — Docker/K8s 두 함수는 path 결과만 받아 자기 format (Docker bind 문자열 / K8s mount 객체) 만 책임. 새로 같은 파싱 로직 만들면 `tests/policy/worktree-mount-dedup.test.ts` 가 차단.

### ANT_WORKSPACE_BASE_PATH 동일성 invariant

API 서버 / IDE pod / job worker 가 **모두 같은** `ANT_WORKSPACE_BASE_PATH` 값을 보아야 한다. 다르면 worktree marker 의 절대경로가 한쪽에서만 해소돼 IDE 가 git 을 인식 못하거나 API 서버가 worktree 를 valid 로 잘못 판정한다. `KubernetesIDEOrchestrator.assertWorkspacePathInBase` 가 startup 시 fail-fast 검증.

### IDE Pod Mount Drift Auto-Recreate

존재하는 pod 의 `volumeMounts.length` 가 `resolveK8sWorktreeMounts` 가 지금 돌려주는 expected count 와 다르면 (예: 옛 race 케이스에서 만들어진 1-mount pod 가 지금은 worktree valid 라 3 mount 가 expected) `KubernetesIDEOrchestrator.start` 가 자동으로 pod 를 delete + recreate. pod spec 은 immutable 이므로 stale broken pod 는 이 경로로만 복구 가능.

### Feature의 Git 상태 전이

```
[Feature 생성] → Worktree 즉시 attach (.git marker 파일 생성;
                 첫 feature 는 anchor lazy 생성 + branchBase = feature 이름 auto-set)
                    │
                    ├── 코드 변경 → Uncommitted Changes
                    ├── Commit → Local Commits
                    ├── Push → Synced with Remote
                    ├── Publish Branch → upstream 설정됨
                    ├── Discard → Clean State
                    │
                    └── worktree 손상 감지 → self-heal: createWorktree re-attach
                          (브랜치는 anchor 에 살아있으므로 커밋 이력 보존;
                           corrupt worktree 의 uncommitted changes 는 폐기)
```

feature = linked worktree 는 **생성 시점부터** 성립한다 — "git 없는 feature codebase" 상태는 존재하지 않는다.

### Clone — feature 0개 전제 + default-branch feature 자동 생성

Clone 은 feature 가 **0개일 때만** 허용된다 (BE hard guard → 409; FE 는 `deriveGitMenu.cloneBlockedByFeatures` 로 clone 항목 disabled + notice). 절차:

1. `git clone --bare` → `{project}/repo.git`
2. 명시적 fetch refspec `+refs/heads/*:refs/remotes/origin/*` 설정
3. remote HEAD → branchBase 로 반영 후 잠금 (`hasRemote` = LOCK)
4. 원격 default branch 이름의 feature 를 **자동 생성** (worktree attach) — 사용자가 바로 코드를 볼 수 있게

응답 result 는 `GitCloneResult { defaultBranch, feature }` (`@ant/shared`). 옛 `FeatureCodebaseBackup` / temp-clone flatten / `SourceDetector` 경로는 삭제됐다.

### Corrupt Worktree Self-heal (`ensureGitRepository`)

`ensureGitRepository` 는 feature 를 요구한다 — 옛 gitBootstrap / featureBackup 입력은 없다 (fetch 만 `allowAnchor` 로 bare anchor 대상 실행 가능). feature codebase 의 worktree 가 손상되면 self-heal 은 `createWorktree` re-attach — 브랜치는 anchor 에 살아있으므로 커밋 이력은 보존되지만, corrupt worktree 의 uncommitted changes 는 폐기된다. 옛 backup → restore 경로는 삭제됐다.

### Worktree 안전성

WorktreeService.createWorktree는 기존 디렉터리 발견 시:
1. `GitHelper.isWorktreeStructureValid` (Stage-4: `.git` marker + gitdir 디렉토리 + HEAD + commondir) 로 검증
2. valid → early return (재생성 불필요)
3. 손상/누락 (`worktreeValidityFailure` 로그 emit) → `git worktree remove` → `git worktree prune` → 재생성

`git worktree add` 직후에는 `pollWorktreeValidity` (3 회 × 100ms) 로 EFS NFS 의 eventual consistency lag 흡수 후 최종 invalid 면 `GitOperationError` throw — silent partial create 차단.

### Worktree 생성 시 브랜치 선택 사다리

`WorktreeService.createWorktree` 는 origin convergence (아래 섹션) 후 아래 순서로 브랜치를 결정한다 (브랜치 이름 == feature 이름):

1. 원격 브랜치 존재 → `--track -b` (bare-clone 이 import 한 shadowing 로컬 head 는 먼저 `branch -D` — stale tip + no-upstream 방지)
2. 로컬 브랜치 존재 (원격 counterpart 없음) → attach
3. 로컬 branchBase 브랜치 존재 → 그로부터 fork
4. 원격 `origin/{branchBase}` 존재 → 그로부터 fork (`--no-track` — 새 브랜치가 base 의 upstream 을 물려받으면 Publish affordance 가 깨진다). converge 된 anchor 는 fetch 로 `refs/remotes/origin/*` 만 채워지므로 (clone 과 달리 로컬 head import 없음) 이 스텝이 없으면 원격에 없는 새 feature 가 orphan 으로 낙하한다.
5. anchor 에 HEAD commit 존재 → HEAD 로부터 fork
6. empty anchor → plumbing initial commit 후 attach + seed `.gitignore`/`README` commit

`repoType: 'local'` 은 모든 것을 short-circuit 한다 (사용자 소유 localPath; anchor/worktree/branch 조작 없음) — 옛 `mainCodebasePath === worktreePath` path-equality 가드는 `config.repoType === 'local'` 가드로 대체됐다.

### Origin Convergence (`WorktreeService.syncOriginState`)

`config.githubRepo` 는 clone/init **전에** 기록되므로 "githubRepo 설정됨 ≠ 연동됨". createWorktree 는 래더 진입 전에 anchor 의 origin 상태를 config 와 **트랜잭셔널**하게 수렴시킨다:

1. anchor 에 origin 없음 + `config.githubRepo` 존재 → `remote add origin <PAT URL>` + fetch refspec 백필 (`ensureOriginWithRefspec`; origin 이 이미 있으면 `set-url` + refspec 백필만 — 구 clone 앵커의 refspec 누락도 여기서 치유)
2. `git fetch origin` 프로브 → 성공 + 원격 tracking ref ≥ 1 일 때만 origin 유지
3. 아니면 `remote remove origin` 롤백 — origin 존재는 branchBase lock 및 Init/Clone 자격 신호이므로 "실제 원격과 ref 를 교환한 적 있음"의 의미를 지켜야 한다
4. no-origin→origin 전이 성공 시 `applyAfterRemoteConverge` 가 remote HEAD 를 branchBase 로 1회 기록 (clone 의 remote-HEAD 기록의 지연 버전)

fetch 프로브 실패 분류:

| 실패 | 동작 |
|---|---|
| PAT 미등록 (`buildAuthenticatedUrl` throw) | convergence 스킵, 기존 origin fetch best-effort |
| repository not found | 롤백 후 로컬 래더 (Publish/init 플로우 — repo 가 아직 없는 선언 상태) |
| origin 이 원래 있던 anchor | stale tracking ref 로 진행 (일시 장애가 feature 생성을 막지 않음) |
| 전이 시도 + anchor 에 커밋 있음 | warn 후 로컬 래더 |
| 전이 시도 + **빈 anchor** + auth 거부 | `GitAuthError` throw (non-retryable) |
| 전이 시도 + **빈 anchor** + 네트워크/기타 | `GitNetworkError` throw (retryable) — 연동된 legacy 프로젝트에서 일시 장애가 영구 orphan 분기로 굳는 것 차단 |

이 convergence 가 **legacy 프로젝트** (bare anchor 이전, `{project}/codebase/.git` 시대에 연동됨) 의 anchor 편입 경로다: 첫 feature 생성이 origin 을 붙이고 기존 원격 브랜치를 추적한다. 옛 feature 들은 자기 gitdir (구 `codebase/.git` worktree) 로 계속 동작하며 마이그레이션되지 않는다.

## Publish Branch

Feature에서 처음 Push할 때 upstream이 설정되지 않은 경우:
- `git push -u origin {featureName}` 실행 (Publish Branch — 브랜치 이름 == feature 이름)
- UI에서는 ActionButton에 "Publish Branch" 버튼으로 표시
- 이후 Push는 일반 `git push origin {featureName}`

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

## Anchor Lazy 초기화 (첫 Feature 생성 시)

프로젝트 생성 시점에는 git 을 만들지 않는다 — feature 가 없는 프로젝트는 codebase 도 git 도 없다. **첫 feature 생성 (0→1)** 시 `GitAnchorSSOT.ensureAnchor` 가:

1. `{project}/repo.git` bare anchor 생성 (HEAD symref → `refs/heads/{branchBase}`)
2. plumbing 으로 initial commit 생성 (`hash-object -t tree` / `commit-tree` / `update-ref`)
3. branchBase = 첫 feature 이름 auto-set (+ anchor HEAD symref)
4. feature worktree attach + seed `.gitignore`/`README` commit

이후 Init(publish) 은 remote 설정 후 이 anchor 를 GitHub 에 연결한다.

## branchBase 포인터

`branchBase` 는 anchor HEAD 가 가리키는 base 브랜치 포인터다. **유일한 writer 는 `GitService/anchor/branchBaseLifecycle.ts`**:

- default `'main'`
- 첫 feature (0→1) 생성 → branchBase = feature 이름 auto-set (+ anchor HEAD symref)
- base feature 삭제 → 생성 순서상 가장 오래된 남은 feature 로 재지정, 없으면 `'main'`
- 사용자는 ConfigEditor dropdown 에서 기존 feature 중 하나로 선택 가능 — **remote 미연결 상태에서만**
- origin convergence (no-origin→origin 전이, legacy 프로젝트 편입) → `applyAfterRemoteConverge` 가 remote HEAD 를 1회 기록
- LOCK 조건: anchor 에 origin remote 존재 (`hasRemote`)

read-time git-sync 는 없다 — `detectGitDefaultBranch` 는 삭제됐고, fetch 는 더 이상 remote-HEAD drift 를 branchBase 에 미러링하지 않는다.

## 공통 전제 조건

- `config.json`의 `githubRepo` 필드 설정 필수 (Clone/Init/Push/Pull/Fetch/Sync)
- GitHub PAT 설정 필수 (Account Configuration)
- anchor + remote 이미 존재 시 Clone/Init 불가 (이미 연결됨)
- Clone 은 feature 0개 필수, Init 은 feature ≥ 1 필수

## Feature 없음 상태 (`_base` sentinel 삭제)

`RESERVED_FEATURE_NAME('_base')` sentinel 과 `isBaseBranch` 는 삭제됐다. "feature 미선택" 의 의미:

- working tree 없음 — IDE / job 라우트는 feature 를 **요구**한다
- git 읽기 (`GET /git/state` without `feature`) 는 bare anchor 에서 서빙: `hasGit` = anchor 존재, `currentBranch` = anchor HEAD = branchBase, `hasCodebase=false`, changes 는 빈 값
- 내부 redis-key fallback 상수: `NO_FEATURE_KEY='@none'` (`redisKeyUtils`; 방어적 용도만)

## 상태 전이

```
[프로젝트 생성] → NoGit (codebase 없음, git 없음 — anchor 는 첫 feature 가 lazy 생성)
                    │
                    ├── 첫 feature 생성 → LocalAnchor (bare anchor + worktree,
                    │                      branchBase = feature 이름, remote 없음)
                    │
                    ├── Clone 성공 (feature 0개 전제) ──→ Connected
                    │     (bare anchor + default-branch feature 자동 생성, branchBase LOCK)
                    └── Init(publish) 성공 (feature ≥ 1) ──→ Connected
                          (remote add + push -u {branchBase})
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
├── repo.git/             ← bare anchor (숨김; HEAD symref → refs/heads/{branchBase})
│   └── worktrees/{id}/   ← linked worktree 메타 (HEAD, commondir, gitdir 등)
└── features/
    └── {featureName}/
        ├── codebase/     ← linked worktree (브랜치 이름 == feature 이름)
        │   └── .git      ← worktree marker 파일 (gitdir: <abs>/repo.git/worktrees/{id})
        ├── plan/
        ├── architecture/
        ├── visual/
        ├── assets/
        ├── meta/
        └── sessions/
```

- feature 없는 프로젝트: codebase 없음, git 없음 (`repo.git` 은 첫 feature 생성 시 lazy 생성)
- 모든 feature codebase 는 생성 시점부터 linked worktree — `.git` marker 가 `repo.git/worktrees/{id}` 를 가리킨다
- worktree 손상 시: self-heal = `createWorktree` re-attach (커밋 이력은 anchor 브랜치에 보존, uncommitted changes 폐기)

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

`feature` 파라미터 없이 호출하면 **bare anchor 기준**으로 서빙한다: `hasGit` = anchor 존재, `currentBranch` = anchor HEAD = branchBase, `hasCodebase=false`, changes 빈 값. anchor 대상 git 명령은 명시적 `GIT_DIR` (`GitHelper.bareAnchorEnv`) 로 실행된다.

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
| Anchor SSOT (`ensureAnchor`, init variant 구현) | `packages/ant-cli/src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT.ts` |
| branchBase 포인터 단일 writer | `packages/ant-cli/src/periphery/adapters/http/services/GitService/anchor/branchBaseLifecycle.ts` |

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

## 참조 카탈로그 어휘

- reference catalog 의 브랜치 = feature 이름 verbatim (prefix/sanitization 없음)
- `ReferenceTarget.branch` 생략 → 대상 프로젝트의 branchBase

## 경계

- 워크스페이스 격리: [20-workspace-isolation.md](20-workspace-isolation.md)
- 인프라 (Redis, BullMQ): [02-infrastructure.md](02-infrastructure.md)
- 실시간 시스템 전반: [21-realtime-system.md](21-realtime-system.md)
- 프론트엔드 레이어 구조: [30-frontend-architecture.md](30-frontend-architecture.md)
