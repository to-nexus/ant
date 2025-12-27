# 개발서버 관리

## 1. 개요

피처별 개발서버를 관리하는 시스템입니다. 멀티패키지 프로젝트(Fullstack, Monorepo)를 지원하며, 모든 패키지를 동시 기동하고 Entry 패키지를 통한 프록시 접근을 제공합니다.

### 핵심 특징

- **멀티 패키지 지원**: Frontend + Backend 동시 실행
- **동적 포트 할당**: 30000-35000 범위 자동 할당
- **프록시 통합**: `/dev/:serverKey` 단일 URL 접근
- **피처별 격리**: 동일 사용자의 여러 피처 독립 실행
- **실시간 진행 상황**: 패키지별 설치/실행 상태 추적

---

## 2. 아키텍처

### 2.1 서버 키 구조

```
{tenantId}:{userId}:{projectId}:{feature}

예시: acme-corp:alice:todo-app:feature-login
```

### 2.2 시스템 구성

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (ant-ui)                                           │
│  ├─ DevServerStatusPanel    # 진행 상황 표시              │
│  ├─ useDevServerManager     # 상태 관리 & 폴링            │
│  └─ extractProgress()        # 로그 파싱                   │
└─────────────────────────────────────────────────────────────┘
                              ↓ HTTP API
┌─────────────────────────────────────────────────────────────┐
│ Backend (ant-cli)                                           │
│  ├─ DevServerService        # 멀티 패키지 기동            │
│  ├─ PortManager             # 동적 포트 할당              │
│  ├─ PortRegistry            # 서버 키 → 포트 매핑         │
│  └─ DevServerProxy          # /dev/:serverKey 프록시      │
└─────────────────────────────────────────────────────────────┘
                              ↓ Spawn
┌─────────────────────────────────────────────────────────────┐
│ Dev Servers (Child Processes)                               │
│  ├─ web-client:30001        # Frontend (Entry)             │
│  ├─ api-server:30002        # Backend                      │
│  └─ admin:30003             # Additional packages          │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 프록시 흐름

```
브라우저
  ↓ http://localhost:3000/dev/acme:alice:project:feature
Express DevServerProxy
  ↓ PortRegistry 조회: acme:alice:project:feature → 30001
  ↓ HTML 응답 Rewrite: /main.tsx → /dev/acme:alice:project:feature/main.tsx
http://localhost:30001 (web-client, Entry)
  ↓ vite.config.ts: proxy: { '/api': 'http://localhost:30002' }
http://localhost:30002 (api-server)
```

**중요**: 프록시는 `selfHandleResponse: true`를 사용하여 HTML 응답의 모든 절대 경로를 `/dev/serverKey/` prefix로 자동 rewrite합니다.

---

## 3. Backend 구현

### 3.1 프록시 미들웨어 (핵심)

프록시 미들웨어는 **`selfHandleResponse: true`** 옵션을 사용하여 HTML 응답을 직접 처리합니다:

```typescript
const proxy = createProxyMiddleware({
  target: `http://localhost:${port}`,
  changeOrigin: true,
  ws: true,  // WebSocket support for HMR
  selfHandleResponse: true,  // ✅ CRITICAL: Handle response ourselves
  pathRewrite: (path) => {
    // /dev/serverKey/main.tsx → /main.tsx
    return path.replace(`/dev/${serverKey}`, '') || '/';
  },
  onProxyRes: (proxyRes, req, res) => {
    const isHtml = proxyRes.headers['content-type']?.includes('text/html');
    
    if (isHtml) {
      // Collect HTML chunks
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        
        // Rewrite: /main.tsx → /dev/serverKey/main.tsx
        html = html.replace(
          /((?:src|href|action|data-src)=["'])\/(?!\/)/g, 
          `$1/dev/${serverKey}/`
        );
        
        res.end(Buffer.from(html, 'utf8'));
      });
    } else {
      // Non-HTML: pipe through
      proxyRes.pipe(res);
    }
  }
});
```

**이유**: Vite가 반환하는 HTML의 모든 리소스(`/main.tsx`, `/@vite/client`)가 절대 경로이므로, 이를 `/dev/serverKey/` prefix로 rewrite하지 않으면 브라우저가 프록시를 거치지 않고 직접 요청하여 401 Unauthorized 에러가 발생합니다.

### 3.2 프로젝트 구조 감지

| 타입 | 판단 기준 | Entry | 기동 패키지 |
|------|-----------|-------|------------|
| **Frontend-Only** | React/Vue/Vite | root | root |
| **Backend-Only** | Express/NestJS | root | root |
| **Fullstack** | Frontend + Backend 디렉토리 | Frontend | 모두 |
| **Monorepo** | `workspaces` 설정 | 첫 Frontend | dev script 있는 모두 |

**감지 로직:**
```typescript
// Frontend 판단
isFrontendPackage(packageJson) {
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  // 프레임워크: react, vue, svelte, @angular/core
  // 빌드툴: vite, next, webpack, parcel
  // dev script: "vite", "next dev", "react-scripts"
}

