# 🔍 Vector DB 이중 구조 분석 및 개선 방향

## 📊 **현황 파악**

### **Vector DB의 2가지 Type**

```typescript
// 1. learning 타입 (작업 학습 결과)
{
  type: 'learning',
  content: `
## 작업 완료: 사용자 인증 구현
- AuthService.validateUser 메서드 추가
- bcrypt를 사용한 비밀번호 검증
- JWT 토큰 생성 및 반환

## 학습된 패턴
- 인증 로직은 Service 레이어에 구현
- 비밀번호는 항상 bcrypt로 해싱
  `,
  metadata: {
    type: 'learning',
    project: 'my-project',
    feature: 'auth',
    task: 'code',
    timestamp: '2024-01-15T10:00:00Z'
  }
}

// 2. codebase 타입 (실제 코드 청크)
{
  type: 'codebase',
  content: `
export class AuthService {
  async validateUser(email: string, password: string) {
    const user = await this.db.findUserByEmail(email);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    return isValid ? { user, token } : null;
  }
}
  `,
  metadata: {
    type: 'codebase',
    filePath: 'src/Auth.ts',
    project: 'my-project',
    branch: 'feature-login',
    commitHash: 'abc1234',
    language: 'typescript',
    chunkType: 'function',
    chunkName: 'validateUser'
  }
}
```

---

## 🎯 **현재 사용 현황**

### **1. CodebaseRetriever (resolve 노드)**

```typescript
// packages/ant-cli/src/core/codebase/strategies/VectorSearchStrategy.ts

const results = await vectorDB.query(directive, 'codebase', {
  k: options.maxFiles * 2,
  minScore: 0.4,
  where: { type: 'codebase' }  // ✅ codebase만 검색!
});

// Result:
// - src/Auth.ts (함수/클래스 코드)
// - src/api/user.ts (API 엔드포인트)
// - src/components/LoginForm.tsx (UI 컴포넌트)
```

**용도:** 
- ✅ 사용자 요청(directive)과 관련된 **실제 코드 파일** 찾기
- ✅ 의미적으로 유사한 **코드 청크** 검색
- ✅ LLM에게 **현재 코드베이스** 제공

---

### **2. Memory Retrieval (resolve 노드)**

```typescript
// packages/ant-cli/src/agents/architect/memory/index.ts

const queryResults = await memory.query(query, project, {
  k: 10,
  where: { 
    type: 'learning'  // ✅ learning만 검색!
  },
  minScore: 0.5
});

// Queries:
const queries = {
  learnings: [
    "implementation learnings",
    "bug fixes",
    "optimization learnings"
  ],
  architecture: [
    "code architecture",
    "implementation patterns",
    "best practices"
  ],
  feedback: [
    "code feedback",
    "refactoring suggestions"
  ],
  project: [
    `${project} implementations`,
    `${project} coding patterns`
  ]
};

// Result:
`
📚 Previous Learnings
- Auth 구현 시 async/await 필수
- JWT 토큰은 httpOnly 쿠키 사용
- bcrypt로 비밀번호 해싱 (salt rounds: 10)

🏗️ Architecture & Design
- Service 레이어에 비즈니스 로직
- Repository 패턴으로 데이터 접근
- Clean Architecture 원칙 준수

📝 Feedback & Improvements
- 에러 처리를 더 구체적으로
- 로깅 추가 필요
- 테스트 커버리지 향상
`
```

**용도:**
- ✅ 과거 작업에서 **학습한 패턴/교훈** 검색
- ✅ 프로젝트의 **아키텍처 원칙** 제공
- ✅ **피드백/개선사항** 전달
- ✅ LLM에게 **장기 기억(Long-term Memory)** 제공

---

## 🔄 **전체 흐름 (현재)**

