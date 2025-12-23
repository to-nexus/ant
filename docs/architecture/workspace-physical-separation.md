# 워크스페이스 물리적 격리 - 리팩토링 핵심

## 🎯 리팩토링 목표 (원래 요청)

> "프로젝트 소스와 물리적 구분을 해야하는 상황이다"

### Before (현재 문제)
```
/Users/probe/dev/ant/                    ← ant 소스 코드
├── packages/
│   ├── ant-cli/                         ← ant-cli 소스
│   ├── ant-ui/                          ← ant-ui 소스
│   └── ant-ide/                         ← ant-ide 소스
│
└── workspaces/                          ❌ 사용자 워크스페이스가 소스 안에!
    ├── local/user/my-app/
    └── acme-corp/alice/project-x/
```

**문제점:**
1. **보안**: 사용자 코드가 ant 소스와 같은 디렉토리 트리
2. **확장성**: ant 소스가 있는 디스크 용량 제약
3. **관리**: 백업/마이그레이션 시 소스와 데이터 섞임
4. **배포**: ant 업데이트 시 사용자 데이터 영향

---

## ✅ After (리팩토링 후)

### 1. 완전한 물리적 분리

```bash
# ant 소스 (코드 저장소)
/Users/probe/dev/ant/
├── packages/ant-cli/
├── packages/ant-ui/
└── packages/ant-ide/

# 사용자 워크스페이스 (완전히 별도 위치!) ⭐
/mnt/ant-workspaces/                     ← ANT_WORKSPACE_BASE_PATH
├── local/user/my-app/
└── acme-corp/alice/project-x/
```

또는 더 나아가서:

```bash
# 프로덕션 환경 - 별도 머신으로도 분리 가능
머신 A (ant-cli 서버):
  /opt/ant/packages/ant-cli/

머신 B (워크스페이스 스토리지):
  /data/workspaces/                      ← NFS/S3/EBS 마운트
  ├── acme-corp/alice/project-x/
  └── techco/bob/project-y/
```

---

## 🔧 구현 방법

### 환경변수로 물리적 위치 제어

```bash
# .env 설정
ANT_WORKSPACE_BASE_PATH=/mnt/ant-workspaces     # ⭐ 완전히 다른 위치!

# 또는
ANT_WORKSPACE_BASE_PATH=/data/user-workspaces   # ⭐ 별도 디스크
```

### LocalWorkspaceService가 이미 지원

```typescript
// packages/ant-cli/src/infrastructure/workspace/LocalWorkspaceService.ts

export class LocalWorkspaceService implements WorkspaceServicePort {
  private readonly basePath: string;
  
  constructor(basePath: string) {
    // ⭐ basePath는 ant 소스와 완전히 독립적!
    this.basePath = path.resolve(basePath);
    // 예: /mnt/ant-workspaces
  }
  
  async createWorkspace(tenantId: string, projectId: string) {
    const workspacePath = path.join(this.basePath, tenantId, projectId);
    // → /mnt/ant-workspaces/acme-corp/alice/my-app  ⭐
    
    await fs.promises.mkdir(workspacePath, { recursive: true });
    return { storagePath: workspacePath, ... };
  }
}
```

### server.ts에서 초기화 (통합 필요)

```typescript
// packages/ant-cli/src/composition/server.ts

// ⭐ 환경변수로 워크스페이스 위치 결정
const workspaceBasePath = process.env.ANT_WORKSPACE_BASE_PATH 
  || '/mnt/ant-workspaces';  // 프로덕션 기본값

const workspaceService = new LocalWorkspaceService(workspaceBasePath);

console.log(`[Server] Workspace storage: ${workspaceBasePath}`);
console.log(`[Server] Ant source: ${process.cwd()}`);
console.log(`[Server] ✅ Physical separation enabled!`);
```

---

## 📊 시뮬레이션 (올바른 버전)

### 환경 설정 (프로덕션)

```bash
# ant-cli 환경변수
ANT_WORKSPACE_BASE_PATH=/mnt/ant-workspaces    ⭐
ANT_SERVER_MODE=cloud
ANT_CLI_PORT=4100
```

### 1️⃣ 프로젝트 생성

```
POST /api/projects { id: "my-app" }
↓
WorkspaceService.createWorkspace('acme-corp:alice', 'my-app')
↓
/mnt/ant-workspaces/acme-corp/alice/my-app/  ⭐ 생성
  ├── config.json
  ├── codebase/
  └── features/
```

**저장 위치**: `/mnt/ant-workspaces/` (ant 소스와 완전 분리!)

### 2️⃣ 작업 실행

```typescript
// Child process 실행 위치
cwd: /Users/probe/dev/ant/packages/ant-cli/    ← ant 소스

// 파일 작업 위치
FileSystemPort.writeFile('src/app.ts', code)
  ↓
/mnt/ant-workspaces/acme-corp/alice/my-app/codebase/src/app.ts  ⭐ Write
```

**파일 저장**: `/mnt/ant-workspaces/` (완전히 분리된 스토리지!)

### 3️⃣ Git 작업

```typescript
// Git 저장소 위치
GitPort 초기화:
  codebasePath = /mnt/ant-workspaces/acme-corp/alice/my-app/codebase/
  
GitPort.commit('feat: add login')
  ↓
/mnt/ant-workspaces/acme-corp/alice/my-app/codebase/.git/  ⭐ Git 작업
```

