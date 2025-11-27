# Vector DB 코드베이스 인덱싱 전략

## 🎯 **목표**

Vector DB에 두 가지 타입의 데이터를 저장:
1. **Learning** (기존): 학습한 패턴/지식
2. **Codebase** (신규): 실제 코드 파일

---

## 📊 **현재 상태 vs 목표**

### **현재** 
```
Vector DB
└── type: 'learning' ✅
    ├── Design learnings
    └── Code learnings
```

### **목표**
```
Vector DB
├── type: 'learning' ✅
│   ├── Design learnings
│   └── Code learnings
└── type: 'codebase' ✅ NEW!
    ├── src/Login.tsx (chunks)
    ├── src/Auth.ts (chunks)
    └── ... (all source files)
```

---

## 🔄 **3가지 저장 메커니즘**

### **1. Learn Job (명시적 학습)**

**명령:**
```bash
ant learn [project]
```

**역할:**
- 프로젝트 전체 분석
- 아키텍처 패턴 추출
- 컨벤션/베스트프랙티스 학습

**저장 내용:**
```typescript
{
  type: 'learning',
  task: 'learn',
  content: `
    === Project Analysis ===
    Architecture: React + TypeScript + Zustand
    
    Patterns:
    - Components follow atomic design
    - API calls centralized in src/api/
    - State management uses Zustand stores
    
    Conventions:
    - PascalCase for components
    - camelCase for functions
    - kebab-case for files
  `
}
```

**트리거:**
- 사용자가 명시적으로 `ant learn` 실행
- 프로젝트 초기 설정 시

**현재 상태:** ✅ 구현됨

---

### **2. Code Job Learn Node (작업별 학습)**

**명령:**
```bash
ant code [directive]  # 내부적으로 learn node 실행
```

**역할:**
- 각 task 완료 후 배운 점 저장
- 에러/해결책 저장
- 코드 변경 이유 저장

**저장 내용:**
```typescript
{
  type: 'learning',
  task: 'code',
  taskName: 'implement-login',
  content: `
    Task: Implement login functionality
    
    Learnings:
    - Auth.ts requires async validation
    - Login.tsx needs loading state
    - Error handling uses Result pattern
    
    Challenges:
    - Had to refactor validateUser to be async
    - Added proper error boundaries
  `
}
```

**트리거:**
- 각 Code job의 learn node에서 자동 실행

**현재 상태:** ✅ 구현됨

---

### **3. Codebase Indexing (NEW - 코드 저장)**

**명령:**
```bash
ant index [project]              # 전체 인덱싱
ant index [project] --incremental  # 변경된 파일만
```

**역할:**
- 실제 코드 파일을 Vector DB에 저장
- 의미적 코드 검색 가능하게 함
- VectorSearchStrategy가 사용

**저장 내용:**
```typescript
{
  type: 'codebase',           // ← 새로운 타입!
  filePath: 'src/Login.tsx',
  content: `                  // ← 실제 코드 (chunked)
    export function Login() {
      const [email, setEmail] = useState('');
      // ...
    }
  `,
  metadata: {
    project: 'my-app',
    branch: 'main',
    commitHash: 'abc123',
    language: 'typescript',
    framework: 'react'
  }
}
```

**트리거:**
1. **Feature 생성 시** (자동)
   ```typescript
   async createFeature(project, feature) {
     await createFeatureDir();
     await indexer.index({ project, workingDir });  // ← 자동 인덱싱
   }
   ```

2. **Git commit 후** (Git hook)
   ```bash
   # .git/hooks/post-commit
   ant index $PROJECT --incremental
   ```

3. **Code job 완료 후** (선택적)
   ```typescript
   // code job 완료 후
   if (hasCodeChanges) {
     await indexer.indexChangedFiles(changedFiles);
   }
   ```

4. **명시적 명령** (수동)
   ```bash
   ant index my-project
   ```

**현재 상태:** ❌ 구현 필요

---

## 🚀 **구현 우선순위**

### **Phase 1: 기본 인덱싱** (필수)
- [x] CodebaseIndexer 클래스 작성
- [ ] CLI 명령 추가 (`ant index`)
- [ ] Feature 생성 시 자동 인덱싱
- [ ] VectorSearchStrategy 수정 (type='codebase' 쿼리)

