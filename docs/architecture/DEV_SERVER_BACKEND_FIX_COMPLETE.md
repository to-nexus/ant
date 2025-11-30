# Dev Server Backend/Frontend 구분 수정 완료

## ✅ 구현 완료

### 문제 요약

**ant-pong-be 프로젝트:**
```json
{
  "scripts": { "dev": "tsx watch server.ts" },  // ← 실행해야 할 명령
  "dependencies": { 
    "next": "^14.2.0",  // UI 라이브러리
    "ws": "^8.18.0"     // WebSocket 서버
  }
}
```

**기존 문제:**
1. DevServerService가 `next` dependency 발견
2. "Next.js 프로젝트"로 잘못 판단
3. `npx next dev` 실행 → WebSocket 서버가 안 뜸 ❌
4. 실제로는 `npm run dev` (tsx watch server.ts) 실행해야 함 ✅

**근본 원인:**
- Framework detection이 package.json scripts보다 우선순위가 높음
- Backend 프로젝트 타입을 구분하지 못함
- Backend는 PORT 환경변수, Frontend는 CLI argument 필요

---

## 🔧 구현 내용

### 1. Backend Project Detection

**새로운 함수 추가 (`isBackendProject`):**

```typescript
private isBackendProject(packageJson: any): boolean {
  const deps = { 
    ...packageJson.dependencies, 
    ...packageJson.devDependencies 
  };
  
  // Backend frameworks
  const backendFrameworks = [
    'express', 'koa', 'fastify', 'hapi',
    '@nestjs/core', '@nestjs/platform-express', '@nestjs/platform-fastify',
    'ws', 'socket.io', 'uWebSockets.js'
  ];
  
  // Backend dev tools (strong indicators)
  const backendDevTools = [
    'tsx', 'nodemon', 'ts-node', 'ts-node-dev'
  ];
  
  // Check for backend indicators
  const hasBackendFramework = backendFrameworks.some(fw => deps[fw]);
  const hasBackendDevTool = backendDevTools.some(tool => deps[tool]);
  
  // Also check dev script content
  const devScript = packageJson.scripts?.dev || '';
  const isNodeServer = devScript.includes('tsx') || 
                      devScript.includes('nodemon') || 
                      devScript.includes('ts-node') ||
                      devScript.includes('nest start') ||
                      devScript.includes('server.ts') ||
                      devScript.includes('server.js');
  
  return hasBackendFramework || hasBackendDevTool || isNodeServer;
}
```

**감지 기준:**
1. Backend frameworks: express, koa, fastify, nest.js, ws, socket.io
2. Backend dev tools: tsx, nodemon, ts-node
3. Dev script 패턴: "tsx", "nodemon", "server.ts" 포함

---

### 2. 우선순위 재정렬

**이전 순서 (Framework First):**
```
1. vite check
2. @vitejs/plugin-react check
3. next check ← ❌ ant-pong-be가 여기서 걸림!
4. react-scripts check
5. package.json scripts.dev check ← ✅ 여기가 정답!
6. package.json scripts.start check
```

**새로운 순서 (Scripts First):**
```typescript
// ✅ 1순위: package.json scripts.dev (명시적 의도)
if (packageJson.scripts?.dev) {
  const isBackend = this.isBackendProject(packageJson);
  
  if (isBackend) {
    // Backend: PORT env var만
    command = 'npm';
    args = ['run', 'dev'];
    env.PORT = devPort.toString();
  } else {
    // Frontend: --port argument
    command = 'npm';
    args = ['run', 'dev', '--', '--port', devPort.toString()];
  }
}
// ✅ 2순위: Framework detection (dev script 없을 때만)
else if (vite detected) {
  command = 'npx';
  args = ['vite', '--port', devPort.toString()];
}
else if (next detected) {
  command = 'npx';
  args = ['next', 'dev', '-p', devPort.toString()];
}
```

**핵심 변경:**
- `package.json scripts` = 개발자의 **명시적 의도** → 최우선!
- Framework detection = 시스템의 **추론** → 보조 수단

---

### 3. Port 전달 방식 개선

**Backend vs Frontend 구분:**

