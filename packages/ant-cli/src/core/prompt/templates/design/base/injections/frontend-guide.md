## 🎨 FRONTEND DESIGN DOCUMENT GUIDE

**Document Type**: `fe-system-design.md`
**Role**: HOW Frontend CONSUMES api-contract.md
**Phase**: Written AFTER api-contract.md is finalized

### 🎯 What This Document IS

**Frontend Implementation Architecture:**
- ✅ HOW to consume APIs at an architectural level (client boundary, error policy, caching/state ownership)
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
- ❌ NO hard-coded route strings/storage keys unless PRD explicitly requires them

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

**Focus**: Component purpose and contract (props), NOT implementation (framework hooks, lifecycle, handlers)

### 3. State Management

**State Strategy:**
- Global state solution (if needed; choice left to implementation unless PRD specifies)
- Server state solution (if needed; choice left to implementation unless PRD specifies)
- Local state pattern (when to use component-local state)

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

**Screens/Routes (conceptual):**
- List major screens and access rules
- If PRD provides exact route paths, you may include them; otherwise keep route strings abstract

**Route Guards:**
- Protected routes require authentication
- Redirect strategy (unauthenticated → login screen)

**Focus**: Route definitions and access rules, NOT router API specifics

### 5. API Integration Layer ⚠️ MOST CRITICAL

**🚨 CRITICAL RULES:**
1. **NEVER redefine DTOs** - Import/reference from api-contract.md
2. **Reference contract explicitly**: "Uses LoginRequest from api-contract.md §3.1"
3. **Focus on HOW to call**, not WHAT the interface is

**⚠️ TWO TYPES OF APIs - Different Documentation Rules:**

#### A. Internal Backend API (when api-contract.md exists)
- **Rule**: Reference api-contract.md types, do NOT redefine
- **Focus**: Error handling, state synchronization, token refresh
- **Format**: "Uses [DTO Name] from api-contract.md §X.Y"

#### B. External Public APIs (when PRD specifies external services)
- **Rule**: Document ALL PRD-specified external services/APIs
- **Why**: These are architectural constraints, not implementation choices
- **Format**: `[Service name from PRD]: [Purpose from PRD] (PRD §X.Y)`
- **Example format only**: 
  ```markdown
  ### External Services (Per PRD Requirements)
  - [Service A per PRD]: [Purpose per PRD] (PRD §X.Y)
  - [Service B per PRD]: [Purpose per PRD] (PRD §X.Y)
  - [Service C per PRD]: [Purpose per PRD] (PRD §X.Y)
  ```

**🚨 CRITICAL: "PRD-Specified" vs "You Choose"**
- ✅ PRD says "Use [Service Name]" → Document it exactly as written in PRD
- ✅ PRD says "Integrate with [Service]" → Copy service name from PRD
- ❌ YOU chose implementation library (axios vs fetch) → Don't document (detail)
- ❌ YOU designed API client class structure → Describe abstractly only

**API Client Pattern:**
```markdown
### API Client Architecture
**Pattern**: Type-safe wrapper functions around fetch/HTTP client

**Shared Logic**:
- Base URL configuration
- Request headers (Content-Type, Authorization)
- Response parsing and error extraction
- Token attachment for authenticated requests

**Error Handling**:
- Typed error wrapper (status code, error code, message)
- Errors propagate to error boundaries or state
- Retry logic for transient failures

**For Internal Backend APIs** (from `api-contract.md`):
- **Auth Operations**:
  - Login: Uses LoginRequest → LoginResponse (api-contract.md §3.1)
  - Logout: Uses api-contract.md §3.2
  
- **User Operations**:
  - Get profile: Returns User (api-contract.md §4.1)
  - Error handling: 401 → trigger token refresh or logout flow

**For External Services** (if PRD specifies):
- List ONLY services/APIs that PRD explicitly requires
- Format: `[Service Name from PRD]: [Purpose from PRD] (PRD §X.Y)`
- Do NOT invent service names - copy exact names from PRD
- Example format:
  ```markdown
  ### External Service Integration (Per PRD)
  - [Service A per PRD]: [Purpose per PRD] (PRD §X.Y)
  - [Service B per PRD]: [Purpose per PRD] (PRD §X.Y)
  - [Service C per PRD]: [Purpose per PRD] (PRD §X.Y)
  ```

**Loading & Error States**:
- Per-request loading indicators
- Global loading state for navigation
- Retry UI for failed requests

**Token Refresh Strategy** (if backend auth exists):
- Detect 401 responses
- Attempt token refresh
- Retry original request or redirect to login
```

**Focus**: Integration architecture and policies, not implementation code

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
- Stores auth state using a chosen persistence boundary (details left to implementation unless PRD mandates)
- Redirects to the authenticated landing screen on success
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
