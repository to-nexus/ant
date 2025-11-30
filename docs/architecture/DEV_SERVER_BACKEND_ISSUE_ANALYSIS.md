# Dev Server Backend 프로젝트 이슈 분석

## 🔴 문제 발견

### 현재 상황

**백엔드 프로젝트 (ant-pong-be)의 package.json:**
```json
{
  "name": "ant-poing-fe",
  "scripts": {
    "dev": "tsx watch server.ts",      // ✅ Node.js + tsx 사용
    "build": "next build && tsc --project tsconfig.server.json",
    "start": "NODE_ENV=production node dist/server.js"
  },
  "dependencies": {
    "next": "^14.2.0",   // Next.js for UI
    "ws": "^8.18.0"      // WebSocket server
  },
  "devDependencies": {
    "tsx": "^4.16.0"     // TypeScript execution
  }
}
```

**실제 상황**:
- Backend = Custom WebSocket Server (ws) + Next.js UI
- Dev script = `tsx watch server.ts` (Node.js 기반)
- **Vite 의존성 없음!**

---

## 🔍 DevServerService 로직 분석

### 현재 로직 (Line 206-242)

```typescript
// Check for specific frameworks first (before generic "dev" script)
if (packageJson.devDependencies?.vite || packageJson.dependencies?.vite) {
  // Direct vite command
  command = 'npx';
  args = ['vite', '--port', devPort.toString()];
} else if (packageJson.devDependencies?.['@vitejs/plugin-react'] || ...) {
  // Vite React project
  command = 'npx';
  args = ['vite', '--port', devPort.toString()];
} else if (packageJson.devDependencies?.['next'] || packageJson.dependencies?.['next']) {
  // ❌ 문제: Next.js project
  command = 'npx';
  args = ['next', 'dev', '-p', devPort.toString()];
  // ❌ ant-pong-be는 여기서 걸림!
} else if (packageJson.scripts?.dev) {
  // ✅ 올바른 처리: npm run dev 사용
  command = 'npm';
  args = ['run', 'dev', '--', '--port', devPort.toString()];
}
```

---

## ❌ 문제점

### 1. 잘못된 우선순위

**현재 우선순위:**
```
1. vite 체크
2. @vitejs/plugin-react 체크
3. next 체크 ← ❌ ant-pong-be가 여기서 걸림!
4. react-scripts 체크
5. package.json scripts.dev 체크 ← ✅ 여기가 정답!
6. package.json scripts.start 체크
```

**ant-pong-be의 경우:**
- `next`가 dependencies에 있음 (UI용)
- → Line 216에서 `next dev` 실행 결정 ❌
- → 실제로는 `npm run dev` (tsx watch server.ts)를 실행해야 함 ✅

### 2. Framework Detection의 함정

```typescript
// ❌ 잘못된 가정
if (packageJson.dependencies?.['next']) {
  // "Next.js 프로젝트다" → 틀림!
  // ant-pong-be는 Next.js를 UI 라이브러리로만 사용
  // 실제 서버는 Custom WebSocket Server (tsx server.ts)
}
```

**실제 ant-pong-be 구조:**
```
server.ts (Main Entry)
  ├── WebSocket Server (ws library)
  └── Next.js (UI only, not as dev server)

Dev Command: tsx watch server.ts
  ↓
  tsx가 server.ts 실행
  ↓
  server.ts 내부에서 Next.js를 integrate
```

### 3. 백엔드 프로젝트 유형 미구분

**현재 지원 범위:**
```
✅ Vite frontend
✅ Next.js standalone
✅ Create React App
❌ Node.js backend (Express, Nest.js, etc.)
❌ Hybrid (Next.js + Custom Server)
```

---

## 🎯 해결 방안

### 원칙 1: package.json scripts 우선

**변경 전 (Framework First):**
```typescript
if (vite) → vite
else if (next) → next dev  ← 문제!
else if (scripts.dev) → npm run dev
```

**변경 후 (Scripts First):**
```typescript
if (scripts.dev) → npm run dev  ← 최우선!
else if (vite && no scripts.dev) → vite
else if (next && no scripts.dev) → next dev
```

