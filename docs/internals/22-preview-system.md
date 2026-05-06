# Preview System

## 개요

Preview 시스템은 생성된 코드의 실시간 미리보기를 제공한다. 피처별로 독립된 Dev Server를 실행하고, 통합 프록시를 통해 브라우저에서 접근한다. Redis 기반 상태 관리로 Multi-Pod 환경을 지원한다.

## 키 구조

| 형식 | 용도 | 예시 |
|------|------|------|
| Internal Key (Redis) | 내부 상태 관리 | `org:user:project:feature` |
| URL Key (HTTP, 4-part) | 단일 frontend / 4-part 라우팅 | `org--user--project--feature` |
| URL Key (HTTP, 5-part) | 멀티 frontend 패키지 / `ant-project` serviceName | `org--user--project--feature--apps-web` |

URL Key는 콜론 대신 더블대시(`--`)를 사용한다. `toUrlKey()` / `toUrlKeyWithService()` / `fromUrlKey()` / `parseUrlKey()`가 SSOT이며 모두 `packages/ant-cli/src/periphery/adapters/http/services/PreviewService/utils/serverKeyUtils.ts`에 있다. `fromUrlKey()`는 항상 앞 4개만 internal key로 변환하며 `parseUrlKey()`가 5번째 세그먼트를 `serviceName`으로 추출한다.

### 5번째 세그먼트의 두 용도

5-part URL Key는 두 시나리오에 동일 형식으로 쓰인다:

1. **멀티 프런트엔드 패키지 접근**: 한 피처에 frontend 패키지가 2개 이상이면 각 패키지가 자체 5-part urlKey를 가진다. 하나는 entry, 나머지도 모두 자체 dev server에 직접 접근할 수 있어야 한다.
2. **`ant-project` 서비스 연결**: 다른 피처의 특정 패키지를 호출할 때 (`@connection ... ant-project:{pid}:{feat}:{svc}`).

두 용도 모두 5번째 세그먼트는 **반드시 `packageSlug(name)`이 만든 슬러그**여야 한다. 프록시는 슬러그로 정확 일치(exact match)만 시도하므로 raw name(`apps/web`)을 그대로 쓰면 매치되지 않는다. `PreviewServer.createDeployProxyMiddleware` / `previewProxy`는 입력단에서 `packageSlug()`로 정규화하여 legacy 입력도 자동 보정한다.

### `packageSlug()` 규칙 (SSOT)

| 입력 | 출력 |
|------|------|
| `web` | `web` |
| `apps/web` | `apps-web` |
| `@scope/ui` | `scope-ui` |
| `apps_web` | `appsweb` (밑줄은 strip) |
| `apps---web` | `apps-web` (연속 하이픈 collapse) |
| 빈 문자열 | `pkg` |

알고리즘: 슬래시 → `-`, 영숫자/하이픈 외 strip, 연속 하이픈 collapse, 양끝 trim, 빈 결과는 `pkg`로 폴백. `--` 출현이 절대 불가능하도록 보장하므로 5-part urlKey 파싱이 깨지지 않는다.

### Slug 충돌 처리

`PreviewService.assignPackageUrlIdentity` / `DeployService.assignDeployIdentity`가 frontend 패키지 목록을 한 번에 받아 슬러그를 결정한다. 이미 사용된 슬러그가 또 나오면 `slug-2`, `slug-3`, … 단일 하이픈 접미사로 dedupe한다 (`--` 절대 미사용). 결과적으로 한 피처 내 모든 frontend는 unique slug를 갖는다.

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

Preview는 별도 호스트(`ant-preview.example.com`)를 사용한다. 프레임워크가 네이티브 base path를 사용하더라도 일부 리소스(`<img src="/logo.svg">` 등)는 base path 없이 요청된다. 별도 호스트를 사용하면 호스트 기반 라우팅으로 이러한 요청도 ant-preview에 도달한다.

## 프록시 전략

모든 프레임워크가 네이티브 base path를 사용한다. 프록시는 단일 경로로 동작한다.

### Main 경로

1. URL에서 urlKey 파싱 → `parseUrlKey()` → `{ tenantId, userId, projectId, feature, serviceName? }`
2. Redis에서 `PreviewState`(host/port + `packages[]`) 조회
3. 라우팅 우선순위(아래 표) 적용 → 최종 `{targetPort, targetPath}` 결정
4. 응답 body를 stream pipe (변환/재작성 없음)
5. preview cookie 설정 (`Path=/{urlKey}`)

