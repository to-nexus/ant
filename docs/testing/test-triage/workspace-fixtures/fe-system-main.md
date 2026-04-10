# Frontend System Design: TaskFlow Web Client

## 1. Overview

**Application Name**: taskflow-web
**Responsibility**: Task management UI, real-time notification display, Kanban board interaction, dashboard visualization
**PRD Reference**: prd.md

### Pages

- `/login` — Login / Registration
- `/dashboard` — Project list, task statistics overview
- `/projects/:id` — Kanban board (Todo / In Progress / Done)
- `/projects/:id/settings` — Project settings, member management
- `/notifications` — Notification list

### External Dependencies

- **taskflow-api** — REST API for all data operations
- Browser localStorage — JWT token persistence

---

## 2. Architecture Pattern Selection

### 2.1 Internal Architecture Observation

| Checkpoint | Observation |
|-----------|-------------|
| **UI complexity** | Moderate. Kanban board with drag-and-drop, real-time notification badge, dashboard charts. Interactive but standard SPA patterns suffice. |
| **State sharing scope** | Medium. Auth state is global; project/task state is page-scoped; notification count is header-scoped. |
| **API integration volume** | Six REST endpoints. No GraphQL or complex caching requirements. |

### 2.2 Architecture Selection

**Selected Pattern**: Component-based SPA with centralized store

Feature-based directory structure. Zustand for global state (auth, notifications), React Query for server state (projects, tasks). Clear separation between UI components and data-fetching logic.

**Boundary Responsibilities**:
- **Pages**: Route-level containers. Compose feature components, handle route params.
- **Features**: Domain-specific UI modules (kanban, dashboard, auth). Own their sub-components and hooks.
- **Components**: Reusable presentation components. No business logic, only props-driven rendering.
- **Hooks**: Data fetching and state management logic. Encapsulate API calls and store access.
- **Services**: API client layer. HTTP request/response handling, token injection.

### 2.3 Directory Structure

```
src/
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── KanbanPage.tsx
│   ├── ProjectSettingsPage.tsx
│   └── NotificationsPage.tsx
├── features/
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   ├── RegisterForm.tsx
│   │   └── useAuth.ts
│   ├── kanban/
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   ├── TaskCard.tsx
│   │   ├── TaskCreateModal.tsx
│   │   └── useKanban.ts
│   ├── dashboard/
│   │   ├── ProjectList.tsx
│   │   ├── ProgressChart.tsx
│   │   ├── MemberWorkload.tsx
│   │   └── useDashboard.ts
│   └── notification/
│       ├── NotificationBell.tsx
│       ├── NotificationList.tsx
│       └── useNotifications.ts
├── components/
│   ├── Layout.tsx
│   ├── Header.tsx
│   ├── Button.tsx
│   ├── Modal.tsx
│   ├── Badge.tsx
│   └── EmptyState.tsx
├── services/
│   ├── api.ts
│   ├── auth.service.ts
│   ├── project.service.ts
│   ├── task.service.ts
│   └── notification.service.ts
├── stores/
│   ├── authStore.ts
│   └── notificationStore.ts
├── router.tsx
└── App.tsx
```

---

## 3. State Management

### Global State (Zustand)

| Store | State | Reason for global |
|-------|-------|-------------------|
| `authStore` | `user`, `accessToken`, `refreshToken`, `isAuthenticated` | Needed by API client interceptor and header across all pages |
| `notificationStore` | `unreadCount` | Displayed in header badge on every page |

### Server State (React Query)

| Query Key | Endpoint | Stale Time |
|-----------|----------|-----------|
| `['projects']` | GET /api/projects | 30s |
| `['projects', id, 'tasks']` | GET /api/projects/:id/tasks | 10s |
| `['notifications']` | GET /api/notifications | 15s |

### Mutations

| Mutation | Endpoint | Optimistic Update |
|----------|----------|-------------------|
| Create task | POST /api/projects/:id/tasks | Append to task list |
| Update task status | PATCH /api/tasks/:id | Move card in kanban columns |
| Delete task | DELETE /api/tasks/:id | Remove from task list |
| Mark notification read | PATCH /api/notifications/:id/read | Decrement unread count |

---

## 4. Routing & Authentication

### Route Configuration

| Path | Component | Auth Required | Guard |
|------|-----------|--------------|-------|
| `/login` | LoginPage | No | Redirect to `/dashboard` if authenticated |
| `/dashboard` | DashboardPage | Yes | Redirect to `/login` if not authenticated |
| `/projects/:id` | KanbanPage | Yes | Verify project membership |
| `/projects/:id/settings` | ProjectSettingsPage | Yes | Verify project owner role |
| `/notifications` | NotificationsPage | Yes | — |

### Token Management

- **Storage**: `localStorage` for refresh token, in-memory (Zustand) for access token
- **Auto-refresh**: API client interceptor catches 401, attempts token refresh, retries original request
- **Logout**: Clear both tokens, redirect to `/login`

---

## 5. Key UI Interactions

### Kanban Drag & Drop

- Library: `@dnd-kit/core`
- Drag source: `TaskCard` component
- Drop targets: `KanbanColumn` containers (Todo, In Progress, Done)
- On drop: Optimistic status update via React Query mutation, revert on API failure

### Dashboard Charts

- Library: `recharts`
- Progress chart: Bar chart showing completed vs total tasks per project
- Member workload: Horizontal bar chart showing task count per assignee

### Notification Polling

- Interval: 30 seconds via React Query `refetchInterval`
- Unread count synced to `notificationStore` on each fetch
- Mark-as-read triggers immediate cache invalidation

---

## 6. Technology Stack

| Component | Technology |
|-----------|-----------|
| **Framework** | React 18 |
| **Language** | TypeScript 5 |
| **Build Tool** | Vite |
| **Styling** | Tailwind CSS 3 |
| **State (global)** | Zustand |
| **State (server)** | React Query (TanStack Query) |
| **Routing** | React Router 6 |
| **Drag & Drop** | @dnd-kit/core |
| **Charts** | Recharts |
| **HTTP Client** | Axios |
