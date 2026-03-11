# Git Operations

## 개요

ANT는 GitHub를 통한 Git 연동을 지원한다. 프로젝트 생성 후 Git을 연결하는 3가지 Operation(Clone, Init, Publish)과 연결 후 사용하는 3가지 Operation(Push, Pull, Fetch)이 있다.

## Operation 정의

| Operation | 역할 | 원격 레포 | 로컬 .git | Feature |
|-----------|------|:---------:|:---------:|:-------:|
| **Clone** | 기존 원격 레포를 로컬로 다운로드 | 있어야 함 | 없어야 함 | 없어야 함 |
| **Init** | 로컬 코드로 새 원격 레포 생성 후 push | 없어야 함 | 없어야 함 | 없어야 함 |
| **Publish** | 로컬 코드 + feature로 새 원격 레포 생성 후 push | 없어야 함 | 없어야 함 | OK |
| **Push** | 로컬 변경사항을 원격에 업로드 | 연결됨 | 있어야 함 | - |
| **Pull** | 원격 변경사항을 로컬로 다운로드 | 연결됨 | 있어야 함 | - |
| **Fetch** | 원격 refs 업데이트 (코드 변경 없음) | 연결됨 | 있어야 함 | - |

## 상황별 가능 여부

```
                    원격 레포 없음              원격 레포 있음
              +----------------------+   +------------------------+
Feature 없음  |  Clone  X (레포없음)  |   |  Clone  O              |
              |  Init   O            |   |  Init   X (레포존재)    |
              |  Publish O           |   |  Publish X (레포존재)   |
              +----------------------+   +------------------------+
Feature 있음  |  Clone  X (레포없음)  |   |  Clone  X (feat존재)   |
              |  Init   X (feat존재) |   |  Init   X (둘다불가)    |
              |  Publish O           |   |  Publish X (레포존재)   |
              +----------------------+   +------------------------+

.git 이미 존재 → 3개 모두 불필요, Push/Pull/Fetch 사용
```

### 사용자 가이드: "어떤 것을 써야 하나?"

| 상황 | 올바른 선택 | 비고 |
|------|-----------|------|
| 원격 없음 + Feature 없음 | **Init** 또는 Publish | 새 레포 생성 |
| 원격 없음 + Feature 있음 | **Publish** (유일한 선택) | feature 브랜치도 함께 push |
| 원격 있음 + Feature 없음 | **Clone** (유일한 선택) | 기존 레포 다운로드 |
| 원격 있음 + Feature 있음 | **막힘** | feature 삭제 후 Clone, 또는 원격 주소 변경 후 Publish |

## Clone이 Feature를 허용하지 않는 이유

Feature 코드는 Git base 없이 AI가 PRD 기반으로 독립 생성한 코드이다. 원격 레포를 clone하면 base branch는 원격의 코드인데, feature 코드는 이 base와 무관하다.

이 둘을 git 브랜치 관계로 엮으면 diff가 "기존 파일 전체 삭제 + 새 파일 전체 추가"가 되어 의미없는 feature branch가 생성된다.

반면 Publish에서는 feature 코드 자체를 base branch의 seed로 사용하므로, base와 feature가 같은 출발점을 공유하여 diff가 의미있다.

## 공통 전제 조건

- `config.json`의 `githubRepo` 필드 설정 필수
- GitHub PAT 설정 필수 (Account Configuration)
- `.git` 이미 존재 시 Clone/Init/Publish 모두 불가 (이미 연결됨)

## 상태 전이

```
[프로젝트 생성] → NoGit (미연동)
                    │
                    ├── feature 생성 → NoGit + HasFeatures
                    │
                    ├── Clone 성공 ──→ Connected (연동됨)
                    ├── Init 성공 ──→ Connected (연동됨)
                    └── Publish 성공 → Connected (연동됨)
                                        │
                                        ├── Push/Pull/Fetch → Connected
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
│   └── .git/             ← Clone/Init/Publish 후 생성
└── features/
    └── {featureName}/
        ├── codebase/     ← git worktree (feature branch) 또는 일반 디렉터리
        ├── inputs/
        ├── outputs/
        └── sessions/
```

- Git 연결 전: `features/{name}/codebase/`는 일반 디렉터리
- Git 연결 후 feature 생성: `features/{name}/codebase/`는 `feature/{name}` 브랜치의 git worktree

## 에러 분류 기준

라우트 핸들러에서 Operation 에러를 HTTP 상태 코드로 분류:

| 상태 코드 | 의미 | 예시 |
|-----------|------|------|
| 400 | 사전 조건 불충족 | feature 존재, config 미설정, 레포 not found |
| 401 | 인증 실패 | PAT 만료, 권한 부족 |
| 409 | 충돌 | 이미 clone됨, 원격 레포 이미 존재 |
| 500 | 서버 에러 | 예상치 못한 git 명령 실패 |

프론트엔드는 400/401/409 응답의 `error` 필드를 모달로 표시한다. 500은 "Internal Server Error"로 대체되므로, known 에러는 반드시 400/401/409으로 분류해야 한다.

## 관련 코드

| 역할 | 파일 |
|------|------|
| Clone | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/CloneOperation.ts` |
| Init | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/InitOperation.ts` |
| Publish | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/PublishOperation.ts` |
| 라우트 | `packages/ant-cli/src/periphery/adapters/http/routes/projects.routes.ts` |
| Git 상태 조회 | `packages/ant-cli/src/periphery/adapters/http/services/GitService/status/index.ts` |
| UI 드롭다운 | `packages/ant-ui/src/presentation/components/ProjectSection.tsx` |
| UI 설정 뱃지 | `packages/ant-ui/src/presentation/components/ConfigEditor/components/ConfigField.tsx` |
| UI 위저드 뱃지 | `packages/ant-ui/src/presentation/components/ProjectWizardModal/StepGitIntegration.tsx` |

## 경계

- 워크스페이스 격리: [10-workspace-isolation.md](10-workspace-isolation.md)
- 인프라 (Redis, BullMQ): [01-infrastructure.md](01-infrastructure.md)
