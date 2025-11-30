# Git Merge Conflict 문제 분석

## 🔴 문제 상황

### 에러 메시지
```
📌 Branch 'feature/skeleton' already exists, checking out...

⚠️  Execution interrupted: src/app.module.ts: needs merge
src/main.ts: needs merge
src/rooms/rooms.controller.ts: needs merge
src/rooms/rooms.service.ts: needs merge
error: 현재 인덱스를 먼저 해결해야 합니다

❌ Error: src/app.module.ts: needs merge
src/main.ts: needs merge
src/rooms/rooms.controller.ts: needs merge
src/rooms/rooms.service.ts: needs merge
error: 현재 인덱스를 먼저 해결해야 합니다
```

---

## 🔍 근본 원인

### 상황 분석

**1. Stash Pop 시 Conflict 발생**

**코드 위치:** `ProjectService.ts` Line 1698-1707, 1776-1785

```typescript
// ✅ Apply stashed changes if any
if (hasChanges) {
  try {
    await git.stash(['pop']);
    console.log(`[ProjectService] ✅ Stashed changes applied successfully`);
  } catch (popError) {
    console.warn(`[ProjectService] ⚠️  Could not apply stashed changes:`, popError);
    // Continue anyway - user can manually resolve
  }
}
```

**문제:**
1. Branch switch 전에 uncommitted changes를 `git stash`로 저장
2. Branch checkout 후 `git stash pop`으로 복원 시도
3. **Stashed changes가 target branch의 코드와 conflict** 발생!
4. `git stash pop` 실패 → Working tree가 conflict 상태로 남음
5. 다음 작업 시도 시 "needs merge" 에러

---

### 시나리오 재구성

```
1. User working on feature/skeleton
   - app.module.ts 수정 중 (uncommitted)
   - main.ts 수정 중 (uncommitted)
   - rooms.controller.ts 수정 중 (uncommitted)
   - rooms.service.ts 수정 중 (uncommitted)

2. Job starts (learn node)
   - switchToFeatureBranch() 호출
   - Detects uncommitted changes
   - git stash (changes saved)

3. Checkout feature/skeleton
   - Already exists
   - git checkout feature/skeleton ✅

4. Apply stashed changes
   - git stash pop
   - ❌ CONFLICT! Stashed changes conflict with feature/skeleton
   - 4 files have merge conflicts
   - Git index now in "needs merge" state

5. Job continues
   - Tries to work on codebase
   - ❌ Git operations fail: "needs merge"
   - Job interrupted
```

---

## 📊 Git State Diagram

```
Before Stash:
  Working Tree: 4 files modified
  Index: clean
  HEAD: some-branch

After Stash:
  Working Tree: clean
  Index: clean
  Stash: 4 files saved

After Checkout:
  Working Tree: clean
  Index: clean
  HEAD: feature/skeleton

After Stash Pop (CONFLICT):
  Working Tree: 4 files with conflict markers
  Index: UNMERGED state (needs merge)
  HEAD: feature/skeleton
  
  ❌ State: Cannot proceed with any Git operations!
```

---

## 🎯 왜 이런 일이 발생하는가?

### 1. Stash Pop의 함정

**Git Stash Pop:**
```bash
git stash pop
# = git stash apply + git stash drop (if successful)
```

**문제:**
- Stash에 저장된 changes가 current branch와 **conflict** 가능
- Conflict 발생 시:
  - Working tree에 conflict markers 생성
  - Git index가 "unmerged" 상태
  - **Stash는 drop 안 됨** (pop 실패)
  - **다음 작업 불가능!**

### 2. 현재 코드의 문제

**ProjectService.ts Line 1701-1707:**
```typescript
try {
  await git.stash(['pop']);
  console.log(`[ProjectService] ✅ Stashed changes applied successfully`);
} catch (popError) {
  console.warn(`[ProjectService] ⚠️  Could not apply stashed changes:`, popError);
  // Continue anyway - user can manually resolve
  // ❌ 문제: 에러만 로그하고 계속 진행!
  // ❌ Git index가 "needs merge" 상태로 남음!
}
```

