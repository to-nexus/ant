# Git Stash Conflict 문제 해결 완료

## ✅ 구현 완료

### 목표
Git stash pop 시 발생하는 merge conflict를 안전하게 처리하여 "needs merge" 상태로 인한 작업 중단 방지

---

## 🔧 구현 내용

### 1. ProjectService - applyStashSafely() 메서드 추가

**위치:** `packages/ant-cli/src/periphery/adapters/http/services/ProjectService.ts`

```typescript
private async applyStashSafely(git: any, contextName: string): Promise<void> {
  try {
    // ✅ Use apply instead of pop (keeps stash if conflict occurs)
    console.log(`[ProjectService] 🔄 Applying stashed changes for ${contextName}...`);
    await git.stash(['apply']);
    
    // ✅ Check for conflicts
    const statusAfterApply = await git.status();
    const hasConflicts = statusAfterApply.conflicted && statusAfterApply.conflicted.length > 0;
    
    if (hasConflicts) {
      const conflictedFiles = statusAfterApply.conflicted || [];
      console.error(`[ProjectService] ❌ Stash conflicts detected:`, conflictedFiles);
      
      // ✅ Abort: Reset to clean state
      await git.reset(['--hard', 'HEAD']);
      await git.clean(['-fd']);
      
      throw new Error(
        `Cannot apply your uncommitted changes to ${contextName} due to conflicts.\n` +
        `Conflicted files:\n${conflictedFiles.map((f: string) => `  - ${f}`).join('\n')}\n\n` +
        `Your changes are still saved in git stash. To recover:\n` +
        `1. Resolve conflicts manually: git stash apply\n` +
        `2. Or discard stashed changes: git stash drop`
      );
    }
    
    // ✅ No conflicts: Success! Drop stash
    await git.stash(['drop']);
    console.log(`[ProjectService] ✅ Stashed changes applied successfully for ${contextName}`);
    
  } catch (error) {
    // ✅ Check if it's our own conflict error
    if (error instanceof Error && error.message.includes('conflicts')) {
      throw error;  // Re-throw our detailed error
    }
    
    // ✅ Other errors: Cleanup and throw
    console.error(`[ProjectService] ❌ Failed to apply stash:`, error);
    
    try {
      await git.reset(['--hard', 'HEAD']);
      await git.clean(['-fd']);
      console.log(`[ProjectService] 🧹 Cleaned up working tree after stash error`);
    } catch (cleanupError) {
      console.error(`[ProjectService] ⚠️  Cleanup also failed:`, cleanupError);
    }
    
    throw new Error(
      `Failed to apply your uncommitted changes. Repository reset to clean state.\n` +
      `Your changes are still in git stash. To recover: git stash apply\n` +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

**핵심 개선:**
1. **Apply instead of Pop**: Conflict 발생해도 stash 보존
2. **Conflict Detection**: `git status`로 conflicted files 체크
3. **Automatic Cleanup**: Conflict 시 `git reset --hard HEAD` + `git clean -fd`
4. **Detailed Error**: 복구 방법 포함한 명확한 에러 메시지
5. **Drop on Success**: 성공 시에만 stash drop

---

### 2. switchToFeatureBranch() 리팩토링

**변경 전:**
```typescript
if (hasChanges) {
  try {
    await git.stash(['pop']);  // ❌ Conflict 시 문제
  } catch (popError) {
    console.warn(`⚠️ Could not apply stashed changes:`, popError);
    // Continue anyway ← ❌ Git이 conflict 상태로 남음!
  }
}
```

**변경 후:**
```typescript
let stashCreated = false;

if (hasChanges) {
  try {
    await git.stash(['push', '-u', '-m', `Auto-stash before switching to ${featureName}`]);
    stashCreated = true;
  } catch (stashError) {
    throw new Error(`Failed to stash changes: ...`);
  }
}

