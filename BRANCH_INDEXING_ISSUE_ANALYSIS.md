# 브랜치 벡터 DB 복사 문제 분석 및 해결책

## 🚨 문제 상황

### 현재 동작 흐름

```
1. 사용자가 새 feature 브랜치 생성
   ↓
2. autoIndexNewBranch() 호출
   ↓
3. base branch (main)가 인덱싱되어 있는지 확인
   isBranchIndexed(vectorDB, projectId, 'main')
   ↓
4. 인덱싱되어 있음 ✅
   ↓
5. copyBranchEmbeddings()로 얕은 복사
   - main 브랜치의 모든 임베딩 가져오기
   - targetBranch, targetCommit만 변경
   - 새 브랜치에 저장
```

### 문제점

**시나리오:**
```
1. main 브랜치가 commit ABC에서 인덱싱됨 (2일 전)
2. 팀원들이 main에 100개 커밋 추가 (최신: commit XYZ)
3. 사용자가 feature 브랜치 생성 (main에서 분기)
4. feature 브랜치는 commit XYZ의 최신 코드를 가짐
5. 하지만 벡터 DB는 commit ABC의 오래된 임베딩을 복사
6. LLM이 오래된 코드로 학습된 상태로 작업
```

**결과:**
- ❌ 최신 코드와 벡터 DB 불일치
- ❌ LLM이 존재하지 않는 함수/파일 참조
- ❌ 이미 수정된 버그를 다시 수정하려 함
- ❌ 새로 추가된 기능을 모름

---

## 🔍 근본 원인

### autoIndexNewBranch() 코드 (ProjectService.ts, line 2172-2196)

```typescript
const baseBranchIndexed = await indexer.isBranchIndexed(
  vectorDB,
  projectId,
  baseBranch
);

if (baseBranchIndexed) {
  // ❌ 문제: 커밋 해시를 확인하지 않음!
  console.log(`   ✅ Base branch '${baseBranch}' is indexed → Fast copy!`);
  
  const copyStats = await indexer.copyBranchEmbeddings(
    vectorDB,
    projectId,
    baseBranch,     // 오래된 커밋일 수 있음
    newBranch,
    baseCommit      // 현재 최신 커밋
  );
}
```

**문제:**
- `isBranchIndexed()`는 브랜치 **존재 여부**만 확인
- 브랜치의 **커밋 해시**는 확인하지 않음
- base branch가 최신인지 확인 안 함

---

## 💡 해결책

### 해결책 1: 커밋 해시 비교 (Recommended ⭐)

**장점:**
- ✅ 간단하고 확실
- ✅ 기존 코드 최소 변경
- ✅ 빠른 판단

**구현:**

```typescript
// ProjectService.ts - autoIndexNewBranch()

const indexer = new CodebaseIndexer();
const currentCommit = await git.getCurrentCommit();  // feature 브랜치의 커밋

// ✅ 1단계: base branch가 인덱싱되어 있는지 확인
const baseBranchIndexed = await indexer.isBranchIndexed(
  vectorDB,
  projectId,
  baseBranch
);

if (!baseBranchIndexed) {
  // base branch 인덱싱 안 됨 → full indexing
  console.log(`   ⚠️  Base branch '${baseBranch}' not indexed → Full indexing...`);
  await fullIndexing();
  return;
}

// ✅ 2단계: base branch의 커밋 해시 확인
const baseIndexStatus = await indexer.checkBranchIndexStatus(
  vectorDB,
  projectId,
  baseBranch,
  currentCommit  // 현재 커밋과 비교
);

// ✅ 3단계: 커밋이 동일한지 확인
if (baseIndexStatus.lastCommit === currentCommit) {
  // 같은 커밋 → 안전하게 복사
  console.log(`   ✅ Base branch is up-to-date (${currentCommit.substring(0, 8)}) → Fast copy!`);
  
  const copyStats = await indexer.copyBranchEmbeddings(
    vectorDB,
    projectId,
    baseBranch,
    newBranch,
    currentCommit
  );
} else {
  // 다른 커밋 → full indexing 필요
  console.log(`   ⚠️  Base branch is outdated:`);
  console.log(`      Indexed at: ${baseIndexStatus.lastCommit?.substring(0, 8)}`);
  console.log(`      Current: ${currentCommit.substring(0, 8)}`);
  console.log(`   → Full indexing required...`);
  
  await fullIndexing();
}
```

---

### 해결책 2: 자동 업데이트 후 복사 (Better UX 🌟)

**장점:**
- ✅ 사용자 경험 최고 (항상 최신)
- ✅ base branch도 자동으로 최신 유지
- ✅ 복사 성능 유지

**단점:**
- ⚠️ 약간 더 복잡
- ⚠️ 증분 인덱싱 시간 추가

