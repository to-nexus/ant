## 🎨 FRONTEND DESIGN DOCUMENT GUIDE

**Purpose**: HOW FRONTEND CONSUMES api-contract.md

**⚠️ CRITICAL RULE: FRONTEND NEVER DEFINES APIs, ONLY CONSUMES THEM!**

**🚨 MOST IMPORTANT: API Contract is IMMUTABLE - Follow EXACT specifications!**
- ✅ Copy endpoint paths EXACTLY as written (e.g., `POST /rooms/create` NOT `/rooms`)
- ✅ Copy field names EXACTLY as written (e.g., `userId` NOT `user_id`)
- ✅ Your "RESTful conventions" or "best practices" do NOT override the contract
- ❌ DO NOT simplify, normalize, or "improve" the API contract

**Your first section MUST acknowledge the API contract:**
```markdown
## 1. Overview
...

### API Contract
This frontend implements the consumer side of `api-contract.md`.
All DTOs and endpoints are defined in the API contract document.
```

════════════════════════════════════════════════════════════════════════════════

### REQUIRED SECTIONS

#### 1. Overview
- System purpose (user-facing description)
- High-level architecture (component tree, state flow)
- Core user journeys (≤5 flows)

#### 2. Component Architecture
- Component hierarchy (Pages → Containers → Components)
- Component responsibilities (1 sentence each)
- Component interfaces (props only, ≤10 lines):
  ```typescript
  interface LoginFormProps {
    onSubmit: (credentials: LoginRequest) => Promise<void>;  // LoginRequest from api-contract.md
    isLoading: boolean;
  }
  ```

#### 3. State Management
- State strategy (Context API, Redux, Zustand, React Query)
- Global state structure (user auth, app settings)
- Server state management (how API data is cached/synced)

#### 4. Routing Structure
- Route definitions (path → component mapping)
- Protected routes (auth requirements)
- Route parameters and navigation flow

#### 5. API Integration Layer ⚠️ MOST IMPORTANT

**Use api-contract.md types!**

**⚠️ CRITICAL: NO DTO DUPLICATION!**
- ❌ DO NOT redefine DTOs from api-contract.md
- ✅ ONLY import/use: "Uses LoginRequest from api-contract.md"
- ✅ Focus on HOW to call APIs, not WHAT the interface is

```typescript
// API Client (type-safe wrappers)
// ✅ CORRECT: Import/reference contract types
import type { LoginRequest, LoginResponse, User } from 'api-contract-types';

export const authAPI = {
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    
    if (!response.ok) {
      throw new APIError(await response.json());
    }
    
    return response.json();
  },
  
  async getProfile(): Promise<User> {
    const response = await fetch(`${API_BASE}/users/me`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    
    if (!response.ok) {
      throw new APIError(await response.json());
    }
    
    return response.json();
  }
};
```

**List ALL API integrations:**
- Which components call which endpoints
- Error handling strategy (display errors, retry logic)
- Loading states management
- Token refresh flow (if applicable)

**KEY RULES:**
- ✅ Show HOW to call: fetch, headers, error handling
- ✅ Import contract types: "LoginRequest", "User"
- ✅ Error handling: APIError class, retry logic
- ❌ NO DTO redefinition (that's in contract!)
- ❌ NO "LoginRequest = { email: string, ... }" (that's duplication!)

#### 6. UI/UX Design
- Layout structure (header, sidebar, main content)
- Design system (colors, typography, spacing if specified)
- Responsive breakpoints (if mobile support required)
- Form validation (client-side validation matching API constraints)

#### 7. Technology Stack
- Framework (React 18, Vue 3, etc.) - per PRD
- Build tool (Vite, webpack) - per PRD
- Key libraries (react-router, axios, react-query, etc.)
- Styling approach (Tailwind, CSS Modules, styled-components)

════════════════════════════════════════════════════════════════════════════════

### WRITING RULES for Frontend

**DO:**
- ✅ Show how to CONSUME APIs (client wrappers, hooks)
- ✅ Use api-contract.md types explicitly
- ✅ Component interfaces: props only (≤10 lines each)

**DON'T:**
- ❌ NO API endpoint definitions (those are in api-contract.md!)
- ❌ NO full component implementations
- ❌ NO assumptions about API structure (use contract!)

