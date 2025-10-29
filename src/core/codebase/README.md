# Codebase Module

코드베이스 검색 및 로딩을 위한 모듈

## Phase 1: CodebaseRetriever (기본)

**대부분의 작업 (90%+)**에 사용되는 스마트 검색 기반 코드 로더

### 특징

- ✅ **자동 전략 선택**: Git → Vector → Keyword
- ✅ **토큰 효율적**: 관련 파일만 로드
- ✅ **Git 통합**: 변경사항 자동 추적
- ✅ **Vector 검색**: 의미 기반 관련 파일 찾기

### 사용 예시

```typescript
import { CodebaseRetriever } from '@core/codebase';

const retriever = new CodebaseRetriever();

const context = await retriever.retrieve(
  directive,
  workingDir,
  { git, vectorDB },
  { maxTokens: 100000, maxFiles: 30 }
);

// context.strategy: 'git' | 'vector' | 'keyword'
// context.code: 현재 코드베이스
// context.codeHead: Git HEAD 버전 (있으면)
```

### 전략

#### 1. Git Strategy (우선)
- Git diff가 있을 때 사용
- 변경된 파일 + 관련 파일
- 가장 빠르고 정확

#### 2. Vector Strategy (메인)
- Vector DB로 의미 검색
- 관련 파일만 선별
- 토큰 효율적

#### 3. Keyword Strategy (Fallback)
- Vector DB 없을 때
- 키워드 기반 grep
- 기본 동작 보장

---

## Phase 2: CodebaseBatchRetriever (대규모)

**대규모 전역 리팩토링**을 위한 배치 처리 시스템

### 특징

- ✅ **배치 처리**: 5-10개 파일씩 나눠서 처리
- ✅ **점진적**: 여러 번 LLM 호출
- ✅ **토큰 관리**: 배치당 ~20K tokens
- ✅ **AST 준비**: 향후 정밀 분석 통합

### 사용 예시

```typescript
import { CodebaseBatchRetriever } from '@core/codebase';

const retriever = new CodebaseBatchRetriever();

// AsyncIterator로 배치 스트리밍
for await (const batch of retriever.retrieveInBatches(directive, workingDir, deps)) {
  console.log(`Batch ${batch.batchNumber}: ${batch.files.length} files`);
  
  // LLM으로 배치 처리
  const result = await llm.generateDiffs({
    instruction: directive,
    code: batch.code
  });
  
  // Diff 적용
  for (const diff of result.diffs) {
    await applyDiff(diff);
  }
}
```

### 사용 사례

- **전역 함수명 변경**: `loginUser` → `authenticateUser` (100+ 파일)
- **Import 경로 변경**: `@old/path` → `@new/path` (50+ 파일)
- **함수 시그니처 변경**: 모든 파일에서 함수 인터페이스 업데이트

---

## 비교표

| 항목 | Phase 1 (Retriever) | Phase 2 (Batch) |
|------|---------------------|-----------------|
| **사용 빈도** | 90%+ | 10%- |
| **파일 수** | < 30개 | 100+ 개 |
| **토큰** | ~100K | ~20K × N batches |
| **LLM 호출** | 1회 | N회 (배치 수만큼) |
| **처리 방식** | 한 번에 | 점진적 |
| **적용 범위** | 단일 기능 | 전역 리팩토링 |

---

## Architecture

### Phase 1 전략 선택 흐름

```
CodebaseRetriever.retrieve()
    ↓
Git diff 있나?
  YES → Git Strategy (변경된 파일)
  NO  ↓
Vector DB 있나?
  YES → Vector Strategy (의미 검색)
  NO  ↓
Keyword Strategy (grep)
    ↓
File System에서 실제 파일 로드
    ↓
Return: CodeContext
```

### Phase 2 배치 처리 흐름

```
CodebaseBatchRetriever.retrieveInBatches()
    ↓
1. 전체 스캔 (grep or AST)
    ↓
2. 영향받는 파일 식별 (100+)
    ↓
3. 배치로 나누기 (5개씩)
    ↓
4. 각 배치 yield
    ↓
   LLM 처리 (외부)
    ↓
5. 다음 배치...
```

---

## Claude와 비교

| 기능 | Claude | Phase 1 | Phase 2 |
|------|--------|---------|---------|
| Vector 검색 | ✅ | ✅ | ✅ |
| Git 통합 | ✅ | ✅ | ✅ |
| Fallback | ❌ | ✅ | ✅ |
| 자동 전략 | 수동 | ✅ 자동 | ✅ 자동 |
| 배치 처리 | ✅ | ❌ | ✅ |
| AST 분석 | ✅ | ❌ | 🚧 향후 |

**결론**: Claude와 동등하거나 더 나은 구현! 🎯

---

## 설정

### 기본값

```typescript
// Phase 1
{
  maxTokens: 100000,    // ~75KB
  maxFiles: 30,
  exclude: ['node_modules', 'test', ...]
}

// Phase 2
{
  batchSize: 5,
  maxBatches: 20,
  maxTokensPerBatch: 20000  // ~15KB
}
```

### 커스터마이징

```typescript
// 토큰 늘리기 (큰 프로젝트)
await retriever.retrieve(directive, workingDir, deps, {
  maxTokens: 150000,  // ~110KB
  maxFiles: 50
});

// 배치 크기 조정
for await (const batch of batchRetriever.retrieveInBatches(directive, workingDir, deps, {
  batchSize: 10,      // 더 큰 배치
  maxBatches: 30      // 더 많은 배치
})) {
  // ...
}
```

---

## 향후 계획

### Phase 1
- ✅ Git Strategy
- ✅ Vector Strategy
- ✅ Keyword Fallback
- 🚧 Import 분석 (관련 파일 확장)
- 🚧 Cache 시스템

### Phase 2
- ✅ Grep 기반 스캔
- ✅ 배치 처리
- 🚧 AST 기반 정밀 분석
- 🚧 Dependency Graph
- 🚧 영향 범위 예측
- 🚧 자동 검증/롤백

