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

## 관련 코드

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
| 라우트 | `packages/ant-cli/src/periphery/adapters/http/routes/projects.routes.ts` |
| UI 드롭다운 | `packages/ant-ui/src/presentation/components/ProjectSection.tsx` |
| UI Git 버튼 | `packages/ant-ui/src/presentation/components/GitStatusButton/index.tsx` |
| UI 변경 패널 | `packages/ant-ui/src/presentation/components/GitStatusButton/components/GitChangesPanel.tsx` |
| UI API 클라이언트 | `packages/ant-ui/src/infrastructure/http/api/github.ts` |

## 경계

- 워크스페이스 격리: [20-workspace-isolation.md](20-workspace-isolation.md)
- 인프라 (Redis, BullMQ): [02-infrastructure.md](02-infrastructure.md)
