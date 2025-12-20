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

### 2. Component Architecture & Presentation Boundaries

**Presentation Layer Structure:**
- **Screen/Page Boundaries**: Top-level route handlers; orchestrate screen flows
- **Form/Input Boundaries**: Capture user intent; emit commands to Application layer
- **Display Boundaries**: Render Application state as views; no business logic

**For EACH boundary, specify:**
- **Responsibility**: 1 sentence describing WHAT it does (use case or display purpose)
- **Application Dependencies**: Which Application layer contracts it consumes (services, state, commands)
- **Flow**: How user actions become Application commands; how Application state becomes views

**Critical Rules:**
- ❌ DO NOT invent component names (`LoginPage`, `UserProfile`, `NewsCard`)
- ❌ DO NOT specify props/interfaces (`onSuccess`, `userId`, `items`)
- ❌ DO NOT describe component hierarchies or children
- ❌ DO NOT mention framework hooks or lifecycle events
- ✅ DESCRIBE responsibilities using domain/use-case terms
- ✅ REFERENCE Application layer contracts by their architectural roles
- ✅ FOCUS on "what happens when user acts" and "what state drives this view"

**Self-Test:**
- "Did I name a specific component YOU invented?" → DELETE IT
- "Did I describe a boundary's responsibility without naming it?" → CORRECT
- "Could this work with any UI framework?" → CORRECT

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

**API Client Architecture Pattern:**
- **Shared Infrastructure Responsibilities**:
  - Request/response serialization boundary
  - Error translation from HTTP to domain error codes
  - Authentication token attachment policy
  - Base configuration (URLs, headers) encapsulation

- **Error Handling Policy**:
  - HTTP status codes mapped to domain-level errors
  - Transient failures (network, timeout) separated from semantic errors (validation, authorization)
  - Retry policy coordinated with Application layer
  - Error propagation to Presentation layer (error boundaries or state)

- **For Internal Backend APIs** (from `api-contract.md`):
  - Infrastructure layer provides client boundary
  - Application layer invokes operations using contract types (e.g., LoginRequest → LoginResponse from api-contract.md §X)
  - ❌ DO NOT redefine DTOs or endpoints
  - ✅ REFERENCE contract sections explicitly
  - ✅ DESCRIBE error mapping policy (401 → authentication failure, 403 → authorization failure)

- **For External Services** (if PRD specifies):
  - List ONLY services/APIs that PRD explicitly requires
  - Format: `[Exact Service Name from PRD]: [Purpose from PRD] (PRD §X.Y)`
  - ❌ DO NOT invent service names or examples
  - ✅ COPY exact names from PRD

- **State Synchronization**:
  - Loading/error/success states owned by Application layer
  - Presentation observes these states
  - Optimistic updates policy (if applicable per PRD)

- **Authentication Flow** (if applicable):
  - Token refresh triggered on 401 detection
  - Retry original request or redirect based on refresh result
  - Session expiry handling coordinated with Application layer

**Critical Rules:**
- ❌ DO NOT name API client classes or methods YOU invented
- ❌ DO NOT show code examples with function calls
- ✅ DESCRIBE responsibilities and error mappings
- ✅ REFERENCE api-contract.md sections

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

**✅ GOOD (Architecture-Level Description)**:
```markdown
## 5. API Integration

### Authentication Flow (Architecture)
- Presentation boundary captures credential input
- Application layer invokes authentication service using LoginRequest from api-contract.md §3.1
- On success: Application layer updates authentication state; Presentation observes state change and navigates
- On error: Application layer exposes error; Presentation displays message

### Error Handling Strategy
- Infrastructure layer translates HTTP errors to domain error types
- Application layer decides retry vs propagation based on error type
- 401 errors trigger authentication refresh or session termination
- Validation errors propagated to Presentation for field-level display
```

**❌ BAD (Implementation Details or API Redefinition)**:
```markdown
## 5. API Integration

### POST /api/auth/login  ← API definition belongs in api-contract.md!
Request: { email, password }
Response: { accessToken, user }

### LoginForm Component  ← Component name YOU invented!
Props:
- onSubmit: (credentials) => void  ← Props interface is implementation!
- errorMessage?: string

const login = async (email, password) => {  ← Full implementation code!
  const res = await fetch('/api/auth/login', { ... });
  return res.json();
}

### API Client Methods  ← Method names YOU invented!
- authAPI.login(credentials)
- userAPI.getProfile()
```

**Key Mistakes in BAD Example:**
1. Redefining API contract (already in api-contract.md)
2. Naming components YOU invented (LoginForm)
3. Specifying props interfaces (implementation detail)
4. Showing implementation code (NOT System Design)
5. Naming methods/functions YOU chose (authAPI.login)

---

**Purpose**: This guide ensures fe-system-design.md focuses on HOW to build the frontend architecture that consumes the API contract, without duplicating interface definitions.
