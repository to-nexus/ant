# 전체 시스템 개선 테스트 가이드

이번 리팩토링으로 변경된 주요 기능들:
1. ✅ Vector DB (Codebase + Lessons 통합 검색)
2. ✅ Retrieval (Hybrid Search + Git Diff + Import Graph Boosting)
3. ✅ Session Context Compression (토큰 최적화)
4. ✅ Mode Inference (Generate/Refactor/Explain 자동 판단)
5. ✅ Replan (Continue with new directive)

---

## 테스트 환경 준비

### 1. 서버 실행
```bash
cd /Users/wag/dev/ant
npm run dev
```

### 2. 테스트용 프로젝트 생성
```bash
# UI에서 새 프로젝트 생성
# 또는 기존 프로젝트 사용
```

---

## 🧪 테스트 1: Mode Inference

### 목적
LLM이 사용자 의도를 자동으로 판단 (Generate/Refactor/Explain)

### 시나리오 A: Generate Mode
```
Chat: "Create a user authentication API with JWT"
```

**확인 사항**:
```
📊 [Resolve] Inferring code mode...
✅ [ModeInference] Mode: Generate
   Reason: Keywords 'create', no existing files
   Confidence: 0.95
```

**UI 확인**:
- 새 파일들이 생성됨
- Design doc 참조
- PRD 참조 (있으면)

---

### 시나리오 B: Refactor Mode
```
Chat: "Refactor the login function to use async/await"
```

**확인 사항**:
```
📊 [Resolve] Inferring code mode...
✅ [ModeInference] Mode: Refactor
   Reason: Keywords 'refactor', existing files detected
   Confidence: 0.92
```

**UI 확인**:
- 기존 파일 수정 (새로 생성 X)
- Git diff 표시
- Original files 참조

---

### 시나리오 C: Explain Mode
```
Chat: "Explain how the authentication middleware works"
```

**확인 사항**:
```
📊 [Resolve] Inferring code mode...
✅ [ModeInference] Mode: Explain
   Reason: Keywords 'explain', informational query
   Confidence: 0.88
```

**UI 확인**:
- 파일 생성/수정 없음
- 설명 텍스트만 응답
- 코드 분석 결과 표시

---

## 🧪 테스트 2: Hybrid Retrieval (Vector + Keyword + Git + Import Graph)

### 목적
관련 코드를 정확하게 찾아서 LLM에게 전달

### 시나리오 A: Vector Search
```
Chat: "Add email validation to user registration"
```

**확인 사항**:
```
🔍 [UnifiedSearchStrategy] Searching for relevant context...
   Query: "Add email validation to user registration"

📊 Vector Search Results:
   - src/auth/register.ts (score: 0.85, source: vector)
   - src/utils/validators.ts (score: 0.78, source: vector)

📊 Keyword Search Results:
   - src/models/user.ts (source: keyword, match: "email")

✅ [UnifiedSearchStrategy] Found 3 file(s)
   Source breakdown:
   - vector: 2
   - keyword: 1
```

---

### 시나리오 B: Git Diff Boosting
```
# 1. 파일 수정
echo "// test" >> src/auth/login.ts

# 2. Chat 입력
Chat: "Fix the authentication bug"
```

**확인 사항**:
```
🔍 [ImportGraphBooster] Git changes detected: 1 file(s)
   Changed: src/auth/login.ts

✅ [ImportGraphBooster] Boosted 1 file(s) to top priority
   Priority order:
   1. src/auth/login.ts (git-changed) ⭐
   2. src/auth/middleware.ts (import-graph)
   3. src/utils/jwt.ts (vector)
```

**UI 확인**:
- 수정한 파일이 최우선으로 참조됨

---

### 시나리오 C: Import Graph Boosting
```
Chat: "Update JWT token expiration time"
```

**확인 사항**:
```
🔍 [ImportGraphBooster] Building import graph...
   Found connections:
   - src/auth/login.ts → src/utils/jwt.ts
   - src/auth/middleware.ts → src/utils/jwt.ts

✅ [ImportGraphBooster] Boosted connected files:
   1. src/utils/jwt.ts (primary match)
   2. src/auth/login.ts (import-graph) ⬆️
   3. src/auth/middleware.ts (import-graph) ⬆️
```

---

### 시나리오 D: Lessons (기존 learning → lesson)
```
# 1. 첫 번째 job 완료 (learning 자동 저장)
Chat: "Create login API"
[완료 후 자동으로 lesson 저장됨]

# 2. 유사한 작업 요청
Chat: "Create logout API"
```

