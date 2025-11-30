# Dev Server 상태 관리 설계 결함 분석

## 🔴 치명적인 설계 결함 발견

### 문제 1: Global Single Dev Server Status

**Store (Line 51, 285):**
```typescript
interface StoreState {
  devServerStatus: DevServerStatus | undefined;  // ❌ 단일 상태!
  //...
}

// Initial state
devServerStatus: undefined,  // ❌ 프로젝트별/피처별 구분 없음!
```

**문제:**
- **전역 단일 상태**: 모든 프로젝트/피처가 하나의 `devServerStatus` 공유
- **여러 탭 문제**: Tab A에서 Project1/Feature1 선택, Tab B에서 Project2/Feature2 선택
  - 두 탭이 **동일한 Zustand store 인스턴스** 공유
  - `devServerStatus` 덮어쓰기 발생
  - Tab A에서 본 status가 Tab B의 것으로 바뀜 ❌

---

### 문제 2: Backend는 Project별 관리, Frontend는 전역 관리

**Backend (DevServerService.ts Line 14-16):**
```typescript
export class DevServerService {
  private devServers: Map<string, ChildProcess> = new Map();      // ✅ projectId별
  private devServerPorts: Map<string, number> = new Map();       // ✅ projectId별
  private devServerLogs: Map<string, LogEntry[]> = new Map();    // ✅ projectId별
}
```

**Frontend (Store Line 51):**
```typescript
devServerStatus: DevServerStatus | undefined;  // ❌ 전역 단일
```

**불일치:**
- Backend: `Map<projectId, status>` (프로젝트별 독립)
- Frontend: 단일 객체 (공유)
- → **Backend는 올바른데 Frontend가 잘못됨!**

---

### 문제 3: 여러 탭 시나리오

**시나리오:**
```
Tab A:
  1. Select Project1/Feature1
  2. Start dev server → port 5173
  3. Store updates: devServerStatus = { running: true, port: 5173, ... }
  4. UI shows: "Running on port 5173" ✅

Tab B (동일 브라우저, 다른 탭):
  1. Select Project2/Feature2
  2. Start dev server → port 5174
  3. Store updates: devServerStatus = { running: true, port: 5174, ... }
  4. Tab B UI shows: "Running on port 5174" ✅

Tab A (다시 보면):
  5. devServerStatus now = { running: true, port: 5174, ... }  ❌
  6. UI shows: "Running on port 5174" ❌ (Project1은 5173인데!)
  7. 혼란!
```

**근본 원인:**
- Zustand는 **브라우저 전역 상태**
- 여러 탭이 **동일한 Zustand 인스턴스** 공유
- `devServerStatus`를 덮어쓰면 모든 탭에 영향

---

### 문제 4: refreshDevServerStatus의 문제

**Store (Line 980-1000):**
```typescript
refreshDevServerStatus: async () => {
  const state = get();
  const { selectedProject, backendMode, userEmail } = state;
  if (!selectedProject) return;
  
  // ...
  
  try {
    const { getDevServerStatus } = await import('@/infrastructure/http/api');
    const status = await getDevServerStatus(selectedProject);  // ✅ projectId로 조회
    set({ devServerStatus: status });  // ❌ 전역 단일 상태에 저장!
  } catch (error) {
    console.error('Failed to refresh dev server status:', error);
    set({ devServerStatus: undefined });
  }
},
```

**문제:**
- `selectedProject`에 대한 status를 가져옴
- **전역 `devServerStatus`에 저장** → 다른 프로젝트 status 덮어씀
- 여러 탭에서 다른 프로젝트 선택 시 충돌

---

## 📊 멀티 탭 충돌 다이어그램

```
Browser (Single Zustand Store Instance)
  ├─ Tab A: Project1/Feature1
  │    └─ devServerStatus: { port: 5173 }
  │
  └─ Tab B: Project2/Feature2
       └─ devServerStatus: { port: 5174 } ← 덮어쓰기!

Result:
  Tab A sees: port 5174 ❌ (should be 5173)
  Tab B sees: port 5174 ✅
```

---

## 🎯 올바른 설계

### Option 1: Per-Project Map (Recommended)

