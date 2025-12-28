# Cloud IDE 관리 (Docker 기반)

## 개요

IDEService는 **유저별 독립된 code-server(VSCode) 컨테이너**를 Docker로 관리합니다.
각 사용자는 완전히 격리된 개발 환경을 가지며, 리소스 제한이 적용됩니다.

## ✅ 단계적 적용/검증 순서 (Side-effect 최소화)

IDE는 “컨테이너는 떴는데 iframe 첫 로딩이 실패(연결 재설정)” 같은 레이스가 생길 수 있으므로,
아래 순서대로 **하나씩만** 켜고 검증합니다.

### Step 0 (Baseline, 안정)
- **Workspace mount**: `/{projectId}` (✅ 고정: 항상 project mode)
- **Hostname**: `ant-ide` (기본)

### Step 1 (Hostname: `{org}-{user}-{project}`)
```bash
export ANT_IDE_HOSTNAME_MODE=org-user-project
```

### Step 2 (Hostname: `containerId` 12자리, best-effort)
```bash
export ANT_IDE_HOSTNAME_MODE=containerid
```

> 적용 팁: 각 step마다 IDE 컨테이너를 **stop → start(IDE 버튼 클릭)** 해서 새 컨테이너로 확인합니다.

## 유저별 독립 환경

### IDE 인스턴스 키
```typescript
// 키 형식: {tenantId}:{userId}:{projectId}
const key = `acme-corp:alice:todo-app`;

// 각 사용자-프로젝트 조합마다 독립된 컨테이너
// - acme-corp:alice:todo-app → Container 1
// - acme-corp:bob:blog → Container 2
// - startup-xyz:charlie:dashboard → Container 3
```

### 컨테이너 격리
```typescript
// Docker 컨테이너 생성
const container = await docker.createContainer({
  Image: 'codercom/code-server:latest',
  
  // ✅ 환경변수 격리 (각 컨테이너마다 독립)
  Env: [
    `USER_ID=${userContext.userId}`,
    `ORG_ID=${userContext.organizationId}`,
    `PROJECT_ID=${projectId}`,
    'PASSWORD=temp123'  // 컨테이너별 비밀번호
  ],
  
  // ✅ 워크스페이스 마운트 (컨테이너 내부로)
  HostConfig: {
    Binds: [`${workspacePath}:/home/coder/project`],
    // 예: /workspaces/acme-corp/alice/todo-app → /home/coder/project
    
    // ✅ 리소스 제한
    Memory: 2 * 1024 * 1024 * 1024,  // 2GB RAM
    NanoCpus: 2 * 1000000000,        // 2 CPU cores
  },
  
  WorkingDir: '/home/coder/project'
});
```

### 환경 격리 방식
- **프로세스 격리**: 각 컨테이너는 독립된 프로세스 공간
- **파일시스템 격리**: 컨테이너 내부 파일시스템 완전 분리
- **네트워크 격리**: 각 컨테이너는 독립된 네트워크 네임스페이스
- **환경변수 격리**: 컨테이너마다 독립된 환경변수
- **포트 격리**: PortManager가 호스트 포트 동적 할당

## Docker 마운트 생명주기

### 1. IDE 시작 (마운트)
```typescript
// POST /api/cloud-ide/start
await ideService.startIDE(userContext, projectId, workspacePath);

// 플로우:
// 1. PortManager에서 포트 할당 (예: 31001)
// 2. Docker 컨테이너 생성
//    - 워크스페이스 마운트: {workspacePath} → /home/coder/project
//    - 포트 바인딩: 호스트 31001 → 컨테이너 8080
// 3. 컨테이너 시작
// 4. IDEInstance 맵에 저장
```

**마운트 시점**: `container.start()` 호출 시 즉시 마운트

### 2. IDE 사용 중
```typescript
// 컨테이너 내부에서 작업
// - /home/coder/project/src/app.ts 편집
//   → 호스트의 /workspaces/.../codebase/src/app.ts에 실시간 반영
// - 터미널 명령 실행 (npm install, git commit 등)
// - 컨테이너 내부 환경변수 사용

// 마지막 접근 시간 업데이트
instance.lastAccessedAt = new Date();
```

### 3. IDE 중지 (언마운트)
```typescript
// POST /api/cloud-ide/stop
await ideService.stopIDE(tenantId, projectId);

// 플로우:
// 1. 컨테이너 중지: container.stop()
// 2. 컨테이너 삭제: container.remove()
//    → 마운트 자동 해제
// 3. PortManager에서 포트 해제
// 4. IDEInstance 맵에서 제거
```

