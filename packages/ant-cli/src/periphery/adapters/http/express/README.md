# ExpressServerAdapter Refactoring

## 개요

ExpressServerAdapter를 서브모듈로 분할하여 각 모듈이 단일 책임을 가지도록 리팩토링했습니다.

## 디렉토리 구조

```
express/
├── ExpressServerAdapter.ts          # 메인 어댑터 (조합 클래스)
├── index.ts                          # Export 파일
├── types/
│   └── index.ts                      # 공유 타입 정의
├── config/
│   ├── ServerConfigurator.ts         # HTTP 서버 설정 (CORS, middleware, auth)
│   ├── RouteConfigurator.ts          # 라우트 설정 및 등록
│   └── index.ts
├── managers/
│   ├── JobStateTracker.ts            # Job 상태 추적 (in-memory state)
│   ├── JobExecutionManager.ts        # Job 실행 관리 (child process)
│   ├── JobCleanupManager.ts          # Job 정리 및 세션 영속화
│   ├── SessionFileWatcher.ts         # 세션 파일 감시
│   └── index.ts
├── bridges/
│   ├── WorkflowBridge.ts             # 워크플로우 상태 업데이트 브리지
│   └── index.ts
├── lifecycle/
│   ├── ServerLifecycleManager.ts     # 서버 생명주기 (graceful shutdown)
│   └── index.ts
└── services/
    └── ServiceInitializer.ts         # 서비스 의존성 초기화
```

## 모듈별 책임

### 1. ExpressServerAdapter (메인 어댑터)
- 모든 서브모듈을 조합하여 Port 인터페이스 구현
- 얇은 위임 레이어 (thin delegation layer)
- 싱글톤 인스턴스 관리

### 2. ServerConfigurator (서버 설정)
- CORS 설정
- Body parser 설정
- Dev server & IDE proxy middleware
- Cloud mode 인증 middleware

### 3. RouteConfigurator (라우트 설정)
- 모든 API 엔드포인트 등록
- Mode별 root route 처리
- Internal endpoint 설정

### 4. JobStateTracker (상태 추적)
- Job 상태 in-memory 저장
- Task queue snapshot 관리
- Job-to-project mapping 관리
- 상태 조회 및 업데이트 API

### 5. JobExecutionManager (실행 관리)
- Job 실행 시작 (executeJob)
- Child process 생성 및 모니터링
- Log streaming
- Exit handler (성공/실패/중단)

### 6. JobCleanupManager (정리 관리)
- Job 종료 시 cleanup
- 세션 파일 업데이트
- 중단된 task queue 복원
- Interruption 정보 저장
- 최종 Kanban broadcast

### 7. SessionFileWatcher (파일 감시)
- 세션 파일 변경 감시
- SSE 클라이언트 확인

### 8. WorkflowBridge (워크플로우 브리지)
- Workflow state update 처리
- Task queue update → Kanban broadcast
- File tree update 알림
- Node tracking (enterNode, exitNode)

### 9. ServerLifecycleManager (생명주기)
- Graceful shutdown
- 실행 중인 job 저장
- Child process 종료
- 서비스 cleanup
- Timeout 및 force shutdown

### 10. ServiceInitializer (서비스 초기화)
- 모든 의존성 서비스 생성
- Mode별 서비스 구성
- WorkspaceService, PortManager, IDEService 등 초기화

## 장점

### 1. 단일 책임 원칙 (SRP)
- 각 모듈이 하나의 명확한 책임을 가짐
- 기능 추가/수정 시 관련 모듈만 변경

### 2. 테스트 용이성
- 각 모듈을 독립적으로 테스트 가능
- Mock 의존성 주입 용이

### 3. 가독성 향상
- 2177줄 → 각 모듈 100-400줄
- 기능별로 파일이 분리되어 이해하기 쉬움

### 4. 확장성
- 새로운 기능을 새 모듈로 추가 가능
- 기존 코드에 영향 최소화

### 5. 유지보수성
- 버그 수정 시 관련 모듈만 확인
- 의존성이 명확하게 정의됨

## 마이그레이션

기존 코드:
```typescript
import { ExpressServerAdapter } from '../periphery/adapters/http/ExpressServerAdapter';
```

새 코드:
```typescript
import { ExpressServerAdapter } from '../periphery/adapters/http/express';
```

기존 파일은 `ExpressServerAdapter.ts.backup`으로 백업되어 있습니다.

## 향후 개선 사항

1. **세션 파일 콜백 연결**: SessionService의 onSessionChange 콜백을 ExpressServerAdapter에서 제대로 연결
2. **더 나은 타입 안정성**: `any` 타입을 구체적인 타입으로 대체
3. **에러 처리 표준화**: 각 모듈의 에러 처리 패턴 통일
4. **로깅 일관성**: 모든 모듈에서 동일한 로깅 패턴 사용
5. **유닛 테스트**: 각 모듈별 테스트 케이스 작성
