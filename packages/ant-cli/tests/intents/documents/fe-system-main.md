# Frontend System Design: main

## 라우팅
- / → 대시보드
- /projects/:id → 칸반 보드
- /projects/:id/settings → 프로젝트 설정
- /profile → 사용자 프로필

## 컴포넌트
- KanbanBoard: 드래그 앤 드롭 칸반
- TaskCard: 태스크 카드
- CommentThread: 실시간 댓글
- Dashboard: 진행률 차트

## 상태 관리
- Zustand store: projects, tasks, auth, websocket
