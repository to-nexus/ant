# Replan 기능 테스트 가이드

## 테스트 환경 준비

### 1. 서버 실행
```bash
cd /Users/wag/dev/ant
npm run dev
```

### 2. 브라우저에서 UI 접속
```
http://localhost:4100
```

---

## 테스트 시나리오

### 시나리오 1: Continue (기존 계획 유지)

#### 1단계: Job 시작
```
Chat에서 입력: "Create a simple login API with JWT authentication"
```

#### 2단계: 진행 중 중단
- 1-2개 task 완료되면 **Stop 버튼** 클릭
- 또는 터미널에서 `Ctrl+C`

#### 3단계: 새 메시지 입력
```
Chat에서 입력: "Make sure to use bcrypt for password hashing"
```

#### ✅ 예상 결과
**콘솔 로그 확인**:
```
🔍 [ReplanDecision] Multiple directives detected (2)
   Original: "Create a simple login API..."
   New:      "Make sure to use bcrypt..."
   Analyzing impact...

🤖 [ReplanDecision] Asking LLM for decision...

✅ [ReplanDecision] Decision: CONTINUE
   Reason: Minor implementation detail, doesn't change plan structure
   Confidence: 95%

🚦 [ReplanRouter] Routing based on action: continue
   → Continuing with current plan (plan node)
```

**UI 확인**:
- ✅ Resume 버튼 즉시 사라짐
- ✅ Task queue 변경 없음
- ✅ 다음 task부터 계속 진행

---

### 시나리오 2: Modify (특정 task 조정)

#### 1단계: Job 시작
```
Chat에서 입력: "Create REST API with 5 endpoints: users, posts, comments, likes, follows"
```

#### 2단계: 진행 중 중단
- Setup task 완료 후 Stop

#### 3단계: 새 메시지 입력
```
Chat에서 입력: "Actually, only need 3 endpoints: users, posts, comments. Remove likes and follows."
```

#### ✅ 예상 결과
**콘솔 로그 확인**:
```
🔍 [ReplanDecision] Multiple directives detected (2)
   Original: "Create REST API with 5 endpoints..."
   New:      "Actually, only need 3 endpoints..."

✅ [ReplanDecision] Decision: MODIFY
   Reason: Scope reduction - remove specific features
   Confidence: 88%
   Tasks to modify: endpoint-likes, endpoint-follows

🚦 [ReplanRouter] Routing based on action: modify
   → Modifying specific tasks (modifyTasks node)

🔧 [ModifyTasks] Applying task modifications...
   Tasks to remove: endpoint-likes, endpoint-follows
   ✅ Removed 2 task(s) from queue
   Remaining: 6 tasks

💾 [ModifyTasks] Checkpoint saved (6 tasks)
📋 [ModifyTasks] Task queue updated → Kanban board
```

**UI 확인**:
- ✅ Resume 버튼 사라짐
- ✅ Kanban에서 2개 task 제거됨
- ✅ 남은 task로 계속 진행

---

### 시나리오 3: Restart (완전 재분해)

#### 1단계: Job 시작
```
Chat에서 입력: "Create a REST API with authentication"
```

#### 2단계: 진행 중 중단
- 몇 개 task 완료 후 Stop

#### 3단계: 새 메시지 입력
```
Chat에서 입력: "Actually, use GraphQL instead of REST"
```

#### ✅ 예상 결과
**콘솔 로그 확인**:
```
🔍 [ReplanDecision] Multiple directives detected (2)
   Original: "Create a REST API..."
   New:      "Actually, use GraphQL..."

✅ [ReplanDecision] Decision: RESTART
   Reason: Architecture change from REST to GraphQL requires new decomposition
   Confidence: 92%

🚦 [ReplanRouter] Routing based on action: restart
   → Restarting with new plan (clearStateForReplan → decompose)

🔄 [ClearStateForReplan] Restarting with new plan...
   Previous progress: 3 task(s) completed
   Merging 2 directive(s) for re-decomposition

   ✅ Directive structure:
      - Initial: "Create a REST API..."
      - Update 1: "Actually, use GraphQL..."

📋 [ClearStateForReplan] State cleared, ready for decompose
   Next: decompose will create new task breakdown

[Decompose 노드 실행...]
📊 Created 8 tasks:
   1. [P100] Setup GraphQL Server (setup)
   2. [P200] Define Schema (feature)
   ...
```

**UI 확인**:
- ✅ Resume 버튼 사라짐
- ✅ Kanban이 완전히 새로운 task로 재구성
- ✅ GraphQL 관련 task들로 교체