**구현:**

```typescript
// ProjectService.ts - autoIndexNewBranch()

const indexer = new CodebaseIndexer();
const currentCommit = await git.getCurrentCommit();

// 1. base branch가 인덱싱되어 있는지 확인
const baseBranchIndexed = await indexer.isBranchIndexed(
  vectorDB,
  projectId,
  baseBranch
);

if (!baseBranchIndexed) {
  // base branch 없음 → full indexing
  console.log(`   ⚠️  Base branch '${baseBranch}' not indexed → Full indexing...`);
  await fullIndexing();
  return;
}

// 2. base branch의 커밋 상태 확인
const baseIndexStatus = await indexer.checkBranchIndexStatus(
  vectorDB,
  projectId,
  baseBranch,
  currentCommit
);

if (baseIndexStatus.lastCommit !== currentCommit) {
  // base branch가 오래됨 → 먼저 업데이트
  console.log(`   🔄 Base branch is outdated, updating first...`);
  console.log(`      Indexed at: ${baseIndexStatus.lastCommit?.substring(0, 8)}`);
  console.log(`      Current: ${currentCommit.substring(0, 8)}`);
  
  if (this.chatService && featureName) {
    this.chatService.addContentToCurrentMessage(projectId, featureName, {
      type: 'indexing',
      content: 'Updating base branch...',
      metadata: {
        message: `Updating ${baseBranch} to latest (incremental update)`
      }
    });
  }
  
  // ✅ base branch를 현재 커밋으로 증분 인덱싱
  await git.checkoutBranch(baseBranch);  // base branch로 체크아웃
  
  const updateStats = await indexer.index(
    { git, vectorDB, chunk },
    {
      project: projectId,
      workingDir: codebasePath,
      branch: baseBranch,
      incremental: true  // 증분 인덱싱 (빠름!)
    }
  );
  
  console.log(`   ✅ Base branch updated (${updateStats.filesIndexed} files)`);
  
  // feature branch로 다시 체크아웃
  await git.checkoutBranch(newBranch);
}

// 3. 이제 안전하게 복사
console.log(`   ✅ Base branch is up-to-date → Fast copy!`);

const copyStats = await indexer.copyBranchEmbeddings(
  vectorDB,
  projectId,
  baseBranch,
  newBranch,
  currentCommit
);
```

---

### 해결책 3: Lazy Update (성능 최적화)

**전략:**
- 복사는 일단 수행 (빠른 시작)
- 백그라운드에서 차이 확인 및 업데이트

**장점:**
- ✅ 즉시 시작 가능
- ✅ 백그라운드 업데이트

**단점:**
- ❌ 복잡도 높음
- ❌ 초기에는 여전히 오래된 데이터 사용

**구현:**

```typescript
// 1. 일단 복사 (빠르게 시작)
const copyStats = await indexer.copyBranchEmbeddings(
  vectorDB,
  projectId,
  baseBranch,
  newBranch,
  currentCommit
);

// 2. 백그라운드로 차이 확인 및 업데이트
this.scheduleBackgroundIndexUpdate(
  projectId,
  newBranch,
  baseBranch,
  currentCommit
);
```

**비추천**: 복잡도 대비 효과 낮음

---

## 📊 해결책 비교

| 해결책 | 구현 난이도 | 성능 | 정확성 | 사용자 경험 | 추천도 |
|--------|-------------|------|--------|-------------|--------|
| **1. 커밋 비교** | ⭐ 쉬움 | ⭐⭐⭐ 빠름 | ⭐⭐⭐ 완벽 | ⭐⭐ 보통 | ⭐⭐⭐ |
| **2. 자동 업데이트** | ⭐⭐ 보통 | ⭐⭐ 보통 | ⭐⭐⭐ 완벽 | ⭐⭐⭐ 최고 | ⭐⭐⭐⭐ |
| **3. Lazy Update** | ⭐⭐⭐ 어려움 | ⭐⭐⭐ 빠름 | ⭐⭐ 지연됨 | ⭐⭐ 보통 | ⭐ |

---

## 🎯 추천 구현 방안

### Phase 1: 커밋 비교 (즉시 적용) ⭐

**변경 파일**: `ProjectService.ts` - `autoIndexNewBranch()`

**변경 내용:**
```typescript
// Before
if (baseBranchIndexed) {
  // 바로 복사
  await indexer.copyBranchEmbeddings(...);
}

// After
if (baseBranchIndexed) {
  // 커밋 확인
  const baseIndexStatus = await indexer.checkBranchIndexStatus(
    vectorDB,
    projectId,
    baseBranch,
    currentCommit
  );
  
  if (baseIndexStatus.lastCommit === currentCommit) {
    // 같은 커밋 → 복사
    await indexer.copyBranchEmbeddings(...);
  } else {
    // 다른 커밋 → full indexing
    console.log(`   ⚠️  Base branch outdated → Full indexing`);
    await fullIndexing();
  }
}
```