```
사용자: "사용자 로그인 기능 추가해줘"
  ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1. CodebaseRetriever] - type='codebase' 검색
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Query: "사용자 로그인 기능"
Where: { type: 'codebase' }

Result (실제 코드):
  - src/Auth.ts (AuthService class)
  - src/api/user.ts (getUser function)
  - src/components/LoginForm.tsx (LoginForm component)

→ LLM에게 전달:
   "FILE: src/Auth.ts [CURRENT]\n..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[2. Memory Retrieval] - type='learning' 검색
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Queries:
  - "implementation learnings"
  - "code architecture"
  - "best practices"

Where: { type: 'learning' }

Result (학습된 패턴):
  📚 Previous Learnings:
    - Auth 구현 시 async/await 필수
    - JWT 토큰은 httpOnly 쿠키 사용
  
  🏗️ Architecture & Design:
    - Service 레이어에 비즈니스 로직
    - Repository 패턴으로 데이터 접근

→ LLM에게 전달:
   "# Memory (Long-term Knowledge)\n..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3. Prompt Assembly]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LLM에게 전달되는 최종 프롬프트:

1️⃣ Directive (사용자 요청)
   "사용자 로그인 기능 추가해줘"

2️⃣ Memory (장기 기억 - learning 타입)
   📚 Previous Learnings:
   - Auth 구현 시 async/await 필수
   - JWT 토큰은 httpOnly 쿠키 사용
   
   🏗️ Architecture & Design:
   - Service 레이어에 비즈니스 로직

3️⃣ Current Code (현재 코드 - codebase 타입)
   FILE: src/Auth.ts [CURRENT]
   export class AuthService { ... }
   
   FILE: src/api/user.ts [CURRENT]
   export function getUser() { ... }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4. LLM 판단]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LLM:
  "Memory에서 배운 대로 async/await를 사용하고,
   JWT 토큰은 httpOnly 쿠키로 설정하겠습니다.
   현재 코드의 AuthService를 확장하겠습니다."

✅ Memory (learning)와 Code (codebase) 모두 활용!
```

---

## ❌ **문제점**

### **1. 분리된 검색 = 중복 쿼리**

```typescript
// 문제: 2번 검색
await vectorDB.query("사용자 로그인", 'codebase', {
  where: { type: 'codebase' }
});

await vectorDB.query("implementation learnings", 'codebase', {
  where: { type: 'learning' }
});

// ❌ 비효율적: 동일한 임베딩 공간에서 2번 쿼리
// ❌ 컨텍스트 단절: learning과 codebase가 별도로 전달
```

### **2. Memory 쿼리가 너무 일반적**

```typescript
// 현재 쿼리 (너무 광범위)
queries = {
  learnings: [
    "implementation learnings",  // 모든 구현 학습?
    "bug fixes",                 // 모든 버그 픽스?
    "optimization learnings"     // 모든 최적화?
  ],
  architecture: [
    "code architecture",         // 전체 아키텍처?
    "implementation patterns",   // 모든 패턴?
    "best practices"             // 모든 베스트 프랙티스?
  ]
};

// ❌ 문제:
// 1. 사용자 요청(directive)과 무관한 결과 포함 가능
// 2. "로그인" 관련 learning인지 "결제" 관련 learning인지 모호
// 3. 관련성 낮은 학습 내용까지 검색
```

### **3. 우선순위 불명확**

```typescript
// LLM이 받는 프롬프트
`
Memory (Long-term Knowledge):
- Auth 구현 시 async/await 필수
- 결제 처리 시 트랜잭션 필수  ← 관련 없음
- 파일 업로드는 S3 사용        ← 관련 없음

Current Code:
FILE: src/Auth.ts
export class AuthService { ... }
`

// ❌ LLM 혼란:
// "어떤 Memory가 현재 작업과 관련 있지?"
// "Auth 관련만 보고, 결제/파일은 무시해야 하나?"
```

### **4. Codebase + Learning 연결 부족**

```typescript
// 현재: 별도로 전달
Memory:
  "Auth 구현 시 async/await 필수"

Code:
  "export class AuthService { ... }"

// ❌ 연결성 부족:
// - 이 Auth.ts 파일을 작업했을 때 배운 교훈인지?
// - 다른 파일에서 배운 일반적 원칙인지?
// - 언제 배웠는지? (최신성 모름)
```

---

## 💡 **개선 방향**

### **옵션 1: 통합 검색 (Unified Search)**

```typescript
// ✅ 한 번의 쿼리로 learning + codebase 모두 검색

const results = await vectorDB.query(directive, project, {
  k: 50,  // 충분한 후보
  minScore: 0.4,
  // ❌ where: { type: 'codebase' }  제거!
});

// Result: learning과 codebase 모두 포함
[
  {
    type: 'codebase',
    score: 0.95,
    content: 'export class AuthService { ... }',
    metadata: { filePath: 'src/Auth.ts' }
  },
  {
    type: 'learning',
    score: 0.92,
    content: 'Auth 구현 시 async/await 필수...',
    metadata: { project, feature: 'auth', timestamp: '...' }
  },
  {
    type: 'codebase',
    score: 0.88,
    content: 'export function getUser() { ... }',
    metadata: { filePath: 'src/api/user.ts' }
  }
]

// ✅ 장점:
// 1. 한 번의 쿼리로 모든 관련 정보 수집
// 2. 유사도 기반으로 자동 정렬
// 3. 관련성 높은 learning + codebase 함께 전달
```

