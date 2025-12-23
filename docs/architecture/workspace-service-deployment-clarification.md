# Workspace Service 배포 구조 명확화

## 현재 구조 (Before)

```
/Users/probe/dev/ant/  (monorepo root)
├── packages/
│   ├── ant-cli/              ← Express Server + Orchestrator
│   │   ├── src/
│   │   │   ├── composition/
│   │   │   │   └── server.ts       (ExpressServerAdapter)
│   │   │   ├── infrastructure/
│   │   │   │   └── workspace/
│   │   │   │       ├── WorkspaceResolver.ts    (현재)
│   │   │   │       └── LocalWorkspaceResolver.ts (현재)
│   │   │   └── periphery/
│   │   │       └── adapters/
│   │   │           └── git/
│   │   │               └── SimpleGitAdapter.ts  (Git + 파일 I/O 혼재)
│   │   └── package.json
│   ├── ant-ui/               ← React Frontend
│   └── ant-ide/              ← IDE Extension
├── workspaces/               ← 사용자 데이터 (문제!)
│   ├── local/user/<project>/
│   └── to.nexus/<user>/<project>/
└── package.json
```

**현재 실행 방식:**
```bash
# 1. ant-cli 서버 실행 (Port 4100)
cd packages/ant-cli
npm run dev:server

# → Express 서버가 workspaces/ 디렉토리 직접 접근
# → Child process가 같은 머신에서 spawn
# → 사용자 코드가 시스템에 직접 영향
```

---

## 리팩토링 후 구조 (After)

### Option A: 단일 프로세스 (초기 구현 - 권장)

```
/Users/probe/dev/ant/  (monorepo root)
├── packages/
│   ├── ant-cli/              ← Control Plane
│   │   ├── src/
│   │   │   ├── composition/
│   │   │   │   └── server.ts       (ExpressServerAdapter - 기존)
│   │   │   ├── core/ports/
│   │   │   │   ├── git.ts           [수정] Git만
│   │   │   │   ├── filesystem.ts    [신규] 파일 I/O만
│   │   │   │   └── workspace.ts     [신규] WorkspaceServicePort
│   │   │   ├── infrastructure/
│   │   │   │   └── workspace/       [삭제 후 재구축]
│   │   │   │       ├── WorkspaceService.ts      [신규]
│   │   │   │       ├── LocalWorkspaceService.ts [신규]
│   │   │   │       └── S3WorkspaceService.ts    [신규]
│   │   │   └── periphery/adapters/
│   │   │       ├── filesystem/      [신규]
│   │   │       │   ├── LocalFileSystemAdapter.ts
│   │   │       │   └── S3FileSystemAdapter.ts
│   │   │       └── git/
│   │   │           └── PureGitAdapter.ts [수정] 파일 I/O 제거
│   │   └── package.json
│   ├── ant-ui/
│   └── ant-ide/
└── package.json

/mnt/workspaces/              ← 사용자 데이터 (분리됨!)
└── <org>/<user>/<project>/
```

**실행 방식:**
```bash
# 1. ant-cli 서버 실행 (같은 프로세스)
cd packages/ant-cli
ANT_WORKSPACE_STORAGE=local \
ANT_WORKSPACE_BASE_PATH=/mnt/workspaces \
npm run dev:server

# → WorkspaceService가 내부적으로 초기화됨
# → ExpressServerAdapter가 WorkspaceService 사용
# → 모든 파일 접근이 WorkspaceService를 통해서만 가능
```

**코드 예시:**
```typescript
// packages/ant-cli/src/composition/server.ts
import { ExpressServerAdapter } from '../periphery/adapters/http/ExpressServerAdapter';
import { LocalWorkspaceService } from '../infrastructure/workspace/LocalWorkspaceService';
import { S3WorkspaceService } from '../infrastructure/workspace/S3WorkspaceService';

async function main() {
  // ✅ Workspace Service 초기화 (같은 프로세스 내)
  const workspaceService = process.env.ANT_WORKSPACE_STORAGE === 's3'
    ? new S3WorkspaceService(
        process.env.ANT_WORKSPACE_S3_BUCKET!,
        '/tmp/workspace-cache'
      )
    : new LocalWorkspaceService(
        process.env.ANT_WORKSPACE_BASE_PATH || '/mnt/workspaces'
      );
  
  // Express 서버에 주입
  const server = new ExpressServerAdapter(
    workspaceService,  // ← 의존성 주입
    githubAuthService,
    // ...
  );
  
  await server.start(4100);
}
```

---

### Option B: 마이크로서비스 (미래 확장 - 옵션)

만약 나중에 트래픽이 많아지면 **별도 서비스로 분리** 가능:

