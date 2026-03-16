# Preview System

## 개요

Preview 시스템은 생성된 코드의 실시간 미리보기를 제공한다. 피처별로 독립된 Dev Server를 실행하고, 통합 프록시를 통해 브라우저에서 접근한다. Redis 기반 상태 관리로 Multi-Pod 환경을 지원한다.

## 키 구조

| 형식 | 용도 | 예시 |
|------|------|------|
| Internal Key (Redis) | 내부 상태 관리 | `org:user:project:feature` |
| URL Key (HTTP) | URL path segment | `org--user--project--feature` |

URL Key는 콜론 대신 더블대시(`--`)를 사용한다. `toUrlKey()` / `fromUrlKey()` 함수로 변환한다.

Multi-package 서비스 연결 시 URL Key에 5번째 세그먼트(serviceName)가 추가될 수 있다: `org--user--project--feature--serviceName`. `fromUrlKey()`는 항상 앞 4개만 internal key로 변환하며, `parseUrlKey()`가 5번째 세그먼트를 별도로 추출한다.

## Redis 키 분리

Preview 상태는 두 개의 독립된 Redis 키에 저장된다:

| Redis 키 | 용도 | 수명 | 포함 데이터 |
|----------|------|------|------------|
| `PREVIEW` (`ant:infra:preview:{portKey}`) | 런타임 상태 | Preview 실행 중에만 존재. `stopPreview` 시 삭제 | running, phase, port, host, podId, packages, connections (w/ status), issues |
| `PREVIEW_CONFIG` (`ant:infra:preview-config:{portKey}`) | 영속 설정 | Preview 중지 후에도 유지 (TTL) | connections (status 없음), structureType, projectProfile |

설계 원칙:
- `PREVIEW`: 런타임 전용. connection의 `status` (active/unreachable/not-started)는 여기에만 저장.
- `PREVIEW_CONFIG`: 사용자 설정 전용. connection의 resolution, envVar 등 설정 정보만 저장. **런타임 status를 저장하지 않는다.**
- 프론트엔드는 두 소스를 merge: `config.connections`를 base로, `previewStatus.connections`의 status를 overlay.

## 호스트 분리

Preview는 별도 호스트(`ant-preview.crosstoken.io`)를 사용한다. 프레임워크가 네이티브 base path를 사용하더라도 일부 리소스(`<img src="/logo.svg">` 등)는 base path 없이 요청된다. 별도 호스트를 사용하면 호스트 기반 라우팅으로 이러한 요청도 ant-preview에 도달한다.

## 프록시 전략

모든 프레임워크가 네이티브 base path를 사용한다. 프록시는 단일 경로로 동작한다.

### Main 경로

1. URL에서 urlKey 파싱 -> `fromUrlKey()` -> internal key
2. Redis에서 `{ host, port }` 조회
3. 경로 prefix 유지하여 Dev Server로 프록시
4. Fullstack: `/api/*` -> backend port 분기
5. Multi-package serviceName: urlKey의 5번째 세그먼트로 특정 패키지 port 라우팅
6. 응답 body를 stream pipe (변환/재작성 없음)
7. preview cookie 설정 (`Path=/{urlKey}`)

### Fallback 경로

urlKey가 없는 요청 (리소스 누출):
1. Referer 헤더에서 urlKey 추출
2. 실패 시: `__ant_preview_sk` 쿠키에서 추출
3. `/{urlKey}` prepend 후 프록시

## Base Path 설정

| 프레임워크 | 환경변수 | 설정 위치 |
|-----------|---------|----------|
| Vite (React/Vue) | `VITE_BASE_PATH` | `vite.config.ts` -> `base` |
| Next.js | `NEXT_PUBLIC_BASE_PATH` | `next.config.js` -> `basePath` |

`ProcessSpawner`가 Dev Server 프로세스 생성 시 환경변수를 자동 주입한다.

## 프로젝트 설정 검증 (Validator)

Preview 시작 시 프록시 환경 설정을 검증한다.

