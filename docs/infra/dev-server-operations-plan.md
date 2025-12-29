# 개발서버 운용 인프라 요청서 (ant-cli / ant-ui / embedder / chromaDB + Cloud IDE)
---

## 1. TL;DR (인프라팀 실행 요약)

- **배포**: `ant-ui`(웹) / `ant-cli`(API+Runner) / `chromaDB` / `embedder` 4개를 각각 서비스로 띄우면 됩니다.
- **필수 전제**: `ant-cli`가 올라가는 서버는 **Docker 데몬 접근 가능** + **워크스페이스 볼륨 마운트**가 되어야 합니다.
- **네트워크**:
  - 외부 공개: `ant-ui`(443), `ant-cli`(443→4100)
  - 내부 전용: `chromaDB:8000`, `embedder:8001`은 `ant-cli`에서만 접근 허용
  - 권장: `ant-cli` 서버의 **30000–35000 inbound 차단**

---

## 2. 배포 단위(서비스) 및 역할

### 2.1 `ant-ui` (Web)

- 역할: 사용자 UI
- 인바운드: 443 (또는 80/443)
- 비고: 백엔드 주소는 빌드/배포 시 `VITE_CLOUD_BACKEND_BASE`로 설정 필요

### 2.2 `ant-cli` (API + Runner)

- 역할:
  - API 서버(프로젝트/피처/잡/IDE/devserver 제어)
  - 사용자 프로젝트 devserver 실행(프로세스 spawn)
  - Cloud IDE 컨테이너 생성/삭제(Docker)
- 인바운드: 4100(내부) / 외부는 443에서 reverse proxy 권장
- 요구사항:
  - Docker 데몬 접근(컨테이너 생성/삭제)
  - 워크스페이스 볼륨 마운트(대용량/고IO 권장)

### 2.3 `chromaDB`

- 역할: 벡터 DB
- 인바운드: 8000 (외부 비공개, `ant-cli`에서만 접근)
- 스토리지: 영속 볼륨 필수(`/data`)

### 2.4 `embedder`

- 역할: 임베딩 생성 API
- 인바운드: 8001 (외부 비공개, `ant-cli`에서만 접근)
- 스토리지: 불필요(stateless)

---

## 3. 권장 인프라 토폴로지(서버/서비스 배치)

- **Server A**: `ant-cli` (API+Runner)
- **Server B**: `ant-ui` (Web)
- **Server C**: `chromaDB`
- **Server D**: `embedder`

---

## 4. 네트워크/보안그룹 설정

### 4.1 외부 공개(ingress)

- **Server B (ant-ui)**: 80/443
- **Server A (ant-cli API)**: 443 → 4100 (reverse proxy/LB 권장)

### 4.2 내부 통신(서비스 간, egress)

- **Server A → Server C**: TCP 8000 (`CHROMA_URL`)
- **Server A → Server D**: TCP 8001 (`EMBEDDER_URL`)

### 4.3 dev server 포트 범위(권장 정책)

`ant-cli`는 사용자 프로젝트 devserver를 **30000–35000**에 띄웁니다.

- **권장**: Server A의 **30000–35000 inbound는 외부에서 차단**
- **이유**: 사용자는 `ant-cli`의 `/dev/:serverKey` 경로로만 접속하면 됩니다.

---

## 5. 스토리지/마운트

### 5.1 Server A(ant-cli) 워크스페이스 볼륨

- `ANT_WORKSPACE_BASE_PATH=/mnt/ant-workspaces` (예시)
- 요구사항: 대용량/고IO 권장(프로젝트 clone, node_modules, build 캐시, IDE 작업 등)

### 5.2 Server A(Cloud IDE) 홈 볼륨(권장)

- `ANT_IDE_HOME_BASE_PATH=/mnt/ant-ide-homes` (예시)
- 목적: 프로젝트별 IDE 확장/설정/캐시를 컨테이너 재생성 후에도 유지

### 5.3 Server C(chromaDB) 데이터 볼륨

- 컨테이너 `/data`에 영속 볼륨 연결(백업/스냅샷 정책 필요)

---

## 6. 환경변수(운영 표준)

### 6.1 Server A(ant-cli)

**필수**

- `ANT_SERVER_MODE=cloud|local`
- `ANT_CLI_PORT=4100`
- `ANT_WORKSPACE_BASE_PATH=/mnt/ant-workspaces`
- `ANT_ENCRYPTION_KEY=<secret>` (PAT 저장 등 암호화에 사용)
- LLM 키(최소 1개):
  - `ANTHROPIC_API_KEY=<secret>` 또는
  - `OPENAI_API_KEY=<secret>`

**권장(운영 편의/기능 활성화)**

- 모델 기본값:
  - `AI_MODEL_PROVIDER=anthropic|openai`
  - `AI_MODEL_NAME=<model>`
  - `AI_MODEL_TEMPERATURE=0.7`
- 벡터 메모리:
  - `CHROMA_URL=http://<server-c-host>:8000`
  - `EMBEDDER_URL=http://<server-d-host>:8001`
- Cloud IDE(Docker):
  - `ANT_IDE_IMAGE=gitpod/openvscode-server:latest`
  - `ANT_IDE_HOME_BASE_PATH=/mnt/ant-ide-homes`
  - `ANT_IDE_HOSTNAME_MODE=user|containerid`
- 기타:
  - `RECURSION_LIMIT=800`
  - `GIT_DEFAULT_BASE=main`
  - `DEBUG_KANBAN=0|1`
  - (선택) `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET`, `FIGMA_REDIRECT_URI`

### 6.2 Server B(ant-ui)

- `VITE_CLOUD_BACKEND_BASE=https://<api-domain>/api`

---

## 7. 운영 체크리스트(인프라팀)

- **Server A (ant-cli)**
  - Docker 데몬 접근 가능 여부(권한/소켓)
  - 30000–35000 포트 충돌 없음 + 외부 인바운드 차단
  - 워크스페이스 볼륨 용량/IOPS
  - 로그 수집(프로세스 stdout/stderr, Docker 컨테이너 로그)
- **Server C (chromaDB)**: 데이터 영속 볼륨 + 백업
- **Server D (embedder)**: CPU 사용량 모니터링

