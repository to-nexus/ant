# Architecture 문서 정리 완료

## 핵심 문서 (5개)

### 1. 01-job-workspace-isolation.md
**Job 실행 시 Workspace 격리 정책**
- 환경변수 격리 (화이트리스트)
- 파일시스템 격리 (features/ 디렉토리)
- Multi-tenancy 구조
- 보안 및 격리 보장

### 2. 02-dev-server-management.md
**개발서버 관리 (환경 감지 통합)**
- EnvironmentDetector 재사용 (LLM과 공유)
- 프로젝트 타입별 실행 경로 결정
- PortManager (동적 포트 할당)
- PortRegistry (메모리/Redis)
- DevServerService (피처별 개발서버)
- 프록시 아키텍처 (Express/Nginx)

### 3. 03-cloud-ide-management.md
**Cloud IDE 관리 (Docker)**
- 유저별 독립 Docker 컨테이너
- 워크스페이스 마운트 생명주기
- 리소스 제한 (2GB RAM, 2 Cores)
- 자동 유휴 체크 및 종료

### 4. workspace-physical-separation.md
**물리적 분리**
- ANT_WORKSPACE_BASE_PATH 설정
- 물리적 분리 개념

### 5. correct-workspace-feature-structure.md
**Workspace 디렉토리 구조**
- features/ 디렉토리 구조
- 경로 매핑

## 최종 상태

```
docs/architecture/
  ├── 01-job-workspace-isolation.md          ✅ Job 격리
  ├── 02-dev-server-management.md            ✅ 개발서버 + 환경 감지
  ├── 03-cloud-ide-management.md             ✅ Cloud IDE
  ├── workspace-physical-separation.md       ✅ 물리적 분리
  └── correct-workspace-feature-structure.md ✅ 디렉토리 구조
```

**핵심**: Job 실행 격리 + 개발서버 관리 + Cloud IDE 관리에 집중

