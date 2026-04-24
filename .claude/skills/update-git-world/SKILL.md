---
name: update-git-world
description: ANT의 Git/GitHub 연동, PAT 관리, Git SSE 이벤트, Git 관련 UI 상태 변경 시 자동 호출. `git-world` 불변 계약을 강제한다.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

`domain/git-world/`, `common/operation/`, `presentation/git-panel/`,
`GitService`, `GitOperation`, `GitChangeBroadcaster`, `GitStateEventData`,
또는 Git/PAT/Publish/Sync/Clone/Fetch 와 연관된 파일을 수정할 때
**반드시 먼저 이 SKILL 을 읽고 따른다**. $ARGUMENTS

## 1. 선행 독해 (필수)

아래 3개 문서를 정독한 후 작업을 시작한다:

- `docs/architecture/24-git-operations.md` — Ant Git 어휘 스펙 + 상태 매트릭스
- `docs/tmp/git-world-greenfield-rewrite-handoff.md` §3, §7, §12, §13
- `CLAUDE.md` 의 Git SSOT 섹션

## 2. Ant Git 어휘 (FE 금지어)

이하 용어는 FE 코드에 등장할 수 없다. 등장 요청이 들어오면 **거부**하고
대안을 제시한다:

| 금지어 | 대안 |
|-------|------|
| `status`, `gitStatus`, `getGitStatus`, `fetchGitStatus` | `GitSnapshot`, `useGitSnapshot`, `fetchGitWorldState` |
| `changes`, `gitChanges`, `getGitChanges`, `fetchGitChanges` | 동일 — 모두 `GitSnapshot` 한 필드셋 |
| `initialize`, `initializeOperation`, `InitOperation` | `publish` user op (BE 가 S1/S2/S3/S4 로 폴리모픽 해결) |
| `publish-branch`, `publishBranch` | `publish` (동일 어휘로 통합) |
| `fetchGitAll`, `fetchFromRemote`, `refreshGitStatus` | 단일 `fetchGitWorldState` |
| `gitStatusPhase`, `statusFetchState`, `changesFetchState` | FSM `GitOperationState` (running/failed/succeeded) |
| `useState<boolean> isPushing/isCommitting/...` | `useGitOperation()` — 슬라이스가 FSM 소유 |
| `AlertModal.isProcessing`, `async onConfirm` | `ConfirmAndDispatch` + `OperationDispatcher` |

## 3. 구조적 불변

- **SSOT**: Git 상태는 `GitSnapshot` 1개. `gitStatus` + `gitChanges` 로 쪼개지 않는다.
- **Writer 3개**: `runGitOperation`, `savePat`, `deletePat` 만이 git-world 밖에서 호출 가능한 writer. 새 writer 추가 금지.
- **SSE 1 이벤트**: `gitState` (discriminated union — `workingTreeChange` / `operationComplete` / `reconnectRefill`). 새 Git SSE 이벤트 타입 추가 금지.
- **REST 2 엔드포인트**: `GET /projects/:id/git/state` + `POST /projects/:id/git/ops/:userOp`. 다른 엔드포인트 추가 금지.
- **FSM 단일**: `GitOperationState` = `idle | running | failed | succeeded`. local per-component `useState` 금지.
- **BE onSuccess 대칭**: 모든 `GitOperation` 은 `onSuccess` 에서 snapshot publish + `retryDeferredWatchers` + (옵션) indexing. 특정 op 에만 추가 금지.
- **Immutability**: `GitSnapshot` 은 `Readonly<...>` + `Object.freeze`. `as` 로 우회 금지.

## 4. 신규 요청 대응 규칙

"새 Git 관련 기능 추가" 요청이 들어오면 먼저 아래 체크리스트:

1. **새 user op 이 필요한가?** — `GitUserOperation` 8개 안에 매핑되면 추가 X. 굳이 필요하면 `@ant/shared/src/git.ts` 의 `GitUserOperation` 유니언에 추가 + BE `resolveGitOperation` + `OperationProgress` 라벨/에러 맵 3곳 동시 수정.
2. **새 상태 필드가 필요한가?** — `GitSnapshot` 에 추가 (Readonly 유지) + `StatusService.getSnapshot` 계산 추가 + selector 갱신.
3. **새 에러 분기가 필요한가?** — `GitOperationErrorKind` / `GitSuggestedAction` 유니언 확장 + BE `errors.ts` 서브클래스 + FE `OperationProgress` 라벨.
4. **새 UI 자리가 필요한가?** — `presentation/git-panel/` 내부에만 추가. 다른 폴더에 git 전용 컴포넌트 만들지 말 것.

## 5. 구조 검증

수정 후 반드시 아래를 실행하고 모두 통과해야 한다:

```bash
pnpm git:sweep            # 18 rg 패턴 (cutover 후엔 GIT_SWEEP_ALLOW_LEGACY 없이)
pnpm typecheck            # ant-cli + ant-ui 공통
pnpm lint                 # ESLint 5 규칙 포함
pnpm test:git             # git-world + ant-cli/tests/git 통합 테스트
```

## 6. 실패 회복 유도

작업이 복잡해질 때 "중간에 일단 레거시 경로 사용" 같은 우회를 금지한다.
불변을 깨뜨릴 방법밖에 보이지 않으면 작업을 중단하고 사용자에게 설계
변경을 제안한다 (신규 user op / 신규 snapshot 필드 / 신규 에러 분기 중
어느 것인지 명시).
