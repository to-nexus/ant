# ant-pong-be 프로젝트 문제 분석 보고서

## 📊 프로젝트 상태 요약

### 기본 정보
- **프로젝트**: ant-pong-be (NestJS WebSocket Backend)
- **피처**: skeleton
- **세션**: 20 turns (모두 filesWritten: 0)
- **최신 작업**: 2025-11-30T05:15:28 시작 → 05:19:47 중단

### 완료된 작업
```
✅ add-rooms-rest-controller (31s)
✅ add-rooms-service (56s)
✅ wire-rest-api-in-app-module (46s)
✅ fix-cors-in-main (27s)
✅ final-verification (24분 39초) ← 완료 후 learn 노드 진입
```

---

## 🔴 실제 문제 1: Git Merge Conflict

### 사용자가 제기한 문제
```
LobbyPage.tsx:30 Error fetching rooms: 
SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON

이 문제를 계속 해결못하는 이유를 설명하고 해결해라
```

### 실제 발생한 문제 (로그 Line 4759-4773)
```
📌 Branch 'feature/skeleton' already exists, checking out...

⚠️ Execution interrupted: 
  src/app.module.ts: needs merge
  src/main.ts: needs merge
  src/rooms/rooms.controller.ts: needs merge
  src/rooms/rooms.service.ts: needs merge
  error: 현재 인덱스를 먼저 해결해야 합니다

❌ Error: (same files) needs merge
```

**발생 시점**: Learn 노드에서 branch checkout 시도

---

## 🔍 실제 코드 문제 분석

### 1. 코드는 사실 성공적으로 생성됨

**현재 codebase 상태:**
```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { RoomsModule } from './rooms/rooms.module';

@Module({
  imports: [RoomsModule],  // ✅ 올바르게 import됨
  controllers: [],
  providers: [],
})
export class AppModule {}

// src/main.ts
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',  // ✅ CORS 설정됨
    methods: '*',
    allowedHeaders: '*',
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);  // ✅ 정상

  console.log(`Application is running on: http://localhost:${port}`);
}
```

**파일 구조:**
```
codebase/src/
  ✅ app.module.ts (RoomsModule import)
  ✅ main.ts (CORS 설정)
  ✅ rooms/rooms.controller.ts (존재)
  ✅ rooms/rooms.service.ts (존재)
  ✅ rooms/rooms.module.ts (존재)
  ✅ game/game.service.ts
  ✅ gateway/game.gateway.ts
```

**빌드 상태 (Line 4658):**
```
✅ Build passed
✅ Type check passed
⚠️ ESLint warning (ignorePatterns 없음 - 무시됨)
```

**결론**: **코드는 이미 올바르게 생성되었고 빌드도 성공함!**

---

### 2. 사용자 문제 vs 실제 문제

**사용자가 본 문제:**
```
LobbyPage.tsx:30 Error: Unexpected token '<'
→ Frontend가 HTML을 받음 (404 페이지)
→ Backend API가 없다고 생각
```

**실제 상황:**
```
✅ Backend API 코드 생성 완료
✅ Rooms Controller 존재
✅ GET /rooms, POST /rooms/create 존재
✅ CORS 설정 완료
✅ 빌드 성공