**언마운트 시점**: `container.stop()` 또는 `container.remove()` 호출 시 자동 언마운트

### 4. 자동 종료 (유휴 시간 초과)
```typescript
// 백그라운드 체커가 1분마다 확인
private async checkIdleContainers() {
  const now = Date.now();
  
  for (const [key, instance] of this.instances.entries()) {
    const idleTime = now - instance.lastAccessedAt.getTime();
    
    // ✅ 30분 이상 미사용 시 자동 종료
    if (idleTime > 30 * 60 * 1000) {
      console.log(`💤 Stopping idle IDE: ${key}`);
      await this.stopIDE(instance.tenantId, instance.projectId);
      // → 마운트 자동 해제
    }
  }
}

// 자동 체커 시작
ideService.startIdleChecker();  // 서버 시작 시
```

## 리소스 사용 제한

### 현재 적용된 제한
```typescript
// IDEService.startIDE()
HostConfig: {
  // ✅ 메모리 제한
  Memory: 2 * 1024 * 1024 * 1024,  // 2GB
  // 초과 시: Docker가 OOM Killer로 컨테이너 종료
  
  // ✅ CPU 제한
  NanoCpus: 2 * 1000000000,        // 2 CPU cores
  // 초과 시: CPU 스로틀링 (느려지지만 종료 안 됨)
}
```

### 리소스 제한 효과

#### 메모리 (2GB)
```
사용량 < 2GB: 정상 작동
사용량 = 2GB: 새 할당 차단 (Out of Memory)
사용량 > 2GB: Docker가 컨테이너 강제 종료 (OOM Killed)
```

#### CPU (2 Cores)
```
사용량 < 2 Cores: 정상 속도
사용량 = 2 Cores: 최대 속도
사용량 > 2 Cores (요청): 스로틀링으로 제한 (2 Cores 이상 못 씀)
```

### 제한 없을 경우 문제점
```
❌ 제한 없으면:
- 사용자 A가 메모리 30GB 사용
- 사용자 B가 CPU 100% 독점
- 다른 사용자 영향: 서버 전체 느려짐 또는 다운
- 악의적 사용 가능 (DOS 공격)

✅ 제한 있으면:
- 사용자 A는 최대 2GB까지만 (초과 시 자기만 종료)
- 사용자 B는 최대 2 Cores까지만 (다른 사용자 영향 없음)
- 서버 전체 안정성 보장
- Fair usage 강제
```

## 하나의 머신에서 여러 컨테이너

### 리소스 계산
```typescript
// 시나리오: 8 Core, 32GB RAM 서버
const maxUsers = Math.floor(32 / 2);  // 메모리 기준: 16명
const maxUsersCPU = Math.floor(8 / 2); // CPU 기준: 4명

// 실제 제한: 4명 동시 사용 (CPU가 bottleneck)
```

### Docker의 리소스 공유
- **Over-commit 가능**: 16개 컨테이너를 띄워도 실제로 4개만 활발히 사용하면 문제없음
- **Idle 컨테이너**: 사용 안 하는 컨테이너는 최소 리소스만 차지
- **자동 종료**: 30분 미사용 시 자동 종료로 리소스 회수

### 실제 운영 예시
```
8 Core, 32GB 서버:
- 컨테이너 제한: 2GB RAM, 2 Cores 각각
- 동시 활성: 최대 4명 (full usage)
- 총 컨테이너: 10명 생성 가능 (일부는 idle)
- 자동 정리: 30분 idle → 종료 → 새 사용자 수용
```

## 파일 구조

```
packages/ant-cli/src/
  └── periphery/adapters/
      ├── ide/
      │   └── IDEService.ts              # IDE 컨테이너 관리
      │
      └── http/routes/
          ├── cloud-ide.routes.ts         # Cloud IDE API (Docker)
          └── ide.routes.ts               # Local IDE API (로컬 앱 실행)
```

## API 사용 예시

### IDE 시작
```bash
POST /api/cloud-ide/start
{
  "projectId": "todo-app",
  "userContext": {
    "userId": "alice",
    "organizationId": "acme-corp"
  }
}

# 응답:
{
  "success": true,
  "instance": {
    "url": "http://localhost:31001",
    "port": 31001,
    "status": "running"
  }
}
```

### IDE 접근
```bash
# 브라우저에서 접근
http://localhost:31001

# 또는 프록시 경로 (구현 예정)
http://localhost:3000/ide/acme-corp:alice:todo-app
```

