# Git Operations

> **Greenfield SSOT (git-world)** — This document is the single source of truth for
> Ant's Git domain vocabulary, state, SSE events, and REST endpoints. Before writing
> any new Git-related code, read this document and `.claude/skills/update-git-world/SKILL.md` first.

## 0. The git-world Contract

**Ant Git vocabulary (FE official)** — the FE dispatches only these 8 user operations:
`publish`, `push`, `pull`, `fetch`, `sync`, `commit`, `discard`, `clone`.
Canonical git vocabulary (`status`, `changes`, `initialize`, `publish-branch`) never
appears on the FE type surface.

### Type SSOT — `@ant/shared/src/git.ts`

| Type | Role |
|------|------|
| `GitSnapshot` | Unified readonly state (hasGit/hasRemote/ahead/behind/staged/unstaged/untracked, etc.). Mutation prohibited via `Object.freeze` + `Readonly<>` |
| `GitUserOperation` | Discriminated union of the 8 user ops |
| `GitOperationState` | 4-state FSM (`idle` / `running` / `failed` / `succeeded`) |
| `GitOperationError` | `{ kind, message, retryable, suggestedAction, params? }` — `params` carries interpolation values (branch, counts) for the FE's localized copy; `message` is technical text, never a dialog's primary line |
| `GitSuggestedAction` | `configurePat` / `resolveConflict` / `reconfigureRepo` / `runClone` / `syncFirst` / `commitFirst` / `retryWithMerge` |
| `GitPullStrategy` | `merge` (default) / `rebase` — carried on `pull` and `sync` as an op field, NOT a ninth user op |
| `GitPatState` | `{ configured, username? }` |
| `GitStateEventData` | Discriminated union for the SSE `gitState` event (`workingTreeChange` / `operationComplete` / `reconnectRefill`) |
| `GitCloneResult` | Clone response result — `{ defaultBranch, feature }` (includes the feature name that clone auto-created) |

### 1 SSE event — `gitState`

- `cause: 'workingTreeChange'` — disk-change hint. No snapshot in the payload. FE re-calls `fetchGitWorldState` after a debounce.
- `cause: 'operationComplete'` — full snapshot + pat + operation FSM. FE replaces immediately.
- `cause: 'reconnectRefill'` — published by the server on SSE open. Full snapshot + pat.

### 2 REST endpoints

- `GET  /projects/:id/git/state?feature=...&fresh=true` → `GitStateResponse`
- `POST /projects/:id/git/ops/:userOp`                 → `GitOperationResponse`

Adding any other Git REST endpoint is prohibited.

### 3 writers (FE)

Only these 3 writers may be called from outside `domain/git-world/`:

- `runGitOperation(projectId, op)`
- `savePat(pat)`
- `deletePat()`

Any additional Git/PAT-related writer is caught by ESLint `no-restricted-imports` and
the P11/P13/P14 patterns of `scripts/git-sweep.mjs`.

### BE `GitOperation.onSuccess` symmetric hook

All 8 operations, **symmetrically**, immediately after `run()` succeeds:

1. Call `StatusService.getSnapshot(projectId)` to compute the latest snapshot
2. Publish the `gitState` SSE via `GitStateBroadcaster.notifyOperationComplete(...)`
3. Call `gitWatcher.retryDeferredWatchers(projectId)` (retry deferred watchers)
4. If it is a project-level op (no feature), trigger `autoIndexCodebase`

Asymmetric designs that add/remove hooks for only specific ops are prohibited. The
P9 pattern in `scripts/git-sweep.mjs` polices this.

### Publish polymorphism

`GitUserOperation.kind === 'publish'` resolves to one of 4 BE behaviors depending on state:

| State (S) | BE behavior |
|----------|---------|
| S1/S2: `!hasGit` (no anchor = 0 features) | Unreachable — the init variant requires feature ≥ 1, and the first feature creates the anchor, so `hasGit=true` whenever a feature exists. Publish with 0 features is rejected by a guard |
| S3: `hasGit && !hasRemote` | Create a GitHub repo → `remote add origin` + fetch refspec → `git push -u origin {branchBase}` (the base the user chose becomes the GitHub default branch) → `remote set-head origin {branchBase}` best-effort (init). On failure, rollback is `remote remove origin` only — `repo.git` is never deleted |
| S4: `hasGit && hasRemote && !hasUpstream` | `git push -u` (publish-branch) |

The FE dispatches just `{ kind: 'publish' }` without knowing which branch applies. The
implementation SSOT for the init variant is `GitService/anchor/GitAnchorSSOT.ts` — the
old `GitBootstrapSSOT` / `BaseGitSetupOperation` have been deleted.

---

## Overview

ANT supports Git integration through GitHub. There are 2 Setup Operations (Clone, Init) for connecting Git after project creation, and 6 Operations (Push, Pull, Fetch, Commit, Sync, Discard) used after connection.

## Operation Definitions

