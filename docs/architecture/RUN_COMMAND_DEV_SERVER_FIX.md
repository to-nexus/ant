# run_command Tool: Dev Server 문제 분석 및 해결

## 🚨 문제 상황

### 로그 분석
```
🔧 [Tool] Executing tool: run_command
   Args: { command: "npm run dev &" }
   🔧 Running command: npm run dev &
   📁 Working directory: /Users/probe/dev/ant/workspaces/.../codebase

[멈춤 - 10분간 대기 후 timeout]
```

### 근본 원인

#### 1. **Shell `&` 연산자의 오해**

```bash
# Shell에서
npm run dev &    # ✅ 백그라운드 실행, 즉시 종료

# Node.js child_process에서
npm run dev &    # ❌ `&`는 command의 일부, foreground 실행
```

**Node.js `child_process`는**:
- `&`를 shell 연산자로 해석하지 않음
- `npm run dev &`를 그대로 실행 시도
- Shell이 없으면 `&`는 무시되거나 에러
- 결과: Dev server가 foreground로 실행 → 절대 종료 안됨

#### 2. **Dev Server의 특성**

```typescript
// Dev server lifecycle
npm run dev
  ↓
Vite/Next.js starts
  ↓
Server listening on port 3000
  ↓
[무한 대기 - 사용자가 Ctrl+C로 종료할 때까지]
```

**Dev server는**:
- HTTP server 프로세스
- 요청 대기 상태로 계속 실행
- **절대 자동 종료되지 않음**
- `process.exit()`를 호출하지 않음

#### 3. **Timeout의 동작**

```typescript
// tool.ts Line 721-723
const result = await commandPort.execute(command, {
  cwd: workingDir,
  timeout: 10 * 60 * 1000, // 10 minutes
  // ...
});
```

**결과**:
- Dev server 시작 → 대기
- 10분 동안 아무 응답 없음
- Timeout 발생 → SIGTERM 전송
- 강제 종료 → Task 실패

---

## 🎯 왜 LLM이 이렇게 했는가?

### 컨텍스트 분석

```
Task: Fix BUILD ERROR Errors
Error: build_error in app/api/rooms/route.ts
LLM 생각:
1. 빌드 에러를 수정함
2. 검증해야 함
3. Dev server로 테스트? (❌ 잘못된 판단)
4. `npm run dev &` 실행
```

### LLM의 의도

- ✅ **올바른 의도**: 코드가 작동하는지 확인하고 싶었음
- ❌ **잘못된 방법**: Dev server는 검증 도구가 아님
- ❌ **Shell 습관**: `&`를 사용하면 백그라운드 실행된다고 생각

### 프롬프트 부족

현재 프롬프트에는 다음이 **명시되지 않음**:

```markdown
❌ 없는 지시사항:
- Dev server 사용 금지
- Build 명령으로 검증
- `&` 연산자 무용

✅ 있어야 할 지시사항:
- npm run dev는 절대 종료 안됨
- 검증은 npm run build로
- Dev server는 테스트 용도 아님
```

---

## ✅ 해결 방안

### 1. Prompt Template 수정 ✅

**파일**: `src/core/prompt/templates/code/phases/execute/base.md`

**추가된 내용**:

```markdown
## 🔧 ERROR TASK: Fix Specific Issues

🚨 **CRITICAL - COMMAND RESTRICTIONS** 🚨

**❌ NEVER USE THESE COMMANDS (they never exit):**
```
npm run dev         ❌ Dev server runs forever
npm start           ❌ Server runs forever
npm run serve       ❌ Server runs forever
node server.js      ❌ Server runs forever
nodemon            ❌ Watcher runs forever
```

**✅ ONLY USE THESE COMMANDS (they exit immediately):**
```
npm run build       ✅ Compiles and exits
npm run type-check  ✅ Validates and exits
npm run lint        ✅ Checks and exits
npm test            ✅ Tests and exits
npx tsc --noEmit    ✅ Type checks and exits
npm install [pkg]   ✅ Installs and exits
```

**Why?** Dev servers never exit - they'll hang for 10 minutes until timeout.
Always use build/test commands for verification.
```

### 2. Runtime Validation in tool.ts ✅

**파일**: `src/agents/architect/graph/code/nodes/tool.ts`

**추가된 코드**:

```typescript
// ✅ CRITICAL: Block long-running dev server commands
const longRunningPatterns = [
  /npm\s+run\s+dev\b/,
  /npm\s+run\s+serve\b/,
  /npm\s+start\b/,
  /yarn\s+dev\b/,
  /pnpm\s+dev\b/,
  /node\s+.*server\.js/,
  /nodemon\b/,
  /npx\s+vite\b/,
  /npx\s+next\s+dev\b/,
  /npx\s+react-scripts\s+start\b/
];

for (const pattern of longRunningPatterns) {
  if (pattern.test(command)) {
    return `❌ COMMAND BLOCKED: ${command}

This is a long-running dev server command that never exits.
It would hang for 10 minutes until timeout.

