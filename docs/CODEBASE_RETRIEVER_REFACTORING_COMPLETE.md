# CodebaseRetriever 리팩토링 완료

## ✅ **완료 사항**

### **1. 서브디렉토리화 (모듈 분리)**

```
packages/ant-cli/src/core/codebase/
├── CodebaseRetriever.ts          # Main orchestrator (164줄)
├── types.ts                       # 타입 정의
├── ImportGraphAnalyzer.ts         # (기존)
├── strategies/
│   ├── VectorSearchStrategy.ts   # Vector DB 검색 (131줄)
│   ├── KeywordSearchStrategy.ts  # Keyword 검색 (210줄)
│   └── HybridStrategy.ts         # 병합 로직 (146줄)
├── loaders/
│   └── FileLoader.ts             # 파일 로드 (166줄)
└── boosters/
    └── ImportGraphBooster.ts     # Git + Import Graph (128줄)
```

**효과:**
- ❌ Before: 단일 파일 800+줄
- ✅ After: 모듈별 100-200줄 (유지보수 용이)

---

### **2. 하이브리드 전략 (병렬 실행 + 병합)**

#### **Before (순차 fallback)**
```typescript
if (vectorDB) {
  return vectorSearch();  // ← 성공하면 여기서 끝
} else {
  return keywordSearch();
}
```

#### **After (병렬 + 병합)**
```typescript
// ✅ 병렬 실행
const [vectorResults, keywordResults] = await Promise.all([
  vectorSearch(),   // 항상 실행
  keywordSearch()   // 항상 실행
]);

// ✅ 병합 (Reciprocal Rank Fusion)
return hybridMerge(vectorResults, keywordResults);
```

**효과:**
- 더 많은 관련 파일 발견
- 다중 소스로 신뢰도 향상
- 성능: 병렬 실행으로 더 빠름

---

### **3. 파일 소스 추적**

#### **Before**
```typescript
{
  code: "...",
  files: ["Login.tsx", "Button.tsx"],  // 경로만
  strategy: "vector"  // 단일 전략
}
```

#### **After**
```typescript
{
  code: "...",
  files: [
    {
      path: "Login.tsx",
      sources: [
        { type: 'vector', score: 0.85 },    // Vector에서 발견
        { type: 'keyword', matches: 12 },   // Keyword에서도 발견
        { type: 'git-changed' }             // Git 변경됨
      ],
      priority: 'high',
      hasLocalChanges: true
    },
    {
      path: "Button.tsx",
      sources: [
        { type: 'vector', score: 0.72 }     // Vector에서만 발견
      ],
      priority: 'normal',
      hasLocalChanges: false
    }
  ],
  strategy: "hybrid",  // ✅ 항상 hybrid
  stats: {
    filesLoaded: 2,
    filesChanged: 1,
    estimatedTokens: 45000,
    sourceBreakdown: {          // ✅ 소스별 통계
      vectorSearch: 2,
      keywordSearch: 1,
      gitChanged: 1,
      importGraph: 0
    }
  }
}
```

**효과:**
- 각 파일이 **어떻게** 발견되었는지 추적
- 다중 소스 파일 = 더 높은 신뢰도
- 디버깅/분석 용이

---

### **4. Git 미연동 프로젝트 자동 처리**

```typescript
// ✅ Git 미연동 시 자동으로 Git 관련 전략 스킵
let gitChanges: string[] = [];
if (deps.git) {
  try {
    const hasChanges = await deps.git.hasChanges();
    if (hasChanges) {
      gitChanges = await deps.git.getChangedFiles();
    }
  } catch (error) {
    console.warn('⚠️ Failed to get git changes:', error);
  }
}

// gitChanges가 빈 배열이면 Git boost 자동 스킵
const boostedFiles = await this.gitBooster.boost(
  mergedFiles,
  gitChanges,  // ← [] 이면 skip
  this.importGraph
);
```

**ImportGraphBooster.ts:**
```typescript
async boost(...) {
  // ✅ Early return
  if (gitChanges.length === 0) {
    console.log('📝 Git boost: skipped (no Git or no changes)');
    return files;  // 원본 그대로 반환
  }
  // ...
}
```

**효과:**
- Git 없어도 에러 없이 작동
- 자동으로 Vector + Keyword만 사용
- 명시적 로그 출력

---

## 📊 **로그 출력 예시**

