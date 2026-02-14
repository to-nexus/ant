# Preview System

## 개요

Preview 시스템은 생성된 코드의 실시간 미리보기를 제공한다. 피처별로 독립된 Dev Server를 실행하고, 통합 프록시를 통해 브라우저에서 접근한다. Redis 기반 상태 관리로 Multi-Pod 환경을 지원한다.

## 키 구조

| 형식 | 용도 | 예시 |
|------|------|------|
| Internal Key (Redis) | 내부 상태 관리 | `org:user:project:feature` |
| URL Key (HTTP) | URL path segment | `org--user--project--feature` |

URL Key는 콜론 대신 더블대시(`--`)를 사용한다. `toUrlKey()` / `fromUrlKey()` 함수로 변환한다.

## 호스트 분리

Preview는 별도 호스트(`ant-preview.crosstoken.io`)를 사용한다. 프레임워크가 네이티브 base path를 사용하더라도 일부 리소스(`<img src="/logo.svg">` 등)는 base path 없이 요청된다. 별도 호스트를 사용하면 호스트 기반 라우팅으로 이러한 요청도 ant-preview에 도달한다.

## 프록시 전략

모든 프레임워크가 네이티브 base path를 사용한다. 프록시는 단일 경로로 동작한다.

### Main 경로

1. URL에서 urlKey 파싱 -> `fromUrlKey()` -> internal key
2. Redis에서 `{ host, port }` 조회
3. 경로 prefix 유지하여 Dev Server로 프록시
4. Fullstack: `/api/*` -> backend port 분기
5. 응답 body를 stream pipe (변환/재작성 없음)
6. preview cookie 설정 (`Path=/{urlKey}`)

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
idle -> installing -> starting -> running
                        |           |
                        v           v
                      error <----- error
```

### 시작 흐름

1. POST /preview/projects/:id/start
2. 분산 락 획득 (Redis SET NX, TTL 120s)
3. 프로젝트 구조 감지
4. npm install
5. Dev Server 기동 (`npm run dev --host 0.0.0.0`)
6. Validator 검증
7. Redis에 PreviewState 등록 (`{ host: Pod_IP, port, running, ready }`)
8. Health Check (최대 60초)

### EFS 파일 감시

EFS(NFS)에서는 `inotify`가 작동하지 않는다. `ProcessSpawner`가 Dev Server 프로세스에 `CHOKIDAR_USEPOLLING=true`, `WATCHPACK_POLLING=true`를 자동 주입하여 해결한다.

## Fullstack 지원

```
/{urlKey}/        -> Frontend (entry port)
/{urlKey}/page    -> Frontend
/{urlKey}/api/*   -> Backend (backend port)
```

## Cross-Project Preview

프론트엔드와 백엔드가 서로 다른 프로젝트일 때, Preview Config UI에서 `linkedBackend`를 설정한다. 프론트엔드의 `VITE_API_BASE_URL`에 백엔드의 urlKey 경로가 주입된다.

## Multi-Pod

모든 상태는 Redis에만 존재한다 (Single Source of Truth). Dev Server는 `0.0.0.0`에서 listen하여 다른 Pod에서도 접근 가능하다. 어떤 Pod가 요청을 받아도 Redis에서 실제 Dev Server Pod IP를 조회하여 프록시한다. Sticky Session 불필요.

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
