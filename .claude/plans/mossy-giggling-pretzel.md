# Git Status Button 업데이트 트리거 분석 및 개선

## Context

코드잡으로 파일이 생성/수정될 때 Git 상태 버튼(커밋할 파일 수 등)이 실시간으로 업데이트되지 않는 문제. 현재 트리거가 6가지로 파편화되어 있으며, 코드잡 시나리오에서는 근본적인 설계 결함이 있음.

## 핵심 문제

**GitWatcherService는 `.git/index` mtime을 1초 간격으로 폴링**하지만, 에이전트는 파일을 working directory에 직접 쓸 뿐 `git add/commit`을 하지 않음. → `.git/index`가 변하지 않으므로 `gitChange` SSE 이벤트가 발생하지 않음.

**코드잡 중 git 상태 갱신 경로가 없음:**
- GitWatcherService: `.git/index` 미변경 → SSE 안 보냄
- useJobExecution.ts:185-187: 잡 **완료 시점**에만 `setGitStatusPhase('fetching')` → `setTimeout(null, 100ms)` 해킹으로 1회 트리거
- 결과: 긴 코드잡 실행 중 git 상태 버튼이 전혀 업데이트 안 됨

## 현재 6가지 트리거 (파편화)

| # | 메커니즘 | 위치 | 용도 | 코드잡 중 동작? |
|---|---------|------|------|----------------|
| 1 | SSE `gitChange` | useGitChanges:146-173 | .git/index 변경 감지 | **X** (index 미변경) |
| 2 | `gitStatusPhase` 전환 | useGitChanges:127-134 | 사용자 git 작업 완료 | **X** (잡 중 미호출) |
| 3 | `gitStatusRefreshTrigger` | useGitChanges:136-144 | 설정변경, 계정변경 등 | **X** (잡과 무관) |
| 4 | Auto-polling | useGitChanges:254-277 | 폴백 (30초/5분) | △ (간격 너무 김) |
| 5 | `isGitStatusLoading` 전환 | useGitChanges:228,264 | 로딩 완료 시 | **X** |
| 6 | Initial load | useGitChanges:248-252 | 첫 렌더 | 1회만 |

## 해결 방안

### 핵심 아이디어
에이전트는 파일 쓸 때마다 이미 `fileTree` SSE 이벤트를 브로드캐스트함 (FileTreeBroadcaster). 이 기존 이벤트에 편승하여 git 상태를 갱신하면 백엔드 변경 없이 해결 가능.

### Step 1: useGitChanges에 `fileTree` SSE 리스너 추가 (디바운스)

**파일**: `packages/ant-ui/src/presentation/components/GitStatusButton/hooks/useGitChanges.ts`

기존 `gitChange` SSE 리스너(line 146-173) 아래에 `fileTree` SSE 리스너를 추가:

```typescript
// Listen to fileTree events (agent file writes) - debounced git refresh
useEffect(() => {
  if (!selectedProject || !selectedFeature) return;

  let cancelled = false;
  let unregister: (() => void) | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  (async () => {
    const { sseManager } = await import('@/infrastructure/sse/SSEManager');
    if (cancelled) return;

    const handleFileTreeUpdate = () => {
      // SSE connection은 이미 project/feature 단위로 스코핑되므로 별도 필터 불필요
      // (gitChange와 달리 fileTree data에는 project/feature 필드 없음)
      // Debounce: 코드잡 중 수십 번 연속 파일 쓰기 발생하므로 3초 디바운스
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        setTriggerFetch(prev => prev + 1);
      }, 3000);
    };

    sseManager.registerHandler('fileTree', handleFileTreeUpdate);
    unregister = () => sseManager.unregisterHandler('fileTree', handleFileTreeUpdate);
  })();

  return () => {
    cancelled = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    unregister?.();
  };
}, [selectedProject, selectedFeature]);
```

**참고**: `fileTree` SSE data는 `{ type: 'update', tree: [...] }` 형태로 project/feature 필드가 없음. 하지만 SSE 연결 자체가 이미 project/feature 단위로 스코핑되어 있으므로 (SSEService.broadcastLocal에서 정확한 key 매칭) 별도 필터링 불필요.

### Step 2: Auto-polling 제거

**파일**: `packages/ant-ui/src/presentation/components/GitStatusButton/hooks/useGitChanges.ts`

**제거 대상** (line 254-277): GIT_FETCH_INTERVAL 기반 타이머 폴링 로직 전체 제거.

이벤트 기반 트리거(`gitChange` SSE, `fileTree` SSE, `gitStatusPhase` 전환, `gitStatusRefreshTrigger`)가 모든 시나리오를 커버하므로 타이머 기반 폴링은 불필요한 API 부하만 생성. SSE 재연결 시 초기 상태도 다시 전송되므로 이벤트 누락 시나리오도 커버됨.