| Operation | Role | Remote repo | Local anchor (`repo.git`) | Feature |
|-----------|------|:---------:|:---------:|:-------:|
| **Clone** | Download an existing remote repo as a bare anchor + auto-create a default-branch feature | Must exist | Must not exist | **Exactly 0 required** (BE hard guard → 409) |
| **Init** | Create a new remote repo from the local anchor and push | Must not exist | Exists (first feature creates it lazily) | **≥ 1 required** |
| **Commit** | Commit changes locally | Connected | Must exist | - |
| **Push** | Upload local commits to the remote (auto-sets upstream if missing) | Connected | Must exist | - |
| **Pull** | Download remote changes to local | Connected | Must exist | - |
| **Fetch** | Update remote refs (no code changes) | Connected | Must exist | - |
| **Sync** | Run Fetch + Pull + Push sequentially | Connected | Must exist | - |
| **Discard** | Revert uncommitted changes | - | Must exist | - |

## Availability by Situation

```
                    No remote repo                       Remote repo exists
              +------------------------------+   +------------------------------+
No features   |  Clone  X (no repo)          |   |  Clone  O (auto-creates a     |
              |  Init   X (feature required) |   |           default-branch      |
              |                              |   |           feature)            |
              |                              |   |  Init   X (repo exists)       |
              +------------------------------+   +------------------------------+
Has features  |  Clone  X (features exist    |   |  Clone  X (features exist     |
              |           →409)              |   |           →409)               |
              |  Init   O                    |   |  Init   X (repo exists)       |
              +------------------------------+   +------------------------------+

anchor exists + remote exists → Clone/Init unnecessary; use Push/Pull/Fetch/Commit/Sync/Discard
anchor exists (feature ≥ 1) + no remote → Init(publish) allowed
```

### UI Menu Structure

| State | Git menu items |
|------|--------------|
| Setup Mode (`!hasGit`) | Clone / Initialize |
| Connected Mode (`hasGit`) | Push / Pull / Fetch |

In Connected Mode the ActionButton automatically displays Commit / Publish Branch / Push / Pull / Sync / No Changes depending on the situation.

If even one feature exists, the Clone item is shown disabled + with a notice
(`deriveGitMenu.cloneBlockedByFeatures`) — Clone is only allowed with 0 features.

## Worktree Lifecycle

### Bare anchor vs .git marker file

- `{projectPath}/repo.git/` (bare anchor) — the project's **only real repository**. A hidden bare repo whose `HEAD` is a symref to `refs/heads/{branchBase}`; worktree metadata is stored in `repo.git/worktrees/{id}/`. The old `{project}/codebase/` main worktree does not exist.
- `features/{name}/codebase/.git` (file) — the linked worktree reference file, **always written by git as an absolute path** in the form `gitdir: <absolute path>/repo.git/worktrees/{id}` (cannot be changed via a CLI flag). The worktree metadata directory name derives from the last path component of the worktree path (usually `codebase`); on collision git auto-disambiguates it to e.g. `codebase1`.

A project with no features has no codebase and no git — the anchor is created **lazily upon first feature creation** (`GitAnchorSSOT.ensureAnchor`; the empty-state initial commit is created with `hash-object -t tree` / `commit-tree` / `update-ref` plumbing).

### Branch naming

Branch name == feature name, **exactly identical** — no `feature/` prefix, no sanitization. Feature names may contain `/` (`feature/base`, `release/1.0`) and are used verbatim as branch names. Only git `check-ref-format` violations (`~`, `//`, leading/trailing `/`, `..`, `.lock` segments, etc.) are rejected at creation time (`@ant/shared` `validateFeatureName`). `GitHelper.sanitizeBranchName` has been deleted.

Feature names are projected as `/`-free **slugs** in filesystem directory segments, URL path segments, and redis keys (IDE serverKey) (`@ant/shared` `featureNameToSlug`/`featureSlugToName`, `/ ↔ ~`). On disk the worktree is `features/{slug}/codebase/` while the git branch keeps the raw name (`release/1.0`). Clone downloads a remote default branch verbatim even if it contains `/`, creates a feature of the same name, and tracks `origin/{name}`.

### Bare anchor access (GIT_DIR)

Every git command targeting the anchor runs with an explicit `GIT_DIR` (`GitHelper.bareAnchorEnv` / `getBareGitInstance`) — this also works under `safe.bareRepository=explicit` environments. The env uses a whitelist approach (simple-git rejects editor/pager-class vars).

### Worktree validity (Stage-4 SSOT)

**`GitHelper.isWorktreeStructureValid(featureCodebasePath)`** is the single source of truth. A 4-stage check:

1. `.git` file exists (worktree marker present)
2. `gitdir:` format parses successfully
3. The directory at that absolute path (`<project>/repo.git/worktrees/<id>/`) exists
4. Both `HEAD` and `commondir` files exist in that directory

The check is cheap (4 stats), so it is called on every critical path. Adding new helpers is prohibited — partial worktrees (NFS partial write / interrupted `git worktree add`) are detected via the single SSOT.

### Worktree validity call sites