### IDE 중지
```bash
POST /api/cloud-ide/stop
{
  "tenantId": "acme-corp:alice",
  "projectId": "todo-app"
}

# 응답:
{
  "success": true
}
```

### IDE 목록 조회
```bash
GET /api/cloud-ide/list

# 응답:
{
  "instances": [
    {
      "tenantId": "acme-corp:alice",
      "projectId": "todo-app",
      "port": 31001,
      "url": "http://localhost:31001",
      "status": "running",
      "createdAt": "2024-01-01T00:00:00Z",
      "lastAccessedAt": "2024-01-01T00:30:00Z"
    }
  ]
}
```

## 보안 및 격리 보장

### 1. 컨테이너 격리
- ✅ 각 사용자는 독립된 컨테이너
- ✅ 파일시스템 완전 분리 (컨테이너 내부)
- ✅ 프로세스 격리 (다른 컨테이너 프로세스 접근 불가)
- ✅ 네트워크 격리 (독립된 네트워크 네임스페이스)

### 2. 워크스페이스 마운트 격리
```typescript
// Alice의 컨테이너
Binds: ['/workspaces/acme-corp/alice/todo-app:/home/coder/project']
// → Alice는 자기 워크스페이스만 접근

// Bob의 컨테이너
Binds: ['/workspaces/acme-corp/bob/blog:/home/coder/project']
// → Bob은 자기 워크스페이스만 접근

// ✅ Alice는 Bob의 파일에 접근 불가 (마운트 안 됨)
```

### 3. 리소스 공정성
- ✅ CPU/메모리 제한으로 다른 사용자 방해 불가
- ✅ 한 사용자가 서버 전체를 독점할 수 없음
- ✅ Fair usage 보장

### 4. 자동 정리
- ✅ 30분 idle → 자동 종료 (리소스 회수)
- ✅ 서버 재시작 시 모든 컨테이너 정리
- ✅ 에러 발생 시 포트 자동 해제

## Local vs Cloud IDE

### Local IDE (로컬 앱 실행)
```typescript
// ide.routes.ts
router.post('/ide/open', async (req, res) => {
  // macOS: open -a "Cursor.app" {path}
  // Windows: start cursor {path}
  // Linux: cursor {path}
  
  // ✅ 로컬 머신의 IDE 앱 실행
  // ❌ 격리 없음 (로컬 환경 공유)
  // ❌ 리소스 제한 없음
});
```

### Cloud IDE (Docker 컨테이너)
```typescript
// IDEService
await ideService.startIDE(userContext, projectId, workspacePath);

// ✅ Docker 컨테이너로 격리
// ✅ 리소스 제한 (2GB RAM, 2 Cores)
// ✅ 브라우저 접근 (http://localhost:31001)
// ✅ 멀티 유저 지원
```

## 현재 상태 및 개선 사항

### ✅ 현재 작동
- Docker 기반 code-server 컨테이너
- 유저별 독립 환경
- 워크스페이스 마운트/언마운트
- 리소스 제한 (2GB RAM, 2 Cores)
- 자동 유휴 체크 및 종료 (30분)
- 포트 동적 할당

### ⏰ 미완료
- Express 프록시 통합 (`/ide/:serverKey`)
- 비밀번호 보안 (현재 temp123 고정)
- SSL/TLS 지원
- 사용자별 리소스 쿼터 설정

### 🔧 개선 가능
- 리소스 제한 커스터마이징 (조직별, 사용자별)
- Docker 이미지 최적화 (빌드 시간, 용량)
- 멀티 노드 지원 (Docker Swarm, Kubernetes)
- 지속적 스토리지 (컨테이너 재시작 시 설정 유지)

## 요약

| 항목 | 설명 |
|------|------|
| **격리 방식** | Docker 컨테이너 (완전 격리) |
| **마운트 시점** | IDE 시작 시 (`container.start()`) |
| **언마운트 시점** | IDE 중지 시 (`container.stop/remove()`) |
| **리소스 제한** | 2GB RAM, 2 CPU cores (컨테이너당) |
| **자동 종료** | 30분 미사용 시 |
| **동시 사용자** | 서버 리소스에 따라 (8 Core → 4명 권장) |
| **문제 없음?** | ✅ 리소스 제한으로 안전 보장 |

**핵심**: 각 사용자는 완전히 독립된 Docker 컨테이너에서 작업하며, 리소스 제한으로 서버 전체 안정성이 보장됩니다.

