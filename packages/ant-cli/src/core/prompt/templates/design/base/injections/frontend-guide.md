## 🎨 FRONTEND DESIGN DOCUMENT GUIDE

**Document Type**: `fe-system-design.md`
**Role**: HOW Frontend CONSUMES api-contract.md
**Phase**: Written AFTER api-contract.md is finalized

### 🎯 What This Document IS

**Frontend Implementation Architecture:**
- ✅ HOW to consume APIs (client wrappers, error handling)
- ✅ Component architecture (hierarchy, responsibilities, interfaces)
- ✅ State management (strategy, global state, server state)
- ✅ Routing structure (pages, navigation, guards)
- ✅ UI/UX patterns (layout, forms, loading states)

**Characteristics:**
- CONSUMER perspective: How to call APIs, not define them
- REFERENCE contract types: "Uses LoginRequest from api-contract.md"
- ARCHITECTURE focus: Component boundaries, data flow, patterns

### 🚫 What This Document is NOT

- ❌ NO API definitions (already in api-contract.md)
- ❌ NO DTO redefinition (import/reference only!)
- ❌ NO full component implementations (only interfaces)
- ❌ NO detailed event handlers (only high-level flow)

---

## 📐 REQUIRED SECTIONS

### 1. Overview & API Contract Compliance (mandatory)

**MUST acknowledge api-contract.md:**
```markdown
## 1. Overview

### System Purpose
[User-facing description of what this frontend does]

### Architecture
[High-level: component tree, state flow strategy]

### API Contract Compliance
This frontend implements the **consumer side** of `api-contract.md`.
All API calls use types defined in the contract.
NO DTOs are redefined in this document.
```

### 2. Component Architecture

**Component Hierarchy:**
- Page components (top-level routes)
- Container components (data fetching, business logic)
- Presentational components (pure UI, props-driven)

**For EACH major component, specify:**
- **Responsibility**: 1 sentence describing WHAT it does
- **Props interface**: ≤5 key fields with types

**Example:**
```markdown
### LoginPage
**Responsibility**: Handles user authentication flow and redirects on success

**Interface** (props):
- `onLoginSuccess: (user: User) => void` - Callback after successful login
- `redirectTo?: string` - Optional redirect path after login

**Children**:
- LoginForm - Captures credentials, validates, submits
- ErrorDisplay - Shows authentication errors
```

**Focus**: Component purpose and contract (props), NOT implementation (useState, useEffect, handlers)

### 3. State Management

**State Strategy:**
- Global state solution (Context API, Redux, Zustand, Jotai, etc.)
- Server state solution (React Query, SWR, RTK Query, etc.)
- Local state pattern (when to use useState)

**Global State Structure:**
```markdown
- `auth`: User authentication state (user, token, isAuthenticated)
- `app`: Application-level state (theme, locale, notifications)
```

**Server State:**
- Which queries are cached
- Invalidation strategy
- Optimistic updates (if applicable)

**Focus**: State ownership and boundaries, NOT implementation (reducer logic, selectors)

### 4. Routing Structure

**Routes:**
```markdown
- `/` - HomePage (public)
- `/login` - LoginPage (public)
- `/dashboard` - DashboardPage (protected, requires auth)
- `/profile` - ProfilePage (protected)
```

**Route Guards:**
- Protected routes require authentication
- Redirect strategy (unauthenticated → `/login`)

**Focus**: Route definitions and access rules, NOT router API specifics

### 5. API Integration Layer ⚠️ MOST CRITICAL

**🚨 CRITICAL RULES:**
1. **NEVER redefine DTOs** - Import/reference from api-contract.md
2. **Reference contract explicitly**: "Uses LoginRequest from api-contract.md §3.1"
3. **Focus on HOW to call**, not WHAT the interface is