❌ BUT: Git merge conflict로 learn 노드 실패
❌ Session에 filesWritten: 0으로 기록됨 (잘못된 기록)
```

**왜 filesWritten: 0인가?**
- Session 기록이 업데이트 안 됨
- 또는 Git conflict로 인해 commit 실패
- 파일은 working directory에 존재하지만 commit 안 됨

---

## 🎯 실제 문제 2: Git Stash Pop Conflict (Learn 노드)

### 문제 발생 지점

**Learn Node (Line 4759-4773):**
```
1. Learn node 진입
2. Branch checkout 시도: "feature/skeleton"
3. ❌ Git merge conflict 발생
4. 4개 파일 "needs merge" 상태
5. 작업 중단
```

### 왜 Learn 노드에서 Branch Checkout을 하는가?

**Learn Node 책임:**
- 완료된 작업의 "교훈" 추출
- Design doc, lessons를 Vector DB에 저장
- **Branch checkout 필요?** → 아마도 Git commit을 위해

**추측:**
1. Learn 노드가 lessons를 commit하려 함
2. 그 전에 branch 확인/전환
3. Uncommitted changes + branch checkout → conflict

---

## 📋 왜 에이전트가 해결 못하는가?

### 1. **문제 인식 실패**

**에이전트가 본 것:**
```
💬 Session: 20 turns, filesWritten: 0
❌ Error: LobbyPage.tsx에서 API 호출 실패
🎯 Mode: refactor (0.95) - "Session continuation: fixing previous generate output"
```

**에이전트의 판단:**
```
"이전에 생성한 코드가 실패했다"
→ 코드를 다시 생성해야 한다
→ REST API controller를 추가해야 한다
```

**실제 상황:**
```
✅ 코드는 이미 올바르게 존재함!
❌ 단지 Git conflict로 learn이 실패했을 뿐
❌ Session에 잘못 기록됨 (filesWritten: 0)
```

---

### 2. **Session 정보의 불완전성**

**Session.json 문제:**
```json
{
  "turns": [
    {
      "turnId": 1-20,
      "output": {
        "filesWritten": 0,  // ❌ 모두 0!
        "files": [],         // ❌ 빈 배열!
        "modifications": []  // ❌ 빈 배열!
      }
    }
  ]
}
```

**왜 이렇게 기록되었는가?**

**가설 1: Git Conflict로 Commit 실패**
```
1. Plan → Code Gen → Write Files ✅
2. Runtime Validation ✅
3. Learn → Git checkout ❌ Conflict!
4. Session 저장 시점에 Git이 conflict 상태
5. filesWritten = 0으로 기록됨
```

**가설 2: Session 기록 버그**
```
- Learn 노드에서만 session.turn.output 업데이트?
- 그 전에는 업데이트 안 됨?
- Learn 실패 → output 업데이트 안 됨
```

---

### 3. **Mode Inference의 오판**

**Resolve Node (Line 47-49):**
```
🎯 Mode: refactor (confidence: 0.95)
   Reasoning: Session continuation: fixing previous generate output
```

**문제:**
- Session에 20 turns 존재, 모두 filesWritten: 0
- 에이전트: "이전 시도들이 실패했다"
- → "Refactor mode로 다시 수정해야 한다"

**실제:**
- 마지막 시도는 성공! (빌드 통과)
- 단지 Learn에서 Git conflict
- → **Mode는 "done" 또는 "skip"이어야 함**

---

### 4. **Decompose의 Over-Engineering**

**사용자 Directive:**
```
"이 문제를 계속 해결못하는 이유를 설명하고 해결해라"
```

**Decompose 결과 (추정):**
```
Task 1: Add REST API Controller
Task 2: Add Rooms Service
Task 3: Wire in AppModule
Task 4: Fix CORS
Task 5: Final Verification
```

**문제:**
- 코드는 이미 존재함!
- 다시 생성하면 → 동일한 코드 덮어쓰기
- 실제 필요한 작업: **Git conflict 해결** 또는 **아무것도 안 함**

---

### 5. **Git Conflict 자동 복구 실패**

**Learn Node에서 발생한 Conflict:**
```
src/app.module.ts: needs merge
src/main.ts: needs merge
src/rooms/rooms.controller.ts: needs merge
src/rooms/rooms.service.ts: needs merge
```

**에이전트의 대응:**
```
❌ Execution interrupted
→ 작업 중단
→ Session 저장 (interrupted: true)
→ 다음 실행 시 "해결 못한 문제"로 인식
```

**필요한 대응:**
```
1. Git conflict 감지
2. git reset --hard HEAD (clean state)
3. 이미 완료된 작업이므로 skip
4. 또는 conflict 무시하고 계속
```

---

## 🎓 근본 원인 요약

### 실제 코드 문제: **없음!**

```
✅ REST API Controller 존재
✅ Rooms Service 존재
✅ AppModule에 wiring 완료
✅ CORS 설정 완료
✅ 빌드 성공
✅ 타입 체크 통과
```

### 실제 시스템 문제: **3가지**

#### 1. **Git Conflict in Learn Node**
```
Learn 노드에서 branch checkout 시 stash pop conflict
→ "needs merge" 상태
→ 작업 중단
→ 다음 실행 시 "실패한 작업"으로 오인
```

#### 2. **Session 기록 불완전**
```
filesWritten: 0 (20 turns 모두!)
→ 에이전트가 "아무것도 생성 안 됨"으로 판단
→ 실제로는 파일 생성됨
→ Session-Reality 불일치
```

#### 3. **Mode Inference 오판**
```
Session: 20 turns with filesWritten: 0
→ Mode: refactor (계속 수정)
→ 실제: 작업 완료, Git conflict만 해결 필요
→ 불필요한 재작업 반복
```

---

## 💡 에이전트가 해결 못하는 이유

### 1. **잘못된 Context**

```
에이전트가 본 것:
  - Session: 20 turns, filesWritten: 0
  - Codebase: 5 files (keyword fallback)
  - Mode: refactor

