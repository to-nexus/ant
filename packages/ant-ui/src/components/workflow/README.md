# Agent Workflow Board

## 개요

Agent Workflow Board는 Agent의 실행 흐름을 시각화하는 컴포넌트입니다.

## 현재 상태

**Placeholder**: 현재는 기본 UI만 구현되어 있으며, 실제 워크플로우 시각화 기능은 향후 구현 예정입니다.

## 향후 구현 계획

### 1. LangGraph 노드 시각화
- Agent graph의 각 노드를 시각적으로 표현
- 노드 간 연결(edge) 표시
- 노드 상태 (pending, running, completed, error) 시각화

### 2. 실시간 실행 추적
- 현재 실행 중인 노드 하이라이트
- 실행 경로 시각화
- 노드별 실행 시간 표시

### 3. 인터랙티브 노드 검사
- 노드 클릭 시 상세 정보 표시
- 노드의 입력/출력 데이터 확인
- 노드 실행 로그 확인

### 4. 상태 전환 시각화
- Agent state 변화 추적
- State transition history
- 조건부 분기 표시

## 기술 스택 (예정)

- **React Flow** 또는 **D3.js**: 노드/그래프 시각화
- **SSE (Server-Sent Events)**: 실시간 상태 업데이트
- **Framer Motion**: 애니메이션 효과

## 위치

Agent Workflow Board는 MainPanel의 split layout에서 두 번째 영역에 표시됩니다:
- Split layout이 활성화되면 Task Board와 함께 표시
- 독립적인 스크롤 영역
- Task Board와 동일한 위계

## 관련 컴포넌트

- `MainPanel`: 상위 컨테이너
- `SplitLayout`: 분할 레이아웃 관리
- `KanbanBoard`: Task 관리 (동일 위계)