**효과:**
- ✅ 오래된 데이터 복사 방지
- ✅ 항상 정확한 코드로 학습
- ✅ 최소 변경으로 문제 해결

---

### Phase 2: 자동 업데이트 (추후 개선) 🌟

**변경 파일**: `ProjectService.ts` - `autoIndexNewBranch()`

**변경 내용:**
```typescript
if (baseBranchIndexed) {
  const baseIndexStatus = await indexer.checkBranchIndexStatus(...);
  
  if (baseIndexStatus.lastCommit !== currentCommit) {
    // base branch 업데이트
    console.log(`   🔄 Updating base branch first...`);
    await updateBaseBranch(baseBranch, currentCommit);
  }
  
  // 이제 안전하게 복사
  await indexer.copyBranchEmbeddings(...);
}
```

**효과:**
- ✅ base branch도 항상 최신 유지
- ✅ 다음 브랜치 생성 시 더 빠름
- ✅ 최고의 사용자 경험

---

## 🔧 구현 예시

### 최종 추천 코드 (Phase 1 + Phase 2)

```typescript
// ProjectService.ts - autoIndexNewBranch()

private async autoIndexNewBranch(
  projectId: string,
  codebasePath: string,
  newBranch: string,
  baseBranch: string,
  userContext: UserContext,
  featureName: string
): Promise<void> {
  try {
    console.log(`\n📇 [Auto-Index] New branch created: ${newBranch}`);
    
    const { CodebaseIndexer } = await import('../../../../core/codebase/CodebaseIndexer');
    const { AdapterFactory } = await import('../../../../infrastructure/adapters/AdapterFactory');
    
    const git = AdapterFactory.createGitAdapter(codebasePath, projectId);
    const vectorDB = AdapterFactory.createMemoryAdapter();
    const chunk = AdapterFactory.createChunkAdapter();
    
    const indexer = new CodebaseIndexer();
    const currentCommit = await git.getCurrentCommit();
    
    // 1. base branch가 인덱싱되어 있는지 확인
    const baseBranchIndexed = await indexer.isBranchIndexed(
      vectorDB,
      projectId,
      baseBranch
    );
    
    if (!baseBranchIndexed) {
      // base branch 없음 → full indexing
      console.log(`   ⚠️  Base branch '${baseBranch}' not indexed → Full indexing...`);
      await this.performFullIndexing(projectId, codebasePath, newBranch, featureName, indexer, git, vectorDB, chunk);
      return;
    }
    
    // 2. ✅ NEW: base branch의 커밋 상태 확인
    const baseIndexStatus = await indexer.checkBranchIndexStatus(
      vectorDB,
      projectId,
      baseBranch,
      currentCommit
    );
    
    if (baseIndexStatus.lastCommit !== currentCommit) {
      // base branch가 오래됨
      console.log(`   ⚠️  Base branch is outdated:`);
      console.log(`      Indexed at: ${baseIndexStatus.lastCommit?.substring(0, 8) || 'unknown'}`);
      console.log(`      Current: ${currentCommit.substring(0, 8)}`);
      
      // Option A: Full indexing (Phase 1 - 간단)
      console.log(`   → Full indexing for accuracy...`);
      await this.performFullIndexing(projectId, codebasePath, newBranch, featureName, indexer, git, vectorDB, chunk);
      
      // Option B: Auto-update (Phase 2 - 더 나은 UX)
      /*
      console.log(`   🔄 Updating base branch first...`);
      await this.updateBaseBranch(projectId, codebasePath, baseBranch, currentCommit, indexer, git, vectorDB, chunk);
      
      // 이제 복사
      console.log(`   ✅ Base branch updated → Fast copy!`);
      await this.performFastCopy(projectId, baseBranch, newBranch, currentCommit, featureName, indexer, vectorDB);
      */
    } else {
      // 같은 커밋 → 안전하게 복사
      console.log(`   ✅ Base branch is up-to-date (${currentCommit.substring(0, 8)}) → Fast copy!`);
      await this.performFastCopy(projectId, baseBranch, newBranch, currentCommit, featureName, indexer, vectorDB);
    }
    
  } catch (error) {
    console.error(`❌ [Auto-Index] Failed:`, error);
    // ... error handling
  }
}

// Helper: Full indexing
private async performFullIndexing(
  projectId: string,
  codebasePath: string,
  branch: string,
  featureName: string,
  indexer: CodebaseIndexer,
  git: any,
  vectorDB: any,
  chunk: any
): Promise<void> {
  if (this.chatService && featureName) {
    this.chatService.addContentToCurrentMessage(projectId, featureName, {
      type: 'indexing',
      content: 'Learning codebase...',
      metadata: {
        message: `Full indexing for ${branch}`
      }
    });
  }
  
  const stats = await indexer.index(
    { git, vectorDB, chunk },
    {
      project: projectId,
      workingDir: codebasePath,
      branch
    }
  );
  
  console.log(`   ✅ Indexed ${stats.filesIndexed} files (${stats.chunksCreated} chunks)`);
  
  if (this.chatService && featureName) {
    this.chatService.addContentToCurrentMessage(projectId, featureName, {
      type: 'indexed',
      content: 'Codebase learned!',
      metadata: stats
    });
    this.chatService.finalizeCurrentMessage(projectId, featureName);
  }
}

// Helper: Fast copy
private async performFastCopy(
  projectId: string,
  sourceBranch: string,
  targetBranch: string,
  targetCommit: string,
  featureName: string,
  indexer: CodebaseIndexer,
  vectorDB: any
): Promise<void> {
  if (this.chatService && featureName) {
    this.chatService.addContentToCurrentMessage(projectId, featureName, {
      type: 'indexing',
      content: 'Fast learning...',
      metadata: {
        message: `Copying embeddings from ${sourceBranch}`
      }
    });
  }
  
  const copyStats = await indexer.copyBranchEmbeddings(
    vectorDB,
    projectId,
    sourceBranch,
    targetBranch,
    targetCommit
  );
  
  console.log(`   ✅ Copied ${copyStats.embeddingsCopied} embeddings in ${(copyStats.duration / 1000).toFixed(1)}s`);
  
  if (this.chatService && featureName) {
    this.chatService.addContentToCurrentMessage(projectId, featureName, {
      type: 'indexed',
      content: 'Branch learned!',
      metadata: copyStats
    });
    this.chatService.finalizeCurrentMessage(projectId, featureName);
  }
}

// Helper: Update base branch (Phase 2)
private async updateBaseBranch(
  projectId: string,
  codebasePath: string,
  baseBranch: string,
  targetCommit: string,
  indexer: CodebaseIndexer,
  git: any,
  vectorDB: any,
  chunk: any
): Promise<void> {
  // 현재 브랜치 저장
  const currentBranch = await git.getCurrentBranch();
  
  try {
    // base branch로 체크아웃
    await git.checkoutBranch(baseBranch);
    
    // 증분 인덱싱
    const updateStats = await indexer.index(
      { git, vectorDB, chunk },
      {
        project: projectId,
        workingDir: codebasePath,
        branch: baseBranch,
        incremental: true
      }
    );
    
    console.log(`   ✅ Base branch updated (${updateStats.filesIndexed} files)`);
  } finally {
    // 원래 브랜치로 돌아가기
    await git.checkoutBranch(currentBranch);
  }
}
```