```
┌─────────────────────────────────────┐
│ ant-cli (Control Plane)             │
│ packages/ant-cli/                   │
│ - Express Server (Port 4100)        │
│ - Job orchestration                 │
│ - UI serving                        │
└─────────────────────────────────────┘
              │ HTTP/gRPC
              ▼
┌─────────────────────────────────────┐
│ workspace-service (별도 레포/서비스) │   ← 이것이 별도 레포로 분리된 경우
│ - WorkspaceServicePort 구현         │
│ - FileSystemPort 구현               │
│ - API: /workspace/create            │
│ - API: /workspace/files/{path}      │
└─────────────────────────────────────┘
              │
              ▼
        S3 / NFS / Local FS
```

**실행 방식 (마이크로서비스):**
```bash
# Terminal 1: Workspace Service 실행 (별도 서비스)
cd workspace-service/  # 별도 레포
npm start              # Port 5000

# Terminal 2: ant-cli 실행
cd ant/packages/ant-cli
ANT_WORKSPACE_SERVICE_URL=http://localhost:5000 \
npm run dev:server     # Port 4100
```

**하지만 초기에는 이렇게 하지 않습니다!** 너무 복잡합니다.

---

## 결론: 우리가 하려는 것

### 단계별 진화

#### Phase 1: 단일 프로세스 내 리팩토링 (지금 할 일)
```
ant-cli 내부에 WorkspaceService 구현
  ↓
파일 구조만 정리 (ant 소스 내)
  ↓
workspaces/를 /mnt/workspaces/로 이동
  ↓
여전히 ant-cli 하나만 실행하면 됨
```

**변경 사항:**
- ✅ 코드 구조 개선 (GitPort 분리, FileSystemPort 추가)
- ✅ 물리적 경로 분리 (workspaces → /mnt/workspaces)
- ✅ Storage 추상화 (S3 지원 준비)
- ❌ 배포 구조는 동일 (ant-cli 하나만 실행)

#### Phase 2: 별도 서비스 분리 (미래 - 필요시)
```
트래픽 증가 시 → workspace-service를 별도 레포/서비스로 분리
```

---

## 비유로 설명

### 현재 (Before)
```
식당 (ant-cli)
  └─ 주방장이 요리도 하고, 설거지도 하고, 청소도 함 (GitPort)
  └─ 손님 음식도 주방 안에 보관 (workspaces/ in repo)
```

### 리팩토링 후 (After - Phase 1)
```
식당 (ant-cli)
  ├─ 요리 담당 (GitPort)
  ├─ 설거지 담당 (FileSystemPort)  ← 역할 분리
  └─ 창고 관리 (WorkspaceService)
  
창고는 건물 밖으로 이사 (/mnt/workspaces)  ← 물리적 분리
하지만 여전히 같은 회사 (ant-cli 내부)   ← 단일 프로세스
```

### 미래 확장 (Option - Phase 2)
```
식당 본점 (ant-cli)
  │
  └─ 전문 물류 회사 계약 (workspace-service, 별도 서비스)
      └─ 여러 체인점 지원 가능 (독립 스케일링)
```

---

## 실제 파일 위치 정리

### Before
```
/Users/probe/dev/ant/
├── packages/ant-cli/          (소스 코드)
└── workspaces/                (사용자 데이터) ← 같은 디렉토리!
```

### After (Phase 1)
```
/Users/probe/dev/ant/
└── packages/ant-cli/          (소스 코드만)
    ├── infrastructure/workspace/
    │   ├── WorkspaceService.ts      (신규 - 추상화 레이어)
    │   ├── LocalWorkspaceService.ts (신규 - 구현)
    │   └── S3WorkspaceService.ts    (신규 - 구현)
    └── periphery/adapters/filesystem/
        ├── LocalFileSystemAdapter.ts (신규)
        └── S3FileSystemAdapter.ts    (신규)

/mnt/workspaces/               (사용자 데이터) ← 완전히 분리!
└── <org>/<user>/<project>/
```

**핵심:**
- WorkspaceService 코드는 `packages/ant-cli/src/` 안에 있음
- 사용자 데이터만 `/mnt/workspaces/`로 이동
- 여전히 `ant-cli` 하나만 실행하면 모든 기능 동작
- 별도 서비스 아님!

---

## 코드 사용 예시

```typescript
// packages/ant-cli/src/composition/orchestrator.ts

async function orchestrator(params: ExecuteJobParams) {
  // 1. Workspace handle 획득
  const handle = await workspaceService.createWorkspace(
    params.tenantId,
    params.projectId
  );
  // handle = { 
  //   tenantId: 'org1', 
  //   projectId: 'proj1',
  //   storagePath: '/mnt/workspaces/org1/proj1' 
  // }
  
  // 2. FileSystemPort 획득 (workspace별 격리)
  const fileSystem = workspaceService.getFileSystem(handle);
  // fileSystem은 /mnt/workspaces/org1/proj1/ 안에서만 작동
  
  // 3. GitPort 획득 (codebase용)
  const git = new PureGitAdapter(
    path.join(handle.storagePath, 'codebase')
  );
  
  // 4. Agent 실행
  await architectAgent(input, project, jobType, inputFile, {
    fileSystem,  // 파일 읽기/쓰기
    git,         // Git 작업
    // ...
  });
}
```

**모든 코드가 ant-cli 안에 있습니다!**