**연관 제거 대상**:
- `GIT_FETCH_INTERVAL` import 제거
- `getLastFetchTime()`, `setLastFetchTime()` 헬퍼 함수 제거
- sessionStorage의 `git-fetch-time` 키 사용 제거
- main effect의 Priority 4 (auto-refresh with timer check) 분기 제거
- `loadingJustCompleted` 관련 로직 제거 (Priority 5도 불필요)

### Step 3: useJobExecution의 해킹 코드 교체

**파일**: `packages/ant-ui/src/application/hooks/features/useJobExecution.ts`

```diff
- // ✅ Refresh Git status to show uncommitted changes (non-blocking)
- // Trigger Git status refresh after job completion
- console.log('[useJobExecution] Triggering Git status refresh after job completion');
- const store = useStore.getState();
- store.setGitStatusPhase('fetching');  // Trigger refresh
- // Clear after completion
- setTimeout(() => store.setGitStatusPhase(null), 100);
+ // Git status refresh: fileTree SSE 이벤트 디바운스 리스너가 처리하지만,
+ // 최종 완료 시 명시적 갱신으로 안정성 보장
+ useStore.getState().refreshGitStatus();
```

## Side Effect / Legacy 점검

### 1. `GIT_FETCH_INTERVAL` 상수 — 다른 소비자 있음
- `useFeatureBranchManager.ts`가 **독립적으로** `GIT_FETCH_INTERVAL`을 사용 (git fetch 빈도 제어, git status와 별개 목적)
- `shouldSkipFetch()`, `recordFetchTime()` 함수가 자체적으로 `git-fetch-time` sessionStorage 관리
- **결론**: `constants.ts`에서 `GIT_FETCH_INTERVAL` 상수 자체는 **삭제하지 않음**. useGitChanges의 import만 제거.

### 2. `git-fetch-time` sessionStorage 키 — 공유 사용
- `useGitChanges`와 `useFeatureBranchManager`가 동일한 `git-fetch-time:${project}:${feature}` 키 사용
- 현재: useGitChanges가 이 키를 쓸 때 useFeatureBranchManager의 git fetch 타이밍에 영향 (의도치 않은 coupling)
- 제거 후: useFeatureBranchManager는 자체 `recordFetchTime()`만으로 관리됨 → **오히려 더 정확한 동작**
- **결론**: 안전하게 제거 가능

### 3. `bypassFetchTimer` 상태
- `useFeatureActions.tsx`, `ProjectSection.tsx`에서 설정, `useFeatureBranchManager`에서 소비
- `useGitChanges`는 사용하지 않음
- **결론**: 영향 없음

### 4. `isGitStatusLoading` 상태
- UI 전반에서 버튼 비활성화에 사용 (ActionButton.tsx, LoadingButton.tsx 등)
- useGitChanges에서 guard 역할 (로딩 중 fetch 건너뛰기) + trigger 역할 (`loadingJustCompleted`)
- **결론**: guard 로직(line 223-226)과 deps array 참여는 **유지**. `prevLoadingRef`와 `loadingJustCompleted` 트리거는 제거.

### 5. `git-cache` sessionStorage
- useGitChanges 내부에서만 사용 → 유지 (타이머와 무관)
- `getStorageKey` 헬퍼도 git-cache에서 사용하므로 유지

### 6. `setLastFetchTime` → useFeatureBranchManager 영향
- useFeatureBranchManager는 자체 `recordFetchTime()` 사용 (useGitChanges 것이 아님)
- **결론**: 영향 없음

## 변경 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `packages/ant-ui/src/presentation/components/GitStatusButton/hooks/useGitChanges.ts` | `fileTree` SSE 리스너 추가, auto-polling 제거, 로직 단순화 |
| `packages/ant-ui/src/application/hooks/features/useJobExecution.ts` | `setGitStatusPhase` 해킹 → `refreshGitStatus()` 교체 |

## 참조 파일 (변경 없음)

- `packages/ant-cli/src/core/realtime/FileTreeBroadcaster.ts` — `fileTree` 브로드캐스트 확인
- `packages/ant-ui/src/infrastructure/sse/SSEManager.ts` — SSE 핸들러 등록 API
- `packages/ant-ui/src/domain/store/slices/gitSlice.ts` — `refreshGitStatus` 메커니즘
- `packages/ant-cli/src/periphery/adapters/http/services/GitWatcherService.ts` — 변경 불필요 (사용자 직접 git 작업 감지용으로 유지)

## 검증

1. 코드잡 실행 → 파일 생성/수정 시 3초 내 git 상태 버튼 업데이트 확인
2. 사용자 git 작업 (commit, push, pull) 시 기존 동작 유지 확인
3. `pnpm test:cli` 통과 확인
