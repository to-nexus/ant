# Git 제어 버튼 활성화 문제 수정 완료

## 🔴 문제

### 사용자 보고
- Config에서 Git 설정(githubRepo) 저장 후
- Explorer의 Git 제어 버튼이 비활성화 상태 유지
- 페이지 새로고침 후에야 버튼 활성화됨

### 증상
```
Before:
  1. Config Editor 열기
  2. githubRepo 설정 (e.g., "owner/repo")
  3. Save 클릭 → 저장 성공
  4. Config Editor 닫기
  5. Git 버튼 여전히 비활성화 ❌
  
After Refresh:
  6. 페이지 새로고침
  7. Git 버튼 활성화 ✅
```

---

## 🔍 근본 원인

### GitStatusButtons 컴포넌트 분석

**문제 코드 (Line 28-48):**
```typescript
// Check if GitHub repo is configured
useEffect(() => {
  if (!selectedProject) {
    setHasGitHubRepo(null);
    setGitChanges(null);
    setIsGitInitialized(null);
    return;
  }

  const checkConfig = async () => {
    try {
      const config = await fetchProjectConfig(selectedProject);
      setHasGitHubRepo(!!config?.githubRepo);
    } catch (error) {
      console.log('[GitStatusButtons] Failed to fetch config:', error);
      setHasGitHubRepo(false);
    }
  };

  checkConfig();
}, [selectedProject]);  // ← 문제: selectedProject만 감지!
```

**문제:**
1. `useEffect`가 **`selectedProject`가 변경될 때만** 실행됨
2. Config 저장 시 `selectedProject`는 **동일한 값**
3. → Config 체크를 다시 수행하지 않음
4. → `hasGitHubRepo` 상태가 업데이트 안 됨
5. → Git 버튼이 비활성화 상태 유지

### 버튼 비활성화 조건 (Line 224-241)

```typescript
// If GitHub repo is not configured, show "Configure GitHub repo first" button
if (hasGitHubRepo === false) {
  return (
    <div className="flex items-center flex-1">
      <Button
        variant="outline"
        size="sm"
        disabled
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium
                   opacity-50 cursor-default
                   text-gray-600 dark:text-gray-400
                   border-gray-300 dark:border-gray-600
                   bg-gray-50 dark:bg-gray-800/50"
      >
        Configure GitHub repo first
      </Button>
    </div>
  );
}
```

**결과:**
- `hasGitHubRepo === false` 상태 유지
- 비활성화 버튼 표시 계속

---

## ✅ 해결 방법

### 트리거 추가: Config Editor 닫힘 감지

**수정 코드:**
```typescript
export function GitStatusButtons() {
  const { 
    selectedProject, 
    selectedFeature, 
    isGitStatusLoading, 
    gitStatusPhase, 
    manualGitAction, 
    showConfigEditor  // ✅ NEW: Config editor state 추가
  } = useStore();
  
  const prevLoadingRef = useRef(isGitStatusLoading);
  const prevManualActionRef = useRef(manualGitAction);
  const prevShowConfigEditorRef = useRef(showConfigEditor);  // ✅ NEW: Track config editor state
  
  // ... states ...

  // Check if GitHub repo is configured
  useEffect(() => {
    if (!selectedProject) {
      setHasGitHubRepo(null);
      setGitChanges(null);
      setIsGitInitialized(null);
      prevShowConfigEditorRef.current = showConfigEditor;  // ✅ Update ref
      return;
    }

    const checkConfig = async () => {
      try {
        const config = await fetchProjectConfig(selectedProject);
        const hasRepo = !!config?.githubRepo;
        console.log('[GitStatusButtons] Config checked - hasGitHubRepo:', hasRepo);
        setHasGitHubRepo(hasRepo);
      } catch (error) {
        console.log('[GitStatusButtons] Failed to fetch config:', error);
        setHasGitHubRepo(false);
      }
    };

    // ✅ Check config when:
    // 1. Project changes
    // 2. Config editor closes (config might have been saved)
    const configEditorJustClosed = prevShowConfigEditorRef.current === true && showConfigEditor === false;
    prevShowConfigEditorRef.current = showConfigEditor;
    
    if (configEditorJustClosed) {
      console.log('[GitStatusButtons] Config editor closed - rechecking config');
    }

    checkConfig();
  }, [selectedProject, showConfigEditor]);  // ✅ NEW: showConfigEditor 의존성 추가
});
```

