# 🎯 프롬프트 토큰 최적화 전략

## 📊 **현재 토큰 사용량 분석**

### **추정치 (평균 Code Job)**

```typescript
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// System Prompt
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
System Prompt:               ~2,000 tokens
Guardrails:                  ~500 tokens
Rules:                       ~1,000 tokens
Examples:                    ~2,000 tokens
Policies:                    ~500 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subtotal (Fixed):            ~6,000 tokens

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Variable Context
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Directive:                   ~200 tokens   ← 사용자 요청
Design Document:             ~5,000 tokens ← 설계 문서
Current Code:                ~20,000 tokens ← 코드베이스 (30 files)
Original Code (Git HEAD):    ~10,000 tokens ← 비교용
Memory (Learning):           ~3,000 tokens ← 장기 기억
Profile:                     ~500 tokens   ← 환경 정보
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subtotal (Variable):         ~38,700 tokens

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL:                       ~44,700 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ⚠️ 문제:
// - Claude 3.5 Sonnet: 200K context window
// - 하지만 ~50K 이상부터 성능 저하 시작
// - 중요하지 않은 정보가 섞여 있음
```

---

## ❌ **현재 문제점**

### **1. 중복 코드 (Current + Original)**

```typescript
// Current Code: 20,000 tokens
FILE: src/Auth.ts [CURRENT]
export class AuthService {
  constructor(private db: Database) {}
  
  async validateUser(email: string, password: string) {
    const user = await this.db.findUserByEmail(email);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    return isValid ? { user, token: generateToken(user) } : null;
  }
  
  async hashPassword(password: string) {
    return bcrypt.hash(password, 10);
  }
}

// Original Code: 10,000 tokens
FILE: src/Auth.ts [ORIGINAL - Git HEAD]
export class AuthService {
  constructor(private db: Database) {}
  
  async hashPassword(password: string) {
    return bcrypt.hash(password, 10);
  }
}

// ❌ 문제:
// - 90%가 동일한 코드 (hashPassword)
// - 실제 차이는 10% (validateUser 추가)
// - 30,000 tokens 중 3,000만 유용
```

### **2. 관련 없는 Learning**

```typescript
// Memory (Learning): 3,000 tokens
📚 Previous Learnings:
- Auth 구현 시 async/await 필수        ← ✅ 관련 있음
- JWT 토큰은 httpOnly 쿠키 사용       ← ✅ 관련 있음
- 결제 처리 시 트랜잭션 필수           ← ❌ 관련 없음
- 파일 업로드는 S3 사용                ← ❌ 관련 없음
- 이메일 발송은 queue 사용             ← ❌ 관련 없음
- 로깅은 Winston 사용                  ← ❌ 관련 없음

🏗️ Architecture & Design:
- Service 레이어에 비즈니스 로직       ← ✅ 관련 있음
- Repository 패턴으로 데이터 접근      ← ✅ 관련 있음
- MVC 패턴 사용                        ← ❌ 일반적
- Dependency Injection 적용            ← ❌ 일반적

// ❌ 문제:
// - 관련성 낮은 learning이 50% 이상
// - 1,500 tokens 낭비
```

### **3. 불필요한 Code**

```typescript
// Current Code: 30 files, 20,000 tokens

// 관련 있는 파일 (40%):
src/Auth.ts                    ← ✅ 직접 수정 대상
src/api/auth.ts                ← ✅ Auth API
src/middleware/auth.ts         ← ✅ Auth 미들웨어
src/types/auth.ts              ← ✅ Auth 타입

// 관련성 낮은 파일 (60%):
src/api/user.ts                ← ⚠️ User API (간접 관련)
src/api/product.ts             ← ❌ 전혀 관련 없음
src/components/ProductList.tsx ← ❌ 전혀 관련 없음
src/utils/format.ts            ← ❌ 유틸리티 (관련 없음)
...

// ❌ 문제:
// - Vector/Keyword 검색이 부정확
// - 12,000 tokens 낭비
```

---

## ✅ **최적화 전략**

### **전략 1: Unified Search (통합 검색)**