```typescript
interface StoreState {
  // ❌ OLD: devServerStatus: DevServerStatus | undefined;
  
  // ✅ NEW: Per-project tracking
  devServerStatusByProject: Record<string, DevServerStatus>;
  
  // Example:
  // {
  //   "project1": { running: true, port: 5173, ... },
  //   "project2": { running: true, port: 5174, ... }
  // }
}
```

**Usage:**
```typescript
// Set
setDevServerStatus: (projectId: string, status: DevServerStatus) => {
  set((state) => ({
    devServerStatusByProject: {
      ...state.devServerStatusByProject,
      [projectId]: status
    }
  }));
}

// Get (in component)
const { devServerStatusByProject, selectedProject } = useStore();
const currentStatus = selectedProject 
  ? devServerStatusByProject[selectedProject] 
  : undefined;
```

---

### Option 2: Per-Tab Isolation (Complex)

```typescript
// ❌ Not recommended - requires localStorage isolation
// Each tab tracks its own state
const tabId = sessionStorage.getItem('tabId') || generateTabId();

interface StoreState {
  devServerStatusByTab: Record<string, DevServerStatus>;
}
```

**단점:**
- SessionStorage 복잡성
- Tab 간 동기화 어려움
- Over-engineering

---

## 🛠️ 해결 방안 (Complete Refactoring)

### Phase 1: Store Structure Change

**파일:** `packages/ant-ui/src/domain/store/index.ts`

```typescript
interface StoreState {
  // ❌ REMOVE
  // devServerStatus: DevServerStatus | undefined;
  
  // ✅ ADD: Per-project tracking
  devServerStatusByProject: Record<string, DevServerStatus>;
  // Example: { "project1": { running: true, port: 5173 }, ... }
}
```

---

### Phase 2: Actions Update

```typescript
interface StoreActions {
  // ❌ REMOVE
  // setDevServerStatus: (status: DevServerStatus | undefined) => void;
  
  // ✅ ADD: Project-specific setter
  setDevServerStatus: (projectId: string, status: DevServerStatus | undefined) => void;
  
  // ✅ ADD: Getter helper
  getDevServerStatus: (projectId: string) => DevServerStatus | undefined;
  
  // ✅ UPDATE: Refresh for specific project
  refreshDevServerStatus: (projectId: string) => Promise<void>;
}
```

**Implementation:**
```typescript
setDevServerStatus: (projectId: string, status: DevServerStatus | undefined) => {
  set((state) => {
    const newMap = { ...state.devServerStatusByProject };
    
    if (status === undefined) {
      delete newMap[projectId];
    } else {
      newMap[projectId] = status;
    }
    
    return { devServerStatusByProject: newMap };
  });
},

getDevServerStatus: (projectId: string) => {
  return get().devServerStatusByProject[projectId];
},

refreshDevServerStatus: async (projectId: string) => {
  if (!projectId) return;
  
  const state = get();
  const { backendMode, userEmail } = state;
  
  // Cloud mode auth check
  if (backendMode === 'cloud' && !userEmail) {
    console.log('[Store] Skipping refreshDevServerStatus: Cloud mode requires authentication');
    get().setDevServerStatus(projectId, undefined);
    return;
  }
  
  try {
    const { getDevServerStatus } = await import('@/infrastructure/http/api');
    const status = await getDevServerStatus(projectId);
    get().setDevServerStatus(projectId, status);
  } catch (error) {
    console.error(`Failed to refresh dev server status for ${projectId}:`, error);
    get().setDevServerStatus(projectId, undefined);
  }
},
```

---

### Phase 3: Component Updates

**파일:** `packages/ant-ui/src/presentation/components/FeatureSection.tsx`

```typescript
export function FeatureSection() {
  const { 
    features, 
    selectedProject, 
    selectedFeature, 
    setSelectedFeature, 
    fetchFeatures,
    refreshFileTree,
    // ❌ OLD: devServerStatus,
    // ✅ NEW: devServerStatusByProject,
    devServerStatusByProject,
    setDevServerStatus,
    setDevServerLoading,
    isDevServerLoading,
    // ...
  } = useStore();
  
  // ✅ Get current project's status
  const devServerStatus = selectedProject 
    ? devServerStatusByProject[selectedProject] 
    : undefined;
  
  // Rest of component uses devServerStatus as before
  // ...
}
```

---

### Phase 4: Start/Stop Actions Update