**API Client Pattern:**
```markdown
### API Client Architecture
**Pattern**: Type-safe wrapper functions around fetch

**Shared Logic**:
- Base URL configuration
- Request headers (Content-Type, Authorization)
- Response parsing and error extraction
- Token attachment for authenticated requests

**Error Handling**:
- APIError class wraps HTTP errors
- Includes status code, error code, message
- Thrown errors bubble to UI error boundaries

**For EACH API endpoint group**:
- **Auth API** (`/api/auth/*`):
  - `login(credentials: LoginRequest): Promise<LoginResponse>` - Uses LoginRequest from api-contract.md §3.1
  - `logout(): Promise<void>` - Uses api-contract.md §3.2
  - Token management: Store in localStorage, attach to requests
  
- **User API** (`/api/users/*`):
  - `getProfile(): Promise<User>` - Uses User from api-contract.md §3.3
  - Error handling: 401 → redirect to login

**Loading States**:
- Per-request loading indicators
- Global loading state (for navigation)

**Token Refresh**:
- Detect 401 responses
- Attempt refresh with refreshToken
- Retry original request or redirect to login
```

**Focus**: API client architecture and error handling strategy

### 6. UI/UX Design (if specified in PRD)

- Layout structure (header, sidebar, main content)
- Design system tokens (if specified)
- Responsive breakpoints (if mobile required)
- Form validation (client-side matching API constraints)

### 7. Technology Stack

**Framework & Version**: (per PRD, e.g., React 18, Vue 3, Svelte 4)
**Build Tool**: (per PRD, e.g., Vite, webpack, Next.js)
**Key Libraries**:
- Routing: react-router, @tanstack/router, etc.
- HTTP client: fetch (native), axios, ky
- State: As chosen in Section 3
- UI: Component library if specified in PRD

---

## ⚠️ CRITICAL RULES FOR FRONTEND

### Rule 1: NO API Definition
**Frontend NEVER defines APIs, only consumes them!**

**❌ WRONG**:
```markdown
### API: POST /api/auth/login
Request: { email, password }  ← This is API definition!
```

**✅ CORRECT**:
```markdown
### API Integration: Authentication
- Uses `login(LoginRequest): LoginResponse` from api-contract.md §3.1
- Stores accessToken in localStorage
- Redirects to /dashboard on success
```

### Rule 2: NO DTO Duplication

**❌ WRONG**:
```typescript
interface LoginRequest {  ← Duplicating contract!
  email: string;
  password: string;
}
```

**✅ CORRECT**:
```typescript
import type { LoginRequest, LoginResponse } from 'api-contract-types';
// Or simply: "Uses LoginRequest from api-contract.md"
```

### Rule 3: Reference Contract Explicitly

**Every API usage must reference contract:**
```markdown
- `authAPI.login()` uses LoginRequest → LoginResponse (api-contract.md §3.1)
- `userAPI.getProfile()` returns User (api-contract.md §4.1)
```

---

## ✅ GOOD vs BAD Examples

**✅ GOOD (Frontend HOW)**:
```markdown
## 5. API Integration

### Authentication Flow
1. LoginForm captures credentials
2. Call `authAPI.login(credentials)` - uses LoginRequest from api-contract.md §3.1
3. On success: Store tokens, update auth state, redirect
4. On error: Display error message from ErrorResponse

### Error Handling Strategy
- Wrap all API calls in try/catch
- 401 errors → trigger token refresh or logout
- Network errors → show retry button
- Validation errors → display per-field messages
```

**❌ BAD (API definition or implementation)**:
```markdown
## 5. API Integration

### POST /api/auth/login  ← This is API definition, not Frontend!
Request: { email, password }
Response: { accessToken, user }

const login = async (email, password) => {  ← This is implementation code!
  const res = await fetch(...);
  return res.json();
}
```

---

## 🎮 Game-Specific Constraint

**If this is a game frontend:**

**FORBIDDEN in Frontend Design**:
- ❌ Game physics formulas (ball trajectory, collision detection)
- ❌ Game state update logic (score calculation, win conditions)
- ❌ Rendering algorithms (sprite positioning, animation frames)

**ALLOWED**:
- ✅ Game screen components (PlayField renders game world, HUD shows score)
- ✅ Input handling (keyboard → command mapping)
- ✅ Game state visualization (state → visual representation)

**Treat game engine as abstract service:**
```markdown
### Game State Integration
- Game engine provides state updates
- PlayField component renders state visually
- Input system sends commands to engine
- HUD displays derived metrics (score, timer)
```

---

**Purpose**: This guide ensures fe-system-design.md focuses on HOW to build the frontend architecture that consumes the API contract, without duplicating interface definitions.