// Backend 판단
isBackendPackage(packageJson) {
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  // 프레임워크: express, koa, fastify, @nestjs/core
  // dev script: "tsx", "nodemon", "ts-node"
}
```

**특징:**
- ✅ `package.json` 내용 기반
- ✅ 디렉토리 이름 무관
- ✅ 유연하고 확장 가능

### 3.2 실행 프로세스

```typescript
async startDevServer(tenantId, userId, projectId, feature, localPath) {
  // 1. 프로젝트 구조 감지
  const structure = await detectProjectStructure(localPath);
  // → { type: 'fullstack', packages: [frontend, backend], entry: frontend }
  
  // 2. 모든 패키지 의존성 설치
  for (const pkg of structure.packages) {
    if (!exists(pkg.path + '/node_modules')) {
      await spawn('npm', ['install'], { cwd: pkg.path });
      // 로그: "📦 Installing dependencies for web-client..."
      // 로그: "✅ Dependencies installed for web-client"
    }
  }
  
  // 3. 포트 할당 및 모든 패키지 기동
  const processes = [];
  for (const pkg of structure.packages) {
    const port = await portManager.allocate();  // 30001, 30002, ...
    const process = spawn('npm', ['run', 'dev'], { 
      cwd: pkg.path, 
      env: { PORT: port } 
    });
    // 로그: "🚀 Starting web-client (frontend) on port 30001..."
    processes.push(process);
  }
  
  // 4. Entry만 PortRegistry에 등록
  await portRegistry.registerDevServer(
    tenantId, userId, projectId, feature,
    structure.entry.port  // 30001 (Frontend)
  );
  
  // ✅ 5. Basename validation (Frontend Entry만)
  let validation = { valid: true };
  if (structure.entry?.type === 'frontend') {
    validation = await validateDevServerSetup(structure.entry.path);
    
    if (!validation.valid) {
      // 서버 중단 + 정리
      processes.forEach(p => p.kill());
      await portRegistry.unregisterDevServer(...);
      
      return {
        success: false,
        error: 'Dev server setup validation failed',
        setupReasoning: validation.reasoning || 'unknown',  // Categorized code
        setupReason: validation.reason,                     // Human-readable message
        suggestedFix: validation.suggestedFix
      };
    }
  }
  
  // 6. 로그: "✅ All dev servers started successfully!"
  return { 
    success: true, 
    port: structure.entry.port, 
    url: `/dev/${serverKey}`,
    setupReasoning: validation.reasoning  // Only set if validation failed
  };
}
```

### 3.3 로그 형식

```typescript
// 의존성 설치
"📦 Installing dependencies for web-client..."
"✅ Dependencies installed for web-client"

// 서버 시작
"🚀 Starting web-client (frontend) on port 30001..."
"🚀 Starting api-server (backend) on port 30002..."

// 완료
"✅ All dev servers started successfully!"