```typescript
// ✅ 한 번의 쿼리로 Code + Learning 모두 검색

const allResults = await vectorDB.query(directive, project, {
  k: 50,  // 충분한 후보
  minScore: 0.6  // ✅ 기준 상향 (0.4 → 0.6)
  // ❌ where 필터 제거
});

// ✅ 유사도 기반 자동 정렬
[
  { type: 'codebase', score: 0.95, path: 'src/Auth.ts' },
  { type: 'learning', score: 0.92, content: 'Auth 구현 시...' },
  { type: 'codebase', score: 0.88, path: 'src/api/auth.ts' },
  { type: 'learning', score: 0.85, content: 'JWT 토큰은...' },
  { type: 'codebase', score: 0.70, path: 'src/middleware/auth.ts' },
  { type: 'codebase', score: 0.50, path: 'src/api/user.ts' }  ← 제외
]

// ✅ Top N 선택
codeFiles = top 15 (score >= 0.6)
learnings = top 5 (score >= 0.6)

// 토큰 절약: 20,000 → 12,000 (40% 절약)
```

### **전략 2: Diff-based Original Code**

```typescript
// ❌ 현재: Current + Original 모두 전송
Current:  20,000 tokens
Original: 10,000 tokens
Total:    30,000 tokens

// ✅ 개선: Diff만 전송
Current:  12,000 tokens (15 files, 관련성 높음)
Diff:     1,500 tokens   (변경 부분만)
Total:    13,500 tokens

// 토큰 절약: 30,000 → 13,500 (55% 절약)

// Example:
FILE: src/Auth.ts [CURRENT]
export class AuthService {
  constructor(private db: Database) {}
  
  // ✅ NEW: User validation method
  async validateUser(email: string, password: string) {
    const user = await this.db.findUserByEmail(email);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    return isValid ? { user, token: generateToken(user) } : null;
  }
  
  async hashPassword(password: string) {
    return bcrypt.hash(password, 10);
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Changes from Git HEAD:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
+  async validateUser(email: string, password: string) {
+    const user = await this.db.findUserByEmail(email);
+    if (!user) return null;
+    
+    const isValid = await bcrypt.compare(password, user.passwordHash);
+    return isValid ? { user, token: generateToken(user) } : null;
+  }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### **전략 3: Smart Learning Integration**

```typescript
// ✅ Learning을 관련 파일과 함께 전달

FILE: src/Auth.ts [CURRENT]
export class AuthService { ... }

📚 Related Learnings (score >= 0.85):
- Auth 구현 시 async/await 필수 (score: 0.92, 2024-01-10)
- JWT 토큰은 httpOnly 쿠키 사용 (score: 0.88, 2024-01-10)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FILE: src/api/auth.ts [CURRENT]
export function loginAPI() { ... }

📚 Related Learnings (score >= 0.85):
- API 엔드포인트는 /api prefix 사용 (score: 0.87)

// 토큰 절약: 3,000 → 1,000 (67% 절약)
```

### **전략 4: Design Document Summarization**

```typescript
// ❌ 현재: 전체 Design Document 전송
Design Document: 5,000 tokens
- System Overview
- Architecture
- Database Schema
- API Specification
- UI/UX Design
- Security Considerations
- Deployment Strategy

// ✅ 개선: Current Task 관련 섹션만 추출
Design Document (Relevant Sections): 1,500 tokens
- Authentication (섹션 3)
- API Specification (섹션 4.2 - Auth APIs)
- Security Considerations (섹션 6.1 - Auth)

