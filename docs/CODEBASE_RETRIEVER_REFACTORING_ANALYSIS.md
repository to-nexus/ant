# CodebaseRetriever 리팩토링 분석

## 🔍 현재 구현 문제점

### ❌ **1. Find와 Load가 혼재되어 있음**

```typescript
// 현재 구조 (CodebaseRetriever.ts)
retrieve()
  ├─ tryVectorStrategy()
  │   ├─ vectorDB.query()        // Find files
  │   └─ loadFiles()              // Load files ← 즉시 로드!
  │
  ├─ keywordStrategy()
  │   ├─ findFilesByKeywords()    // Find files
  │   └─ loadFiles()              // Load files ← 즉시 로드!
  │
  └─ boostChangedFiles()
      └─ reorder files            // ← 이미 로드된 상태에서 재정렬만
```

**문제:**
- Find와 Load가 각 strategy 내부에서 즉시 실행됨
- Git changed 파일의 HEAD 버전을 로드할 기회가 없음
- 우선순위 조정이 파일 로드 **후**에 발생

---

### ❌ **2. Git HEAD 버전이 제대로 로드되지 않음**

```typescript
// 현재: boostChangedFiles()
private async boostChangedFiles(
  searchResult: CodeContext,  // ← code는 이미 로드됨
  gitChanges: string[],
  git?: GitPort
): Promise<CodeContext> {
  // 파일 순서만 재정렬
  const reorderedFiles = [
    ...changedAndConnected,
    ...onlyRelevant
  ];
  
  return {
    ...searchResult,
    files: reorderedFiles,
    // ❌ codeHead가 없음! (Git HEAD 버전 미로드)
  };
}
```

**결과:**
- LLM이 Git changed 파일의 **원본 버전**을 볼 수 없음
- "무엇이 변경되었는지" 비교 불가
- Context 품질 저하

---

### ❌ **3. 레거시 코드 잔존**

```typescript:330:388:packages/ant-cli/src/core/codebase/CodebaseRetriever.ts
/**
 * ⚠️  DEPRECATED: This strategy is no longer used as primary.
 * Git changes are now used as a priority boost, not a standalone strategy.
 */
private async tryGitStrategy(...): Promise<CodeContext | null> {
  // ... 100줄+ 코드
  // ❌ 사용되지 않지만 삭제 안됨
}
```

---

### ❌ **4. Strategy 정보 유실**

```typescript
// 현재: strategy 정보가 제대로 전달 안됨
private async boostChangedFiles(
  searchResult: CodeContext,  // strategy: 'vector' | 'keyword'
  ...
): Promise<CodeContext> {
  return {
    ...searchResult,
    strategy: searchResult.strategy === 'vector' ? 'vector' : 'keyword',
    // ✅ 유지는 되지만, 로직이 복잡함
  };
}
```

---

## ✅ **리팩토링된 구조**

### **설계 원칙: Find와 Load 완전 분리**

```typescript
// 리팩토링 후 구조
retrieve()
  │
  ├─ STEP 1: findRelevantFiles()  ────────────────┐
  │   ├─ searchVector()           // 경로만 반환  │
  │   ├─ searchKeyword()          // 경로만 반환  │  Find Phase
  │   └─ boostWithImportGraph()   // 우선순위 부여│
  │       └─ return FileInfo[]    // 경로 + 우선순위
  │
  ├─ STEP 2: loadFileVersions()   ────────────────┐
  │   ├─ readFile()               // current       │
  │   ├─ git.getHeadFile()        // original      │  Load Phase
  │   └─ return {                                  │
  │        code: current,                          │
  │        codeHead: original     // ✅ HEAD 포함 │
  │      }                                         │
```

---

### **핵심 개선 사항**

