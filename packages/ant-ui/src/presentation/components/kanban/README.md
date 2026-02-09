# Kanban Board Components

리팩토링된 Kanban Board 컴포넌트 구조

## 📁 파일 구조

```
kanban/
├── KanbanBoard.tsx         # 메인 orchestrator (SSE, 상태 관리)
├── KanbanHeader.tsx        # 헤더 액션 (데이터 소스, 게이지)
├── KanbanEstimating.tsx    # Estimating 상태 디스플레이
├── KanbanPausedPrompt.tsx  # Resume 프롬프트
├── KanbanColumns.tsx       # 3칼럼 레이아웃 (To Do, In Progress, Completed)
├── index.ts               # Export 정리
└── README.md              # 이 파일
```

## 🧩 컴포넌트 역할

### KanbanBoard (Main Orchestrator)
- SSE 연결 관리
- 전역 상태 관리 (Zustand)
- 애니메이션 상태 관리
- Resume Task 로직
- 서브 컴포넌트 조합

### KanbanHeader
- Data Source indicator (Live/Session/Estimating)
- Recursion Limit 게이지
- Tasks 진행률 게이지

### KanbanEstimating (KanbanEstimatingSkeleton)
- decompose/revise 단계에서 스켈레톤 카드 3컬럼 표시
- NodeActivityBanner와 함께 사용

### NodeActivityBanner
- 현재 실행 중인 비-태스크 노드의 활동 라벨 + 실시간 타이머 표시
- estimatingLabel/estimatingStartedAt 기반 자동 마운트/해제

### KanbanPausedPrompt
- Recursion limit 도달 시 표시
- Resume Task 버튼

### KanbanColumns
- 3칼럼 레이아웃
- TaskCard 렌더링
- Framer Motion 애니메이션 처리
  - Shine effect (completed)
  - Slide animation (in-progress)

## 🔄 데이터 흐름

```
SSE Stream → KanbanBoard (state) → Sub Components
     ↓
  KanbanData
  {
    todo: UnifiedTask[]
    inProgress: UnifiedTask | null
    completed: UnifiedTask[]
    isEstimating: boolean
    dataSource: 'live' | 'session' | 'estimating'
    recursionCount: number
    recursionLimit: number
    pausedDueToLimit: boolean
    tasksRemaining: number
  }
```

## 🎨 애니메이션

- **Completed**: Slide from right + Shine effect
- **In Progress**: Slide from left (delayed)
- **Layout**: Smooth card repositioning (Framer Motion)

## 🔌 재사용 가능한 Base 컴포넌트

**BoardContainer** (`../BoardContainer.tsx`)
- Kanban Board, Workflow 등에 재사용 가능
- 일관된 Card 스타일
- Header actions 지원

## 📦 사용 예시

```tsx
import { KanbanBoard } from '@/components/kanban';

function App() {
  return <KanbanBoard />;
}
```

## 🚀 향후 확장

동일한 패턴으로 **WorkflowBoard** 구현 가능:
```
workflow/
├── WorkflowBoard.tsx
├── WorkflowHeader.tsx
├── WorkflowNodes.tsx
└── WorkflowEdges.tsx
```

모두 `BoardContainer`를 base로 사용.