| Validator | 검증 항목 |
|-----------|----------|
| ReactValidator | vite.config base + React Router basename |
| VueValidator | vite.config base + Vue Router base |
| NextValidator | next.config basePath + 환경변수 참조 |

검증 실패 시: 서버 중단 -> Redis에 issues 기록 -> SSE로 UI에 브로드캐스트 -> UI에 Fix 버튼 표시 -> Fix 클릭 시 suggestedFix를 채팅에 자동 입력.

## 코드 생성 가이드 (예방)

프롬프트 템플릿이 AI의 올바른 설정을 유도한다:
- `preview-setup.md`: 프레임워크별 base path 설정 원칙
- `preview-env-contract.md`: 플랫폼 런타임 계약 (환경변수, 포트 바인딩)

## 생명주기

### 상태 전이

```
idle -> installing -> starting -> running -> stopped
                        |           |
                        v           v
                      error <----- error
```

### 시작 흐름

1. POST /preview/projects/:id/start
2. 분산 락 획득 (Redis SET NX, TTL 120s)
3. Stale registry 정리 (이전 실행 잔재가 있으면 Docker infra 포함 정리)
4. Orphan 프로세스 kill
5. Redis에 초기 상태 등록 (phase: installing)
6. 프로젝트 구조 감지
7. npm install
8. Docker infrastructure 시작 (docker compose up)
9. Connection 상태 enrichment (docker running → status: active)
10. Dev Server 기동 (`npm run dev --host 0.0.0.0`)
11. Redis에 최종 상태 등록 (running, connections, packages)
12. Validator 검증
13. Health Check (최대 60초)

### 중지 흐름

1. POST /preview/projects/:id/stop
2. stoppingServers에 등록 (프로세스 exit를 "expected"로 분류하기 위함)
3. Docker infrastructure 중지 (docker compose down -v)
4. App 프로세스 kill (SIGTERM → wait for exit → SIGKILL fallback)
5. **포트 기반 kill** (`lsof -i :port -t` → kill) — shell:true로 spawn하면 `sh → make → go binary` 트리가 생기므로, shell만 죽여서는 실제 바이너리가 포트를 계속 점유함. 각 패키지 포트에 바인딩된 프로세스를 직접 kill하여 OS 레벨 포트 해제 보장.
6. Redis에서 connections 읽기 + 모든 패키지 포트 해제 (PortManager)
7. Redis PREVIEW 키 삭제 (unregisterPreview)
8. 로컬 상태 정리 (previewServers, previewServerPaths)
9. SSE broadcast (connections를 not-started로 리셋하여 포함)

### 프로세스 크래시 흐름 (cleanupIfAllDead)

모든 프로세스가 예기치 않게 종료된 경우:
1. Health check abort
2. Docker infrastructure 중지
3. 포트 해제
4. Redis에서 connections를 not-started로 리셋 후 updatePreview
5. updatePhase(error) → Redis에서 full state 읽어 SSE broadcast (connections 포함)

### Graceful Shutdown (SIGTERM)

Pod 종료 시 `PreviewServer.stop()` → `PreviewService.cleanup()` → 모든 실행 중인 preview에 대해 `stopPreview()` 호출.

### EFS 파일 감시

EFS(NFS)에서는 `inotify`가 작동하지 않는다. `ProcessSpawner`가 Dev Server 프로세스에 `CHOKIDAR_USEPOLLING=true`, `WATCHPACK_POLLING=true`를 자동 주입하여 해결한다.

## Fullstack 지원

```
/{urlKey}/        -> Frontend (entry port)
/{urlKey}/page    -> Frontend
/{urlKey}/api/*   -> Backend (backend port)
```

## Docker Infrastructure

`InfrastructureManager`가 프로젝트의 docker-compose.yml을 감지하고 관리한다.

### 프로젝트 격리

Docker Compose 프로젝트 이름: `ant-{projectId}-{feature}`. 서로 다른 preview 인스턴스의 컨테이너가 충돌하지 않는다.