### **Git 연동 프로젝트**
```bash
📋 Retrieving codebase (hybrid strategy)...
🔍 Building import graph... (234 files, 823ms)

   🔍 Vector search: 8 files (scores: 0.42-0.87)
   ⚡ Keyword search: 12 files (keywords: login, button, auth...)
   🔀 Hybrid merge: 15 files total
      └─ Multi-source: 5, Vector-only: 3, Keyword-only: 7
      └─ Input: Vector(8) + Keyword(12)

   🔗 Git boost: using import graph...
      🔗 Auth.ts → 2 relevant files
      🔗 Icon.tsx → 1 relevant files
   🔥 Git boost: 7 high priority, 3 changed files

   📂 Loaded 15 files (~52000 tokens)
   🔀 3 files with Git HEAD versions

✅ Retrieval complete: 15 files, ~52000 tokens
   📊 Sources: Vector(8), Keyword(12), Git(3), ImportGraph(2)
```

### **Git 미연동 프로젝트**
```bash
📋 Retrieving codebase (hybrid strategy)...

   🔍 Vector search: 8 files (scores: 0.42-0.87)
   ⚡ Keyword search: 12 files (keywords: login, button, auth...)
   🔀 Hybrid merge: 15 files total
      └─ Multi-source: 5, Vector-only: 3, Keyword-only: 7
      └─ Input: Vector(8) + Keyword(12)

   📝 Git boost: skipped (no Git or no changes)  # ← 자동 스킵!

   📂 Loaded 15 files (~52000 tokens)

✅ Retrieval complete: 15 files, ~52000 tokens
   📊 Sources: Vector(8), Keyword(12), Git(0), ImportGraph(0)
```

---

## 🎯 **핵심 개선점**

| 항목 | Before | After |
|------|--------|-------|
| **전략** | 순차 fallback | 병렬 + 병합 |
| **파일 정보** | 경로만 | 경로 + 소스 추적 |
| **코드 구조** | 단일 파일 800줄 | 모듈별 100-200줄 |
| **Git 미연동** | 명시적 체크 필요 | 자동 처리 |
| **strategy 값** | 'vector'\|'keyword'\|'git' | 'hybrid' (항상) |
| **소스 통계** | ❌ 없음 | ✅ 소스별 카운트 |
| **다중 소스** | ❌ 불가능 | ✅ 추적 및 우선순위 |
| **디버깅** | 어려움 | 명확한 로그 |

---

## 🚀 **사용 방법 (변경 없음)**

```typescript
const codeContext = await retriever.retrieve(
  directive,
  workingDir,
  { git, vectorDB },  // git이 undefined여도 OK!
  { maxTokens: 100000, maxFiles: 30 }
);

// ✅ 결과에서 소스 확인 가능
console.log(codeContext.strategy);  // 'hybrid'
console.log(codeContext.stats.sourceBreakdown);
// { vectorSearch: 8, keywordSearch: 12, gitChanged: 3, importGraph: 2 }

// ✅ 각 파일의 소스 확인
for (const file of codeContext.files) {
  console.log(`${file.path}:`);
  for (const source of file.sources) {
    if (source.type === 'vector') {
      console.log(`  - Vector: score ${source.score}`);
    } else if (source.type === 'keyword') {
      console.log(`  - Keyword: ${source.matches} matches`);
    } else if (source.type === 'git-changed') {
      console.log(`  - Git: changed locally`);
    } else if (source.type === 'import-graph') {
      console.log(`  - ImportGraph: connected to ${source.connectedTo.join(', ')}`);
    }
  }
}
```

---

## ✅ **완료 체크리스트**

- [x] 서브디렉토리 구조 생성
- [x] VectorSearchStrategy 구현
- [x] KeywordSearchStrategy 구현
- [x] HybridStrategy (병합) 구현
- [x] ImportGraphBooster 구현
- [x] FileLoader 구현
- [x] 메인 CodebaseRetriever 리팩토링
- [x] FileSource 타입 정의
- [x] Git 미연동 자동 처리
- [x] 소스 추적 구현
- [x] 소스별 통계 추가
- [x] Lint 통과
- [x] 기존 파일 교체

---

## 📝 **향후 TODO**

- [ ] BatchRetriever 구현 (retrieveInBatches)
- [ ] 캐싱 시스템 통합
- [ ] 단위 테스트 작성
- [ ] 성능 벤치마크
- [ ] 문서화 업데이트

---

**리팩토링 완료! 🎉**