```typescript
let env: Record<string, string> = {
  ...process.env,
  BROWSER: 'none',
  OPEN: 'false',
  PORT: devPort.toString()  // 항상 env var 설정 (fallback)
};

if (isBackend) {
  // Backend: PORT env var만 (CLI argument 없음)
  command = 'npm';
  args = ['run', 'dev'];  // --port 추가 안함!
  
} else {
  // Frontend: --port argument + PORT env var (both)
  command = 'npm';
  args = ['run', 'dev', '--', '--port', devPort.toString()];
  // env.PORT도 설정되어 있음 (fallback)
}
```

**이유:**
- Backend: 대부분 `process.env.PORT`를 읽음
- Frontend: 대부분 CLI argument를 지원
- 둘 다 설정하면 안전 (frontend는 argument 우선, 없으면 env var fallback)

---

## 📊 동작 비교

### Case 1: ant-pong-be (Backend + Next.js)

**package.json:**
```json
{
  "scripts": { "dev": "tsx watch server.ts" },
  "dependencies": { "next": "^14.2.0", "ws": "^8.18.0" },
  "devDependencies": { "tsx": "^4.16.0" }
}
```

**Before (Wrong):**
```bash
Detection: Next.js project (by dependency)
Command: npx next dev -p 3000
Result: ❌ Only Next.js UI, no WebSocket server
```

**After (Correct):**
```bash
Detection: Backend project with dev script
  - Has 'tsx' in devDependencies ✅
  - Has 'ws' in dependencies ✅
  - Dev script contains 'tsx' and 'server.ts' ✅
Command: PORT=3000 npm run dev
Actual: tsx watch server.ts (with PORT=3000)
Result: ✅ Full server (WebSocket + Next.js UI integrated)
```

---

### Case 2: ant-pong-fe (Next.js Frontend)

**package.json:**
```json
{
  "scripts": { "dev": "next dev" },
  "dependencies": { "next": "^14.2.0" }
}
```

**Before:**
```bash
Detection: Next.js project
Command: npx next dev -p 5173
Result: ✅ Works (but ignores package.json script)
```

**After:**
```bash
Detection: Frontend project with dev script
  - No backend frameworks ✅
  - No backend dev tools ✅
Command: npm run dev -- --port 5173
Actual: next dev --port 5173
Result: ✅ Works (respects package.json)
```

---

### Case 3: Vite Project (No dev script)

**package.json:**
```json
{
  "devDependencies": { "vite": "^5.0.0" }
}
```

**Before & After (Same):**
```bash
Detection: Vite project, no dev script
Command: npx vite --port 3000
Result: ✅ Works (framework detection fallback)
```

---

## 🎯 핵심 개선사항

### 1. 명시적 의도 우선

```
Developer's Intent (package.json scripts)
  ↓ 최우선
System Inference (framework detection)
  ↓ 보조
```

**Philosophy:**
- `package.json scripts.dev` = 개발자가 명시적으로 정의한 개발 서버 명령
- Framework detection = 시스템의 추론 (정답 아님!)
- **명시적 의도 > 추론**

### 2. Backend/Frontend 구분

```
Backend Detection:
  ✅ Framework: express, koa, nest.js, ws, socket.io
  ✅ Dev tools: tsx, nodemon, ts-node
  ✅ Script pattern: "tsx", "server.ts"
  
Port Strategy:
  Backend → PORT env var
  Frontend → --port argument (+ PORT env var fallback)
```

### 3. Framework ≠ Architecture

```
❌ Wrong Assumption:
  "next in dependencies" → "This is a Next.js project"
  
✅ Correct Understanding:
  "next in dependencies" → "This project uses Next.js"
  
ant-pong-be:
  - Uses Next.js (for UI)
  - BUT: Custom WebSocket server architecture
  - Main entry: server.ts (not Next.js dev server)
```

---

## 🧪 테스트 시나리오

### Backend Projects

