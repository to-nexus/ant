# Backend System Design: TaskFlow API

## 1. Overview

**Service Name**: taskflow-api
**Responsibility**: Task management CRUD, user authentication, project membership, notification generation
**PRD Reference**: prd.md

### Endpoints Implemented

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/refresh
- GET/POST /api/projects
- GET /api/projects/:id
- GET/POST /api/projects/:id/tasks
- PATCH/DELETE /api/tasks/:id
- GET /api/notifications
- PATCH /api/notifications/:id/read

### Data Ownership

- `users` table (PostgreSQL) - user accounts and credentials
- `projects` table (PostgreSQL) - project metadata
- `project_members` table (PostgreSQL) - project membership and roles
- `tasks` table (PostgreSQL) - task records with status, priority, assignment
- `notifications` table (PostgreSQL) - in-app notification records

---

## 2. Architecture Pattern Selection

### 2.1 Internal Architecture Observation

| Checkpoint | Observation |
|-----------|-------------|
| **Domain complexity** | Moderate. Task lifecycle management with status transitions, membership-based authorization, cross-entity notification triggers. Business rules exist but are straightforward. |
| **Integration boundary count** | Three external dependencies: PostgreSQL (persistence), Redis (cache and async job queue), email service (verification and invitations). |
| **Dependency direction concern** | Medium. Authorization logic and notification triggers benefit from separation from HTTP framework concerns. |

### 2.2 Architecture Selection

**Selected Pattern**: Framework-conventional layered architecture

Business logic is moderate but well-bounded. Three-layer separation (handler → service → repository) provides sufficient isolation for testing and maintenance.

**Boundary Responsibilities**:
- **Handler layer**: HTTP concern boundary. Request binding, input validation, JWT extraction, response formatting.
- **Service layer**: Business logic boundary. Authentication flows, project membership checks, task state transitions, notification generation.
- **Repository layer**: Persistence boundary. PostgreSQL data access with typed queries.
- **Middleware**: Cross-cutting concerns. JWT validation, project membership authorization.

### 2.3 Directory Structure

```
src/
├── handlers/
│   ├── auth.handler.ts
│   ├── project.handler.ts
│   ├── task.handler.ts
│   └── notification.handler.ts
├── services/
│   ├── auth.service.ts
│   ├── project.service.ts
│   ├── task.service.ts
│   └── notification.service.ts
├── repositories/
│   ├── user.repository.ts
│   ├── project.repository.ts
│   ├── task.repository.ts
│   └── notification.repository.ts
├── middleware/
│   ├── auth.middleware.ts
│   └── project-member.middleware.ts
├── config/
│   └── index.ts
└── app.ts
```

---

## 3. Database Design

### users Table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL |
| `password_hash` | VARCHAR(255) | NOT NULL |
| `email_verified` | BOOLEAN | NOT NULL, DEFAULT false |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

### projects Table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() |
| `name` | VARCHAR(100) | NOT NULL |
| `description` | VARCHAR(500) | NULLABLE |
| `created_by` | UUID | FK → users.id, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

### project_members Table

| Column | Type | Constraints |
|--------|------|-------------|
| `project_id` | UUID | FK → projects.id, NOT NULL |
| `user_id` | UUID | FK → users.id, NOT NULL |
| `role` | VARCHAR(20) | NOT NULL, CHECK (role IN ('owner', 'member')) |
| `joined_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**PK**: (project_id, user_id)

### tasks Table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() |
| `project_id` | UUID | FK → projects.id, NOT NULL |
| `title` | VARCHAR(200) | NOT NULL |
| `description` | TEXT | NULLABLE |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'todo', CHECK (status IN ('todo', 'in_progress', 'done')) |
| `priority` | VARCHAR(10) | NOT NULL, DEFAULT 'medium', CHECK (priority IN ('low', 'medium', 'high')) |
| `assignee_id` | UUID | FK → users.id, NULLABLE |
| `due_date` | DATE | NULLABLE |
| `created_by` | UUID | FK → users.id, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**Indexes**:
- `(project_id, status)` - task listing with status filter
- `(assignee_id)` - member task lookup

### notifications Table

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() |
| `user_id` | UUID | FK → users.id, NOT NULL |
| `type` | VARCHAR(30) | NOT NULL |
| `message` | TEXT | NOT NULL |
| `is_read` | BOOLEAN | NOT NULL, DEFAULT false |
| `metadata` | JSONB | NULLABLE |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() |

**Indexes**:
- `(user_id, is_read, created_at DESC)` - unread notification listing

---

## 4. Authentication & Authorization

### Authentication

- **Registration**: email + password → bcrypt hash → store → send verification email
- **Login**: email + password → verify hash → issue JWT access token (1h) + refresh token (7d)
- **Token Refresh**: refresh token → validate → issue new access token
- **JWT Payload**: `{ sub: userId, email: string, iat: number, exp: number }`

### Authorization

- **JWT Middleware**: All `/api/projects/*`, `/api/tasks/*`, `/api/notifications/*` routes require valid JWT
- **Project Membership Middleware**: Project-scoped routes verify requesting user is a member of the target project
- **Task Deletion**: Only project owner or task creator can delete tasks

---

## 5. Business Logic Placement

### AuthService
- `register(email, password)` - validate, hash password, create user, send verification email
- `login(email, password)` - verify credentials, check email verified, issue tokens
- `refreshToken(refreshToken)` - validate refresh token, issue new access token

### ProjectService
- `createProject(name, description, userId)` - create project, add creator as owner
- `inviteMember(projectId, email, inviterId)` - find user by email, add as member, create notification
- `listProjects(userId)` - list projects where user is a member

### TaskService
- `createTask(projectId, title, description, priority, dueDate, createdBy)` - create task record
- `assignTask(taskId, assigneeId)` - update assignee, create notification for assignee
- `updateStatus(taskId, status, userId)` - update task status, create notification for project members
- `deleteTask(taskId, userId)` - verify permission (owner or creator), delete task
- `listTasks(projectId, filters)` - list tasks with status/priority/assignee filters

### NotificationService
- `createNotification(userId, type, message, metadata)` - create notification record
- `getUnreadCount(userId)` - count unread notifications
- `listNotifications(userId)` - list notifications ordered by created_at DESC
- `markAsRead(notificationId, userId)` - mark single notification as read
- `markAllAsRead(userId)` - mark all user notifications as read

---

## 6. Technology Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js 20 LTS |
| **Framework** | Express 4 |
| **Language** | TypeScript 5 |
| **Database** | PostgreSQL 16 |
| **Cache** | Redis 7 |
| **Auth** | jsonwebtoken + bcrypt |
| **Validation** | zod |
| **Email** | nodemailer (console transport in dev) |
