# Spec: 태스크 검색 API

## 구현 범위
- GET /api/tasks/search 엔드포인트
- 프로젝트 내 태스크 전문 검색 (PostgreSQL tsvector)
- 필터: status, assignee, priority, date range

## 입력 검증
- query: 최소 2자, 최대 100자
- project_id: required, UUID v4

## 응답 페이지네이션
- cursor 기반, limit 기본 20