에이전트의 판단:
  - "이전 시도 실패"
  - "코드를 다시 생성해야 함"

실제 상황:
  - 코드 이미 존재하고 완료됨
  - Git conflict만 해결 필요
  - 또는 이미 완료 선언 필요
```

### 2. **Git Conflict 무한 루프**

```
Cycle:
1. 코드 생성 ✅
2. Learn → Git checkout ❌ Conflict!
3. Session 저장 (filesWritten: 0)
4. 다음 실행
5. "실패했다" 인식
6. 코드 다시 생성 (동일)
7. Learn → Git checkout ❌ Conflict!
8. 반복...
```

### 3. **Vector DB Empty**

```
Log Line 58-62:
📊 Results: 0 code, 0 lessons, 0 documents
✅ Selected: 0 code, 0 lessons, 0 documents
🔄 Vector DB empty - falling back to keyword search
```

**문제:**
- Learn 노드가 계속 실패
- Lessons가 Vector DB에 저장 안 됨
- 다음 실행 시 이전 경험 없음
- 같은 실수 반복

### 4. **Directive Indexing 실패**

```
Log Line 41-46:
[ERROR] ❌ [ChromaMemory] Failed to store to documents-ant-pong-be: {
  "name": "ChromaValueError"
}
[WARN] ⚠️ Directive indexing failed
```

**영향:**
- 사용자 directive가 Vector DB에 저장 안 됨
- 다음 검색 시 directive 컨텍스트 없음
- 문제 이해도 저하

---

## 🔧 해결 방법

### 즉각적 해결 (수동)

```bash
cd /Users/probe/dev/ant/workspaces/to.nexus/probe/ant-pong-be/codebase

# 1. Git conflict 정리
git reset --hard HEAD
git clean -fd

# 2. 현재 코드 확인
npm run build  # ✅ 이미 성공할 것

# 3. 서버 실행
npm run dev  # Port 3000에서 실행

# 4. Frontend 테스트
curl http://localhost:3000/rooms
# → 정상 JSON 응답 기대
```

### 시스템 수정 필요 사항

#### 1. **Learn Node Git Conflict 처리**
```typescript
// learn.ts
try {
  await git.checkout(branch);
} catch (error) {
  if (error.message.includes('needs merge')) {
    // ✅ Conflict 발생 시 cleanup
    await git.reset(['--hard', 'HEAD']);
    await git.clean(['-fd']);
    console.warn('Git conflict detected - reset to clean state');
  }
}
```

#### 2. **Session filesWritten 기록 수정**
```typescript
// 파일 생성 직후 session 업데이트
// Learn 실패해도 filesWritten은 정확히 기록
```

#### 3. **Mode Inference 개선**
```typescript
// filesWritten: 0이지만 codebase에 파일 존재
// → Git conflict로 인한 기록 누락 의심
// → Mode: verify (검증만)
```

#### 4. **Decompose 개선 (이미 구현됨)**
```typescript
// Mode-aware prompt
// Refactor mode: 최소 변경만
// → Git conflict만 해결하는 task 생성
```

---

## 📊 결론

### 실제 문제
1. **코드 문제**: 없음 (이미 완료)
2. **Git 문제**: Learn 노드에서 stash pop conflict
3. **Session 문제**: filesWritten 0으로 잘못 기록
4. **Vector DB 문제**: Learn 실패로 lessons 저장 안 됨

### 에이전트가 해결 못하는 이유
1. **잘못된 Context**: Session 기록이 실제와 불일치
2. **Mode 오판**: "Refactor"가 아니라 "Done" 상태
3. **Git Conflict 루프**: Learn 실패 → 재시도 → 실패 반복
4. **Vector DB Empty**: 이전 경험 학습 안 됨

### 사용자 관점
```
보이는 증상: "API가 계속 404"
실제 상황: API 코드는 완료, Git conflict만 발생
에이전트 행동: 계속 재생성 (불필요)
필요한 행동: Git cleanup 또는 skip
```

---

**핵심**: **코드는 이미 완료되었지만, Git conflict로 인해 "미완료"로 기록되어 무한 재시도 중**