// 에러
"❌ Failed to start api-server: Port 30002 already in use"
```

### 3.4 API 엔드포인트

```bash
# 시작
POST /api/projects/:id/dev/start
Body: { feature: "feature-login" }
Response: { 
  success: true, 
  port: 30001, 
  url: "/dev/acme:alice:project:feature-login",
  message: "Started 2 package(s)"
}

# 중지
POST /api/projects/:id/dev/stop
Body: { feature: "feature-login" }

# 상태 (폴링용)
GET /api/projects/:id/dev/status?feature=feature-login
Response: { 
  running: true, 
  port: 30001, 
  url: "/dev/...",
  logs: [
    { timestamp: "...", type: "stdout", message: "📦 Installing..." },
    { timestamp: "...", type: "stdout", message: "🚀 Starting..." }
  ]
}
```

---

## 4. Basename Validation & Fix 워크플로우

### 4.1 개요

Frontend Entry 패키지의 Router basename 설정을 자동 검증하여, 프록시 환경에서 올바르게 작동하도록 보장합니다.

### 4.2 검증 대상

| 프로젝트 타입 | Entry 타입 | Validation 실행 여부 |
|--------------|-----------|-------------------|
| Frontend-Only | frontend | ✅ 실행 |
| Fullstack | frontend | ✅ 실행 (Entry만) |
| Fullstack | backend | ⏭️ Skip |
| Monorepo | frontend | ✅ 실행 (Entry만) |
| Backend-Only | backend | ⏭️ Skip |

### 4.3 검증 로직

#### React
```typescript
// ReactValidator.ts
async validate(codebasePath: string): Promise<ValidationResult> {
  const appTsx = await fs.readFile(path.join(codebasePath, 'src/App.tsx'), 'utf-8');
  
  // 1. BrowserRouter basename 체크
  const hasBasename = appTsx.includes('window.__BASENAME__') && 
                     appTsx.includes('<BrowserRouter') &&
                     appTsx.includes('basename=');
  
  // 2. Window 타입 선언 체크
  const hasTypeDeclaration = appTsx.includes('interface Window') && 
                            appTsx.includes('__BASENAME__');
  
  if (!hasBasename || !hasTypeDeclaration) {
    return {
      valid: false,
      framework: 'react',
      reasoning: 'basename-missing',  // ✅ Categorized failure code
      reason: 'Missing basename configuration for dev server proxy',
      suggestedFix: `
개발서버 프록시 지원을 위해 다음 설정을 추가해주세요:

1. App.tsx의 <BrowserRouter>에 basename 추가:
   <BrowserRouter basename={window.__BASENAME__ || ''}>

2. Window 타입 선언 추가:
   declare global {
     interface Window {
       __BASENAME__?: string;
     }
   }

이 설정은 Ant 플랫폼의 개발서버 프록시(/dev/:serverKey/)가 
정상적으로 작동하기 위해 필요합니다.
      `
    };
  }
  
  return { valid: true, framework: 'react' };
}
```

#### Vue
```typescript
// VueValidator.ts
async validate(codebasePath: string): Promise<ValidationResult> {
  const mainTs = await fs.readFile(path.join(codebasePath, 'src/main.ts'), 'utf-8');
  
  const hasBasename = mainTs.includes('createWebHistory') && 
                     mainTs.includes('__BASENAME__');
  
  if (!hasBasename) {
    return {
      valid: false,
      framework: 'vue',
      reasoning: 'basename-missing',  // ✅ Categorized failure code
      reason: 'Missing basename configuration for dev server proxy',
      suggestedFix: `
개발서버 프록시 지원을 위해 Vue Router 설정을 수정해주세요:

import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory((window as any).__BASENAME__ || '/'),
  routes: [...]
});
      `
    };
  }
  
  return { valid: true, framework: 'vue' };
}
```

### 4.4 Proxy에서 window.__BASENAME__ 주입

프록시 미들웨어는 HTML 응답에 `window.__BASENAME__`를 자동 주입합니다:

```typescript
// devServerProxy.ts
const basenameScript = `<script>window.__BASENAME__ = "${pathPrefix}/${serverKey}";</script>`;