**이유:**
- `package.json scripts.dev`는 프로젝트 개발자가 **명시적으로 정의한 dev 명령**
- Framework detection은 **추론**일 뿐, 정답이 아님
- 개발자의 의도 > 프레임워크 추론

### 원칙 2: Backend-Specific Detection

**Node.js Backend 프로젝트 특징:**
```json
{
  "scripts": {
    "dev": "tsx watch server.ts",     // tsx, nodemon, ts-node
    "dev": "nodemon src/index.ts",
    "dev": "nest start --watch",
    "dev": "ts-node-dev src/main.ts"
  },
  "dependencies": {
    "express": "^4.x",
    "@nestjs/core": "^10.x",
    "koa": "^2.x",
    "fastify": "^4.x"
  }
}
```

**Detection 로직:**
```typescript
function isBackendProject(packageJson): boolean {
  // Backend frameworks
  const backendFrameworks = [
    'express', 'koa', 'fastify', 'hapi',
    '@nestjs/core', '@nestjs/platform-express',
    'ws', 'socket.io', 'uWebSockets.js'
  ];
  
  // Backend dev tools
  const backendDevTools = [
    'tsx', 'nodemon', 'ts-node', 'ts-node-dev',
    'concurrently', 'pm2'
  ];
  
  // Check dependencies
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  return backendFrameworks.some(fw => deps[fw]) ||
         backendDevTools.some(tool => deps[tool]);
}
```

### 원칙 3: Port Argument Flexibility

**문제:**
```bash
# Frontend (Vite): --port 지원 ✅
vite --port 3000

# Frontend (Next.js): -p 지원 ✅
next dev -p 3000

# Backend (tsx): --port 미지원 ❌
tsx watch server.ts --port 3000  # 작동 안함!
```

**해결:**
```typescript
// Backend는 환경변수로 port 전달
if (isBackendProject(packageJson)) {
  env.PORT = devPort.toString();
  command = 'npm';
  args = ['run', 'dev'];  // --port 추가 안함!
}

// Frontend는 CLI argument로 전달
else {
  args = ['run', 'dev', '--', '--port', devPort.toString()];
}
```

---

## 📋 구현 계획

### Phase 1: 우선순위 재정렬

**목표**: package.json scripts 최우선

```typescript
// ✅ NEW ORDER
if (packageJson.scripts?.dev) {
  // 1순위: 명시적 dev script
  const isBackend = isBackendProject(packageJson);
  
  if (isBackend) {
    // Backend: PORT env var
    command = 'npm';
    args = ['run', 'dev'];
    env.PORT = devPort.toString();
  } else {
    // Frontend: --port argument (시도)
    command = 'npm';
    args = ['run', 'dev', '--', '--port', devPort.toString()];
  }
} else if (packageJson.devDependencies?.vite || ...) {
  // 2순위: Framework detection (dev script 없을 때만)
  command = 'npx';
  args = ['vite', '--port', devPort.toString()];
} else if (packageJson.dependencies?.['next']) {
  // 3순위: Next.js (dev script 없을 때만)
  command = 'npx';
  args = ['next', 'dev', '-p', devPort.toString()];
}
```

### Phase 2: Backend Detection

```typescript
function isBackendProject(packageJson: any): boolean {
  const deps = { 
    ...packageJson.dependencies, 
    ...packageJson.devDependencies 
  };
  
  // Backend frameworks
  const backendIndicators = [
    'express', 'koa', 'fastify', 'hapi',
    '@nestjs/core', '@nestjs/platform-express',
    'ws', 'socket.io', 'uWebSockets.js',
    'tsx', 'nodemon', 'ts-node', 'ts-node-dev'
  ];
  
  return backendIndicators.some(indicator => deps[indicator]);
}
```

### Phase 3: Port Argument Strategy

