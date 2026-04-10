# Backend System Design: main

## API 엔드포인트
- GET /api/projects → 프로젝트 목록
- POST /api/projects → 프로젝트 생성
- GET /api/projects/:id/tasks → 태스크 목록
- PATCH /api/tasks/:id → 태스크 상태 변경
- POST /api/tasks/:id/comments → 댓글 작성

## DB 스키마
- projects: id, name, owner_id, created_at
- tasks: id, project_id, title, status, assignee_id, priority
- comments: id, task_id, author_id, content, created_at

## 인증
- OAuth 2.0 (Google, GitHub), JWT access + refresh token