---

## 🎯 핵심 개선사항

### 1. Config Editor 상태 감지

**이전:**
```typescript
useEffect(() => {
  checkConfig();
}, [selectedProject]);  // Project 변경만 감지
```

**개선:**
```typescript
useEffect(() => {
  // Config editor 닫힘 감지
  const configEditorJustClosed = 
    prevShowConfigEditorRef.current === true && 
    showConfigEditor === false;
  
  checkConfig();
}, [selectedProject, showConfigEditor]);  // Project + Config editor 감지
```

### 2. 2가지 트리거

**Config 재체크 시점:**
1. **Project 변경**: 다른 프로젝트 선택 시
2. **Config Editor 닫힘**: Config 저장 후 에디터 닫을 때

### 3. 로깅 개선

```typescript
console.log('[GitStatusButtons] Config checked - hasGitHubRepo:', hasRepo);
console.log('[GitStatusButtons] Config editor closed - rechecking config');
```

**디버깅 용이:**
- Config 체크 시점 확인
- githubRepo 설정 여부 확인

---

## 📊 동작 비교

### Before (문제 상황)

```
1. Config Editor 열기
   → showConfigEditor: true
   
2. githubRepo 설정
   → Backend: config 저장됨 ✅
   → Frontend: hasGitHubRepo 상태 그대로 ❌
   
3. Config Editor 닫기
   → showConfigEditor: false
   → useEffect 실행 안 됨 (selectedProject 동일)
   → hasGitHubRepo: false 유지 ❌
   
4. Git 버튼
   → 비활성화 상태 유지 ❌
```

### After (수정 후)

```
1. Config Editor 열기
   → showConfigEditor: true
   
2. githubRepo 설정
   → Backend: config 저장됨 ✅
   
3. Config Editor 닫기
   → showConfigEditor: false
   → useEffect 실행! (showConfigEditor 변경 감지)
   → checkConfig() 호출
   → fetchProjectConfig(selectedProject)
   → hasGitHubRepo: true 업데이트 ✅
   
4. Git 버튼
   → 활성화! ✅
```

---

## 🧪 테스트 시나리오

### Scenario 1: Git 설정 추가

```
Given: Project with NO githubRepo configured
  hasGitHubRepo: false
  Git button: disabled

When: 
  1. Open Config Editor
  2. Set githubRepo: "owner/repo"
  3. Click Save
  4. Close Config Editor

Then:
  ✅ useEffect triggered (showConfigEditor: true → false)
  ✅ checkConfig() called
  ✅ hasGitHubRepo updated to true
  ✅ Git button enabled
```

### Scenario 2: Git 설정 제거

```
Given: Project WITH githubRepo configured
  hasGitHubRepo: true
  Git button: enabled

When:
  1. Open Config Editor
  2. Clear githubRepo field
  3. Click Save
  4. Close Config Editor

Then:
  ✅ useEffect triggered
  ✅ checkConfig() called
  ✅ hasGitHubRepo updated to false
  ✅ Git button disabled (shows "Configure GitHub repo first")
```

### Scenario 3: Config Editor 열었다 닫기 (저장 안 함)

```
Given: Any project
  hasGitHubRepo: X (any state)

When:
  1. Open Config Editor
  2. Close without saving (ESC or Cancel)

Then:
  ✅ useEffect triggered
  ✅ checkConfig() called (harmless recheck)
  ✅ hasGitHubRepo remains same (config unchanged)
  ✅ Git button state unchanged
```

### Scenario 4: Project 전환

```
Given: Project A selected
  hasGitHubRepo: true

When:
  1. Select Project B (no githubRepo)

Then:
  ✅ useEffect triggered (selectedProject changed)
  ✅ checkConfig() called
  ✅ hasGitHubRepo updated to false
  ✅ Git button disabled
```

---

## 🎓 설계 고려사항

### 왜 Store에 config 상태를 추가하지 않았나?