**확인 사항**:
```
🔍 [UnifiedSearchStrategy] Searching Vector DB...
   Types: ['codebase', 'lesson']

📚 Lessons Retrieved:
   - "Login API implementation with JWT" (score: 0.82, type: lesson)
     Tags: [authentication, jwt, api]
     Related files: [src/auth/login.ts]

✅ Total results: 5 files + 1 lesson
   Source breakdown:
   - vector (codebase): 3
   - lesson: 1
   - keyword: 1
```

**UI 확인**:
- 이전 작업 경험이 반영됨
- 일관된 패턴으로 코드 생성

---

## 🧪 테스트 3: Session Context Compression

### 목적
긴 대화에서 토큰 폭발 방지

### 시나리오: 5+ Turn 대화
```
Turn 1: "Create user API"
Turn 2: "Add authentication"
Turn 3: "Add role-based access"
Turn 4: "Add email verification"
Turn 5: "Fix validation bug"
Turn 6: "Add password reset"  ← 여기서 확인
```

**확인 사항**:
```
📊 [SessionContextBuilder] Building session context...
   Total turns: 6
   Current mode: Refactor
   Window size: 2 (recent turns in detail)

📝 Session Context Structure:
   Recent Turns (detailed):
   - Turn 5: "Fix validation bug" (Refactor)
   - Turn 6: "Add password reset" (Generate)

   Summary (compressed):
   - Turns 1-4: "Created user API with auth, roles, email verification"

   Stats:
   - Original tokens: ~4500
   - Compressed tokens: ~800
   - Compression ratio: 82%
```

**UI 확인**:
- 대화가 길어져도 응답 속도 유지
- 이전 컨텍스트는 요약되어 전달

---

## 🧪 테스트 4: Mode-Aware Context Priority

### 목적
모드에 따라 다른 우선순위로 컨텍스트 제공

### 시나리오 A: Generate Mode
```
Chat: "Create payment API"
```

**확인 사항**:
```
📊 [Resolve] Context Priority (Generate):
   1. Design Doc (high)
   2. PRD Spec (high)
   3. Codebase Profile (medium)
   4. Lessons (medium)
   5. Session Context (low - 1 turn)
```

---

### 시나리오 B: Refactor Mode
```
Chat: "Refactor payment validation"
```

**확인 사항**:
```
📊 [Resolve] Context Priority (Refactor):
   1. Current Code (high) - Git HEAD version
   2. Git Diff (high) - What changed
   3. Import Graph (high) - Connected files
   4. Lessons (medium)
   5. Session Context (medium - 2 turns)
   6. Design Doc (low)
```

---

### 시나리오 C: Explain Mode
```
Chat: "Explain payment flow"
```

**확인 사항**:
```
📊 [Resolve] Context Priority (Explain):
   1. Current Code (high)
   2. Design Doc (high)
   3. Import Graph (medium)
   4. Session Context (low - 1 turn)
```

---

## 🧪 테스트 5: Replan (Continue with New Directive)

### 목적
중단 후 새 요청 시 LLM이 판단하여 조치

### 시나리오 A: Continue
```
1. Chat: "Create REST API with 5 endpoints"
2. [진행 중 Stop]
3. Chat: "Use bcrypt for passwords"
```

**확인 사항**:
```
🔍 [ReplanDecision] Multiple directives detected (2)
🤖 [ReplanDecision] Asking LLM for decision...
✅ [ReplanDecision] Decision: CONTINUE
   Reason: Implementation detail, plan unchanged
🚦 [ReplanRouter] → plan node
```

---

### 시나리오 B: Modify
```
1. Chat: "Create 5 API endpoints"
2. [진행 중 Stop]
3. Chat: "Only need 3 endpoints"
```

**확인 사항**:
```
✅ [ReplanDecision] Decision: MODIFY
   Tasks to remove: [endpoint-4, endpoint-5]
🔧 [ModifyTasks] Removed 2 task(s)
📋 Updated Kanban: 3 tasks remaining
```

---

### 시나리오 C: Restart
```
1. Chat: "Create REST API"
2. [진행 중 Stop]
3. Chat: "Use GraphQL instead"
```

**확인 사항**:
```
✅ [ReplanDecision] Decision: RESTART
   Reason: Architecture change
🔄 [ClearStateForReplan] Clearing state...
📊 [Decompose] Creating new task breakdown...
   New tasks: GraphQL-related
```

---

## 🧪 테스트 6: 통합 시나리오 (All Features)

### 복합 테스트: 모든 기능 동시 확인