---

## 핵심 체크포인트

### 1. Resume 버튼 동작
- [ ] 중단 시 Resume 버튼 표시
- [ ] 채팅 메시지 입력 시 **즉시** 사라짐 (LLM 판단 전에)
- [ ] Resume 버튼 클릭 시 정상 동작 (기존 기능)

### 2. LLM 판단
- [ ] `replanDecision` 노드 실행 확인 (콘솔)
- [ ] LLM 응답이 JSON 형식으로 파싱됨
- [ ] `action`, `reason`, `confidence` 값 확인

### 3. 라우팅
- [ ] Continue → plan 노드로 이동
- [ ] Modify → modifyTasks 노드로 이동
- [ ] Restart → clearStateForReplan → decompose

### 4. Task Queue 변경
- [ ] Continue: 변경 없음
- [ ] Modify: 지정된 task 제거됨
- [ ] Restart: 완전히 새로운 task 생성

---

## 로그 확인 위치

### Backend (터미널)
```bash
# ant-cli 서버 실행 중인 터미널
npm run dev

# 다음 로그들을 확인:
- [ReplanDecision] ...
- [ReplanRouter] ...
- [ModifyTasks] ...
- [ClearStateForReplan] ...
- [Decompose] ...
```

### Frontend (브라우저 DevTools)
```javascript
// Console에서 확인:
F12 → Console

// 다음 로그들을 확인:
- [ChatInput] Continue job
- [Store] ...
```

---

## 간단 테스트 (최소 확인)

만약 전체 시나리오가 부담스럽다면, 가장 간단한 테스트:

### 1분 테스트
```bash
1. Chat: "Create a simple login page"
2. Stop 버튼 클릭
3. Chat: "계속 진행해"
4. 콘솔에서 "ReplanDecision" 로그 확인
5. Resume 버튼이 사라졌는지 확인
```

**성공 조건**:
- ✅ `[ReplanDecision]` 로그 보임
- ✅ `Decision: CONTINUE` 또는 다른 action
- ✅ Resume 버튼 사라짐
- ✅ Task 계속 진행

---

## 문제 발생 시 디버깅

### 1. ReplanDecision 노드가 실행 안 됨
**원인**: `directives.length < 2`
**확인**:
```bash
# Session 파일 확인
cat /path/to/project/features/feature-name/sessions/code.json

# directives 배열 확인
"directives": ["새 directive", "기존 directive"]
```

### 2. LLM 응답 파싱 에러
**로그 확인**:
```
❌ [ReplanDecision] Failed to parse LLM response as JSON
   Response: ...
   Falling back to CONTINUE (safe default)
```
**결과**: 자동으로 continue로 fallback (안전)

### 3. Resume 버튼이 안 사라짐
**확인**:
```javascript
// 브라우저 Console에서
useStore.getState().dismissedInterruptTimestamp
useStore.getState().kanban.interruption.timestamp

// 두 값이 같아야 함
```

### 4. Task가 제거 안 됨 (Modify)
**로그 확인**:
```
🔧 [ModifyTasks] Applying task modifications...
   Tasks to remove: task-id-1, task-id-2
   ⚠️  No matching tasks found to remove
   Available task IDs: setup-1, feature-1, ...
```
**원인**: LLM이 제안한 task ID가 실제와 다름 (LLM 환각)

---

## 성공 기준

✅ **모두 통과해야 함**:
1. Resume 버튼이 채팅 입력 시 즉시 사라짐
2. `replanDecision` 노드가 실행됨 (로그 확인)
3. LLM이 올바른 JSON 응답
4. 라우팅이 LLM 판단에 따라 동작
5. Task queue가 의도대로 변경됨
6. 기존 Resume 버튼 기능은 그대로 동작

---

## 추가 검증 (선택)

### Handlebars Helper 테스트
```bash
# replan-decision.md 템플릿이 올바르게 렌더링되는지 확인
# LLM에게 전달되는 프롬프트 로그 확인 (필요시 추가)
```

### State 저장 확인
```bash
# Session 파일에 replan 관련 필드 저장 확인
cat sessions/code.json | grep -A5 "directives"
cat sessions/code.json | grep "replanAction"
```

---

## 요약

**최소 테스트**:
1. Job 시작
2. 중단
3. 새 메시지 입력
4. 로그에서 `[ReplanDecision]` 확인
5. Resume 버튼 사라짐 확인

**전체 검증** 필요하면 3가지 시나리오 모두 실행.

**로그는 자동으로 출력됨** - 별도 설정 불필요! 🎉