if (contentType.includes('text/html')) {
  let html = text
    .replace(/((?:src|href|action)=["'])\/(?!\/)/g, `$1${pathPrefix}/${serverKey}/`)
    .replace(/((?:^|\n|;)\s*import\s+["'])\/(?!\/)/gm, `$1${pathPrefix}/${serverKey}/`);
  
  // <head> 태그 안에 basename script 주입
  const headEndIndex = html.indexOf('</head>');
  if (headEndIndex !== -1) {
    html = html.substring(0, headEndIndex) + basenameScript + html.substring(headEndIndex);
  }
  
  res.send(html);
}
```

### 4.5 실행 흐름

```
1. 사용자: "Start Server" 클릭
   ↓
2. Backend: 의존성 설치
   ↓
3. Backend: 개발서버 기동 (모든 패키지)
   ↓
4. Backend: Validation 체크 (Entry가 Frontend인 경우)
   ├─ ✅ 통과 → Health Check → Success
   └─ ❌ 실패 → 서버 중단 → 400 에러 반환
   ↓
5. Frontend: setupReasoning 존재 여부 감지
   ↓
6. UI: 노란색 경고 + Fix 버튼 표시
   ┌─────────────────────────────────────────────┐
   │ ⚠️  개발서버 프록시 설정 미완료                │
   │                                             │
   │ Missing basename configuration for          │
   │ dev server proxy                            │
   │                                             │
   │ [Fix 🔧]                                    │
   └─────────────────────────────────────────────┘
   ↓
7. 사용자: Fix 버튼 클릭
   → suggestedFix를 클립보드에 복사
   → 채팅창에 자동 붙여넣기 준비 + job type 'code' 자동 선택
   ↓
8. AI: basename 설정 코드 생성
   (dev-server-setup.md injection 포함)
   ↓
9. 사용자: "Start Server" 재시도
   → ✅ Validation 통과
   → ✅ 정상 작동
```

### 4.6 AI 프롬프트 Injection

Frontend 프로젝트의 code job 실행 시, `dev-server-setup.md` 가이드가 자동 주입됩니다:

```typescript
// ModeController.ts
if (phase === 'execute' && task === 'code') {
  if (environment === ProjectEnvironment.BROWSER || 
      environment === ProjectEnvironment.FULLSTACK) {
    injections.push(`code/base/injections/dev-server-setup`);
  }
}
```

**dev-server-setup.md 내용:**
- React Router의 `<BrowserRouter basename>` 설정 가이드
- Vue Router의 `createWebHistory` base 설정 가이드
- `window.__BASENAME__` 타입 선언 가이드

### 4.7 API 응답

```typescript
// Success (Validation 통과)
{
  success: true,
  port: 30001,
  url: "/dev/tenant:user:project:feature"
  // setupReasoning은 undefined (실패 시만 설정됨)
}

// Failure (Validation 실패)
{
  success: false,
  error: "Dev server setup validation failed",
  setupReasoning: "basename-missing",  // Categorized failure code
  setupReason: "Missing basename configuration for dev server proxy",
  suggestedFix: "개발서버 프록시 지원을 위해..."
}
```

**Reasoning Codes:**
- `basename-missing`: Frontend Router의 basename 설정 누락
- `port-conflict`: 포트 충돌 (향후 확장)
- `dependency-error`: 의존성 설치 실패 (향후 확장)
- `config-invalid`: 설정 파일 오류 (향후 확장)
- `unknown`: 미분류 에러

### 4.8 Reasoning 기반 오류 분류 시스템

#### 개요
`setupReasoning`은 오류를 프로그래밍 방식으로 분류하기 위한 코드입니다. `setupReason`은 사람이 읽을 수 있는 상세 메시지입니다.

#### 장점
1. **프로그래밍 처리**: `if (setupReasoning === 'basename-missing')` 조건 분기 가능
2. **확장성**: 새로운 오류 유형 추가 시 기존 코드 수정 불필요
3. **다국어 지원**: Reasoning code로 메시지 매핑 가능
4. **로깅 & 분석**: 구조화된 데이터로 통계 수집 가능

#### Frontend에서의 사용
```typescript
// DevServerStatusPanel.tsx
function getSetupFailureTitle(reasoning?: SetupFailureReasoning): string {
  switch (reasoning) {
    case 'basename-missing':
      return '⚠️ 개발서버 프록시 설정 미완료';
    case 'port-conflict':
      return '⚠️ 포트 충돌';
    case 'dependency-error':
      return '⚠️ 의존성 설치 실패';
    default:
      return '⚠️ 개발서버 설정 미완료';
  }
}

// State 분석
function analyzeDevServerState(status: DevServerStatus): DevServerState {
  if (status.setupReasoning) {  // ✅ 간결한 체크
    return 'error';
  }
  // ...
}
```

#### Validator 구조
```
ProjectValidator (Orchestrator)
    ├─ 프레임워크 감지 (React, Vue, Next, etc.)
    └─ 프레임워크별 Validator 위임
         ├─ ReactValidator → reasoning: 'basename-missing'
         ├─ VueValidator → reasoning: 'basename-missing'
         └─ (향후) PortValidator → reasoning: 'port-conflict'
```

---

## 5. Frontend 구현

### 5.1 상태 관리

```typescript
export type DevServerState = 'idle' | 'installing' | 'starting' | 'running' | 'error';

export interface DevServerStatus {
  running: boolean;
  ready?: boolean;
  port?: number | null;
  url?: string | null;
  logs?: LogEntry[];
  setupReasoning?: string;  // ✅ Categorized failure code (e.g., 'basename-missing')
  setupReason?: string;     // ✅ Human-readable message
  suggestedFix?: string;    // ✅ Suggested fix prompt
}

export interface PackageProgress {
  name: string;                  // 'web-client', 'api-server'
  state: 'pending' | 'installing' | 'starting' | 'running' | 'error';
  error?: string;
}

export interface DevServerProgress {
  packages: PackageProgress[];   // 모든 패키지 상태
  currentPhase: 'installing' | 'starting' | 'running';
  completedCount: number;
  totalCount: number;
}
```

### 5.2 로그 파싱

```typescript
// utils/devServer.ts
export function extractProgress(logs: DevServerLog[]): DevServerProgress {
  // "📦 Installing dependencies for web-client..."
  // → { name: 'web-client', state: 'installing' }
  
  // "✅ Dependencies installed for web-client"
  // → { name: 'web-client', state: 'starting' }
  
  // "🚀 Starting web-client (frontend) on port 30001..."
  // → { name: 'web-client', state: 'starting' }
  
  // "✅ All dev servers started successfully!"
  // → all packages: state: 'running'
  
  return {
    packages: [...],
    currentPhase: 'starting',
    completedCount: 1,
    totalCount: 2
  };
}
```

### 5.3 UI 컴포넌트

#### DevServerStatusPanel

```tsx
<DevServerStatusPanel
  state="installing"
  progress={{
    packages: [
      { name: 'web-client', state: 'installing' },
      { name: 'api-server', state: 'pending' }
    ],
    currentPhase: 'installing',
    completedCount: 0,
    totalCount: 2
  }}
/>
```

**렌더링 결과:**
```
┌─────────────────────────────────────────────┐
│ 📦 Installing dependencies: web-client      │
│ [■□] Progress bars                          │
└─────────────────────────────────────────────┘
```

#### 상태별 UI

| 상태 | 아이콘 | 메시지 | 추가 요소 |
|------|--------|--------|----------|
| `installing` | 📦 (pulse) | "Installing dependencies: web-client, api-server" | Progress bars |
| `starting` | ⏳ (spin) | "Starting servers: web-client, api-server" | Progress bars |
| `running` | ✅ | "All servers running (2/2)" | [Open] 버튼 |
| `error` | ⚠️ | "Dev Server Failed to Start" | Error details |

### 5.4 Hook 사용

```typescript
const {
  state,           // 'installing' | 'starting' | 'running' | ...
  status,          // { running: true, port: 30001, logs: [...], setupReasoning: 'basename-missing' }
  ready,           // Health check 결과
  setupReasoning,  // ✅ Categorized failure code (e.g., 'basename-missing')
  setupReason,     // ✅ Human-readable message
  suggestedFix,    // ✅ Suggested fix prompt
  progress,        // { packages: [...], currentPhase: 'starting', ... }
  error,           // { message: "..." }
  startServer,
  stopServer,
  isLoading
} = useDevServerManager(selectedProject, selectedFeature);
```

---

## 6. 사용자 경험

### 6.1 단일 패키지 (Frontend-Only)

```
1. Play 버튼 클릭
   ↓
2. "Installing dependencies..." (필요시)
   ↓
3. "Starting dev server..."
   ↓
4. Basename Validation
   ├─ ✅ 통과 → "Dev Server Running" + [Open]
   └─ ❌ 실패 → "Setup 미완료" + [Fix 🔧]
```

### 6.2 멀티 패키지 (Fullstack)

```
1. Play 버튼 클릭
   ↓
2. "Installing dependencies: web-client"
   [■□] Progress: web-client 설치 중, api-server 대기
   ↓
3. "Installing dependencies: web-client, api-server"
   [■■] Progress: 모두 설치 중
   ↓
4. "Starting servers: web-client"
   [■□] Progress: web-client 시작 중
   ↓
5. "Starting servers: web-client, api-server"
   [■■] Progress: 모두 시작 중
   ↓
6. "All servers running (2/2)" + [Open]
   [■■] Progress: 완료
```

### 6.3 에러 발생

```
"Dev Server Failed to Start"
❌ api-server: Port 30002 already in use
```

---

## 7. 실행 예시

### 7.1 Fullstack

```typescript
ant-news-desk/
├── web-client/    (React/Vite)
├── api-server/    (Express)
└── package.json

// 실행:
🚀 web-client → Port 30001 (ENTRY)
🚀 api-server → Port 30002
✅ PortRegistry: /dev/acme:alice:ant-news-desk:feature → 30001
```

### 7.2 Monorepo

```typescript
turborepo/
├── package.json (workspaces: ["apps/*"])
├── apps/
│   ├── dashboard/  (Next.js)
│   ├── api/        (NestJS)
│   └── admin/      (React)
└── packages/
    └── shared/     (dev script 없음, 기동 X)

// 실행:
🚀 apps/dashboard → Port 30001 (ENTRY)
🚀 apps/api       → Port 30002
🚀 apps/admin     → Port 30003
⏭️  packages/shared (skipped)
✅ PortRegistry: /dev/acme:alice:turborepo:feature → 30001
```

---

## 8. 배포

### 8.1 Express만 사용 (권장)

```
브라우저 → Express (HTTPS) → Dev Server
```

- ✅ 단순, 추가 인프라 불필요
- ✅ 중소 규모 충분

### 8.2 Nginx + Express (대규모)

```
브라우저 → Nginx (로드밸런싱) → Express → Dev Server
```

- 여러 Express 서버 로드 밸런싱
- SSL 인증서 중앙 관리
- Rate limiting

---

## 9. Graceful Shutdown

서버 종료 시 모든 개발서버를 안전하게 정리합니다.

### 9.1 Shutdown 순서

```typescript
1. Save all running jobs        // Job 상태 저장
   ↓
2. Terminate child processes    // Job 프로세스 종료
   ↓
3. Cleanup services             // DevServerService, IDEService 정리
   ↓
4. Close HTTP server            // Express 서버 종료
```

### 9.2 DevServerService Cleanup

```typescript
async cleanup(): Promise<void> {
  // 1. Stop all dev servers
  for (const serverKey of this.devServers.keys()) {
    const { tenantId, userId, projectId, feature } = parseServerKey(serverKey);
    
    // Kill all processes
    for (const process of processes) {
      process.kill('SIGTERM');
    }
    
    // Release ports
    await portManager.release(port);
    
    // Unregister from PortRegistry
    await portRegistry.unregisterDevServer(...);
  }
  
  // 2. Close PortRegistry connection
  await portRegistry.close();
}
```

### 9.3 실행 로그

```bash
^C
🛑 [Server] Graceful shutdown initiated...

💾 [Server] Saving 2 running job(s)...
   Saving job abc-123 (project/feature/code)...
✅ [Server] All jobs saved (2 total)

🔪 [Server] Terminating 2 child process(es)...
   Job abc-123: Sent SIGTERM...
   Job abc-123: Exited gracefully
✅ [Server] All child processes terminated (2 total)

🧹 [Server] Cleaning up services...
[DevServerService] 🧹 Cleaning up 3 dev server(s)...
[DevServerService]    ✅ Stopped: acme:alice:project:feature-1
[DevServerService]    ✅ Stopped: acme:alice:project:feature-2
[DevServerService]    ✅ Stopped: acme:alice:project:feature-3
[DevServerService]    ✅ PortRegistry closed
[DevServerService] ✅ Cleanup complete (3 server(s) stopped)
   ✅ DevServerService cleaned
   ✅ IDEService cleaned
   ✅ In-memory state cleared

🌐 [Server] Closing HTTP server...
✅ [Server] HTTP server closed

✅ [Server] Graceful shutdown complete
```

### 9.4 타임아웃

- **Timeout**: 5초
- 5초 내 완료 못하면 강제 종료 (force shutdown)
- Job 상태는 저장 완료 후 강제 종료

---

## 10. 파일 구조

```
packages/
├── ant-cli/src/
│   ├── core/
│   │   ├── ports/
│   │   │   └── portRegistry.ts
│   │   └── prompt/templates/code/base/injections/
│   │       └── dev-server-setup.md        # ✅ Basename 가이드
│   ├── infrastructure/networking/
│   │   ├── PortManager.ts
│   │   └── InMemoryPortRegistry.ts
│   └── periphery/adapters/http/
│       ├── services/
│       │   └── DevServerService/
│       │       ├── DevServerService.ts    # 메인 로직
│       │       ├── types.ts               # 타입 정의
│       │       ├── utils/
│       │       │   └── serverKeyUtils.ts
│       │       ├── managers/
│       │       │   └── LogManager.ts
│       │       ├── detectors/
│       │       │   └── PackageDetector.ts # Frontend/Backend 감지
│       │       └── validators/
│       │           ├── ProjectValidator.ts # 통합 validator (Orchestrator)
│       │           ├── ReactValidator.ts   # ✅ React basename 검증
│       │           └── VueValidator.ts     # ✅ Vue basename 검증
│       └── middleware/
│           └── devServerProxy.ts           # ✅ window.__BASENAME__ 주입
│
└── ant-ui/src/presentation/components/FeatureSection/
    ├── constants/
    │   └── devServer.ts                    # 텍스트 상수
    ├── types/
    │   └── devServer.ts                    # ✅ setupReasoning, suggestedFix
    ├── utils/
    │   └── devServer.ts                    # 로그 파싱, 상태 분석
    ├── hooks/
    │   └── useDevServerManager.ts          # ✅ setupReasoning 상태 관리
    └── components/
        └── DevServerStatusPanel.tsx        # ✅ Fix 버튼 표시
```

---

## 11. 핵심 요약

| 항목 | 설명 |
|------|------|
| **Backend** | 모든 패키지 기동, Entry만 프록시 등록 |
| **Frontend** | 로그 파싱하여 패키지별 진행 상황 표시 |
| **UX** | 실시간 프로그레스 바로 멀티 패키지 상태 추적 |
| **Key** | `tenantId:userId:projectId:feature` |
| **Port** | 30000-35000 동적 할당 |
| **Proxy** | `/dev/:serverKey` → Entry 포트 |
| **Basename** | Frontend Entry만 자동 검증 + Fix 워크플로우 |
| **Reasoning** | `basename-missing`, `port-conflict` 등 코드 기반 오류 분류 |
| **AI Injection** | Frontend code job에 dev-server-setup 가이드 자동 포함 |
| **Shutdown** | 모든 dev server, port, registry 안전하게 정리 |