### **옵션 2: Directive 기반 Learning 검색**

```typescript
// ✅ 사용자 요청(directive)으로 learning 검색

// 현재 (일반적 쿼리)
await memory.query("implementation learnings", project, {
  where: { type: 'learning' }
});

// 개선 (directive 기반)
await memory.query(
  directive,  // "사용자 로그인 기능 추가해줘"
  project,
  {
    where: { type: 'learning' },
    k: 10
  }
);

// Result: 로그인 관련 learning만
[
  "Auth 구현 시 async/await 필수",
  "JWT 토큰은 httpOnly 쿠키 사용",
  "로그인 실패 시 rate limiting 필요"
]

// ✅ 장점:
// 1. 현재 작업과 관련성 높은 learning만 검색
// 2. 불필요한 learning 제외
// 3. LLM 혼란 최소화
```

### **옵션 3: 계층적 메타데이터 (Hierarchical Metadata)**

```typescript
// ✅ Learning에 관련 파일 정보 추가

// 현재 learning 저장
{
  type: 'learning',
  content: 'Auth 구현 시 async/await 필수',
  metadata: {
    project: 'my-project',
    feature: 'auth',
    timestamp: '2024-01-15T10:00:00Z'
  }
}

// 개선: 관련 파일 추가
{
  type: 'learning',
  content: 'Auth 구현 시 async/await 필수',
  metadata: {
    project: 'my-project',
    feature: 'auth',
    timestamp: '2024-01-15T10:00:00Z',
    relatedFiles: ['src/Auth.ts', 'src/api/user.ts'],  // ✅
    tags: ['authentication', 'async', 'best-practice']  // ✅
  }
}

// ✅ 활용:
// 1. src/Auth.ts를 수정할 때 → 관련 learning 우선 검색
// 2. "authentication" 태그로 필터링
// 3. 최신성 고려 (timestamp 기반 가중치)
```

### **옵션 4: 컨텍스트 결합 (Context Fusion)**

```typescript
// ✅ LLM에게 전달할 때 learning과 codebase 결합

// 현재 (분리)
`
Memory (Long-term Knowledge):
- Auth 구현 시 async/await 필수
- JWT 토큰은 httpOnly 쿠키 사용

Current Code:
FILE: src/Auth.ts [CURRENT]
export class AuthService { ... }
`

// 개선 (결합)
`
FILE: src/Auth.ts [CURRENT]
export class AuthService {
  // 현재 코드...
}

📚 Related Learnings (from previous work on this file):
- Auth 구현 시 async/await 필수 (2024-01-10, score: 0.92)
- JWT 토큰은 httpOnly 쿠키 사용 (2024-01-10, score: 0.88)
- 이 파일을 작업할 때 bcrypt salt rounds는 10 사용 (2024-01-10)

---

FILE: src/api/user.ts [CURRENT]
export function getUser() { ... }

📚 Related Learnings:
- API 엔드포인트는 /api prefix 사용 (2024-01-08)
- 인증 미들웨어 필수 (2024-01-08)
`

// ✅ 장점:
// 1. 코드와 learning이 명확히 연결
// 2. LLM이 컨텍스트 이해하기 쉬움
// 3. 관련성 점수 + 날짜로 신뢰도 판단 가능
```

---

## 🎯 **권장 구현 순서**

### **Phase 1: Directive 기반 Learning 검색 (빠른 개선)**

```typescript
// packages/ant-cli/src/agents/architect/memory/index.ts

// ✅ 변경: 일반적 쿼리 → directive 기반 쿼리
export async function retrieve(
  task: AgentTask,
  project: string,
  directive: string,  // ✅ 추가
  feature?: string,
  deps?: { memory: MemoryPort }
): Promise<string> {
  
  // ✅ directive로 learning 검색
  const learningResults = await memory.query(
    directive,  // "사용자 로그인 기능 추가해줘"
    project,
    {
      k: 10,
      where: { type: 'learning' },
      minScore: 0.5
    }
  );
  
  // 기존 카테고리 쿼리는 보조로 사용
  const categoryResults = await queryByCategories(...);
  
  // Merge and deduplicate
  const merged = mergeResults(learningResults, categoryResults);
  
  return formatMemory(merged);
}
```