// 토큰 절약: 5,000 → 1,500 (70% 절약)
```

---

## 📊 **최적화 효과**

```typescript
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BEFORE (현재)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
System Prompt:      6,000 tokens
Directive:          200 tokens
Design Doc:         5,000 tokens
Current Code:       20,000 tokens
Original Code:      10,000 tokens
Memory (Learning):  3,000 tokens
Profile:            500 tokens
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL:              44,700 tokens

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AFTER (최적화)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
System Prompt:      6,000 tokens  (동일)
Directive:          200 tokens    (동일)
Design Doc:         1,500 tokens  (✅ -70%, 관련 섹션만)
Current Code:       12,000 tokens (✅ -40%, 유사도 0.6+)
Diff (Original):    1,500 tokens  (✅ -85%, 변경 부분만)
Integrated Learning: 1,000 tokens (✅ -67%, 관련 것만)
Profile:            500 tokens    (동일)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL:              22,700 tokens (✅ -49% 절약!)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 효과
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 토큰 49% 절약 (44.7K → 22.7K)
✅ API 비용 49% 절감
✅ 응답 속도 30% 향상 (적은 컨텍스트)
✅ 정확도 향상 (노이즈 제거)
✅ LLM 집중력 향상 (관련 정보만)
```

---

## 🎯 **우선순위 기반 프롬프트 구조**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 1: 필수 정보 (항상 포함)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- System Prompt
- Guardrails
- Current Task
- Directive (사용자 요청)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 2: 핵심 컨텍스트 (score >= 0.8)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Top 5 Code Files (직접 수정 대상)
- Top 3 Learnings (최고 관련성)
- Design Doc (관련 섹션만)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 3: 참고 컨텍스트 (score >= 0.6)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Additional 10 Code Files (참고용)
- Additional 2 Learnings
- Profile (환경 정보)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIER 4: 선택적 (토큰 여유 있을 때만)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Examples
- Full Design Doc
- Additional Code Files (score < 0.6)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
토큰 예산 관리:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Target: 25,000 tokens
  TIER 1: 6,500 tokens (26%)
  TIER 2: 10,000 tokens (40%)
  TIER 3: 6,000 tokens (24%)
  TIER 4: 2,500 tokens (10%, 선택적)
```

---

## 🚀 **구현 계획**

### **Step 1: UnifiedSearchStrategy 구현**

```typescript
// packages/ant-cli/src/core/codebase/strategies/UnifiedSearchStrategy.ts

export interface UnifiedSearchResult {
  codeFiles: Array<{
    path: string;
    score: number;
    priority: 'critical' | 'high' | 'medium';
  }>;
  learnings: Array<{
    content: string;
    score: number;
    relatedFiles: string[];
    timestamp: string;
  }>;
  stats: {
    totalResults: number;
    codeResults: number;
    learningResults: number;
    avgScore: number;
  };
}

export class UnifiedSearchStrategy {
  async search(
    directive: string,
    vectorDB: MemoryPort,
    options: {
      maxCodeFiles: number;      // 15
      maxLearnings: number;       // 5
      minScore: number;           // 0.6
      includeGitChanges: boolean; // true
    }
  ): Promise<UnifiedSearchResult> {
    
    // 1. Single query for all types
    const allResults = await vectorDB.query(directive, project, {
      k: options.maxCodeFiles + options.maxLearnings + 20,  // Extra candidates
      minScore: options.minScore
      // NO where filter!
    });
    
    // 2. Separate by type, maintaining score order
    const codeResults = allResults
      .filter(r => r.metadata.type === 'codebase')
      .slice(0, options.maxCodeFiles);
    
    const learningResults = allResults
      .filter(r => r.metadata.type === 'learning')
      .slice(0, options.maxLearnings);
    
    // 3. Boost git-changed files
    if (options.includeGitChanges) {
      const gitChanges = await this.getGitChanges();
      this.boostChangedFiles(codeResults, gitChanges);
    }
    
    // 4. Classify by priority
    const classified = this.classifyByPriority(codeResults);
    
    return {
      codeFiles: classified,
      learnings: this.formatLearnings(learningResults),
      stats: {
        totalResults: allResults.length,
        codeResults: codeResults.length,
        learningResults: learningResults.length,
        avgScore: this.calculateAvgScore(allResults)
      }
    };
  }
  
  private classifyByPriority(
    results: any[]
  ): Array<{ path: string; score: number; priority: string }> {
    return results.map(r => ({
      path: r.metadata.filePath,
      score: r.score,
      priority: 
        r.score >= 0.9 ? 'critical' :
        r.score >= 0.75 ? 'high' :
        'medium'
    }));
  }
}
```

### **Step 2: Learning 메타데이터 강화**