❌ NEVER use these commands:
- npm run dev
- npm start
- node server.js

✅ ONLY use these commands for verification:
- npm run build (compiles and exits)
- npm run type-check (validates and exits)
- npm run lint (checks and exits)

Use build/test commands instead of dev servers.`;
  }
}
```

**효과**:
- LLM이 dev server 명령 시도 시 **즉시 차단**
- 명확한 에러 메시지로 **올바른 명령 제시**
- 10분 timeout 방지

---

## 🎓 근본 설계 원칙

### 1. **Dev Server ≠ Validation Tool**

```
❌ 잘못된 사용:
LLM → npm run dev
    → Server 시작
    → [검증?] 불가능 - 어떻게 검증?
    → Timeout

✅ 올바른 사용:
LLM → npm run build
    → 컴파일 시작
    → 성공/실패 명확
    → Exit code 반환
    → 즉시 다음 단계
```

### 2. **Commands Must Exit**

```
LLM Tool의 필수 조건:
1. ✅ 명령 실행
2. ✅ 결과 반환 (stdout/stderr)
3. ✅ Exit code 반환
4. ✅ 종료 (process.exit)

Dev server는 4번을 충족하지 못함!
```

### 3. **Foreground vs Background**

```
Foreground Process:
- await로 대기
- 결과 수집
- Tool response 반환

Background Process:
- 별도 관리 필요 (DevServerService)
- Tool response와 독립
- Stop 명령 필요
```

**LLM Tool은 Foreground만 가능!**

---

## 📊 올바른 검증 방법

### Build Verification (권장)

```typescript
// ✅ 정확하고 빠른 검증
Task: Fix build error
  ↓
LLM: Fix code
  ↓
LLM: run_command("npm run build")
  ↓
Build Success → Exit 0
  ↓
Task Complete ✅

시간: ~30초
결과: 명확 (Success/Fail)
```

### Type Check Verification (가장 빠름)

```typescript
// ✅ 가장 빠른 검증 (5-10초)
Task: Fix type error
  ↓
LLM: Fix code
  ↓
LLM: run_command("npx tsc --noEmit")
  ↓
Type Check Success → Exit 0
  ↓
Task Complete ✅

시간: ~5초
결과: 명확
```

### Dev Server (절대 안됨)

```typescript
// ❌ 절대 사용 불가
Task: Fix build error
  ↓
LLM: Fix code
  ↓
LLM: run_command("npm run dev")
  ↓
Server starts...
  ↓
[대기 10분]
  ↓
Timeout ❌

시간: 10분 (낭비)
결과: 실패
```

---

## 🔧 DevServerService의 올바른 사용

### 별도 관리 시스템

```typescript
// DevServerService는 별도로 관리됨
// LLM tool과 독립적

User: "Start dev server for myproject"
  ↓
API: POST /api/dev-server/start
  ↓
DevServerService.startDevServer()
  ↓
Background Process 시작
  ↓
Response 즉시 반환 (port 정보)

User: "Stop dev server"
  ↓
API: POST /api/dev-server/stop
  ↓
DevServerService.stopDevServer()
  ↓
SIGTERM 전송 → 종료
```

**핵심 차이**:
- ✅ API 기반 (HTTP 요청/응답)
- ✅ 백그라운드 프로세스 관리
- ✅ Start/Stop 분리
- ❌ LLM tool과 무관

---

## 📋 체크리스트

### 프롬프트 업데이트 ✅
- ✅ ERROR task에 명령 제한사항 추가
- ✅ Dev server 금지 명시
- ✅ Build 명령 사용 권장

### 코드 수정 ✅
- ✅ `tool.ts`에 dev server 차단 로직 추가
- ✅ 명확한 에러 메시지 제공
- ✅ 올바른 명령 제시

### 테스트 필요 ⏳
- ⏳ LLM이 `npm run dev` 시도 시 차단 확인
- ⏳ 에러 메시지가 명확한지 확인
- ⏳ LLM이 `npm run build`로 전환하는지 확인

---

## 🎯 결론

### 문제 요약
1. **LLM이 `npm run dev &` 실행**
2. **Dev server는 절대 종료 안됨**
3. **10분 timeout까지 대기**
4. **Task 실패**

### 근본 원인
1. **Prompt에 명시 없음** (dev server 금지)
2. **Runtime validation 없음** (차단 로직 없음)
3. **LLM의 Shell 습관** (`&` 사용)

### 해결책
1. ✅ **Prompt 수정**: Dev server 명령 금지 명시
2. ✅ **Runtime 차단**: `tool.ts`에 validation 로직 추가
3. ✅ **대안 제시**: Build/test 명령 사용 권장

### 효과
- ⚡ **10분 낭비 방지**
- ✅ **명확한 검증 방법 제시**
- 🎯 **LLM 행동 교정**

---

**수정 완료**: 2025-11-29
**파일 변경**: 2개 (base.md, tool.ts)
**빌드 상태**: ✅ 성공