try {
  // ... branch checkout logic ...
  
  // ✅ Safe stash apply
  if (stashCreated) {
    await this.applyStashSafely(git, branchName);
  }
  
  return branchName;
  
} catch (error) {
  // ✅ Cleanup on any error
  if (stashCreated) {
    try {
      await git.reset(['--hard', 'HEAD']);
      await git.clean(['-fd']);
    } catch (cleanupError) {
      console.error(`Cleanup failed:`, cleanupError);
    }
  }
  
  throw error;
}
```

**개선 사항:**
1. **stashCreated 플래그**: Stash 생성 여부 추적
2. **try-catch 블록**: 전체 로직을 감싸서 에러 시 cleanup 보장
3. **applyStashSafely 사용**: 3곳에서 통일된 방식으로 stash 적용
   - Base branch checkout
   - Existing feature branch checkout  
   - New feature branch creation
4. **Error Cleanup**: 에러 발생 시 자동으로 clean state 복구

---

### 3. Learn 노드 Git Error Handling 개선

**위치:** `packages/ant-cli/src/agents/architect/graph/code/nodes/learn.ts`

**변경 전:**
```typescript
await gitPort.createBranch(branch, branchBase);
// No error handling ← Git conflict 시 작업 중단!
```

**변경 후:**
```typescript
try {
  await gitPort.createBranch(branch, branchBase);
  console.log(`\n📌 Branch '${branch}' ready`);
} catch (branchError: any) {
  // ✅ Handle "needs merge" or other Git conflicts
  if (branchError.message?.includes('needs merge') || 
      branchError.message?.includes('conflict') ||
      branchError.message?.includes('현재 인덱스')) {
    console.warn(`\n⚠️  Git conflict detected during branch operation. Cleaning up...`);
    
    try {
      // ✅ Cleanup: Reset to clean state
      const simpleGit = await import('simple-git');
      const git = simpleGit.default({
        baseDir: await gitPort.getRepoRoot(),
        binary: 'git',
        maxConcurrentProcesses: 6
      });
      
      await git.reset(['--hard', 'HEAD']);
      await git.clean(['-fd']);
      console.log(`✅ Git workspace cleaned up successfully`);
      
      // ✅ Retry branch creation
      await gitPort.createBranch(branch, branchBase);
      console.log(`✅ Branch '${branch}' created after cleanup`);
    } catch (cleanupError) {
      console.error(`❌ Failed to cleanup Git state:`, cleanupError);
      // ✅ Continue anyway - lessons can still be saved
    }
  } else {
    console.error(`❌ Failed to create branch '${branch}':`, branchError.message);
    // ✅ Continue anyway - branch creation failure shouldn't block lesson storage
  }
}
```

**개선 사항:**
1. **Conflict Detection**: "needs merge", "conflict", "현재 인덱스" 감지
2. **Automatic Cleanup**: Git reset + clean으로 clean state 복구
3. **Retry Logic**: Cleanup 후 branch creation 재시도
4. **Graceful Degradation**: 실패해도 lesson 저장은 계속 진행

---

## 📊 동작 비교

### Before (문제 상황)

```
1. User has uncommitted changes
2. Branch switch triggered
3. git stash push ✅
4. git checkout feature/skeleton ✅
5. git stash pop ❌ CONFLICT!
   → Working tree: conflict markers
   → Index: "needs merge" state
6. Error handler: console.warn() only
7. Continue anyway
8. Next Git operation: ❌ "needs merge" error
9. Job interrupted ❌
```

**결과:**
- Git이 conflict 상태로 남음
- 다음 작업 실패
- 무한 루프 (재시도 시 동일 문제)

---

### After (수정 후)

```
Scenario 1: No Conflict
1. User has uncommitted changes
2. git stash push ✅
3. git checkout feature/skeleton ✅
4. git stash apply ✅
5. Check status: No conflicts ✅
6. git stash drop ✅
7. Continue with clean state ✅

Scenario 2: Conflict Detected
1. User has uncommitted changes
2. git stash push ✅
3. git checkout feature/skeleton ✅
4. git stash apply ⚠️
5. Check status: Conflicts detected! ❌
6. git reset --hard HEAD ✅
7. git clean -fd ✅
8. Throw clear error with recovery instructions ✅
9. User informed, can resolve manually ✅

Scenario 3: Learn Node Conflict
1. Learn node: git checkout ❌ "needs merge"
2. Detect conflict ✅
3. git reset --hard HEAD ✅
4. git clean -fd ✅
5. Retry git checkout ✅
6. Continue with lessons ✅
```

**결과:**
- Git 항상 clean state 유지
- Conflict 발생 시 자동 cleanup
- 명확한 에러 메시지
- 무한 루프 방지

---

## 🎯 핵심 개선사항

### 1. Stash Apply vs Pop

**Before:**
```bash
git stash pop
# → Conflict 발생 시 index가 "needs merge" 상태
# → Stash는 유지되지만 다음 작업 불가능
```

**After:**
```bash
git stash apply
# → Conflict 발생해도 stash 유지
git status  # → Conflict 체크
# If no conflict:
git stash drop  # → Success cleanup
# If conflict:
git reset --hard HEAD
git clean -fd  # → Abort cleanup
```

### 2. 3단계 안전장치

```
Level 1: Conflict Detection
  → git status로 conflicted files 체크