---

## 📝 테스트 시나리오

### 시나리오 1: base branch가 최신일 때

```
Given: main 브랜치가 commit XYZ에서 인덱싱됨
And: 현재 main 브랜치가 commit XYZ (최신)
When: feature 브랜치 생성
Then: 
  - 커밋 비교 → 동일
  - Fast copy 수행
  - ✅ 정확한 데이터로 학습
```

### 시나리오 2: base branch가 오래되었을 때

```
Given: main 브랜치가 commit ABC에서 인덱싱됨
And: 현재 main 브랜치가 commit XYZ (최신)
When: feature 브랜치 생성
Then:
  - 커밋 비교 → 불일치
  - Phase 1: Full indexing 수행
  - 또는 Phase 2: main 업데이트 → Fast copy
  - ✅ 정확한 데이터로 학습
```

### 시나리오 3: base branch가 인덱싱 안 됐을 때

```
Given: main 브랜치 인덱싱 안 됨
When: feature 브랜치 생성
Then:
  - Full indexing 수행 (기존과 동일)
  - ✅ 정상 동작
```

---

## 🎯 결론

### 즉시 적용 (Phase 1)

**파일**: `ProjectService.ts`
**메서드**: `autoIndexNewBranch()`
**변경**: 커밋 해시 비교 추가

```typescript
const baseIndexStatus = await indexer.checkBranchIndexStatus(
  vectorDB,
  projectId,
  baseBranch,
  currentCommit
);

if (baseIndexStatus.lastCommit !== currentCommit) {
  // Full indexing
} else {
  // Fast copy
}
```

### 추후 개선 (Phase 2)

**추가**: `updateBaseBranch()` 헬퍼 메서드
**효과**: base branch 자동 업데이트

---

**문제 해결! 이제 항상 최신 코드로 학습합니다.** ✅