```typescript
function getDevServerCommand(packageJson: any, devPort: number) {
  const isBackend = isBackendProject(packageJson);
  const hasDevScript = Boolean(packageJson.scripts?.dev);
  
  if (!hasDevScript) {
    // Framework detection logic (기존 로직)
    return detectFrameworkCommand(packageJson, devPort);
  }
  
  // Dev script 있음 → 사용
  if (isBackend) {
    // Backend: PORT env var만
    return {
      command: 'npm',
      args: ['run', 'dev'],
      env: { PORT: devPort.toString() }
    };
  } else {
    // Frontend: --port 시도 (fallback: PORT env var)
    return {
      command: 'npm',
      args: ['run', 'dev', '--', '--port', devPort.toString()],
      env: { PORT: devPort.toString() }  // Fallback
    };
  }
}
```

---

## 🧪 테스트 케이스

### Case 1: ant-pong-be (Backend + Next.js)

**Input:**
```json
{
  "scripts": { "dev": "tsx watch server.ts" },
  "dependencies": { "next": "^14.2.0", "ws": "^8.18.0" },
  "devDependencies": { "tsx": "^4.16.0" }
}
```

**Current (Wrong):**
```bash
npx next dev -p 3000  # ❌ Next.js UI만 띄움, WebSocket 서버 없음
```

**Expected (Correct):**
```bash
PORT=3000 npm run dev  # ✅ tsx watch server.ts 실행
```

### Case 2: Nest.js Backend

**Input:**
```json
{
  "scripts": { "dev": "nest start --watch" },
  "dependencies": { "@nestjs/core": "^10.0.0" }
}
```

**Expected:**
```bash
PORT=3000 npm run dev  # ✅ nest start --watch
```

### Case 3: Vite Frontend (No dev script)

**Input:**
```json
{
  "devDependencies": { "vite": "^5.0.0" }
}
```

**Expected:**
```bash
npx vite --port 3000  # ✅ Vite dev server
```

### Case 4: Next.js Standalone

**Input:**
```json
{
  "dependencies": { "next": "^14.2.0" }
}
```

**Expected:**
```bash
npx next dev -p 3000  # ✅ Next.js dev server
```

---

## 📊 Impact Analysis

### Before (Current)

```
ant-pong-be:
  Detection: Next.js project (by dependency)
  Command: npx next dev -p 3000
  Result: ❌ Only UI, no WebSocket server
  
ant-pong-fe:
  Detection: Next.js project
  Command: npx next dev -p 5173
  Result: ✅ Works (Next.js standalone)
```

### After (Fixed)

```
ant-pong-be:
  Detection: Backend project with dev script
  Command: PORT=3000 npm run dev
  Result: ✅ Full server (WebSocket + UI)
  
ant-pong-fe:
  Detection: Frontend with dev script
  Command: npm run dev -- --port 5173
  Result: ✅ Works (respects package.json)
```

---

## 🎯 핵심 교훈

### 1. 명시적 의도 > 추론

```
package.json scripts.dev = 개발자의 명시적 의도
Framework detection = 시스템의 추론

✅ 개발자 의도 우선!
```

### 2. Framework ≠ Architecture

```
Next.js in dependencies:
  ❌ 잘못된 가정: "이것은 Next.js 프로젝트다"
  ✅ 올바른 이해: "Next.js를 사용하는 프로젝트다"
  
ant-pong-be:
  - Next.js를 사용하지만 (UI용)
  - Next.js 프로젝트가 아님 (Custom Server)
```

### 3. Backend는 별도 처리 필요

```
Frontend:
  - Dev server가 CLI로 실행
  - Port를 CLI argument로 전달
  
Backend:
  - Custom server 코드
  - Port를 환경변수로 전달
```

---

## ✅ 다음 단계

1. **isBackendProject() 구현**
2. **getDevServerCommand() 리팩토링**
3. **우선순위 재정렬 (scripts.dev 최우선)**
4. **테스트 (ant-pong-be, ant-pong-fe)**
5. **문서 업데이트**

---

**작성일**: 2025-11-30  
**문제**: Backend 프로젝트가 잘못된 dev server 명령으로 실행됨  
**원인**: Framework detection 우선순위 문제  
**해결**: package.json scripts 우선 + Backend detection