**문제점:**
1. **Error Handling 불충분**: Catch하고 warning만 출력
2. **State Cleanup 없음**: Conflict 상태를 해결 안 함
3. **Continue Anyway**: 작업 계속 진행 → 다음 Git 작업 실패

---

## ✅ 해결 방안

### Option 1: Stash Apply + Keep Stash (Safest)

**변경:**
```typescript
// ❌ OLD: git stash pop (conflict 시 문제)
await git.stash(['pop']);

// ✅ NEW: git stash apply (conflict 발생해도 stash 유지)
await git.stash(['apply']);

// If conflict occurs:
// - User can see conflicts
// - Stash is still saved (can be dropped manually later)
// - Can abort and try again
```

**장점:**
- Conflict 발생해도 stash 보존
- User가 수동으로 해결 가능
- 데이터 손실 없음

**단점:**
- Stash list에 남음 (수동 정리 필요)

---

### Option 2: Detect Conflict + Abort (Recommended)

**변경:**
```typescript
if (hasChanges) {
  try {
    await git.stash(['apply']);  // ✅ Use apply instead of pop
    
    // ✅ Check if conflicts occurred
    const statusAfterApply = await git.status();
    const hasConflicts = statusAfterApply.conflicted && statusAfterApply.conflicted.length > 0;
    
    if (hasConflicts) {
      // ✅ Abort: Reset to clean state
      console.error(`[ProjectService] ❌ Stash apply resulted in conflicts. Aborting...`);
      await git.reset(['--hard', 'HEAD']);  // Clean working tree
      await git.clean(['-fd']);  // Remove untracked files
      
      throw new Error(
        `Cannot switch to ${featureName}: Your uncommitted changes conflict with the target branch. ` +
        `Please commit or discard your changes before switching branches. ` +
        `Conflicted files: ${statusAfterApply.conflicted.join(', ')}`
      );
    }
    
    // ✅ No conflicts: Drop stash
    await git.stash(['drop']);
    console.log(`[ProjectService] ✅ Stashed changes applied successfully`);
    
  } catch (applyError) {
    // ✅ Handle any errors
    console.error(`[ProjectService] ❌ Failed to apply stashed changes:`, applyError);
    
    // ✅ Cleanup: Reset to clean state
    await git.reset(['--hard', 'HEAD']);
    await git.clean(['-fd']);
    
    throw new Error(
      `Failed to apply stashed changes. Repository has been reset to clean state. ` +
      `Original error: ${applyError instanceof Error ? applyError.message : String(applyError)}`
    );
  }
}
```

**장점:**
- Conflict 감지 즉시 abort
- Clean state 복구
- 명확한 에러 메시지

---

### Option 3: Don't Stash - Require Clean State (Strictest)

**변경:**
```typescript
const hasChanges = status.files.length > 0;

if (hasChanges) {
  // ❌ 브랜치 전환 거부
  throw new Error(
    `Cannot switch to ${featureName}: You have uncommitted changes. ` +
    `Please commit or discard your changes before switching branches.\n` +
    `Modified files:\n` +
    status.files.map(f => `  - ${f.path}`).join('\n')
  );
}

// No stash needed - proceed with checkout
```

**장점:**
- 가장 안전 (conflict 가능성 원천 차단)
- Git 베스트 프랙티스
- 명확한 workflow

**단점:**
- 사용자가 항상 commit/discard 필요
- UX 불편

---

## 🛠️ 권장 구현 (Option 2)

### Phase 1: Stash Apply with Conflict Detection

