# API Contract: TaskFlow

## Base URL

```
/api
```

**Authentication**: All endpoints except Auth require `Authorization: Bearer {accessToken}` header.

---

## Auth

### POST /api/auth/register

Create a new user account.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Validation**:
- `email`: valid email format, required
- `password`: minimum 8 characters, required

**Responses**:
| Status | Body | Condition |
|--------|------|-----------|
| 201 | `{ "id": "uuid", "email": "user@example.com" }` | Success |
| 400 | `{ "error": "Password must be at least 8 characters" }` | Validation failure |
| 409 | `{ "error": "Email already registered" }` | Duplicate email |

---

### POST /api/auth/login

Authenticate and receive tokens.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Responses**:
| Status | Body | Condition |
|--------|------|-----------|
| 200 | `{ "accessToken": "jwt...", "refreshToken": "jwt...", "user": { "id", "email" } }` | Success |
| 401 | `{ "error": "Invalid credentials" }` | Wrong email or password |
| 403 | `{ "error": "Email not verified" }` | Unverified email |

---

### POST /api/auth/refresh

Refresh access token.

**Request Body**:
```json
{
  "refreshToken": "jwt..."
}
```

**Responses**:
| Status | Body | Condition |
|--------|------|-----------|
| 200 | `{ "accessToken": "jwt..." }` | Success |
| 401 | `{ "error": "Invalid or expired refresh token" }` | Token invalid |

---

## Projects

### GET /api/projects

List projects the authenticated user belongs to.

**Query Parameters**: none

**Response** (200):
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "TaskFlow v1",
      "description": "First release",
      "role": "owner",
      "memberCount": 3,
      "taskStats": {
        "total": 12,
        "todo": 4,
        "inProgress": 5,
        "done": 3
      },
      "createdAt": "2025-01-15T09:00:00Z"
    }
  ]
}
```

---

### POST /api/projects

Create a new project. Creator becomes owner.

**Request Body**:
```json
{
  "name": "New Project",
  "description": "Optional description"
}
```

**Validation**:
- `name`: required, max 100 characters
- `description`: optional, max 500 characters

**Responses**:
| Status | Body | Condition |
|--------|------|-----------|
| 201 | `{ "id": "uuid", "name": "New Project", "description": "...", "createdAt": "..." }` | Success |
| 400 | `{ "error": "Name is required" }` | Missing name |

---

### GET /api/projects/:id

Get project details with member list.

**Response** (200):
```json
{
  "id": "uuid",
  "name": "TaskFlow v1",
  "description": "First release",
  "members": [
    { "id": "uuid", "email": "owner@example.com", "role": "owner", "joinedAt": "..." },
    { "id": "uuid", "email": "member@example.com", "role": "member", "joinedAt": "..." }
  ],
  "createdAt": "2025-01-15T09:00:00Z"
}
```

**Errors**:
| Status | Condition |
|--------|-----------|
| 403 | Not a project member |
| 404 | Project not found |

---

### POST /api/projects/:id/invite

Invite a user to the project. Owner only.

**Request Body**:
```json
{
  "email": "newmember@example.com"
}
```

**Responses**:
| Status | Body | Condition |
|--------|------|-----------|
| 200 | `{ "message": "Invitation sent" }` | Success |
| 403 | `{ "error": "Only project owner can invite" }` | Not owner |
| 404 | `{ "error": "User not found" }` | Email not registered |

---

## Tasks

### GET /api/projects/:id/tasks

List tasks in a project with optional filters.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `todo \| in_progress \| done` | all | Filter by status |
| `assignee` | UUID | all | Filter by assignee |
| `priority` | `low \| medium \| high` | all | Filter by priority |
| `sort` | `created \| priority \| due_date` | `created` | Sort field |
| `order` | `asc \| desc` | `desc` | Sort direction |

**Response** (200):
```json
{
  "tasks": [
    {
      "id": "uuid",
      "title": "Implement login",
      "description": "JWT-based authentication",
      "status": "in_progress",
      "priority": "high",
      "assignee": { "id": "uuid", "email": "dev@example.com" },
      "dueDate": "2025-02-01",
      "createdBy": { "id": "uuid", "email": "owner@example.com" },
      "createdAt": "2025-01-16T10:00:00Z",
      "updatedAt": "2025-01-17T14:30:00Z"
    }
  ]
}
```

---

### POST /api/projects/:id/tasks

Create a new task in the project.

**Request Body**:
```json
{
  "title": "Implement login",
  "description": "JWT-based authentication",
  "priority": "high",
  "assigneeId": "uuid",
  "dueDate": "2025-02-01"
}
```

**Validation**:
- `title`: required, max 200 characters
- `description`: optional
- `priority`: optional, one of `low | medium | high`, default `medium`
- `assigneeId`: optional, must be a project member
- `dueDate`: optional, ISO date format

**Responses**:
| Status | Body | Condition |
|--------|------|-----------|
| 201 | Task object | Success |
| 400 | `{ "error": "Title is required" }` | Validation failure |
| 400 | `{ "error": "Assignee is not a project member" }` | Invalid assignee |

---

### PATCH /api/tasks/:id

Update task fields (status, assignee, priority, etc.).

**Request Body** (all fields optional):
```json
{
  "title": "Updated title",
  "status": "done",
  "priority": "low",
  "assigneeId": "uuid",
  "dueDate": "2025-02-15"
}
```

**Responses**:
| Status | Body | Condition |
|--------|------|-----------|
| 200 | Updated task object | Success |
| 403 | `{ "error": "Not a project member" }` | Unauthorized |
| 404 | `{ "error": "Task not found" }` | Invalid task ID |

**Side Effects**:
- Status change → notification to all project members
- Assignee change → notification to new assignee

---

### DELETE /api/tasks/:id

Delete a task. Only project owner or task creator.

**Responses**:
| Status | Body | Condition |
|--------|------|-----------|
| 204 | (empty) | Success |
| 403 | `{ "error": "Only owner or creator can delete" }` | Unauthorized |
| 404 | `{ "error": "Task not found" }` | Invalid task ID |

---

## Notifications

### GET /api/notifications

List notifications for the authenticated user.

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `unreadOnly` | boolean | `false` | Show only unread |
| `limit` | number | 20 | Max results |
| `cursor` | string | — | Pagination cursor |

**Response** (200):
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "task_assigned",
      "message": "You were assigned to 'Implement login'",
      "isRead": false,
      "metadata": { "taskId": "uuid", "projectId": "uuid" },
      "createdAt": "2025-01-17T14:30:00Z"
    }
  ],
  "unreadCount": 3,
  "nextCursor": "cursor-string"
}
```

---

### PATCH /api/notifications/:id/read

Mark a single notification as read.

**Response** (200):
```json
{ "id": "uuid", "isRead": true }
```

---

### PATCH /api/notifications/read-all

Mark all notifications as read.

**Response** (200):
```json
{ "updatedCount": 5 }
```

---

## Error Response Format

All error responses follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "code": "OPTIONAL_ERROR_CODE"
}
```

## Notification Types

| Type | Trigger | Target |
|------|---------|--------|
| `task_assigned` | Task assigned to user | Assignee |
| `task_status_changed` | Task status updated | All project members |
| `project_invited` | Invited to project | Invitee |