### 라우팅 우선순위

| 우선순위 | 조건 | targetPort | targetPath |
|---------|------|-----------|-----------|
| 1 | `/{urlKey}/api/*` (4-part 또는 5-part 무관) | `getBackendPort()` 결과 | prefix strip |
| 2-a | 5-part `serviceName`이 frontend pkg.slug와 일치 | 해당 `pkg.port` | prefix 유지 (frontend는 자체 basePath 보유) |
| 2-b | 5-part `serviceName`이 backend/other pkg.slug와 일치 | 해당 `pkg.port` | prefix strip (basePath 없음) |
| 2-c | 5-part `serviceName`이 어떤 pkg.slug와도 불일치 | (3)으로 fall-through | (3)으로 fall-through |
| 3 | 4-part urlKey, frontend 존재 | entry frontend port | prefix 유지 |
| 4 | frontend 없음 (backend-only deploy 등) | entry port | prefix strip |

`/api/*`가 항상 (2)보다 우선한다. 사용자가 만든 슬러그는 영숫자+하이픈으로 제한되므로 `api`라는 리터럴 세그먼트와 충돌하지 않으며, `/api/*`는 fullstack 보편 계약이다.

### Fallback 경로

urlKey가 없는 요청 (리소스 누출):
1. Referer 헤더에서 urlKey 추출
2. 실패 시: `__ant_preview_sk` 쿠키에서 추출
3. `/{urlKey}` prepend 후 프록시

## Base Path 설정

| 프레임워크 | 환경변수 | 설정 위치 |
|-----------|---------|----------|
| Vite (React/Vue) | `VITE_BASE_PATH` | `vite.config.ts` → `base` |
| Next.js | `NEXT_PUBLIC_BASE_PATH` | `next.config.js` → `basePath` |
| 공통 | `ANT_BASE_PATH` | 사용자 코드/플러그인용 fallback |

`ProcessSpawner`가 Dev Server 프로세스 생성 시 환경변수를 자동 주입한다. 주입값은 `SpawnOptions.packageUrlKey`(SSOT)에서 파생되며, 단일 frontend는 4-part urlKey, 멀티 frontend는 각자 자기 패키지의 5-part urlKey가 된다. 따라서 멀티 frontend 시에도 각 패키지는 **자기 자신의 basePath만** 알며, 프록시가 동일한 5-part prefix를 그대로 보존(라우팅 표 우선순위 2-a)하여 동작한다.

## 프로젝트 설정 검증 (Validator)

Preview 시작 시 프록시 환경 설정을 검증한다.

| Validator | 검증 항목 |
|-----------|----------|
| ReactValidator | vite.config base + React Router basename |
| VueValidator | vite.config base + Vue Router base |
| NextValidator | next.config basePath + 환경변수 참조 |

검증 실패 시: 서버 중단 → Redis에 issues 기록 → SSE로 UI에 브로드캐스트 → UI에 Fix 버튼 표시 → Fix 클릭 시 suggestedFix를 채팅에 자동 입력.

### 멀티 frontend 검증 범위

`frontendCount > 1`이면 entry frontend뿐 아니라 **모든 frontend 패키지**에 대해 validator를 실행한다. Entry는 fatal severity로 실패 시 서버 중단을 유발하지만, 비-entry 패키지의 실패는 `severity: 'warning'`으로 격하되어 동일 Fix UI를 그대로 활용하면서 다른 frontend의 기동을 막지 않는다. 사용자는 멀티 frontend에서도 secondary 패키지의 잘못된 base path를 즉시 인지하고 고칠 수 있다.

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
- **Multi-package serviceName**: `ant-project` resolution에 serviceName을 추가로 지정하면 대상 프로젝트의 특정 패키지(서비스)로 라우팅. URL Key에 5번째 세그먼트로 인코딩됨. 사용자가 입력한 `serviceName`은 producer(`PreviewServer`의 preview-config 응답 빌더)에서 `packageSlug()`로 정규화되어 5-part urlKey에 박힌다. 따라서 `[serviceName=apps/web]`이라 적어도 실제 라우팅 슬러그는 `apps-web`이며, 해당 피처가 같은 슬러그로 자기 패키지를 등록해 두기만 하면 매치된다.

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
| Deploy Static Server | 50000-54999 |

`PortManager`가 동적 할당을 관리한다.