| Phase | Call site | Effect |
|-------|-----------|------|
| pre-existing dir check | `WorktreeService.createWorktree` | Blocks the regression where a partial gitdir is false-positived as valid |
| post-create probe | `WorktreeService.createWorktree` | Detects the case where `git worktree add` exits 0 but the result is partial + throws |
| orphan hardening | `WorktreeService.pruneCorruptWorktreeMeta` | Partial meta directories are also automatically reclaimed |
| Stage-4 self-heal | `ensureGitRepository` | Recovers a corrupt worktree via `createWorktree` re-attach (the branch lives on in the anchor; uncommitted changes of the corrupt worktree are discarded) |
| defense-in-depth | `StatusService.getGitChanges` | Emits a structured `worktreeValidityFailure` log on a "not a git repository" error |

### IDE Pod Multi-Mount Topology (Cloud / K8s)

Since the worktree marker points at an absolute path, the IDE pod must actually be able to resolve that absolute path inside the container. If the K8s pod has only a single subPath mount, the `/mnt/workspaces/<...>/repo.git/worktrees/<id>` path does not exist inside the container and git recognition fails.

Solution: **alias-model multi-mount** (Docker's `resolveWorktreeBindMounts` and K8s's `resolveK8sWorktreeMounts` are isomorphic):

| Mount | mountPath | subPath | Responsibility |
|-------|-----------|---------|------|
| Primary alias | `/workspace` | `<tenant>/<user>/<project>/features/<feat>/codebase` | The working path exposed to the user |
| mainGitDir | `<base>/<...>/repo.git` (absolute) | same prefix | Ensures the worktree marker's absolute gitdir path (`repo.git/worktrees/<id>`) resolves inside the container |
| worktreePath | `<base>/<...>/features/<feat>/codebase` (absolute) | same prefix | Ensures the meta dir's back-reference (the absolute worktree path pointed at by the `<gitdir>/gitdir` file) resolves |

The IDE pod **requires a feature** — a project without features has no codebase at all, so a "base branch pod" no longer exists.

`.git` parsing has a single SSOT, `GitHelper.resolveWorktreeAbsPaths` — the Docker/K8s functions receive only the path results and are responsible solely for their own format (Docker bind strings / K8s mount objects). Creating duplicate parsing logic is blocked by `tests/policy/worktree-mount-dedup.test.ts`.

### ANT_WORKSPACE_BASE_PATH sameness invariant

The API server / IDE pod / job worker must **all** see the same `ANT_WORKSPACE_BASE_PATH` value. If they differ, the worktree marker's absolute path resolves on only one side, so either the IDE fails to recognize git or the API server incorrectly judges the worktree valid. `KubernetesIDEOrchestrator.assertWorkspacePathInBase` validates fail-fast at startup.

### IDE Pod Mount Drift Auto-Recreate

If an existing pod's `volumeMounts.length` differs from the expected count that `resolveK8sWorktreeMounts` currently returns (e.g. a 1-mount pod created in an old race case, where the worktree is now valid and 3 mounts are expected), `KubernetesIDEOrchestrator.start` automatically deletes + recreates the pod. Pod specs are immutable, so a stale broken pod can only be recovered via this path.

### Feature Git state transitions

```
[Feature created] → Worktree attached immediately (.git marker file created;
                 the first feature lazily creates the anchor + auto-sets branchBase = feature name)
                    │
                    ├── Code changes → Uncommitted Changes
                    ├── Commit → Local Commits
                    ├── Push → Synced with Remote
                    ├── Publish Branch → upstream configured
                    ├── Discard → Clean State
                    │
                    └── worktree corruption detected → self-heal: createWorktree re-attach
                          (the branch lives on in the anchor, so commit history is preserved;
                           uncommitted changes of the corrupt worktree are discarded)
```

feature = linked worktree holds **from creation time** — a "feature codebase without git" state does not exist.

### Clone — 0-feature precondition + default-branch feature auto-creation

Clone is only allowed when there are **0 features** (BE hard guard → 409; the FE disables the clone item + shows a notice via `deriveGitMenu.cloneBlockedByFeatures`). Procedure:

1. `git clone --bare` → `{project}/repo.git`
2. Configure the explicit fetch refspec `+refs/heads/*:refs/remotes/origin/*`
3. Reflect remote HEAD → branchBase, then lock (`hasRemote` = LOCK)
4. **Auto-create** a feature named after the remote default branch (worktree attach) — so the user can see code immediately

The response result is `GitCloneResult { defaultBranch, feature }` (`@ant/shared`). The old `FeatureCodebaseBackup` / temp-clone flatten / `SourceDetector` paths have been deleted.

### Corrupt Worktree Self-heal (`ensureGitRepository`)

`ensureGitRepository` requires a feature — the old gitBootstrap / featureBackup inputs are gone (only fetch can run against the bare anchor via `allowAnchor`). When a feature codebase's worktree is corrupt, self-heal is a `createWorktree` re-attach — the branch lives on in the anchor so commit history is preserved, but uncommitted changes of the corrupt worktree are discarded. The old backup → restore path has been deleted.

### Worktree safety

When WorktreeService.createWorktree finds an existing directory:
1. Validate with `GitHelper.isWorktreeStructureValid` (Stage-4: `.git` marker + gitdir directory + HEAD + commondir)
2. valid → early return (no recreation needed)
3. corrupt/missing (emits a `worktreeValidityFailure` log) → `git worktree remove` → `git worktree prune` → recreate

