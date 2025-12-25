# 개발서버 관리

## 구조

### 서버 키 형식
```
{tenantId}:{userId}:{projectId}:{feature}
acme-corp:alice:todo-app:feature-login
```

### 실행 경로
```
/workspaces/acme-corp/alice/todo-app/features/feature-login/
```

## 구현 상태

### 1. PortManager (동적 포트 할당)
```typescript
// 30000-35000 범위에서 사용 가능한 포트 자동 할당
const port = await portManager.allocate();  // → 30001
```

### 2. PortRegistry (포트 매핑 저장)

**InMemoryPortRegistry** (현재 사용 중)
- 메모리 기반 Map
- 단일 서버용
- Redis 없이 바로 사용 가능

**RedisPortRegistry** (프로덕션용, 준비 완료)
- Redis 기반 영구 저장
- 멀티 서버 지원
- 환경변수로 전환

### 3. DevServerService (개발서버 관리)

```typescript
// 개발서버 시작
await devServerService.startDevServer(
  'acme-corp',          // tenantId
  'alice',              // userId
  'todo-app',           // projectId
  'feature-login',      // feature
  port                  // Optional
);

// 결과:
// - Port: 30001 (동적 할당)
// - URL: /dev/acme-corp:alice:todo-app:feature-login
// - 실행 위치: /workspaces/.../features/feature-login
```

## 프록시 아키텍처

### 로컬 개발 (Express)
```
브라우저
  ↓
http://localhost:3000/dev/acme-corp:alice:todo-app:feature-login
  ↓ Express 미들웨어
http://localhost:30001 (실제 개발서버)
```

**DevServerProxyMiddleware**가 `/dev/:serverKey` 요청을:
1. serverKey 파싱
2. PortRegistry에서 포트 조회
3. http-proxy-middleware로 프록시

### 프로덕션 (Nginx)
```
브라우저
  ↓
https://your-domain.com/dev/acme-corp:alice:todo-app:feature-login
  ↓ Nginx
http://localhost:30001 (내부)
```

## 주요 기능

### 1. 피처별 독립 실행
```typescript
// Alice가 2개 피처 동시 작업
await devServerService.startDevServer('acme-corp', 'alice', 'todo-app', 'feature-login');
// → Port 30001, /dev/acme-corp:alice:todo-app:feature-login

await devServerService.startDevServer('acme-corp', 'alice', 'todo-app', 'feature-payment');
// → Port 30002, /dev/acme-corp:alice:todo-app:feature-payment
```

### 2. 자동 의존성 설치
- `node_modules` 없으면 자동 `npm install`
- `.install-complete` 마커 파일로 중복 방지
- 설치 중 다른 요청 차단 (race condition 방지)

### 3. 프레임워크 자동 감지
- Vite: `npx vite --port {port}`
- Next.js: `npx next dev -p {port}`
- Backend (tsx): `npm run dev` + PORT 환경변수

### 4. HMR 지원
- WebSocket 프록시 지원
- Vite, Next.js 등의 hot reload 정상 작동

## 파일 구조

```
packages/ant-cli/src/
  ├── core/ports/
  │   └── portRegistry.ts                      # PortRegistryPort 인터페이스
  │
  ├── infrastructure/networking/
  │   ├── PortManager.ts                        # 동적 포트 할당
  │   ├── InMemoryPortRegistry.ts               # 메모리 기반 (현재 사용)
  │   └── PortRegistry.ts                       # Redis 기반 (준비 완료)
  │
  └── periphery/adapters/http/
      ├── services/
      │   └── DevServerService.ts               # 개발서버 관리
      │
      └── middleware/
          └── devServerProxy.ts                 # Express 프록시 미들웨어
```

## 환경 설정

```bash
# .env
ANT_WORKSPACE_BASE_PATH=/workspaces
ANT_CLI_PORT=3000                # ant-cli API 서버
USE_REDIS=false                  # true면 RedisPortRegistry 사용
REDIS_URL=redis://localhost:6379
```

## API 사용 예시

### 개발서버 시작
```bash
POST /api/dev-server/start
{
  "tenantId": "acme-corp",
  "userId": "alice",
  "projectId": "todo-app",
  "feature": "feature-login"
}

# 응답:
{
  "success": true,
  "port": 30001,
  "serverKey": "acme-corp:alice:todo-app:feature-login",
  "url": "/dev/acme-corp:alice:todo-app:feature-login"
}
```

### 개발서버 접근
```bash
# 로컬
curl http://localhost:3000/dev/acme-corp:alice:todo-app:feature-login

# 프로덕션
curl https://your-domain.com/dev/acme-corp:alice:todo-app:feature-login
```

### 개발서버 중지
```bash
POST /api/dev-server/stop
{
  "tenantId": "acme-corp",
  "userId": "alice",
  "projectId": "todo-app",
  "feature": "feature-login"
}
```

## 다음 단계 (미완료)

### 1. ExpressServerAdapter 통합
- DevServerProxyMiddleware 등록
- PortRegistry, DevServerService 초기화

### 2. API 라우트 구현
- `/api/dev-server/start`
- `/api/dev-server/stop`
- `/api/dev-server/status`

### 3. ant-ui 통합
- 개발서버 시작/중지 UI
- Preview 패널 (iframe)
- 새 탭 열기 기능

## 요약

| 항목 | 상태 | 설명 |
|------|------|------|
| **PortManager** | ✅ 완료 | 30000-35000 범위 동적 할당 |
| **InMemoryPortRegistry** | ✅ 완료 | 로컬 개발용 (현재 사용) |
| **RedisPortRegistry** | ✅ 준비 | 프로덕션용 (환경변수 전환) |
| **DevServerService** | ✅ 완료 | 피처별 개발서버 관리 |
| **DevServerProxyMiddleware** | ✅ 완료 | Express 프록시 |
| **ExpressServerAdapter 통합** | ⏰ 미완료 | 미들웨어 등록 필요 |
| **API 라우트** | ⏰ 미완료 | 엔드포인트 구현 필요 |
| **ant-ui** | ⏰ 미완료 | UI 구현 필요 |

**핵심**: 각 피처마다 독립된 개발서버를 실행하고, 프록시를 통해 통일된 URL로 접근 가능.