```typescript
// packages/ant-cli/src/agents/architect/graph/code/nodes/learn.ts

// ✅ 저장 시 메타데이터 추가
await memory.store([
  {
    content: learnings,
    metadata: {
      type: 'learning',
      project,
      feature,
      timestamp: new Date().toISOString(),
      
      // ✅ 추가 메타데이터
      relatedFiles: state.filesWritten || [],  // 작업한 파일들
      directive: state.directive,               // 원본 요청
      taskType: state.currentTask?.type,        // setup/feature/error
      tags: extractTags(learnings),             // 자동 태그 추출
      branch: currentBranch,                    // 브랜치명
      codeChanges: {
        linesAdded: totalLinesAdded,
        linesRemoved: totalLinesRemoved,
        filesModified: state.filesWritten.length
      }
    }
  }
], project);

function extractTags(learnings: string): string[] {
  const keywords = [
    'auth', 'authentication', 'login', 'jwt', 'bcrypt',
    'api', 'endpoint', 'rest', 'graphql',
    'database', 'sql', 'orm', 'prisma',
    'react', 'component', 'hook', 'state',
    'async', 'await', 'promise',
    'error', 'validation', 'security',
    'test', 'testing', 'jest',
    'performance', 'optimization'
  ];
  
  return keywords.filter(k => 
    learnings.toLowerCase().includes(k)
  );
}
```

### **Step 3: 프롬프트 최적화**

```typescript
// packages/ant-cli/src/core/prompt/engine/ContextAssembler.ts

async assemble(...): Promise<AssembledContext> {
  
  // 1. Unified Search (Code + Learning)
  const unifiedResult = await this.unifiedSearch(
    artifacts.directive || '',
    deps
  );
  
  // 2. Filter Design Doc (관련 섹션만)
  const relevantDesign = artifacts.designDoc 
    ? this.extractRelevantSections(
        artifacts.designDoc,
        artifacts.directive,
        unifiedResult.codeFiles
      )
    : undefined;
  
  // 3. Format Code with Integrated Learning
  const formattedCode = this.formatCodeWithLearning(
    unifiedResult.codeFiles,
    unifiedResult.learnings
  );
  
  // 4. Diff-based Original Code
  const diffOnly = await this.generateDiffOnly(
    unifiedResult.codeFiles,
    deps.git
  );
  
  return {
    directive: artifacts.directive,
    designDoc: relevantDesign,        // ✅ 관련 섹션만
    currentCode: formattedCode,       // ✅ Learning 통합
    originalFiles: diffOnly,          // ✅ Diff만
    stats: {
      hasDirective: !!artifacts.directive,
      hasDesign: !!relevantDesign,
      hasOriginalFiles: !!diffOnly,
      hasCurrentCode: !!formattedCode,
      tokensEstimated: this.estimateTokens({
        directive: artifacts.directive,
        design: relevantDesign,
        code: formattedCode,
        diff: diffOnly
      })
    }
  };
}

private formatCodeWithLearning(
  codeFiles: any[],
  learnings: any[]
): string {
  const sections: string[] = [];
  
  // Group learnings by file
  const learningsByFile = new Map<string, any[]>();
  for (const learning of learnings) {
    for (const file of learning.relatedFiles || []) {
      if (!learningsByFile.has(file)) {
        learningsByFile.set(file, []);
      }
      learningsByFile.get(file)!.push(learning);
    }
  }
  
  // Format each file with its learnings
  for (const file of codeFiles) {
    sections.push(`FILE: ${file.path} [score: ${file.score.toFixed(2)}]`);
    sections.push(file.content);
    
    const relatedLearnings = learningsByFile.get(file.path) || [];
    if (relatedLearnings.length > 0) {
      sections.push('\n📚 Related Learnings:');
      for (const learning of relatedLearnings) {
        sections.push(`- ${learning.content.substring(0, 200)}... (${learning.timestamp})`);
      }
    }
    
    sections.push('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
  
  return sections.join('\n');
}
```

---

## ✅ **결론**

### **1. Phase 3가 최종 목표 맞습니다**
- ✅ 바로 통합 검색으로 리팩토링
- ✅ 레거시 Memory Retrieval 제거

### **2. Learning은 추가 정보입니다**
- ✅ Code와 함께 전달 (통합)
- ✅ 관련성 높은 것만 필터링

### **3. 현재 최적화 안 되어 있습니다**
- ❌ 44.7K tokens (너무 많음)
- ✅ 22.7K tokens로 최적화 (49% 절약)
- ✅ 우선순위 기반 필터링

**바로 구현하겠습니다!** 🚀