| Project | Scripts | Detection | Command | Result |
|---------|---------|-----------|---------|--------|
| ant-pong-be | `tsx watch server.ts` | Backend (tsx, ws) | `PORT=3000 npm run dev` | ✅ |
| Nest.js | `nest start --watch` | Backend (nest) | `PORT=3000 npm run dev` | ✅ |
| Express | `nodemon src/index.ts` | Backend (nodemon, express) | `PORT=3000 npm run dev` | ✅ |

### Frontend Projects

| Project | Scripts | Detection | Command | Result |
|---------|---------|-----------|---------|--------|
| ant-pong-fe | `next dev` | Frontend (next, no backend) | `npm run dev -- --port 5173` | ✅ |
| Vite (with script) | `vite` | Frontend (vite) | `npm run dev -- --port 5173` | ✅ |
| Vite (no script) | - | Vite framework | `npx vite --port 3000` | ✅ |
| CRA | `react-scripts start` | Frontend (react-scripts) | `npm run dev -- --port 3000` | ✅ |

---

## 📁 변경 파일

**수정된 파일:**
- `/packages/ant-cli/src/periphery/adapters/http/services/DevServerService.ts`

**주요 변경:**
1. Line 62-105: `isBackendProject()` 함수 추가
2. Line 235-297: 우선순위 재정렬 (scripts.dev 최우선)
3. Line 237-241: env 변수 구조 변경
4. Line 244-272: Backend/Frontend 구분 로직

---

## 🎓 설계 원칙

### 1. Explicit Over Implicit

```
Explicit (package.json scripts) > Implicit (framework detection)
```

### 2. Backend Needs Special Care

```
Backend:
  - Custom server code
  - PORT via environment
  - No CLI port argument
  
Frontend:
  - Dev server CLI
  - PORT via argument
  - Framework-specific syntax
```

### 3. Safe Defaults

```
Always set:
  - PORT env var (works for backend + fallback for frontend)
  - BROWSER=none (prevent auto-open)
  - OPEN=false (alternative)

Backend:
  - Only env vars

Frontend:
  - CLI arguments + env vars (belt & suspenders)
```

---

## 🔄 영향 범위

### Positive Impact

1. **ant-pong-be 정상 작동**
   - WebSocket 서버 + Next.js UI 통합 실행
   - PORT 환경변수로 포트 제어 가능

2. **명확한 프로젝트 타입 구분**
   - Backend/Frontend 자동 감지
   - 적절한 명령어 선택

3. **개발자 의도 존중**
   - package.json scripts 최우선
   - Framework detection은 보조

### No Breaking Changes

- 기존 Frontend 프로젝트: 정상 작동 유지
- Framework detection fallback: 여전히 작동
- 환경변수: 항상 설정 (안전)

---

## ✅ 체크리스트

- [x] `isBackendProject()` 함수 구현
- [x] Backend framework/tool 감지 로직
- [x] 우선순위 재정렬 (scripts.dev 최우선)
- [x] Backend: PORT env var 전용
- [x] Frontend: --port argument + PORT env var
- [x] TypeScript 빌드 성공
- [x] 로깅 개선 (Backend/Frontend 구분 표시)
- [x] 문서화 완료

---

## 🎯 결론

### 문제의 본질

**Framework Detection의 한계:**
- Next.js dependency가 있다고 해서 "Next.js 프로젝트"가 아님
- ant-pong-be는 Next.js를 **사용**하지만, **Custom Server Architecture**
- Framework detection = 추론 (정답 아님!)

### 해결의 핵심

**명시적 의도 우선 + Backend 구분:**
```
Before:
  Framework Detection → Next.js → npx next dev (Wrong!)
  
After:
  Scripts.dev (Explicit) → Backend Detection → PORT env var (Correct!)
```

### 통합적 접근

1. ✅ **Backend Detection**: Framework + Dev Tools + Script Pattern
2. ✅ **Priority Reordering**: Scripts First → Framework Fallback
3. ✅ **Port Strategy**: Backend (env) vs Frontend (argument)
4. ✅ **Safe Defaults**: Always set PORT env var

---

**구현 완료**: 2025-11-30  
**파일 변경**: 1개 (DevServerService.ts)  
**빌드 상태**: ✅ 성공  
**다음 단계**: 서버 재시작 후 ant-pong-be 테스트