```typescript
async switchToFeatureBranch(
  projectId: string,
  featureName: string,
  userContext: UserContext
): Promise<string> {
  // ... existing code ...
  
  const hasChanges = status.files.length > 0;
  let stashCreated = false;
  
  if (hasChanges) {
    console.log(`[ProjectService] ⚠️  Uncommitted changes detected, stashing...`);
    try {
      await git.stash(['push', '-u', '-m', `Auto-stash before switching to ${featureName}`]);
      stashCreated = true;
      console.log(`[ProjectService] ✅ Changes stashed successfully`);
    } catch (stashError) {
      throw new Error(`Failed to stash changes: ${stashError instanceof Error ? stashError.message : String(stashError)}`);
    }
  }
  
  try {
    // ... branch checkout logic ...
    
    // ✅ Apply stashed changes if any
    if (stashCreated) {
      await this.applyStashSafely(git, featureName);
    }
    
    return actualBranchName;
    
  } catch (error) {
    // ✅ Cleanup on error
    if (stashCreated) {
      try {
        await git.reset(['--hard', 'HEAD']);
        await git.clean(['-fd']);
        console.log(`[ProjectService] 🧹 Cleaned up working tree after error`);
      } catch (cleanupError) {
        console.error(`[ProjectService] Failed to cleanup:`, cleanupError);
      }
    }
    
    throw error;
  }
}

private async applyStashSafely(git: any, featureName: string): Promise<void> {
  try {
    // ✅ Use apply instead of pop (keeps stash)
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
        `Cannot apply your uncommitted changes to ${featureName} due to conflicts.\n` +
        `Conflicted files:\n${conflictedFiles.map((f: string) => `  - ${f}`).join('\n')}\n\n` +
        `Your changes are still saved in git stash. To recover:\n` +
        `1. Resolve conflicts manually: git stash apply\n` +
        `2. Or discard stashed changes: git stash drop`
      );
    }
    
    // ✅ No conflicts: Success! Drop stash
    await git.stash(['drop']);
    console.log(`[ProjectService] ✅ Stashed changes applied and cleaned up successfully`);
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('conflicts')) {
      throw error;  // Re-throw our own error
    }
    
    // ✅ Other errors: Cleanup and throw
    console.error(`[ProjectService] ❌ Failed to apply stash:`, error);
    await git.reset(['--hard', 'HEAD']);
    await git.clean(['-fd']);
    
    throw new Error(
      `Failed to apply your uncommitted changes. Repository reset to clean state.\n` +
      `Your changes are still in git stash. To recover: git stash apply\n` +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

---

## 🧪 테스트 시나리오

### Scenario 1: No Conflicts (Success)

```
1. Edit files on branch A
2. Switch to branch B
3. Stash → Checkout → Apply
4. ✅ No conflicts
5. ✅ Changes applied successfully
```

### Scenario 2: Conflicts (Abort)

```
1. Edit app.module.ts on branch A (add line 10)
2. Switch to branch B (branch B also modified line 10 differently)
3. Stash → Checkout → Apply
4. ❌ Conflict detected!
5. ✅ Abort: git reset --hard HEAD
6. ✅ Error message with recovery instructions
7. User can: git stash apply (to manually resolve)
```

### Scenario 3: Apply Error (Cleanup)

```
1. Stash changes
2. Checkout branch
3. Apply stash → Some error
4. ✅ Cleanup: reset + clean
5. ✅ Error message with recovery
```

---

## 📋 구현 체크리스트

- [ ] `applyStashSafely()` 메서드 추가
- [ ] `git stash pop` → `git stash apply` 변경
- [ ] Conflict detection 추가
- [ ] Conflict 발생 시 `git reset --hard HEAD` cleanup
- [ ] 명확한 에러 메시지 (recovery 방법 포함)
- [ ] Success 시 `git stash drop`
- [ ] Try-catch에서 cleanup 보장
- [ ] 테스트 (conflict 시나리오)

---

## 🎓 Git Stash Best Practices

### 1. Apply vs Pop

```bash
# ❌ Pop: Conflict 시 문제
git stash pop
# → Conflict 발생 시 stash 유지되지만 index가 "needs merge" 상태

# ✅ Apply: Safer
git stash apply
# → Conflict 발생해도 stash 유지, 수동 drop 가능
git stash drop  # Success 후 수동 정리
```

### 2. Conflict Detection

```bash
git stash apply
git status
# Check: conflicted files

# If conflicts:
git reset --hard HEAD  # Abort
git clean -fd          # Clean untracked
```

### 3. Error Recovery

```bash
# If stuck in "needs merge":
git reset --hard HEAD
git clean -fd

# Recover stashed changes:
git stash list
git stash apply stash@{0}
```

---

**다음 단계**: ProjectService.ts 리팩토링 구현