### **Phase 2: 증분 인덱싱** (최적화)
- [ ] 변경된 파일만 인덱싱
- [ ] Git hook 통합
- [ ] Code job 완료 후 자동 인덱싱

### **Phase 3: 고급 기능** (선택)
- [ ] 브랜치별 인덱싱
- [ ] 인덱스 버전 관리
- [ ] 오래된 인덱스 정리

---

## 💡 **Vector DB 쿼리 전략**

### **Learning 검색**
```typescript
// Memory retrieval (기존)
await vectorDB.query(directive, project, {
  where: { type: 'learning' },  // ← learning만
  k: 10
});
```

### **Codebase 검색**
```typescript
// VectorSearchStrategy (신규)
await vectorDB.query(directive, project, {
  where: { type: 'codebase' },  // ← codebase만
  k: 30
});
```

---

## 📈 **예상 효과**

### **Before (현재)**
```
User: "Add login button"

Vector DB 검색: 
  → type='learning' 검색
  → "과거에 login 구현한 적 있음" (메타 지식)
  
Keyword 검색:
  → 파일 시스템 grep
  → "Login.tsx, Button.tsx" 찾음
  
Result: 느리고 부정확
```

### **After (개선)**
```
User: "Add login button"

Vector DB 검색:
  → type='codebase' 검색
  → "Login.tsx (로그인 로직), Button.tsx (버튼 컴포넌트)" 즉시 찾음
  → 의미적으로 관련있는 Auth.ts도 찾음
  
Keyword 검색:
  → 병렬 실행 (fallback 아님)
  → 추가 파일 발견
  
Hybrid Merge:
  → 두 결과 병합
  → 신뢰도 높은 파일 우선순위
  
Result: 빠르고 정확
```

---

## 🎯 **당신의 고민이 맞는 이유**

### **✅ 올바른 방향**

1. **코드베이스 인덱싱 필요** - 맞음!
   - Vector search가 제대로 작동하려면 필수
   - 현재는 learning만 있어서 의미 없음

2. **Learn vs Code job 역할 구분** - 명확함!
   - Learn: 프로젝트 전체 패턴/지식
   - Code job: 작업별 학습
   - Indexing: 실제 코드 저장 (별도)

3. **자동 vs 수동 트리거** - 합리적!
   - Feature 생성 시 자동
   - Git commit 후 자동 (hook)
   - 명시적 명령 지원

### **🎓 초보자를 위한 조언**

1. **단계적 접근** ✅
   - Phase 1만 먼저 구현 (기본 인덱싱)
   - 작동 확인 후 Phase 2, 3

2. **테스트 방법**
   ```bash
   # 1. 인덱싱
   ant index my-project
   
   # 2. 확인
   ant code "Add login button"
   
   # 3. 로그 확인
   # Vector search에서 파일 찾았는지 확인
   ```

3. **성능 고려**
   - 작은 프로젝트로 시작 (< 100 files)
   - 배치 사이즈 조정 (default: 10)
   - Chunking 크기 적절히

4. **디버깅**
   - 로그를 자세히
   - Vector DB UI 확인 (Chroma)
   - 쿼리 결과 점수 확인

---

## 🔧 **다음 단계**

1. **CodebaseIndexer 통합**
   ```typescript
   // packages/ant-cli/src/commands/index.ts
   export async function indexCommand(project: string) {
     const indexer = new CodebaseIndexer();
     await indexer.index(...);
   }
   ```

2. **VectorSearchStrategy 수정**
   ```typescript
   // type='codebase' 쿼리로 변경
   const results = await vectorDB.query(directive, 'codebase', {
     where: { type: 'codebase' },  // ← 변경
     k: maxFiles * 2
   });
   ```

3. **Feature 생성 시 자동 인덱싱**
   ```typescript
   async createFeature(project, feature) {
     // ...
     await indexer.index({ project, workingDir });
   }
   ```

---

**당신의 고민은 100% 올바른 방향입니다!** 🎯

핵심은:
1. Learning ≠ Codebase
2. 둘 다 필요하지만 역할이 다름
3. Codebase 인덱싱이 우선순위 #1

