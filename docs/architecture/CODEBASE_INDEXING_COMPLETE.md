# 코드베이스 인덱싱 시스템 (완전 가이드)

> **최종 업데이트**: 2025-11-28  
> **상태**: ✅ 완료 및 운영 중

---

## 📋 목차

1. [시스템 개요](#시스템-개요)
2. [스마트 인덱싱 전략](#스마트-인덱싱-전략)
3. [Vector DB 데이터 구조](#vector-db-데이터-구조)
4. [자동 인덱싱 (Push 시)](#자동-인덱싱-push-시)
5. [수동 인덱싱 (CLI)](#수동-인덱싱-cli)
6. [통합 검색 시스템](#통합-검색-시스템)
7. [성능 최적화](#성능-최적화)
8. [사용 가이드](#사용-가이드)

---

## 시스템 개요

### 핵심 개념

ANT의 코드베이스 인덱싱 시스템은 **Git 기반 스마트 인덱싱**을 통해 팀 협업에서의 중복을 방지하고 성능을 최적화합니다.

```
┌─────────────────────────────────────────────────────────┐
│                   코드베이스 인덱싱 시스템                 │
└─────────────────────────────────────────────────────────┘

개발자 작업
   ↓
Git Commit
   ↓
ANT UI Push 버튼 클릭
   ↓
┌──────────────────────────────────┐
│  1. Git Push 실행                │
│  2. 스마트 전략 선택:             │
│     - Full: 새 브랜치             │
│     - Incremental: 기존 브랜치    │
│  3. CodebaseIndexer 실행         │
│  4. Vector DB 저장               │
└──────────────────────────────────┘
   ↓
팀원들 Vector DB 공유 (중복 방지!)
```

### 주요 특징

✅ **Git 기반 증분 인덱싱**: 변경된 파일만 인덱싱 (60% 시간 절약)  
✅ **브랜치별 격리**: 각 브랜치 독립적으로 관리  
✅ **자동 전략 선택**: Full vs Incremental 자동 판단  
✅ **팀 협업 최적화**: Push한 사람만 인덱싱, Pull은 스킵  
✅ **Non-blocking**: 인덱싱 실패해도 Push는 성공  

---

## 스마트 인덱싱 전략

### 전략 선택 로직

```typescript
// CodebaseIndexer.index()

1. Git 상태 확인
   - 현재 브랜치
   - HEAD 커밋 해시

2. Vector DB 쿼리
   - 브랜치 존재 여부 확인
   - Index Completion Marker 확인

3. 전략 선택
   if (브랜치 없음 || Marker 없음):
     → Full Indexing (전체 파일)
   else if (커밋 해시 동일):
     → Skip (변경 없음)
   else:
     → Incremental (Git diff 기반)
```

### Index Completion Marker

브랜치 인덱싱이 **완전히 완료**되었음을 보장하는 특수 마커:

```typescript
{
  type: 'index_completion',
  project: 'my-project',
  branch: 'feature-login',
  commitHash: 'abc1234',
  filesIndexed: 100,
  chunksCreated: 523,
  timestamp: '2024-01-15T10:00:00Z'
}
```

**효과**:
- OOM으로 인한 불완전 인덱싱 감지
- 다음 시도 시 자동으로 Full Indexing 재실행
- 데이터 무결성 보장

---

## Vector DB 데이터 구조

### 1. Codebase 타입 (코드 청크)

```typescript
{
  type: 'codebase',
  filePath: 'src/auth/Login.tsx',
  content: 'export function Login() { ... }',
  project: 'my-project',
  branch: 'feature-login',
  commitHash: 'abc1234',
  language: 'typescript-react',
  timestamp: '2024-01-15T10:00:00Z'
}
```

### 2. Lesson 타입 (학습된 지식)

```typescript
{
  type: 'lesson',
  content: 'Auth implementation requires async/await...',
  project: 'my-project',
  feature: 'login',
  relatedFiles: ['src/auth/Login.tsx', 'src/auth/utils.ts'],
  tags: ['auth', 'async', 'validation'],
  directive: 'Add login functionality',
  taskType: 'code',
  branch: 'feature-login',
  timestamp: '2024-01-15T10:00:00Z'
}
```

### 3. Index Completion Marker

```typescript
{
  type: 'index_completion',
  project: 'my-project',
  branch: 'feature-login',
  commitHash: 'abc1234',
  filesIndexed: 100,
  chunksCreated: 523,
  timestamp: '2024-01-15T10:00:00Z'
}
```

---

## 자동 인덱싱 (Push 시)

### 시나리오 1: 최초 Push (새 브랜치)

```bash
# 개발자 A: 새 브랜치 생성
git checkout -b feature-login
# ... 코드 작업 (100개 파일) ...
git commit -m "feat: add login"

# ANT UI에서 Push 버튼 클릭
→ git push origin feature-login

📇 [Auto-Index] Starting...
   Branch: feature-login
   Commit: abc1234
   📊 Branch not in Vector DB → Full indexing
   Found 100 source files
   
   Batch 1/10: 10 files
   Batch 2/10: 10 files
   ...
   
✅ [Indexer] Indexing complete (full)!
   Files indexed: 100
   Chunks created: 523
   Duration: 4.2s
```

### 시나리오 2: 추가 작업 후 Push (증분)

```bash
# 개발자 A: 동일 브랜치에서 추가 작업
# Login.tsx, Auth.ts 수정
git commit -m "fix: update validation"

# ANT UI에서 Push 버튼 클릭
→ git push origin feature-login

📇 [Auto-Index] Starting...
   Branch: feature-login
   Commit: def5678
   📊 Branch exists → Incremental indexing
   Found 2 changed files
   
   Batch 1/1: 2 files
   
✅ [Indexer] Indexing complete (incremental)!
   Files indexed: 2
   Chunks created: 8
   Duration: 0.3s
```

**성능 개선**: 4.2s → 0.3s **(14배 빠름!)**

### 시나리오 3: 팀원 Pull (중복 방지)

```bash
# 개발자 B: Pull로 코드 다운로드
git pull origin feature-login

# ANT UI에서는 아무것도 안함
→ Vector DB는 이미 최신 상태 ✅
→ 중복 인덱싱 없음 ✅
```

---

## 수동 인덱싱 (CLI)

### 명령어

```bash
aidev index <project>
```

### 예시

```bash
aidev index my-project

📇 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📇 Indexing codebase: my-project
📇 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📂 Codebase path: /Users/user/projects/my-project

📇 [Indexer] Starting codebase indexing...
   Project: my-project
   Working dir: /Users/user/projects/my-project
   Branch: feature-login
   Commit: abc1234
   Found 100 source files
   
   Batch 1/10: 10 files
   ...
   
✅ [Indexer] Indexing complete (incremental)!
   Files indexed: 2
   Chunks created: 8
   Est. tokens: 3500
   Duration: 0.3s

✅ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Indexing Complete!
✅ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 통합 검색 시스템

### UnifiedSearchStrategy

**파일**: `packages/ant-cli/src/core/codebase/strategies/UnifiedSearchStrategy.ts`

```typescript
async search(
  directive: string,
  project: string,
  deps: { vectorDB, git },
  options: {
    maxCodeFiles: 15,      // 코드 파일 최대 개수
    maxLessons: 5,         // 레슨 최대 개수
    minCodeScore: 0.6,     // 코드 최소 유사도
    minLessonScore: 0.5,   // 레슨 최소 유사도
    includeGitChanges: true // Git 변경사항 Boost
  }
): Promise<{
  codeFiles: FileWithSource[];
  lessons: LessonResult[];
  stats: SearchStats;
}>
```

### 검색 흐름

```
1. Vector DB 단일 쿼리
   ↓
   type: 'codebase' OR 'lesson'
   ↓
2. 유사도 기반 필터링
   ↓
   codeFiles: score >= 0.6
   lessons: score >= 0.5
   ↓
3. Git 변경사항 Boost
   ↓
   로컬 변경 파일 우선순위 +0.2
   ↓
4. 정렬 및 제한
   ↓
   상위 15개 코드 + 5개 레슨
   ↓
5. 결과 반환
```

### 용어 변경: `learning` → `lesson`

**이유**:
- `learning`은 동명사로 의미 모호 (배우는 것? 배운 것?)
- `lesson`은 명사로 명확하며, "lessons learned"는 업계 표준
- 일반적이고 이해하기 쉬움

**영향 범위**:
- Vector DB 메타데이터: `type: 'lesson'`
- 함수명: `storeLessons`
- 프롬프트 템플릿: "Previous Lessons"

---

## 성능 최적화

### Before vs After

#### Before (항상 전체 인덱싱)
```
Push 1회: 100 files → 4.2s
Push 2회: 100 files → 4.2s
Push 3회: 100 files → 4.2s
━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 12.6s (300 files)
```

#### After (스마트 인덱싱)
```
Push 1회: 100 files → 4.2s (full)
Push 2회: 2 files   → 0.3s (incremental)
Push 3회: 5 files   → 0.5s (incremental)
━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: 5.0s (107 files)
```

**개선 효과**:
- ⚡ **60% 시간 절약** (12.6s → 5.0s)
- 📉 **64% 중복 제거** (300 files → 107 files)
- 🎯 **최대 14배 빠름** (4.2s → 0.3s)

### Vector DB 쿼리 최적화

#### Before (Phase 2)
```
Vector DB 쿼리:
  1. codebase 타입: 30개 파일
  2. lesson 타입: 10개 레슨
  (총 2회 쿼리)

프롬프트 크기:
  - 코드: ~30 파일 × 500 토큰 = ~15K
  - 레슨: 10개 × 200 토큰 = ~2K
  (총 ~17K 토큰)
```

#### After (Phase 3)
```
Vector DB 쿼리:
  1. 통합 검색: 15개 파일 + 5개 레슨
  (총 1회 쿼리, 유사도 정렬)

프롬프트 크기:
  - 코드: ~15 파일 × 500 토큰 = ~7.5K
  - 레슨: ~3개 (0.7+ 점수) × 200 토큰 = ~600
  (총 ~8K 토큰)
```

**개선 효과**:
- ⚡ **Vector DB 쿼리**: 2회 → 1회 (50% 감소)
- 📉 **프롬프트 토큰**: ~17K → ~8K (53% 감소)
- 💰 **LLM API 비용**: 40-50% 절감

---

## 사용 가이드

### 개발 워크플로우

```bash
# 1. Feature 브랜치 생성
git checkout -b feature-new

# 2. 코드 작업
# ... 파일 생성/수정 ...

# 3. Commit
git add .
git commit -m "feat: implement new feature"

# 4. ANT UI에서 Push 버튼 클릭
# → 자동으로 스마트 인덱싱 실행 ✅

# 5. 추가 작업
# ... 파일 수정 ...
git commit -m "fix: update logic"

# 6. 다시 Push
# → 변경된 파일만 인덱싱 (빠름!) ✅
```

### 검증 체크리스트

**인덱싱 성공 확인**:
```bash
# 1. Push 후 로그 확인
✅ Push successful to feature-login

📇 [Auto-Index] Starting codebase indexing...
   Files indexed: 2
   Chunks created: 8
   Duration: 0.3s
```

**Vector DB 데이터 확인**:
```bash
# Chroma Admin UI에서 확인
# - type: 'codebase' 문서들
# - type: 'lesson' 문서들
# - type: 'index_completion' 마커
```

**Code Job에서 활용 확인**:
```bash
# Code job 실행
aidev code "Add logout button"

# 로그 확인:
🔍 [Unified Search] Querying: "Add logout button"
   📊 Total results: 20
   📁 Code results: 15
   📚 Lesson results: 5
   ✅ Selected: 15 code files, 3 lessons (score >= 0.7)
```

---

## 구현 파일 목록

### 코어 로직
- `packages/ant-cli/src/core/codebase/CodebaseIndexer.ts`
- `packages/ant-cli/src/core/codebase/CodebaseRetriever.ts`
- `packages/ant-cli/src/core/codebase/strategies/UnifiedSearchStrategy.ts`

### CLI 명령
- `packages/ant-cli/src/commands/index.ts`
- `packages/ant-cli/src/cli/command.ts`

### UI 통합
- `packages/ant-cli/src/periphery/adapters/http/services/ProjectService.ts`

### Memory/Storage
- `packages/ant-cli/src/agents/architect/memory/storage.ts`

---

## 트러블슈팅

### Q: Push 후 인덱싱이 안 됨
**A**: 로그 확인
```bash
# ProjectService.pushToGitHub() 로그 확인
# autoIndexCodebase() 호출 여부 확인
```

### Q: 증분 인덱싱이 안 되고 계속 Full
**A**: Index Completion Marker 확인
```bash
# Vector DB에서 type: 'index_completion' 문서 확인
# 없으면 이전 인덱싱이 불완전했을 가능성
# → 다시 Push하여 Full Indexing 완료
```

### Q: 검색 결과가 부정확함
**A**: 유사도 임계값 조정
```typescript
// UnifiedSearchStrategy options
minCodeScore: 0.6,    // 0.5로 낮춤 (더 많은 결과)
minLessonScore: 0.5,  // 0.4로 낮춤
```

---

## 향후 개선 방향

### Phase 4 (선택적)

1. **AST 기반 Chunking**
   - 현재: Regex 기반 코드 분리
   - 개선: Babel/TypeScript AST 파서 사용
   - 효과: 더 정확한 함수/클래스 단위 chunking

2. **Lesson 품질 점수**
   - 현재: 유사도 점수만 사용
   - 개선: Lesson 자체의 품질 점수 추가 (feedback 기반)
   - 효과: 더 신뢰성 높은 lessons 우선 제공

3. **Cross-Project Lessons**
   - 현재: 프로젝트별 격리
   - 개선: 유사 프로젝트 간 lessons 공유
   - 효과: 새 프로젝트에서도 lessons 활용

4. **Lesson Decay**
   - 현재: 모든 lessons 동일 가중치
   - 개선: 시간 경과에 따른 가중치 감소
   - 효과: 최신 lessons 우선 제공

---

## 결론

ANT의 코드베이스 인덱싱 시스템은:

✅ **Git 기반 스마트 전략**으로 성능 최적화  
✅ **팀 협업 중복 방지**로 효율성 극대화  
✅ **통합 검색**으로 코드와 레슨을 한 번에  
✅ **자동 품질 관리**로 데이터 무결성 보장  

**별도 설정 없이 Push만 하면 모든 것이 자동으로 작동합니다!** 🎉