### 시작 (startInfrastructure)

1. docker-compose.yml 탐색 (yml, yaml, compose.yml, compose.yaml)
2. Docker 가용성 확인 (docker info)
3. Pre-cleanup: `docker compose down -v --remove-orphans` (이전 실행 잔재 제거, best-effort)
4. `docker compose up -d --wait --quiet-pull --force-recreate --remove-orphans`
5. 타임아웃: 60초. 실패해도 앱 프로세스 시작은 계속 진행 (best-effort)

### 중지 (stopInfrastructure)

1. `docker compose down -v` (컨테이너 + 볼륨 모두 제거)
2. 타임아웃: 30초. best-effort.

### 상태 조회 (getInfraStatus)

`docker compose ps --format json` → 서비스별 running/stopped/unhealthy 상태 반환.

### 볼륨 전략

`-v` 플래그로 매번 볼륨을 삭제한다. 개발 환경용이므로 데이터 영속성보다 깨끗한 시작을 우선한다.

## Service Connections

Preview Config UI의 "Service Connections" 섹션은 프로젝트의 모든 외부 서비스 의존성을 관리한다.

### 감지 메커니즘

`ConnectionDetector`가 `.env.example`의 `@connection` 어노테이션을 파싱한다:

```env
# @connection {category} {name}                              -- 외부 서비스
# @connection {category} {name} self                         -- 동일 프로젝트 내부 연결
# @connection {category} {name} ant-project:{pid}:{feat}     -- 크로스 프로젝트
# @connection {category} {name} ant-project:{pid}:{feat}:{svc} -- 크로스 프로젝트 특정 서비스
```

- `self` 키워드: 같은 프로젝트의 다른 패키지를 참조 (fullstack FE→BE, 모노레포 내부). 프록시 경로가 자동 계산됨.
- `enrichWithCompose()`: docker-compose.yml에서 infrastructure connection의 resolution을 `docker`로 업그레이드.

### Connection Status 라이프사이클

Status 값: `active` | `unreachable` | `not-started` | undefined

| 시점 | 동작 | 저장 위치 |
|------|------|----------|
| ConnectionDetector.detect() | status 없이 생성 | - |
| startPreview (infraStatus enrichment) | docker running → active | PREVIEW (런타임) |
| detect-connections API | docker status로 enrichment, 응답에만 포함 | PREVIEW (런타임). PREVIEW_CONFIG에는 status 제외 |
| stopPreview | 모든 connections → not-started | SSE broadcast |
| cleanupIfAllDead | 모든 connections → not-started | PREVIEW (Redis update) → SSE broadcast |

프론트엔드 merge 규칙 (PreviewConfigEditor):
```
base = config.connections (PREVIEW_CONFIG, status 없음)
live = previewStatus.connections (PREVIEW/SSE, status 있음)
display = live가 있으면 base에 live.status overlay, 없으면 base 그대로
```

### Resolution 타입 제약

| 카테고리 | 허용 resolution | 예시 |
|---------|----------------|------|
| `infrastructure` | `url`, `docker` | DB, Redis, MQ |
| `business` | `url`, `ant-project` | API, MSA 서비스 |

### 패키지별 스코핑

연결은 `source` 필드로 패키지에 소속된다. 모노레포에서 각 패키지는 자체 `.env.example`을 가진다.

- Dedup 키: `${source}:${envVar}` (동일 envVar이 다른 패키지에서 공존 가능)
- Env 주입: `ProcessSpawner`가 spawn 시 해당 패키지의 `source`에 맞는 connections만 필터링하여 주입
- Config UI: 패키지별 그룹핑, 카테고리 뱃지(business/infrastructure), resolution 뱃지(url/docker/ant-project) 표시

### 감지 타이밍