## Deploy (Static Build Serving)

Deploy는 Preview와 별개의 서빙 경로다. 사용자가 "Deploy" 버튼을 누르면 피처의 프로덕션 빌드를 실행하고, 그 산출물을 정적 서버로 서빙한다. URL은 `/deploy/{urlKey}/...` 형식이며 동일한 `ant-preview` 프로세스 안의 별도 프록시 미들웨어가 처리한다.

Deploy는 Preview와 동일한 멀티 패키지 모델을 따른다 — 슬러그 SSOT(`packageSlug()`), 5-part urlKey, `packages[]` 데이터 모델, 라우팅 우선순위까지 공유한다. 차이는 (1) 정적 산출물을 띄운다는 것, (2) `.deploy/meta.json`이 source of truth라는 점뿐이다.

### Phase 모델

| Phase | 의미 | 프로세스 | 메타 | 자동 복구 |
|-------|------|---------|------|----------|
| `idle` | 배포 이력 없음 | - | - | 사용자가 deploy |
| `building` | `npm run build` 진행 중 | 빌드 프로세스 | - | - |
| `deploying` | 빌드 완료 → static server 기동 중 (최초 배포) | - | - | - |
| `running` | 정상 서빙 | static server alive | meta.json 존재 | - |
| `hibernated` | 산출물은 있으나 프로세스 없음 | - | meta.json 존재 | URL 접근 시 자동 기동 |
| `starting` | Lazy re-hydration 중 | spawn 진행 | meta.json 존재 | - |
| `unavailable` | 산출물도 없음 | - | - | 사용자가 재배포 |
| `error` | 빌드/서빙 실패 | - | 불확실 | 사용자가 재배포 |
| `stopped` | 사용자가 중지 | - | 삭제됨 | 사용자가 재배포 |

### 사망 경로

멀티 패키지에서는 `activeDeploys[key]`가 N개의 `StaticServerHandle` 배열이다. 사망/복구 경로는 모두 패키지 단위로 적용된다.

| 경로 | 트리거 | 결과 | 복구 |
|------|-------|------|------|
| Pod rolling update | `ant-preview` 배포 시 (`main/dev/ci/*` push) | 모든 패키지의 `activeDeploys` 핸들 + static server 프로세스 소실 | `cleanupStaleDeploys()`가 시작 시 `pkg.phase: running→hibernated` (또는 `error`) 전환 |
| Process crash / OOM | 특정 패키지 static server 자식 프로세스만 죽음 | Redis entry는 남지만 해당 패키지 fetch 실패 | 프록시가 fetch 실패 시 `hibernated` 표시 + 1회 `ensureRunning` 재시도 |
| Idle eviction | `ANT_DEPLOY_IDLE_TTL_MS` 초과 | `startIdleEviction`이 **모든 패키지** 핸들 정리 + 각 패키지 포트 해제 + phase `hibernated` broadcast | URL 접근 시 `ensureRunning`이 모든 패키지 재기동 |
| Redis TTL 만료 | 7일 무접근 | Redis entry 삭제 | meta.json이 남아있다면 `ensureRunning`이 모든 패키지 재등록 |

### Lazy Re-hydration

EFS `/mnt/workspaces`가 ReadWriteMany이므로 각 `pkg.buildOutputDir`는 pod 교체 후에도 살아있다. 재빌드 없이 static server만 다시 띄우면 복구 가능하다.

```
Browser → /deploy/{urlKey}/*  또는  /deploy/{urlKey}--{slug}/*
  PreviewServer.createDeployProxyMiddleware
    → parseUrlKey() → {projectId, feature, serviceName?}
    → DeployService.ensureRunning()
        1) Redis + activeDeploys 체크 → hit 시 그대로 프록시
        2) miss 시 per-key in-memory lock 획득
        3) workspacePath/.deploy/meta.json 읽기 (v1은 v2로 자동 lift)
           - 없으면 phase='unavailable' broadcast → 404
           - 있으면 phase='starting' broadcast
        4) meta.packages[]를 모두 순회: 각 패키지마다 포트 할당 + startStaticServer
        5) registerDeploy + phase='running' broadcast
    → resolvePackagePort: serviceName(slug) 매치 → 그 패키지 port. 미매치/4-part는 entry pkg port.
    → fetch → 성공 시 touchDeploy (lastAccessedAt + TTL 갱신)
    → 실패 시 phase='hibernated' 갱신 + 1회 ensureRunning 재시도 → 여전히 실패면 phase='unavailable' + 502
```