Immediately after `git worktree add`, `pollWorktreeValidity` (3 tries × 100ms) absorbs EFS NFS eventual-consistency lag; if still invalid at the end, it throws `GitOperationError` — blocking silent partial creates.

### Branch selection ladder at worktree creation

After origin convergence (section below), `WorktreeService.createWorktree` decides the branch in this order (branch name == feature name):

1. Remote branch exists → `--track -b` (a shadowing local head imported by the bare-clone is first `branch -D`'d — prevents stale tip + no-upstream)
2. Local branch exists (no remote counterpart) → attach
3. Local branchBase branch exists → fork from it
4. Remote `origin/{branchBase}` exists → fork from it (`--no-track` — if the new branch inherited the base's upstream, the Publish affordance would break). A converged anchor is only populated with `refs/remotes/origin/*` via fetch (unlike clone, no local head import), so without this step a new feature that does not exist on the remote would fall through as an orphan.
5. A HEAD commit exists in the anchor → fork from HEAD
6. Empty anchor → plumbing initial commit, then attach + seed `.gitignore`/`README` commit

`repoType: 'local'` short-circuits everything (user-owned localPath; no anchor/worktree/branch manipulation) — the old `mainCodebasePath === worktreePath` path-equality guard was replaced with the `config.repoType === 'local'` guard.

### Origin Convergence (`WorktreeService.syncOriginState`)

`config.githubRepo` is recorded **before** clone/init, so "githubRepo configured ≠ connected". Before entering the ladder, createWorktree **transactionally** converges the anchor's origin state with config:

1. No origin on the anchor + `config.githubRepo` exists → `remote add origin <PAT URL>` + fetch refspec backfill (`ensureOriginWithRefspec`; if origin already exists, only `set-url` + refspec backfill — this also heals a missing refspec on old clone anchors)
2. `git fetch origin` probe → keep origin only on success + remote tracking refs ≥ 1
3. Otherwise `remote remove origin` rollback — origin presence is the branchBase lock and Init/Clone eligibility signal, so it must preserve the meaning of "refs have actually been exchanged with a real remote"
4. On a successful no-origin→origin transition, `applyAfterRemoteConverge` records the remote HEAD as branchBase once (a delayed version of clone's remote-HEAD recording)

Fetch probe failure classification:

| Failure | Behavior |
|---|---|
| PAT not registered (`buildAuthenticatedUrl` throws) | Skip convergence; best-effort fetch of the existing origin |
| repository not found | Rollback, then local ladder (Publish/init flow — a declared state where the repo does not yet exist) |
| Anchor that originally had origin | Proceed with stale tracking refs (a transient outage must not block feature creation) |
| Transition attempt + anchor has commits | Warn, then local ladder |
| Transition attempt + **empty anchor** + auth rejected | Throw `GitAuthError` (non-retryable) |
| Transition attempt + **empty anchor** + network/other | Throw `GitNetworkError` (retryable) — prevents a transient outage on a connected legacy project from hardening into a permanent orphan branch |

This convergence is the anchor-adoption path for **legacy projects** (connected in the pre-bare-anchor `{project}/codebase/.git` era): the first feature creation attaches origin and tracks existing remote branches. Old features keep operating with their own gitdir (the old `codebase/.git` worktree) and are not migrated.

## Publish Branch

When pushing from a Feature for the first time with no upstream configured:
- Run `git push -u origin {featureName}` (Publish Branch — branch name == feature name)
- Displayed in the UI as a "Publish Branch" button on the ActionButton
- Subsequent pushes are plain `git push origin {featureName}`

> Note: "Publish Branch" is a per-branch operation, distinct from Setup Mode's Init/Clone.
> Init/Clone is project-level Git connection; Publish Branch is the first push of an individual feature branch to the remote.

## Selective Commit

- The Commit API supports a `files` parameter
- When files are specified, only those files are `git add`ed and committed
- When unspecified, everything is committed after `git add .`

## Discard Operation

Reverting changes:
1. `git reset HEAD` — unstage staged changes
2. When files are specified: tracked files via `git checkout -- {files}`, untracked via `git clean -f {files}`
3. Full discard: `git checkout -- .` + `git clean -fd`

## Anchor Lazy Initialization (on first Feature creation)

No git is created at project creation time — a project without features has no codebase and no git. On **first feature creation (0→1)**, `GitAnchorSSOT.ensureAnchor`:

1. Creates the `{project}/repo.git` bare anchor (HEAD symref → `refs/heads/{branchBase}`)
2. Creates an initial commit via plumbing (`hash-object -t tree` / `commit-tree` / `update-ref`)
3. Auto-sets branchBase = first feature name (+ anchor HEAD symref)
4. Attaches the feature worktree + seeds a `.gitignore`/`README` commit

Init(publish) later connects this anchor to GitHub after configuring the remote.

## The branchBase Pointer

`branchBase` is the base-branch pointer that the anchor HEAD points to. **The only writer is `GitService/anchor/branchBaseLifecycle.ts`**:

- Default `'main'`
- First feature (0→1) created → branchBase auto-set to the feature name (+ anchor HEAD symref)
- Base feature deleted → re-pointed to the oldest remaining feature by creation order, or `'main'` if none
- The user may select one of the existing features from the ConfigEditor dropdown — **only while the remote is not connected**
- Origin convergence (no-origin→origin transition, legacy project adoption) → `applyAfterRemoteConverge` records the remote HEAD once
- LOCK condition: an origin remote exists on the anchor (`hasRemote`)

There is no read-time git-sync — `detectGitDefaultBranch` was deleted, and fetch no longer mirrors remote-HEAD drift into branchBase.

## Common Preconditions

- The `githubRepo` field in `config.json` must be set (Clone/Init/Push/Pull/Fetch/Sync)
- GitHub PAT must be configured (Account Configuration)
- Clone/Init impossible when anchor + remote already exist (already connected)
- Clone requires exactly 0 features, Init requires ≥ 1 feature

## No-Feature State (the `_base` sentinel is deleted)

The `RESERVED_FEATURE_NAME('_base')` sentinel and `isBaseBranch` have been deleted. The meaning of "no feature selected":

- No working tree — the IDE / job routes **require** a feature
- Git reads (`GET /git/state` without `feature`) are served from the bare anchor: `hasGit` = anchor exists, `currentBranch` = anchor HEAD = branchBase, `hasCodebase=false`, changes empty
- Internal redis-key fallback constant: `NO_FEATURE_KEY='@none'` (`redisKeyUtils`; defensive use only)

## State Transitions

```
[Project created] → NoGit (no codebase, no git — the anchor is lazily created by the first feature)
                    │
                    ├── First feature created → LocalAnchor (bare anchor + worktree,
                    │                      branchBase = feature name, no remote)
                    │
                    ├── Clone succeeds (0-feature precondition) ──→ Connected
                    │     (bare anchor + default-branch feature auto-created, branchBase LOCK)
                    └── Init(publish) succeeds (feature ≥ 1) ──→ Connected
                          (remote add + push -u {branchBase})
                                        │
                                        ├── Commit → Local Changes
                                        ├── Push/Pull/Fetch/Sync → Connected
                                        ├── Publish Branch → upstream configured
                                        ├── Discard → Clean State
                                        │
                                        └── Arbitrary config URL change → Error
                                                                    │
                                                                    └── URL restored or re-clone → Connected
```

## Badge States (UI)

The connection-status badge displayed next to the GitHub Repository field in project settings and the wizard:

| State | Condition | Color |
|------|------|------|
| Not connected | `githubRepo` set + `!hasGit` | gray |
| Connected | `hasGit` + `remoteUrl` exists + matches the config URL | green |
| Error | `hasGit` + (config URL and remote URL mismatch OR no remote) | red |

Error causes:
- **URL mismatch**: after Clone/Init, the user arbitrarily changed githubRepo in config.json
- **No remote**: .git exists but `git remote get-url origin` is missing (manual manipulation, etc.)

## Directory Structure

```
{projectPath}/
├── config.json           ← githubRepo, branchBase, etc.
├── repo.git/             ← bare anchor (hidden; HEAD symref → refs/heads/{branchBase})
│   └── worktrees/{id}/   ← linked worktree metadata (HEAD, commondir, gitdir, etc.)
└── features/
    └── {featureName}/
        ├── codebase/     ← linked worktree (branch name == feature name)
        │   └── .git      ← worktree marker file (gitdir: <abs>/repo.git/worktrees/{id})
        ├── plan/
        ├── architecture/
        ├── visual/
        ├── assets/
        ├── meta/
        └── sessions/
```

- Project with no features: no codebase, no git (`repo.git` is lazily created on first feature creation)
- Every feature codebase is a linked worktree from creation — the `.git` marker points to `repo.git/worktrees/{id}`
- On worktree corruption: self-heal = `createWorktree` re-attach (commit history is preserved on the anchor branch, uncommitted changes discarded)

## .git Protection

Preventing `.git` file/directory corruption during LLM code generation:
- Writes to `.git` paths are blocked in the `runCommand` handler's `detectWritePathViolations`
- Commands like `rm`, `mv`, `cp`, `touch` targeting `.git` raise a violation

## Error Classification Criteria

Route handlers classify Operation errors into HTTP status codes:

| Status code | Meaning | Examples |
|-----------|------|------|
| 400 | Precondition not met | Config not set, repo not found |
| 401 | Authentication failure | PAT expired, insufficient permissions |
| 409 | Conflict | Already cloned, remote repo already exists, feature already exists |
| 500 | Server error | Unexpected git command failure |

The frontend displays the `error` field of 400/401/409 responses in a modal. 500 is replaced with "Internal Server Error", so known errors must be classified as 400/401/409.

## Backend State Response

All Git state reads are handled by a **single REST endpoint**.

| Endpoint | Returns | Characteristics |
|------------|------|------|
| `GET /projects/:id/git/state?feature=...&fresh=true` | `{ snapshot: GitSnapshot, pat: GitPatState }` | `snapshot` is deep-frozen read-only. `fresh=true` bypasses the `remoteExists` cache (60s TTL) |

The legacy `/git/status` · `/git/changes` · `/push` · `/pull` · `/fetch` · `/initialize` · `/clone` · `/git/sync` · `/git/commit` · `/git/discard` were all removed in the Phase 7 cutover. The only remaining helper is `GET /projects/:id/clone/status` for the Wizard's post-clone polling. All operation dispatch converges on `POST /projects/:id/git/ops/:userOp`. The path carries the op kind and the body carries its discriminant-specific fields — `commit` takes `message`/`files`/`authorMode`, `discard` takes `files`, and `pull`/`sync` take `strategy` (`merge` | `rebase`). `strategy` reaches git through `pullArgs()`, which whitelists the literal `'rebase'` and folds everything else to merge — the body is unvalidated, and an arbitrary string must never land in git's argv.

`publish` / `clone` / `sync` / `commit` / `push` / `pull` are answered with a keep-alive heartbeat (`isSlowOp`) because each makes at least one network round trip; the FE mirrors that with a 90s per-op timeout for push/pull/sync.

`ahead` / `behind` are relative to the remote refs the local knows about; when freshness is needed, the user explicitly dispatches a `fetch` or `sync` operation. **There is still no read-time git-sync** — but `push` (and therefore the `publish` branch-push variant) preflights with its own `git fetch` before deciding, because a cloud workspace has no other window onto the remote and would otherwise push against refs it has not looked at since the clone. The preflight is best-effort: if the fetch cannot run, the push proceeds and reports its own error.

Calling without the `feature` parameter serves state **based on the bare anchor**: `hasGit` = anchor exists, `currentBranch` = anchor HEAD = branchBase, `hasCodebase=false`, changes empty. Git commands against the anchor run with an explicit `GIT_DIR` (`GitHelper.bareAnchorEnv`).

## Realtime: the gitState Event

**There is exactly one SSE type, `gitState`.** The `cause` discriminant carries 3 paths:

| cause | Publisher | Payload | FE reaction |
|-------|--------|----------|-----------|
| `workingTreeChange` | `FileTreeBroadcaster` co-emit and `GitWatcherService` polling | `{project, feature?, timestamp}` | `_refreshWorkingTreeDebounced` → `fetchGitWorldState` after a 300ms debounce |
| `operationComplete` | `GitOperation.onSuccess` | `{project, feature?, snapshot, operation, pat, timestamp}` | `_applyGitStateEvent` — immediately replaces snapshot + pat, reflects operation FSM `succeeded` |
| `reconnectRefill` | Server SSE onOpen | `{project, feature?, snapshot, pat, timestamp}` | `_applyGitStateEvent` — enters a consistent state right after refresh/reload |

Why publishing is split into two paths (`workingTreeChange`):

| Path | Trigger | Covers |
|------|--------|------|
| `FileTreeBroadcaster` co-emit | Published together with `notifyFileTreeUpdate` | Working-tree file creation/modification during a Job (`.git/index` unchanged) |
| `GitWatcherService` polling | `.git/index` mtime change (1s interval) | External terminal `git add/commit/checkout`, direct user manipulation |

`GitStateBroadcaster` is transport-agnostic (`publisher: (channel, payload) => Promise<unknown>`). The Job Worker child process uses its own ioredis connection, while the HTTP/Realtime Server reuses `stateStore.publish`. The payload type is `SSEMessageMap['gitState']` from `@ant/shared` (= the `GitStateEventData` discriminated union).

## Frontend Git State

### SSOT — the `domain/git-world/` slice

A single Zustand slice owns all Git UI state:

```
git-world/
├── state.ts              # { snapshot: AsyncFields<GitSnapshot>, operation: GitOperationState, pat: AsyncFields<GitPatState> }
├── selectors.ts          # deriveGitCta / deriveGitMenu / deriveGitBadge / deriveGitSetupCta (pure functions)
├── hooks.ts              # useGitSnapshot / useGitOperation / useGitPat / useGitCta / useGitMenu / useGitBadge / useGitSetupCta / useGitDispatch / useGitPatDispatch
├── sse-handler.ts        # registerGitStateHandler — single gitState entry
├── infrastructure/
│   └── api.ts            # git-world-internal REST client (sealed via ESLint)
└── index.ts              # public API — hooks, selectors, createSlice, registerGitStateHandler, dispatchGitOpOneShot
```

`AsyncFields<T> = { data: T | null; refreshing: boolean; error: string | null; lastFetchedAt: number | null }` is applied uniformly to both `snapshot` / `pat`. `operation` is the `GitOperationState` FSM as-is.

### No mutation beyond the 3 writers

Exactly three writes are allowed from outside `domain/git-world/**`:

- `useGitDispatch().runGitOperation(projectId, op)` — dispatches `POST /git/ops/:userOp`. Transitions the FSM `running → succeeded|failed`
- `useGitDispatch().fetchGitWorldState(projectId, opts?)` — resynchronizes the authoritative snapshot + pat via `GET /git/state`
- `useGitPatDispatch()`'s `savePat` / `deletePat` / `fetchGitPat` — after saving/deleting the PAT, automatically re-primes the slice and returns the latest PAT state

All other Git/PAT mutations are blocked by ESLint `no-restricted-imports` + the P5/P13/P14/P15 patterns of `scripts/git-sweep.mjs`. `infrastructure/api.ts` cannot be imported outside `git-world/**`.

### `dispatchGitOpOneShot` (exception)

A fire-and-forget helper used only when clone/publish must be called **while creating a project with no project selected**, as in the Wizard. It calls REST only, without affecting the slice FSM. Regular consumers use `useGitDispatch().runGitOperation`.

### UI branching only via selectors

Presentation consumes selector hooks instead of branching directly on fields like `snapshot.hasGit`:

| Hook | Returned union |
|------|------------|
| `useGitCta` | `loading \| noChanges \| commit(count) \| publish(variant) \| sync \| push \| pull` |
| `useGitMenu(githubRepo)` | `loading \| disabled(reason) \| setup(actions) \| publish(source) \| synced(canPush,canPull,canFetch,pullBlockedByChanges)` |
| `useGitBadge(githubRepo)` | `none \| notConfigured \| configured(branch)` |
| `useGitSetupCta` | `clone \| publish \| ambiguous` (result of the remoteExists probe) |

### Project/feature switch orchestration

Side effects on `(selectedProject, selectedFeature)` switches are handled by **one hook, `useProjectLifecycle`, at the app root**. Slice setters stay close to pure setters.

```
(selectedProject, selectedFeature) changes
  └─ useProjectLifecycle (app root, single effect)
        ├─ clearGitWorld()           ; reset snapshot / pat (operation preserved)
        ├─ clearProjectConfig()      ; reset projectConfigSlice
        ├─ initializeSSE()           ; resubscribe with the new (project, feature) → server publishes reconnectRefill
        ├─ fetchProjectConfig()      ; prime githubRepo
        └─ fetchGitWorldState()      ; authoritative snapshot + pat (safety net against a missed refill)
```

The session restore loop is owned solely by `useSessionLoader` (the `pollForFeatures` duplicate was removed).

### Operation state UI

`useGitOperation()` returns the `idle → running → succeeded|failed` FSM. `running` drives the in-place spinner on the CTA and the menu trigger; modal lifetime is decoupled from operation lifetime (`AlertModal.isProcessing` removed, `ConfirmAndDispatch` pattern). **`failed` has no inline banner today** — the failure surface is the dialog raised by `useGitErrorRouting` (below).

`failed.error.suggestedAction` selects the recovery affordance that dialog offers:

| suggestedAction | Recovery affordance |
|-----------------|---------------|
| `configurePat` | Open the PAT configuration page |
| `resolveConflict` | Resolve the conflict in the IDE |
| `reconfigureRepo` | Edit the project Config |
| `runClone` | Run Clone again |
| `syncFirst` | Run Sync (the remote is ahead — pushing would be rejected) |
| `commitFirst` | None — commit or discard, then retry |
| `retryWithMerge` | Pull with the merge strategy (the rebase was already rolled back) |

### Error dialogs — `useGitErrorRouting` is TOTAL

Every Git dispatch site funnels its failure into `useGitErrorRouting`; **no caller
formats an error itself**. That split is how raw `git push` stderr
(`! [rejected] (fetch first)`) became a user-facing modal: the hook handled the
PAT class and every other kind fell through to `showError(error.message)`.

| Condition (evaluated in order) | Dialog | Primary action |
|---|---|---|
| `configurePat` \| `kind:'auth'` | error | Configure PAT → Account Config |
| `syncFirst` | confirm | Sync (`{kind:'sync', strategy:'merge'}`) |
| `commitFirst` | error | acknowledge |
| `retryWithMerge` | confirm | Pull (merge) |
| `resolveConflict` | error | acknowledge (resolve in the IDE) |
| `runClone` | confirm | Clone |
| `reconfigureRepo` \| `kind:'notFound'`/`'config'` | error | Open project settings |
| `kind:'conflict'` ∧ retryable | error | acknowledge (lock contention + countdown) |
| `kind:'network'` (transport failure and the client timeout) | confirm | Retry the same op |
| anything else | error | acknowledge — summary + the raw output in a collapsed `<details>` |

`fallback: 'none'` is the single opt-out, used only by `ProjectWizardModal`, which
owns per-step errors plus a skip/retry/abort decision dialog. Guard:
`packages/ant-ui/tests/git-world/git-error-routing.test.ts`.

## Related Code

### Backend

| Role | File |
|------|------|
| `GitOperation<TIn,TOut>` abstract template | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/GitOperation.ts` |
| 8 concrete op classes (Publish/Push/Pull/Fetch/Sync/Commit/Discard/Clone) + `resolveGitOperation` factory | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/operations/userOps.ts` |
| `StatusService` (`getSnapshot`, `getPat`, `checkCloneStatus`) | `packages/ant-cli/src/periphery/adapters/http/services/GitService/status/index.ts` |
| `RemoteService` (clone/init/push/pull/fetch/sync/commit/discard implementations, consumed internally by GitOperation subclasses) | `packages/ant-cli/src/periphery/adapters/http/services/GitService/remote/index.ts` |
| `GitService` facade — `getSnapshot`/`getPat`/`resolveOperation`/`checkCloneStatus` | `packages/ant-cli/src/periphery/adapters/http/services/GitService/index.ts` |
| `.git/index` polling → `notifyWorkingTreeChange` | `packages/ant-cli/src/periphery/adapters/http/services/GitWatcherService.ts` |
| `GitStateBroadcaster` (publishes the 3 causes) | `packages/ant-cli/src/core/realtime/GitStateBroadcaster.ts` |
| FileTree co-emit (`notifyWorkingTreeChange`) | `packages/ant-cli/src/core/realtime/FileTreeBroadcaster.ts` |
| REST routes (`/git/state`, `/git/ops/:userOp`, `/clone/status`, PAT) | `packages/ant-cli/src/periphery/adapters/http/routes/projects.routes.ts`, `github.routes.ts` |
| SSE reconnectRefill publish | `packages/ant-cli/src/periphery/adapters/http/routes/sse.routes.ts`, `infrastructure/realtime/RealtimeServer.ts` |
| Feature CRUD | `packages/ant-cli/src/periphery/adapters/http/services/ProjectService/FeatureCrudService.ts` |
| Worktree | `packages/ant-cli/src/periphery/adapters/http/services/GitService/worktree/index.ts` |
| Anchor SSOT (`ensureAnchor`, init variant implementation) | `packages/ant-cli/src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT.ts` |
| branchBase pointer single writer | `packages/ant-cli/src/periphery/adapters/http/services/GitService/anchor/branchBaseLifecycle.ts` |

### Frontend

| Role | File |
|------|------|
| git-world slice (`snapshot`/`operation`/`pat` SSOT) | `packages/ant-ui/src/domain/git-world/state.ts` |
| Pure selectors (`deriveGitCta`/`Menu`/`Badge`/`SetupCta`) | `packages/ant-ui/src/domain/git-world/selectors.ts` |
| Shared hooks (`useGitSnapshot`/`useGitOperation`/`useGitPat`/…) | `packages/ant-ui/src/domain/git-world/hooks.ts` |
| Single SSE handler registration | `packages/ant-ui/src/domain/git-world/sse-handler.ts` |
| Internal REST client (lint-sealed) | `packages/ant-ui/src/domain/git-world/infrastructure/api.ts` |
| Public API barrel | `packages/ant-ui/src/domain/git-world/index.ts` |
| project-world lifecycle hook | `packages/ant-ui/src/domain/project-world/lifecycle.ts` |
| project-world hooks/selectors (`useGithubRepo`/`useProjectConfigSnapshot`, etc.) | `packages/ant-ui/src/domain/project-world/hooks.ts`, `selectors.ts` |
| Operation FSM primitives | `packages/ant-ui/src/common/operation/OperationDispatcher.ts`, `useOperation.ts`, `ConfirmAndDispatch.tsx` |
| Unified Git UI panel (GitPanel / GitCta / GitBadge / GitSetupMenu / GitSyncedMenu / OperationProgress) | `packages/ant-ui/src/presentation/git-panel/**` |
| ProjectSection (consumes GitPanel) | `packages/ant-ui/src/presentation/components/ProjectSection.tsx` |
| Wizard clone/init → `dispatchGitOpOneShot` | `packages/ant-ui/src/presentation/components/ProjectWizardModal/ProjectWizardModal.tsx` |
| Legacy file left with only the clone polling helper | `packages/ant-ui/src/infrastructure/http/api/github.ts` |
| SSE bridge (slice → handler) | `packages/ant-ui/src/domain/store/slices/sseSlice.ts` |

### Shared

| Role | File |
|------|------|
| SSE event types (`SSEMessageType`, `SSEMessageMap`, `GitStateEventData`) | `packages/ant-shared/src/sse-events.ts` |
| Git domain contracts (`GitSnapshot`, `GitUserOperation`, `GitOperationState`, `GitOperationError`, `GitSuggestedAction`, `GitPatState`, `FileChange`) | `packages/ant-shared/src/git.ts` |

### Enforcement

| Role | File |
|------|------|
| 18 structural-pattern CI gate | `scripts/git-sweep.mjs` (`pnpm git:sweep`) |
| Boundary ESLint (`no-restricted-imports` error) | `packages/ant-ui/.eslintrc.cjs` |
| Agent skill (required reading before Git work) | `.claude/skills/update-git-world/SKILL.md` |
| Selector/dispatcher specs | `packages/ant-ui/tests/git-world/**`, `tests/common/**`, `tests/project-world/**` |

## Reference Catalog Vocabulary

- A branch in the reference catalog = the feature name verbatim (no prefix/sanitization)
- `ReferenceTarget.branch` omitted → the target project's branchBase

## Boundaries

- Workspace isolation: [20-workspace-isolation.md](20-workspace-isolation.md)
- Infrastructure (Redis, BullMQ): [02-infrastructure.md](02-infrastructure.md)
- Realtime system overall: [21-realtime-system.md](21-realtime-system.md)
- Frontend layer structure: [30-frontend-architecture.md](30-frontend-architecture.md)
