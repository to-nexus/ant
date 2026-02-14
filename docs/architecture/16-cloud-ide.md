# Cloud IDE

## 개요

Cloud IDE는 사용자별 격리된 VS Code 환경을 제공한다. Local 모드에서는 Docker 컨테이너(LocalIDEOrchestrator), Cloud 모드에서는 Kubernetes Pod(KubernetesIDEOrchestrator)으로 관리된다.

## 인스턴스 키

```
{tenantId}:{userId}:{projectId}
```

3-part 키로 프로젝트 단위 격리. 사용자-프로젝트 조합마다 독립된 IDE 인스턴스가 생성된다.

## Local 모드 (Docker)

### 컨테이너 구성

| 항목 | 값 |
|------|---|
| 이미지 | `gitpod/openvscode-server:latest` (ANT_IDE_IMAGE으로 설정 가능) |
| 내부 포트 | 3000 |
| 호스트 포트 | 40000-49999 (동적 할당) |
| 메모리 제한 | 2GB |
| CPU 제한 | 2 cores |
| Idle timeout | 30분 |

### 마운트

| 호스트 경로 | 컨테이너 경로 | 용도 |
|-------------|-------------|------|
| `{workspacePath}` | `/{projectId}` | 프로젝트 코드 (rw) |
| `{ideHomePath}` | `/home/openvscode` | IDE 설정/확장 영속화 (rw) |

### 생명주기

1. **시작**: PortManager에서 포트 할당 -> Docker 컨테이너 생성/시작 -> Redis에 등록
2. **사용**: 프록시(`/ide/{serverKey}/*`)를 통해 접근. WebSocket(터미널, LSP) 지원
3. **중지**: 컨테이너 stop/remove -> 포트 해제 -> Redis에서 제거
4. **자동 종료**: 1분 주기로 idle 체크, 30분 미사용 시 자동 종료

## Cloud 모드 (Kubernetes)

### Pod 구성

| 항목 | 값 |
|------|---|
| Container | openvscode-server |
| Port | 3000 |
| server-base-path | `/ide/{instanceKey}` |
| Workspace | `/workspace` |
| Volume | EFS PVC (ReadWriteMany), subPath: `{tenant}/{user}/{project}/codebase` |

### 프록시 흐름

```
클라이언트 -> ALB -> ant-api (/ide/:serverKey/*) -> Redis에서 Pod IP 조회 -> K8s Pod IP:3000
```

Redis에 Pod IP를 저장하므로 어떤 ant-api Pod가 요청을 받아도 올바른 IDE Pod로 프록시한다.

## 격리

| 격리 유형 | 방법 |
|-----------|------|
| 프로세스 | 컨테이너/Pod별 독립 프로세스 공간 |
| 파일시스템 | 마운트로 자기 워크스페이스만 접근 |
| 네트워크 | 독립 네트워크 네임스페이스 |
| 환경변수 | 컨테이너/Pod별 독립 |
| 리소스 | CPU/메모리 제한으로 공정성 보장 |

## Local IDE (로컬 앱 실행)

Local 모드에서는 Docker IDE 대신 로컬 IDE 앱(Cursor, VS Code)을 직접 실행하는 옵션도 있다. `POST /api/ide/open`으로 OS별 명령을 실행한다. 격리와 리소스 제한은 없다.

## 포트 범위

| 용도 | 범위 |
|------|------|
| IDE | 40000-49999 |
| Preview | 30000-39999 |

## 경계

- Redis 상태 규약: [01-infrastructure.md](01-infrastructure.md)
- 워크스페이스 격리: [10-workspace-isolation.md](10-workspace-isolation.md)
- Preview 시스템: [11-preview-system.md](11-preview-system.md)