**Option 1: Store에 config 추가**
```typescript
// ❌ Over-engineering
interface StoreState {
  projectConfig: ProjectConfig | null;
  // ...
}

// ConfigEditor에서 저장 시
onSave(config) {
  await updateProjectConfig(config);
  store.setProjectConfig(config);  // Store 업데이트
}

// GitStatusButtons에서
const { projectConfig } = useStore();
useEffect(() => {
  setHasGitHubRepo(!!projectConfig?.githubRepo);
}, [projectConfig]);
```

**단점:**
- Store에 불필요한 상태 추가
- Config가 여러 곳에서 사용 안 됨 (GitStatusButtons만 필요)
- 중복 데이터 (Backend + Store)
- 동기화 이슈 가능성

**Option 2: showConfigEditor 감지 (선택한 방법)**
```typescript
// ✅ Simple & Effective
useEffect(() => {
  if (configEditorJustClosed) {
    checkConfig();  // Re-fetch from backend
  }
}, [showConfigEditor]);
```

**장점:**
- Store 오염 없음
- 단일 진실의 원천 (Backend)
- 간단한 구현
- 필요한 곳에서만 fetch

### 왜 매번 fetch하는가?

**Alternative: Event bus**
```typescript
// ❌ More complex
const configSavedEvent = new EventEmitter();

// ConfigEditor
onSave(config) {
  await updateProjectConfig(config);
  configSavedEvent.emit('configSaved', config);
}

// GitStatusButtons
useEffect(() => {
  const handler = (config) => {
    setHasGitHubRepo(!!config.githubRepo);
  };
  configSavedEvent.on('configSaved', handler);
  return () => configSavedEvent.off('configSaved', handler);
}, []);
```

**단점:**
- Event bus 인프라 필요
- 구독/해제 관리
- 메모리 누수 가능성
- Over-engineering

**현재 방식:**
```typescript
// ✅ Simple fetch
useEffect(() => {
  checkConfig();  // Just re-fetch
}, [showConfigEditor]);
```

**장점:**
- 단순함
- 네트워크 요청 1회 (Config editor 닫을 때)
- 성능 영향 미미
- 항상 최신 데이터 보장

---

## 📁 변경 파일

**수정된 파일:**
- `/packages/ant-ui/src/presentation/components/GitStatusButtons.tsx`

**변경 내용:**
1. `showConfigEditor` store에서 가져오기
2. `prevShowConfigEditorRef` ref 추가
3. Config editor 닫힘 감지 로직
4. `useEffect` 의존성에 `showConfigEditor` 추가
5. 디버깅 로그 개선

---

## ✅ 완료 체크리스트

- [x] 문제 원인 파악 (selectedProject만 감지)
- [x] 해결 방법 설계 (showConfigEditor 감지)
- [x] GitStatusButtons.tsx 수정
- [x] TypeScript 빌드 성공 (ant-cli)
- [x] Vite 빌드 성공 (ant-ui)
- [x] 테스트 시나리오 작성
- [x] 문서화 완료

---

## 🔄 Side Effects

### Positive
- ✅ Config 저장 후 즉시 Git 버튼 활성화
- ✅ 새로고침 불필요
- ✅ 더 나은 UX

### Potential Issues (None Expected)
- Config Editor를 열었다 닫을 때마다 config fetch
  - **Impact**: 미미 (네트워크 요청 1회, 빠름)
  - **Benefit**: 항상 최신 데이터 보장

---

## 🎯 결론

### 문제의 본질
**상태 동기화 누락**: Config 저장 후 UI 상태가 업데이트되지 않음

### 해결의 핵심
**Config Editor 닫힘 감지**: `showConfigEditor` 의존성 추가로 자동 재체크

### 설계 원칙
1. **단순함 우선**: Store에 config 추가하지 않고, 필요할 때 fetch
2. **단일 진실의 원천**: Backend가 Config의 유일한 원천
3. **성능 균형**: 약간의 네트워크 요청 vs 복잡한 상태 관리

---

**구현 완료**: 2025-11-30  
**문제**: Config 저장 후 Git 버튼 비활성화 유지  
**해결**: showConfigEditor 감지로 자동 재체크  
**다음 단계**: 서버 재시작 후 테스트