#### **1. Find Phase (Step 1)**
```typescript
private async findRelevantFiles(
  directive: string,
  workingDir: string,
  deps: { git?: GitPort; vectorDB?: MemoryPort },
  options: { maxFiles: number; exclude: string[] }
): Promise<FileInfo[]> {  // ← 경로 + 메타정보만!
  
  // 1. Get Git changes
  const gitChanges = await git.getChangedFiles();
  
  // 2. Search for relevant files
  const relevantFiles = await searchVector(directive, vectorDB)
    || await searchKeyword(directive, workingDir);
  
  // 3. Boost with Import Graph
  return boostWithImportGraph(relevantFiles, gitChanges);
  // ✅ 파일 경로 + 우선순위만 반환 (내용 로드 안함!)
}
```

#### **2. Load Phase (Step 2)**
```typescript
private async loadFileVersions(
  filesWithPriority: FileInfo[],
  workingDir: string,
  git: GitPort | undefined,
  maxTokens: number
): Promise<CodeContext> {
  
  const currentFiles = [];
  const headFiles = [];
  
  for (const fileInfo of filesWithPriority) {
    // Load current version (working tree)
    const current = readFile(fileInfo.path);
    currentFiles.push({ path, content: current });
    
    // ✅ Load Git HEAD version (if file has local changes)
    if (fileInfo.hasLocalChanges && git) {
      const head = await git.getHeadFile(fileInfo.path);
      headFiles.push({ path, content: head });
    }
  }
  
  return {
    code: format(currentFiles),
    codeHead: format(headFiles),  // ✅ HEAD 버전 포함!
    files: currentFiles.map(f => f.path),
    strategy: 'vector',  // ✅ 명확한 전달
    stats: { filesLoaded, filesChanged, estimatedTokens }
  };
}
```

---

## 📊 **Before vs After 비교**

| 항목 | Before (현재) | After (리팩토링) |
|------|--------------|---------------|
| **구조** | Find + Load 혼재 | Find → Load 분리 |
| **Git HEAD** | ❌ 로드 안됨 | ✅ changed 파일에 대해 로드 |
| **우선순위** | Load 후 재정렬 | Find 단계에서 결정 |
| **Strategy 정보** | 간접 전달 | 명시적 전달 |
| **레거시 코드** | tryGitStrategy 잔존 | ✅ 제거됨 |
| **코드 라인** | ~800줄 | ~600줄 (25% 감소) |
| **복잡도** | 높음 | 중간 |
| **테스트 가능성** | 어려움 | 쉬움 (단계별) |

---

## 🎯 **실제 동작 비교**

### **Scenario: "Update login button"**

#### **Before (현재)**
```typescript
1. tryVectorStrategy()
   - vectorDB.query("Update login button")
   - Found: [Login.tsx, Button.tsx]
   - loadFiles([Login.tsx, Button.tsx])  ← 즉시 로드
   - return { code: "...", files: [...] }

2. boostChangedFiles(result, [Auth.ts, README.md])
   - Auth.ts와 Login.tsx 연결 확인
   - 파일 순서 재정렬
   - return { code: "...", files: [Auth.ts, Login.tsx, Button.tsx] }
   ❌ Auth.ts 내용은 이미 로드 안됨!
   ❌ Git HEAD 버전 없음!

3. LLM receives:
   - Login.tsx (current only)
   - Button.tsx (current only)
   ❌ Auth.ts 누락! (경로는 있지만 내용 없음)
```

