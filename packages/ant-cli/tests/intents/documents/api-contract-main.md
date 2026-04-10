# API Contract: main

## GET /api/projects
Response: { projects: [{ id, name, memberCount, taskStats }] }

## POST /api/projects
Body: { name, description }
Response: { id, name, inviteCode }
Auth: Bearer JWT required

## GET /api/projects/:id/tasks
Query: status, assignee, sort
Response: { tasks: [{ id, title, status, assignee, priority, commentCount }] }

## PATCH /api/tasks/:id
Body: { status?, assignee?, priority? }
Auth: Bearer JWT required, project member