### 멀티 패키지 Deploy

`DeployService.startDeploy`는 `ProjectStructureDetector`를 재사용해 모든 frontend 패키지를 찾고 `assignDeployIdentity`로 슬러그/urlKey를 부여한다. 각 패키지마다 별도 포트를 할당하고 빌드/static server를 **직렬로** 띄운다. 빌드 실패 패키지는 자기 phase만 `error`가 되고 나머지는 진행한다.

| 항목 | 단일 패키지 | 멀티 패키지 |
|------|-------------|-------------|
| URL Key | 4-part `{urlKey}` | 패키지마다 5-part `{urlKey}--{slug}` |
| basePath | `/deploy/{4-part}` | `/deploy/{5-part}` (패키지별) |
| 포트 | 1개 | N개 (각 패키지) |
| 최상위 `status.url` | 그 url | `null` (FE는 `packages[].url` 사용) |
| `aggregatePhase` | 패키지 phase 그대로 | error 우선 → building → deploying → starting → all-running 등 |

FE는 `DeployStatus.packages[]`를 받아 패키지별 "Open" 버튼을 그린다. 단일 패키지는 기존 단일 버튼 UX 유지.

### 영속 저장소: `.deploy/meta.json` (v2)

`workspacePath/.deploy/meta.json`이 재기동에 필요한 모든 정보를 담는다. Redis는 캐시일 뿐, meta.json이 **source of truth**다.

```json
{
  "version": 2,
  "tenantId": "...",
  "userId": "...",
  "projectId": "...",
  "feature": "...",
  "workspacePath": "/mnt/workspaces/.../codebase",
  "packages": [
    {
      "name": "apps/web",
      "slug": "apps-web",
      "framework": "nextjs",
      "workspacePath": "/mnt/workspaces/.../codebase/apps/web",
      "buildOutputDir": "/mnt/workspaces/.../codebase/apps/web/.next",
      "basePath": "/deploy/{urlKey}--apps-web",
      "urlKey": "{urlKey}--apps-web"
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

`DeployMetaStore.write`는 tmp 파일로 쓴 뒤 atomic rename으로 교체한다. `stopDeploy`는 meta.json을 삭제한다. `ensureRunning`은 meta.json이 있어도 각 `pkg.buildOutputDir`이 실제로 존재하는지 별도로 확인한다 — 없으면 `unavailable`로 전환하고 meta도 제거.

#### v1 → v2 in-memory 자동 lift

기존 단일 패키지 deploy는 `version: 1`로 저장되어 있다. `DeployMetaStore.read()`가 v1을 읽으면 메모리에서 v2 형태로 변환해 반환한다 (디스크는 v1 그대로). slug는 `'root'`로 고정 — v1은 정의상 단일 패키지라 충돌 가능성이 없다. 다음 `write()` 시점에 v2로 덮어쓰여 forward-only 마이그레이션이 완료된다.

### Per-feature UI 상태 분리

프론트엔드의 `deploySlice`는 `Record<featureKey, PerFeatureDeployState>` 구조다. `featureKey = "${projectId}:${featureName}"`. 피처를 전환해도 각 피처의 `status/logs/isLoading`이 독립적으로 유지되어 **다른 피처의 빌드 로그가 보이는 현상이 발생하지 않는다**.

SSE 핸들러는 이중 안전장치를 둔다:
1. `SSEManager.connect(projectId, feature)`의 EventSource URL이 피처 단위로 재연결되므로 서버가 이미 피처별로 필터링.
2. 추가로 핸들러 콜백에서 `selectedProject/Feature`와 비교하여 과도기 이벤트 차단.

또한 탭 포커스가 돌아올 때(`visibilitychange`) `getDeployStatus`를 호출해 stale `running`을 교정한다 (pod이 재기동 되었거나 idle evict 되었을 수 있음).

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ANT_DEPLOY_IDLE_TTL_MS` | `86400000` (24시간) | 이 시간 동안 트래픽이 없으면 static server 프로세스만 정리하고 phase='hibernated' 전환 |

## 경계

- Redis 상태 규약: [02-infrastructure.md](02-infrastructure.md)
- 프롬프트 템플릿: [13-prompt-system.md](13-prompt-system.md)
- Cloud IDE: [23-cloud-ide.md](23-cloud-ide.md)