```
# Turn 1: Generate (Mode Inference)
Chat: "Create a task management API"
→ Mode: Generate
→ Retrieval: Vector search for similar code
→ Lessons: Previous API patterns
→ Session Context: Empty (first turn)

# Turn 2: Refactor (Mode Inference + Git Boosting)
[수정: src/tasks/create.ts]
Chat: "Add validation to task creation"
→ Mode: Refactor
→ Retrieval: Git-changed file boosted
→ Import Graph: Related validators
→ Session Context: Turn 1 summary

# Turn 3: Continue (Replan)
[Stop]
Chat: "Also add priority field"
→ ReplanDecision: Continue
→ Context: Previous turns compressed
→ Retrieval: Task-related files

# Turn 4: Modify (Replan)
[Stop]
Chat: "Skip the notification feature"
→ ReplanDecision: Modify
→ Tasks removed: notification-task
→ Context: All previous turns

# Turn 5: Explain (Mode Inference)
Chat: "Explain how task creation works"
→ Mode: Explain
→ No file changes
→ Context: Full codebase view
```

---

## 📊 성공 기준

### 1. Mode Inference
- [ ] Generate/Refactor/Explain 자동 판단
- [ ] 각 모드별 로그 출력
- [ ] 모드에 맞는 동작 수행

### 2. Hybrid Retrieval
- [ ] Vector + Keyword 결과 병합
- [ ] Git-changed 파일 최우선
- [ ] Import Graph 연결 파일 부스팅
- [ ] Lessons 포함 (type: lesson)

### 3. Session Context
- [ ] 긴 대화에서 압축 동작
- [ ] Window size가 모드별로 다름
- [ ] 토큰 사용량 감소

### 4. Replan
- [ ] Continue/Modify/Restart 판단
- [ ] Resume 버튼 즉시 사라짐
- [ ] Task queue 의도대로 변경

### 5. 통합
- [ ] 모든 기능이 충돌 없이 작동
- [ ] 성능 저하 없음
- [ ] 기존 기능 정상 동작

---

## 🔍 로그 확인 키워드

### Backend (터미널)
```bash
# Mode Inference
grep "ModeInference"

# Retrieval
grep "UnifiedSearchStrategy"
grep "ImportGraphBooster"

# Session Context
grep "SessionContextBuilder"

# Replan
grep "ReplanDecision"
grep "ReplanRouter"
```

### 로그 위치
```bash
# 실시간 확인
npm run dev  # 이 터미널에서 모든 로그 출력

# 필터링
npm run dev 2>&1 | grep -E "(ModeInference|UnifiedSearchStrategy|ReplanDecision)"
```

---

## 🐛 문제 발생 시 체크리스트

### Mode Inference가 작동 안 함
- [ ] `ModeInferenceEngine.ts` import 확인
- [ ] `resolve.ts`에서 호출 확인
- [ ] 로그에 `[ModeInference]` 표시 확인

### Retrieval이 이상함
- [ ] Vector DB 인덱싱 완료 확인
- [ ] `UnifiedSearchStrategy.ts` 사용 확인
- [ ] Git repository 초기화 확인

### Session Context 압축 안 됨
- [ ] Turn 개수 확인 (2개 미만이면 압축 X)
- [ ] `SessionContextBuilder.ts` 로직 확인
- [ ] Window size 설정 확인

### Replan 안 됨
- [ ] `directives` 배열 길이 확인 (2개 이상?)
- [ ] Session 파일에 저장 확인
- [ ] `replanDecision` 노드 실행 확인

---

## 📝 간단 체크 (5분)

시간이 없다면 최소한 이것만:

```bash
# 1. Generate Mode
Chat: "Create login API"
→ 로그에서 "Mode: Generate" 확인

# 2. Retrieval
→ 로그에서 "UnifiedSearchStrategy" 확인
→ Source breakdown 확인

# 3. Replan
Stop → 새 메시지 입력
→ "ReplanDecision" 로그 확인
→ Resume 버튼 사라짐 확인
```

**이 3가지만 확인되면 핵심 기능은 작동하는 것입니다!** ✅

---

## 🎯 완전 검증 (30분)

모든 것을 철저히 테스트하려면:

1. ✅ Mode Inference (3가지 모드)
2. ✅ Hybrid Retrieval (4가지 소스)
3. ✅ Session Context (5+ turns)
4. ✅ Replan (3가지 action)
5. ✅ 통합 시나리오

각 테스트마다 로그 확인 + UI 동작 확인

---

## 📚 추가 자료

- **설계 문서**: `/Users/wag/dev/ant/docs/`
  - `MODE_SPECIFIC_CONTEXT_PRIORITY.md`
  - `SESSION_CONTEXT_COMPRESSION_STRATEGY.md`
  - `VECTOR_DB_DUAL_TYPE_ANALYSIS.md`
  - `REPLAN_IMPLEMENTATION_COMPLETE.md`

- **코드 위치**:
  - Mode Inference: `core/mode/ModeInferenceEngine.ts`
  - Retrieval: `core/codebase/strategies/UnifiedSearchStrategy.ts`
  - Session Context: `agents/architect/session/SessionContextBuilder.ts`
  - Replan: `agents/architect/graph/code/nodes/replanDecision.ts`

