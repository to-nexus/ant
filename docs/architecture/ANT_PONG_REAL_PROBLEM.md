# ant-pong-be 실제 문제 분석 (Frontend API 연동)

## 🔴 실제 문제 발견!

### 사용자가 말한 진짜 문제
```
"백엔드에 프론트엔드가 접근하면 문제가 발생한다"
```

### 문제의 본질

**Frontend (LobbyPage.tsx Line 6):**
```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
```

**Backend (main.ts Line 14):**
```typescript
const port = process.env.PORT || 3000;  // ← Port 3000에서 실행!
```

**문제:**
- Frontend가 `http://localhost:8080/rooms`로 요청
- Backend는 `http://localhost:3000`에서 실행
- → **404 Not Found** → HTML 페이지 반환
- → Frontend에서 `Unexpected token '<!DOCTYPE'` 에러

---

## 📊 상황 분석

### Backend 상태 (ant-pong-be)

**코드 상태:**
```typescript
// ✅ src/rooms/rooms.controller.ts
@Controller('rooms')
export class RoomsController {
  @Get()
  getRooms() {
    const rooms = this.gameGateway.getRooms();
    return { rooms };  // ✅ JSON 반환
  }

  @Post('create')
  createRoom() {
    const roomId = this.gameGateway.createRoom();
    return { roomId };  // ✅ JSON 반환
  }
}

// ✅ src/app.module.ts
@Module({
  imports: [RoomsModule],  // ✅ Controller 등록됨
})

// ✅ src/main.ts
app.enableCors({
  origin: '*',  // ✅ CORS 설정됨
  methods: '*',
  allowedHeaders: '*',
});

const port = process.env.PORT || 3000;  // ← Port 3000!
await app.listen(port);
```

**빌드 상태:**
```bash
$ npm run build
✅ Build successful
```

**실행 포트:**
- Port 3000 (또는 PORT env var)

---

### Frontend 상태 (ant-pong-fe)

**API 요청 코드 (LobbyPage.tsx Line 6, 18, 43):**
```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
//                                                            ^^^^^^^^^^^^^^^^
//                                                            ❌ 잘못된 기본값!

const fetchRooms = async () => {
  const response = await fetch(`${API_BASE_URL}/rooms`);
  //                              ↓
  //                    http://localhost:8080/rooms ❌
  //                    (Backend는 3000에서 실행 중)
  
  const data = await response.json();  // ← HTML 파싱 시도 → 에러!
}
```

**실제 요청:**
```
Frontend → http://localhost:8080/rooms
                    ↓
            Port 8080: 아무것도 실행 안 됨
                    ↓
            404 Not Found (또는 다른 서버의 HTML)
                    ↓
            Frontend: JSON.parse(HTML) ❌
                    ↓
            Error: Unexpected token '<!DOCTYPE'
```

---

## 🎯 근본 원인

### 1. **포트 불일치**

```
Backend 실제 포트:
  - Default: 3000
  - Dev script: tsx watch server.ts (PORT env var)
  
Frontend 기대 포트:
  - Default: 8080 ❌
  - Env var: VITE_API_BASE_URL (설정 안 됨)
```

### 2. **사용자 Directive의 의미**

**사용자가 제시한 해결책:**
```
"NEXT_PUBLIC_BACKEND_URL 이런 환경변수로 서빙하는 url을 파악하려하지말고, 
실제 서빙주는 현재의 호스트와 포트를 바탕으로 판단하도록 해라. 
그렇게 해야 외부에서 주입된 포트로 개발서버를 띄울때 문제가 없다."
```

**의미:**
- 환경변수에 하드코딩하지 말고
- **런타임에 실제 서버의 host:port를 파악**해서 사용
- 동적 포트 할당에 대응

---

## 🔧 올바른 해결 방법

### Option 1: Backend에서 Info Endpoint 제공 (권장)

**Backend에 endpoint 추가:**
```typescript
// src/app.controller.ts
@Controller()
export class AppController {
  @Get('info')
  getServerInfo() {
    const host = process.env.HOST || 'localhost';
    const port = process.env.PORT || 3000;
    return {
      apiUrl: `http://${host}:${port}`,
      wsUrl: `ws://${host}:${port}`,
      version: '1.0.0'
    };
  }
}
```

**Frontend에서 초기화 시 조회:**
```typescript
// src/config/api.ts
let API_BASE_URL = 'http://localhost:3000';  // Temp default
let WS_BASE_URL = 'ws://localhost:3000';

export async function initializeConfig() {
  try {
    // ✅ Try common ports
    const possiblePorts = [3000, 8080, 4000];
    
    for (const port of possiblePorts) {
      try {
        const response = await fetch(`http://localhost:${port}/info`, {
          signal: AbortSignal.timeout(1000)
        });
        
        if (response.ok) {
          const info = await response.json();
          API_BASE_URL = info.apiUrl;
          WS_BASE_URL = info.wsUrl;
          console.log('✅ Backend detected:', API_BASE_URL);
          return;
        }
      } catch {
        continue;
      }
    }
    
    console.warn('⚠️ Backend not detected, using default');
  } catch (error) {
    console.error('Failed to initialize config:', error);
  }
}

export const getApiBaseUrl = () => API_BASE_URL;
export const getWsBaseUrl = () => WS_BASE_URL;
```

**App.tsx에서 초기화:**
```typescript
useEffect(() => {
  initializeConfig();
}, []);
```

---

### Option 2: 같은 포트 사용 (단순)

**Backend와 Frontend를 동일 포트로:**
```bash
# Backend
PORT=3000 npm run dev