```typescript
const handleStartDevServer = async () => {
  if (!selectedProject || !selectedFeature) return;
  
  setIsPollingStatus(true);
  setStartError(undefined);
  setDevServerLoading(true);
  
  try {
    const result = await startDevServer(selectedProject, availablePort);
    
    if (result.success) {
      // ✅ Poll for project-specific status
      const pollInterval = setInterval(async () => {
        try {
          const status = await getDevServerStatus(selectedProject);
          // ✅ Set project-specific status
          setDevServerStatus(selectedProject, status);
          
          if (status.running) {
            clearInterval(pollInterval);
            setIsPollingStatus(false);
            setDevServerLoading(false);
          }
        } catch (error) {
          console.error('Failed to poll dev server status:', error);
        }
      }, 1000);
      
      // Timeout
      setTimeout(() => {
        clearInterval(pollInterval);
        setIsPollingStatus(false);
        setDevServerLoading(false);
      }, 30000);
    }
  } catch (error) {
    setStartError(error.message);
    setDevServerLoading(false);
  }
};
```

---

### Phase 5: Status Refresh on Project Change

```typescript
// In FeatureSection or App.tsx
useEffect(() => {
  if (selectedProject) {
    // ✅ Refresh status for current project
    refreshDevServerStatus(selectedProject);
    
    // ✅ Poll status periodically
    const interval = setInterval(() => {
      refreshDevServerStatus(selectedProject);
    }, 5000);
    
    return () => clearInterval(interval);
  }
}, [selectedProject]);
```

---

## 🎓 설계 원칙

### 1. State Scoping

```
❌ Global Single State:
  devServerStatus: DevServerStatus
  → All projects/tabs share one state
  → Conflicts!

✅ Per-Entity State:
  devServerStatusByProject: Record<projectId, DevServerStatus>
  → Each project has independent state
  → No conflicts!
```

### 2. Backend-Frontend Parity

```
Backend:
  Map<projectId, ChildProcess>
  Map<projectId, port>
  Map<projectId, logs>
  → Project-specific tracking ✅

Frontend:
  Record<projectId, DevServerStatus>
  → Project-specific tracking ✅
  → Matches backend! ✅
```

### 3. Multi-Tab Safety

```
Tab A: Project1 → devServerStatusByProject["project1"]
Tab B: Project2 → devServerStatusByProject["project2"]
  → Independent keys
  → No conflicts! ✅
```

---

## ✅ 구현 체크리스트

- [ ] Store: `devServerStatus` → `devServerStatusByProject` 변경
- [ ] Store: `setDevServerStatus(projectId, status)` 시그니처 변경
- [ ] Store: `getDevServerStatus(projectId)` 추가
- [ ] Store: `refreshDevServerStatus(projectId)` 시그니처 변경
- [ ] FeatureSection: `devServerStatusByProject[selectedProject]` 사용
- [ ] Start/Stop handlers: `setDevServerStatus(projectId, ...)` 호출
- [ ] 모든 컴포넌트에서 `devServerStatus` 사용처 업데이트
- [ ] TypeScript 빌드 성공
- [ ] 멀티 탭 테스트

---

## 🧪 테스트 시나리오

### Scenario 1: Single Tab

```
1. Select Project1
2. Start dev server → port 5173
3. devServerStatusByProject["project1"] = { running: true, port: 5173 }
4. UI shows port 5173 ✅
```

### Scenario 2: Multi Tab - Different Projects

```
Tab A:
  1. Select Project1
  2. Start dev server → port 5173
  3. devServerStatusByProject["project1"] = { running: true, port: 5173 }
  4. UI shows port 5173 ✅

Tab B:
  1. Select Project2
  2. Start dev server → port 5174
  3. devServerStatusByProject["project2"] = { running: true, port: 5174 }
  4. UI shows port 5174 ✅

Tab A (check again):
  5. devServerStatusByProject["project1"] still = { running: true, port 5173 } ✅
  6. UI still shows port 5173 ✅
```

### Scenario 3: Multi Tab - Same Project

```
Tab A & Tab B: Both select Project1

Tab A:
  1. Start dev server → port 5173
  2. devServerStatusByProject["project1"] = { running: true, port: 5173 }

Tab B:
  1. Sees devServerStatusByProject["project1"] = { running: true, port 5173 } ✅
  2. "Already running" message ✅
```

---

**다음 단계**: 리팩토링 구현 시작