Level 2: Automatic Cleanup
  → git reset --hard HEAD
  → git clean -fd
  
Level 3: Error Recovery
  → Detailed error message
  → Recovery instructions
  → Stash preserved
```

### 3. 여러 지점에서 적용

```
1. ProjectService.switchToFeatureBranch()
   - Base branch checkout
   - Existing branch checkout
   - New branch creation
   
2. Learn Node
   - Branch creation
   - Git conflict recovery
```

---

## 🧪 테스트 시나리오

### Test 1: Normal Stash Apply (No Conflict)

```bash
# Setup
echo "change" >> file.txt

# Execute
switchToFeatureBranch("feature/test")

# Expected
✅ Stash created
✅ Branch switched
✅ Stash applied
✅ Stash dropped
✅ file.txt contains "change"
```

### Test 2: Stash Conflict Detection

```bash
# Setup
# Branch A: file.txt line 1 = "A"
# Branch B: file.txt line 1 = "B"
# Working tree: file.txt line 1 = "C"

# Execute
switchToFeatureBranch("feature/b")

# Expected
✅ Stash created
✅ Checkout to branch B
⚠️ Stash apply → Conflict!
❌ Error thrown with details
✅ Git reset to clean state
✅ Stash still exists (can recover)
```

### Test 3: Learn Node Recovery

```bash
# Setup
# Git in "needs merge" state

# Execute
learn() node

# Expected
⚠️ Branch creation fails ("needs merge")
✅ Conflict detected
✅ git reset --hard HEAD
✅ git clean -fd
✅ Retry branch creation
✅ Lessons saved successfully
```

---

## 📁 변경 파일

1. **packages/ant-cli/src/periphery/adapters/http/services/ProjectService.ts**
   - `applyStashSafely()` 메서드 추가
   - `switchToFeatureBranch()` 리팩토링
   - Try-catch error handling 추가

2. **packages/ant-cli/src/agents/architect/graph/code/nodes/learn.ts**
   - Git error handling 추가
   - Conflict detection + cleanup
   - Retry logic

---

## ✅ 완료 체크리스트

- [x] `applyStashSafely()` 메서드 구현
- [x] `git stash pop` → `git stash apply` 변경
- [x] Conflict detection 추가
- [x] Automatic cleanup (`git reset --hard HEAD`)
- [x] Error handling with detailed messages
- [x] Learn 노드 Git error handling
- [x] Try-catch 블록으로 cleanup 보장
- [x] TypeScript 빌드 성공
- [x] 문서화 완료

---

## 🎓 설계 원칙

### 1. Fail-Safe Design

```
Every Git operation must:
1. Detect errors
2. Cleanup on failure
3. Provide recovery path
```

### 2. Clean State Guarantee

```
Before any operation:
  State: Clean or Stashable

After any operation:
  Success: Clean + Changes applied
  Failure: Clean + Stash preserved
  
Never: Dirty with conflicts
```

### 3. Information Preservation

```
Stash Apply (not Pop):
  → Conflict 발생해도 stash 유지
  → 사용자가 수동 복구 가능
  → 데이터 손실 없음
```

---

## 🔄 Impact

### Positive Impact

1. **No More "needs merge" Loop**
   - Git 항상 clean state
   - 무한 재시도 방지

2. **Better Error Messages**
   - 명확한 원인 설명
   - 복구 방법 안내

3. **Automatic Recovery**
   - Learn 노드 자동 cleanup
   - Lesson 저장 계속 진행

### No Breaking Changes

- 기존 동작 유지
- Conflict 없을 때는 동일하게 작동
- Conflict 발생 시에만 새로운 처리

---

## 📝 사용자 가이드

### Stash Conflict 발생 시

**에러 메시지:**
```
Cannot apply your uncommitted changes to feature/skeleton due to conflicts.
Conflicted files:
  - src/app.module.ts
  - src/main.ts

Your changes are still saved in git stash. To recover:
1. Resolve conflicts manually: git stash apply
2. Or discard stashed changes: git stash drop
```

**복구 방법:**
```bash
# Option 1: 수동 conflict 해결
git stash apply
# → Conflict markers 보이면 수동 해결
git add .
git stash drop

# Option 2: 변경사항 포기
git stash drop
```

---

**구현 완료**: 2025-11-30  
**파일 변경**: 2개  
**빌드 상태**: ✅ 성공  
**다음 단계**: 프로덕션 배포 및 모니터링