# Frontend  
VITE_API_BASE_URL=http://localhost:3000 npm run dev
```

**문제:**
- 포트 충돌 가능
- Dev server 관리 복잡

---

### Option 3: Reverse Proxy 패턴

**Frontend가 /api/* 요청을 Backend로 프록시:**
```typescript
// vite.config.ts
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
}
```

**Frontend에서:**
```typescript
const API_BASE_URL = '/api';  // Same origin
fetch(`${API_BASE_URL}/rooms`);  // → http://localhost:5173/api/rooms
                                  // → Proxied to http://localhost:3000/rooms
```

---

## 💡 에이전트가 해결 못하는 이유

### 1. **잘못된 문제 정의**

**에이전트가 이해한 것:**
```
"REST API가 없다"
→ REST Controller를 추가해야 한다
→ RoomsController, RoomsService 생성
```

**실제 문제:**
```
"REST API는 이미 있다"
→ Frontend가 잘못된 포트로 요청
→ 8080 → 3000으로 수정 필요
```

### 2. **Backend만 보고 Frontend 안 봄**

**에이전트의 Context:**
```
Project: ant-pong-be (Backend only)
Codebase: Backend 코드만
Directive: "이 문제를 계속 해결못하는 이유를 설명하고 해결해라"
```

**실제 필요한 Context:**
```
Frontend: ant-pong-fe의 API_BASE_URL
Backend: ant-pong-be의 실제 포트
→ 두 프로젝트 간 연동 문제!
```

### 3. **Cross-Project 문제 인식 불가**

```
ant-pong-be (Backend):
  ✅ API 코드 완성
  ✅ Port 3000에서 실행
  
ant-pong-fe (Frontend):
  ❌ Port 8080로 요청
  ❌ Backend와 연결 안 됨

문제:
  - 에이전트는 한 프로젝트만 봄
  - Cross-project 연동 이슈 파악 안 됨
```

### 4. **에러 메시지 해석 실패**

**에러:**
```
Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

**의미:**
- JSON 대신 HTML 받음
- 404 페이지 또는 다른 서버 응답
- → **잘못된 URL 또는 포트**

**에이전트 해석:**
```
"API가 JSON을 반환 안 함"
→ API 코드를 수정해야 한다
→ Controller를 추가해야 한다
```

**올바른 해석:**
```
"API endpoint에 도달 못함"
→ URL/포트가 틀림
→ Frontend 설정 수정 필요
```

---

## 📋 실제 해결 방법

### 즉각 해결 (수동)

```bash
# Terminal 1: Backend 실행 (Port 3000)
cd /Users/probe/dev/ant/workspaces/to.nexus/probe/ant-pong-be/codebase
PORT=3000 npm run dev

# Terminal 2: Frontend 실행 (Port 5173, Backend URL 수정)
cd /Users/probe/dev/ant/workspaces/to.nexus/probe/ant-pong-fe/codebase
VITE_API_BASE_URL=http://localhost:3000 npm run dev

# 또는 LobbyPage.tsx 직접 수정
# const API_BASE_URL = 'http://localhost:3000';
```

### 시스템 해결 (에이전트가 해야 할 것)

**필요한 수정:**
```typescript
// ant-pong-fe/codebase/src/routes/LobbyPage.tsx
// ❌ OLD
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

// ✅ NEW
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
```

**또는 동적 감지:**
```typescript
// src/config/api.ts
async function detectBackendUrl() {
  const ports = [3000, 8080, 4000];
  
  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}/rooms`, {
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        return `http://localhost:${port}`;
      }
    } catch {
      continue;
    }
  }
  
  return 'http://localhost:3000';  // Default
}
```

---

## 🎓 교훈

### 1. Cross-Project Issues

```
Single Project Context:
  - 에이전트는 한 프로젝트만 봄
  - Backend 또는 Frontend 중 하나
  
Cross-Project Issues:
  - Frontend ↔ Backend 연동
  - URL, 포트, Protocol 불일치
  - 에이전트가 파악 못함
```

### 2. Error Message Interpretation

```
"Unexpected token '<!DOCTYPE'"
  
❌ 잘못된 해석: "API가 JSON 안 반환"
✅ 올바른 해석: "API에 도달 못함 (404)"
```

### 3. Default Port Assumptions

```
Backend Default: 3000 (NestJS, Express 일반적)
Frontend Assumption: 8080 ❌

→ 기본값 불일치!
```

---

## ✅ 결론

### 실제 코드 문제

**Backend:**
- ✅ REST API 구현 완료
- ✅ CORS 설정 완료
- ✅ Port 3000에서 정상 실행

**Frontend:**
- ❌ API_BASE_URL = 8080 (잘못된 기본값)
- ❌ Backend Port = 3000
- ❌ 404 에러 → HTML 파싱 에러

### 에이전트가 해결 못하는 이유

1. **단일 프로젝트 Context**: ant-pong-be만 보고 ant-pong-fe 안 봄
2. **에러 해석 실패**: "JSON 파싱 에러"를 "API 코드 문제"로 오해
3. **Cross-Project 문제 미인식**: Frontend-Backend 연동 이슈 파악 안 됨
4. **Git Conflict 무한 루프**: 이미 완료된 작업을 계속 재시도

### 필요한 수정

**1줄 수정:**
```typescript
// ant-pong-fe/codebase/src/routes/LobbyPage.tsx Line 6
const API_BASE_URL = 'http://localhost:3000';  // 8080 → 3000
```

또는 **동적 감지 로직 추가** (사용자가 원한 방식)

---

**핵심**: **Backend 코드는 완벽하지만, Frontend가 잘못된 포트로 요청하는 단순한 설정 문제!**