---

## 🎯 물리적 격리의 핵심

### 1. 디렉토리 격리

```
Before:
/dev/ant/workspaces/          ❌ 소스 트리 내부

After:
/mnt/ant-workspaces/          ✅ 완전히 별도 위치
```

### 2. 파일시스템 격리

```
Before:
동일한 파일시스템 (루트 파티션)

After:
- ant 소스: SSD (/dev/sda1)
- 워크스페이스: HDD 또는 NFS (/dev/sdb1 또는 nfs-mount)  ✅
```

### 3. 머신 격리 (선택사항, 추상화 완료)

```
현재 (Local):
LocalWorkspaceService → /mnt/ant-workspaces/

미래 (Cloud):
S3WorkspaceService → s3://ant-workspaces-prod/     ✅
NFSWorkspaceService → nfs://storage.internal/      ✅
```

---

## 🔒 보안 및 격리 장점

### 1. Path Traversal 방어

```typescript
// LocalWorkspaceService가 자동 검증
async createWorkspace(tenantId, projectId) {
  this.validateIdentifier(tenantId, 'tenantId');   // ✅ '../', '/' 차단
  this.validateIdentifier(projectId, 'projectId'); // ✅ 특수문자 차단
  
  // 항상 basePath 내부로 제한
  const workspacePath = path.join(this.basePath, tenantId, projectId);
  // ✅ /mnt/ant-workspaces/ 밖으로 절대 벗어날 수 없음
}
```

### 2. 테넌트 격리

```typescript
// FileSystemPort는 테넌트별 격리된 인스턴스
const handle = await workspaceService.createWorkspace('acme-corp:alice', 'my-app');
const fs = workspaceService.getFileSystem(handle);

// ✅ 이 fs는 /mnt/ant-workspaces/acme-corp/alice/my-app/ 내부만 접근 가능
// ✅ 다른 테넌트 디렉토리 접근 불가
await fs.writeFile('../../other-user/secret.txt', 'hack');  // ❌ 차단됨
```

### 3. 디스크 쿼터 (향후)

```typescript
// 테넌트별 디스크 사용량 제한
const info = await workspaceService.getWorkspaceInfo(handle);
if (info.sizeBytes > TENANT_QUOTA) {
  throw new Error('Disk quota exceeded');  // ✅
}
```

---

## 📝 리팩토링 체크리스트

### ✅ 완료된 작업

1. **FileSystemPort 분리**: Git과 파일 I/O 책임 분리
2. **WorkspaceServicePort 정의**: 테넌트 격리 인터페이스
3. **LocalWorkspaceService 구현**: 로컬 파일시스템 격리
4. **LocalFileSystemAdapter 구현**: Path traversal 방어
5. **PureGitAdapter 구현**: Git 작업만 담당
6. **Agent 상태 업데이트**: fileSystem과 git 분리 주입

### 🔄 남은 작업

1. **orchestrator.ts 통합**: WorkspaceService 사용하도록 수정
2. **server.ts 통합**: WorkspaceService 초기화 및 주입
3. **ExpressServerAdapter 통합**: 라우트에서 WorkspaceService 사용
4. **레거시 제거**: SimpleGitAdapter, WorkspaceResolver 삭제

---

## 🚀 배포 시나리오

### 개발 환경

```bash
# ant 소스와 같은 머신이지만 별도 디렉토리
ANT_WORKSPACE_BASE_PATH=/Users/probe/ant-workspaces
```

### 프로덕션 환경

```bash
# 별도 마운트된 대용량 스토리지
ANT_WORKSPACE_BASE_PATH=/data/workspaces        # EBS 볼륨
# 또는
ANT_WORKSPACE_BASE_PATH=/mnt/nfs/workspaces    # NFS 마운트
```

### 클라우드 환경 (향후)

```typescript
// S3WorkspaceService (미래 구현)
const workspaceService = new S3WorkspaceService({
  bucket: 'ant-workspaces-prod',
  region: 'us-east-1'
});

// ✅ 완전한 머신 분리!
// ant-cli: EC2 인스턴스
// 워크스페이스: S3 버킷
```

---

## 💡 핵심 정리

### 리팩토링의 진짜 목표

1. **물리적 분리**: ant 소스 ≠ 사용자 워크스페이스 (다른 디렉토리/디스크/머신)
2. **추상화**: 인터페이스 기반으로 스토리지 교체 가능 (Local → S3 → NFS)
3. **보안**: Path traversal 방어, 테넌트 격리
4. **확장성**: 워크스페이스 스토리지를 독립적으로 스케일

### 왜 혼란스러웠나?

기본값이 여전히 `process.cwd() + '/workspaces'`라서 ant 소스 내부처럼 보였지만,
**실제로는 환경변수로 완전히 다른 위치에 저장 가능**합니다!

```typescript
// ⭐ 이게 핵심!
process.env.ANT_WORKSPACE_BASE_PATH = '/mnt/ant-workspaces';

// 이제 모든 워크스페이스는:
// /mnt/ant-workspaces/...  ← ant 소스와 완전 분리!
```