**예상 효과:**
- ✅ 관련성 높은 learning만 검색
- ✅ LLM 혼란 최소화
- ✅ 프롬프트 토큰 절약

---

### **Phase 2: 메타데이터 강화 (중기)**

```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/learn.ts

// ✅ Learning 저장 시 메타데이터 추가
await memory.store([
  {
    content: learnings,
    metadata: {
      type: 'learning',
      project,
      feature,
      timestamp: new Date().toISOString(),
      relatedFiles: filesModified,           // ✅ 작업한 파일 목록
      tags: extractTags(learnings),          // ✅ 자동 태그 추출
      directive: originalDirective,          // ✅ 원본 요청
      taskType: currentTask.type             // ✅ setup/feature/error
    }
  }
], project);
```

**예상 효과:**
- ✅ Learning과 Code의 연결성 강화
- ✅ 파일별 관련 learning 검색 가능
- ✅ 태그 기반 필터링

---

### **Phase 3: 통합 검색 (장기)**

```typescript
// packages/ant-cli/src/core/codebase/strategies/UnifiedSearchStrategy.ts

export class UnifiedSearchStrategy {
  async search(
    directive: string,
    vectorDB: MemoryPort,
    options: { maxFiles: number; maxLearnings: number }
  ): Promise<UnifiedResult> {
    
    // ✅ 한 번의 쿼리로 모든 타입 검색
    const allResults = await vectorDB.query(directive, project, {
      k: options.maxFiles + options.maxLearnings,
      minScore: 0.4
      // ❌ where 필터 없음!
    });
    
    // ✅ 타입별로 분리하되 유사도 기반 우선순위 유지
    const codeResults = allResults
      .filter(r => r.metadata.type === 'codebase')
      .slice(0, options.maxFiles);
    
    const learningResults = allResults
      .filter(r => r.metadata.type === 'learning')
      .slice(0, options.maxLearnings);
    
    // ✅ 코드와 learning을 결합하여 전달
    return {
      files: codeResults,
      learnings: learningResults,
      integrated: integrateByFile(codeResults, learningResults)
    };
  }
}
```

**예상 효과:**
- ✅ 한 번의 쿼리로 모든 정보 수집
- ✅ 자연스러운 우선순위 (유사도 기반)
- ✅ 쿼리 비용 절감

---

## 📊 **비교표**

| 항목 | 현재 | Phase 1 | Phase 2 | Phase 3 |
|------|------|---------|---------|---------|
| **쿼리 횟수** | 2회 (code + learning) | 2회 | 2회 | 1회 ✅ |
| **Learning 관련성** | 낮음 (일반 쿼리) | 높음 (directive 기반) ✅ | 높음 | 매우 높음 ✅ |
| **Code-Learning 연결** | 없음 | 없음 | 있음 (메타데이터) ✅ | 강함 (통합 검색) ✅ |
| **LLM 혼란도** | 높음 | 중간 | 낮음 ✅ | 매우 낮음 ✅ |
| **구현 난이도** | - | 낮음 ✅ | 중간 | 높음 |
| **토큰 절약** | 0% | 20% ✅ | 30% ✅ | 40% ✅ |

---

## ✅ **결론**

### **현황:**
- ✅ learning과 codebase는 **분리되어 검색**
- ✅ CodebaseRetriever는 **codebase만** 사용
- ✅ Memory Retrieval은 **learning만** 사용
- ✅ 둘 다 **프롬프트에 포함됨**

### **문제점:**
- ❌ 중복 쿼리 (비효율)
- ❌ Learning 쿼리가 너무 일반적 (관련성 낮음)
- ❌ Code와 Learning 연결성 부족
- ❌ LLM 혼란 (어떤 learning이 현재 작업과 관련?)

### **개선 방향:**
1. **Phase 1 (즉시):** Directive 기반 Learning 검색
2. **Phase 2 (중기):** 메타데이터 강화 (relatedFiles, tags)
3. **Phase 3 (장기):** 통합 검색 (unified query)

### **예상 효과:**
- ✅ 관련성 높은 learning만 검색 (토큰 20-40% 절약)
- ✅ LLM 혼란 최소화 (정확도 향상)
- ✅ Code-Learning 연결성 강화 (컨텍스트 명확)

**Phase 1부터 시작하시겠습니까?** 🚀