#### **After (리팩토링)**
```typescript
1. findRelevantFiles("Update login button")
   - searchVector()
   - Found: [Login.tsx, Button.tsx]
   - boostWithImportGraph([Login.tsx, Button.tsx], [Auth.ts, README.md])
   - Auth.ts ↔ Login.tsx connected! (Import Graph)
   - return [
       { path: Auth.ts, priority: 'high', hasLocalChanges: true },
       { path: Login.tsx, priority: 'normal', hasLocalChanges: false },
       { path: Button.tsx, priority: 'normal', hasLocalChanges: false }
     ]

2. loadFileVersions([Auth.ts, Login.tsx, Button.tsx])
   - Auth.ts:
     * current: readFile('Auth.ts')
     * original: git.getHeadFile('Auth.ts')  ✅
   - Login.tsx:
     * current: readFile('Login.tsx')
   - Button.tsx:
     * current: readFile('Button.tsx')
   
   return {
     code: "FILE: Auth.ts\n...\nFILE: Login.tsx\n...",
     codeHead: "FILE: Auth.ts\n... (original)",  ✅
     files: [Auth.ts, Login.tsx, Button.tsx]
   }

3. LLM receives:
   ✅ Auth.ts (current + original for comparison)
   ✅ Login.tsx (current)
   ✅ Button.tsx (current)
```

---

## 📈 **개선 효과**

### **1. Context 품질 향상**
```
Before: LLM은 변경된 파일의 current 버전만 봄
After:  LLM은 current + original 비교 가능
→ "무엇이 어떻게 변경되었는지" 정확히 이해
```

### **2. 성능 개선**
```
Before: 불필요한 파일 로드 후 재정렬
After:  필요한 파일만 선별 후 로드
→ I/O 연산 최소화
```

### **3. 유지보수성 향상**
```
Before: Find/Load 로직이 여러 함수에 분산
After:  명확한 2단계 파이프라인
→ 테스트/디버깅 용이
```

### **4. 확장성 확보**
```
Before: 새로운 strategy 추가 시 Load 로직도 중복 구현
After:  Find 로직만 추가하면 Load는 자동
→ DRY 원칙 준수
```

---

## 🚀 **적용 방법**

### **Option 1: 점진적 마이그레이션**
1. 새 파일(`CodebaseRetriever.refactored.ts`) 테스트
2. 기존 코드와 병렬 실행 (A/B 테스트)
3. 검증 후 기존 파일 교체

### **Option 2: 즉시 교체**
1. 기존 `CodebaseRetriever.ts` 백업
2. 리팩토링 버전으로 교체
3. 통합 테스트 실행

---

## ✅ **체크리스트**

### **리팩토링 완료 기준**
- [ ] Find와 Load 완전 분리
- [ ] Git HEAD 버전 로드 구현
- [ ] 레거시 코드 제거 (tryGitStrategy)
- [ ] Strategy 정보 명시적 전달
- [ ] Import Graph 통합
- [ ] 테스트 작성
- [ ] 문서 업데이트

### **현재 상태** (현재 CodebaseRetriever.ts)
- [x] Import Graph 통합
- [x] boostChangedFiles 구현
- [ ] Find/Load 분리 ← **미완성**
- [ ] Git HEAD 로드 ← **미구현**
- [ ] 레거시 제거 ← **미완성**

### **리팩토링 버전** (CodebaseRetriever.refactored.ts)
- [x] Find/Load 완전 분리
- [x] Git HEAD 로드 구현
- [x] 레거시 코드 없음
- [x] Strategy 명시적 전달
- [x] Import Graph 통합
- [ ] 테스트 작성 ← **필요**
- [ ] 통합 확인 ← **필요**

---

## 📝 **결론**

### **현재 구현의 문제**
1. ❌ Find와 Load가 혼재되어 있음
2. ❌ Git HEAD 버전이 로드되지 않음
3. ❌ 레거시 코드 잔존
4. ❌ 우선순위 결정이 Load 이후

### **리팩토링의 장점**
1. ✅ 명확한 2단계 파이프라인 (Find → Load)
2. ✅ Git HEAD 버전 비교 가능
3. ✅ 깔끔한 코드 (레거시 제거)
4. ✅ 우선순위 기반 로드 (효율적)
5. ✅ 테스트 가능성 향상
6. ✅ 업계 표준 패턴 준수

### **권장 사항**
**즉시 리팩토링을 적용하는 것을 강력히 권장합니다.**
- Context 품질이 크게 향상됨
- 코드 유지보수성 개선
- 표준적 설계 패턴 준수