- **자동 감지**: Config Panel 최초 열 때 레지스트리가 비어있으면 1회 실행 후 Redis에 캐싱
- **수동 재감지**: "Auto Detect" 버튼 → POST /detect-connections → 파일시스템 재스캔, 레지스트리 전체 교체
- **Preview Start**: Redis 레지스트리에서만 읽기 (감지 실행 안 함)

### Cross-Project / Internal 연결

- **Cross-Project**: `ant-project` resolution에 다른 프로젝트의 projectId/feature 지정 → 프록시 경로 자동 계산
- **Same-Project (self)**: `ant-project` resolution에 자기 자신의 projectId/feature 지정 → 내부 프록시 경로 자동 계산. `.env.example`에서 `@connection business backend-api self`로 선언.
- **Multi-package serviceName**: `ant-project` resolution에 serviceName을 추가로 지정하면 대상 프로젝트의 특정 패키지(서비스)로 라우팅. URL Key에 5번째 세그먼트로 인코딩됨.

## Multi-Pod (K8s)

### 기본 원칙

모든 상태는 Redis에만 존재한다 (Single Source of Truth). Dev Server는 `0.0.0.0`에서 listen하여 다른 Pod에서도 접근 가능하다. 어떤 Pod가 요청을 받아도 Redis에서 실제 Dev Server Pod IP를 조회하여 프록시한다. Sticky Session 불필요.

### 분산 락

Preview start는 Redis 분산 락(SET NX, TTL 120s)으로 보호된다. ALB 라운드 로빈으로 동일 preview의 start 요청이 여러 Pod에 도달해도 하나만 실행된다.

### 프로세스 소유권

Preview의 실제 프로세스는 start를 실행한 Pod에서만 존재한다 (in-memory: `previewServers`, `previewServerPaths`).

| 데이터 | 저장 위치 | Pod 크래시 시 |
|--------|----------|-------------|
| ChildProcess 핸들 | In-memory (`previewServers`) | 소실 |
| 프로젝트 경로 | In-memory (`previewServerPaths`) | 소실 |
| PreviewState (port, host, podId) | Redis (`PREVIEW`) | 잔존 (TTL까지) |
| Preview Config (connections 설정) | Redis (`PREVIEW_CONFIG`) | 잔존 (TTL까지) |
| Docker 컨테이너 | Pod 로컬 Docker daemon | 고아로 잔존 |

### Cross-Pod Stop 시나리오

ALB 라운드 로빈으로 인해 stop 요청이 start를 실행한 Pod가 아닌 다른 Pod로 갈 수 있다:

1. Stop Pod는 `previewServers`에 프로세스가 없음
2. Redis에서 `running=true` 확인 → stop 진행
3. `previewServerPaths`에 localPath 없음 → **Docker 인프라 중지 불가**
4. Redis 상태만 정리 (unregisterPreview)

이를 보완하기 위해 `startInfrastructure`에 pre-cleanup이 포함되어 있다. 다음 start 시 이전 실행의 stale Docker 컨테이너/볼륨을 자동 정리한다.

### Pod 크래시/Rolling Update

1. SIGTERM 수신 → `cleanup()` → 모든 preview에 `stopPreview()` (Docker 포함 정리)
2. OOMKill/강제종료 → cleanup 미실행 → Docker 컨테이너와 Redis 상태가 고아로 잔존
3. 복구: 다음 startPreview 시 stale registry 감지 → Docker infra 정리 + unregisterPreview

### Pod 인덱스

`PREVIEW_BY_POD:{podId}` Set으로 Pod별 preview 목록을 관리한다. Pod 정리 작업에서 활용 가능.

## 포트 범위

| 용도 | 범위 |
|------|------|
| Preview Dev Server | 30000-39999 |
| Cloud IDE | 40000-49999 |

`PortManager`가 동적 할당을 관리한다.

## 경계

- Redis 상태 규약: [01-infrastructure.md](01-infrastructure.md)
- 프롬프트 템플릿: [13-prompt-system.md](13-prompt-system.md)
- Cloud IDE: [16-cloud-ide.md](16-cloud-ide.md)
