## 📐 DESIGN DOCUMENTS GUIDE

**You have access to design documents that guide your implementation:**

════════════════════════════════════════════════════════════════════════════════

### 📋 API Contract (api-contract.md)

**Purpose**: BINDING SPECIFICATION for FE/BE integration

**What it contains:**
- Exact REST API endpoints with request/response types
- WebSocket event definitions
- Data transfer object (DTO) specifications
- Error response formats
- Authentication flow

**How to use it (for BOTH Frontend & Backend):**
- ✅ Use EXACT field names from the contract (camelCase/snake_case must match!)
- ✅ Implement ALL required fields (no optional fields unless marked with `?`)
- ✅ Follow validation rules (min/max length, format constraints)
- ✅ Return exact HTTP status codes specified
- ❌ DO NOT invent new fields or endpoints not in the contract
- ❌ DO NOT change field types or names

**Example:**
```typescript
// ✅ CORRECT: Matches contract exactly
interface LoginRequest {
  email: string;      // From api-contract.md
  password: string;   // From api-contract.md
}

// ❌ WRONG: Changed field names
interface LoginRequest {
  userEmail: string;  // Contract says "email", not "userEmail"
  pass: string;       // Contract says "password", not "pass"
}
```

════════════════════════════════════════════════════════════════════════════════

### 🎨 Frontend System Design (fe-system-design.md OR system-design.md)

**Purpose**: HOW FRONTEND IMPLEMENTS the consumer side of api-contract.md

**What it contains:**
- Component architecture and hierarchy
- State management strategy (Redux, Context, Zustand)
- Routing structure and protected routes
- API client wrappers (how to call endpoints)
- UI/UX layout and design system

**How to use it (for FRONTEND tasks ONLY):**
- ✅ Follow component structure (Pages → Containers → Components)
- ✅ Use specified state management library
- ✅ Implement routing as described
- ✅ Create API client wrappers that reference api-contract.md types
- ✅ Apply UI/UX guidelines (colors, spacing, responsive breakpoints)
- ❌ DO NOT define API endpoints (they're in api-contract.md!)
- ❌ DO NOT add backend logic or server-side code

**Example:**
```typescript
// ✅ CORRECT: Frontend consumes API contract
import type { LoginRequest, LoginResponse } from '@/types/api-contract';

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
  }
};
```

════════════════════════════════════════════════════════════════════════════════

### ⚙️ Backend System Design (be-system-design.md OR system-design.md)

**Purpose**: HOW BACKEND IMPLEMENTS the provider side of api-contract.md

**What it contains:**
- Architecture layers (Controller, Service, Repository)
- API endpoint implementation details
- Database schema and entity definitions
- Business logic flows
- Authentication and authorization

**How to use it (for BACKEND tasks ONLY):**
- ✅ Follow layered architecture (Controller → Service → Repository)
- ✅ Implement ALL endpoints from api-contract.md
- ✅ Use database schema as specified
- ✅ Apply business logic rules described
- ✅ Return responses matching api-contract.md EXACTLY
- ❌ DO NOT change API response structure
- ❌ DO NOT add frontend code or UI components

**Example:**
```typescript
// ✅ CORRECT: Backend implements API contract
import type { LoginRequest, LoginResponse } from './types/api-contract';

@Controller('/api/auth')
export class AuthController {
  @Post('/login')
  async login(@Body() body: LoginRequest): Promise<LoginResponse> {
    // Implementation follows be-system-design.md service layer
    const user = await this.authService.authenticate(body.email, body.password);
    const tokens = await this.authService.generateTokens(user);
    
    // Response matches api-contract.md EXACTLY
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      }
    };
  }
}
```

════════════════════════════════════════════════════════════════════════════════

### 🔑 KEY RULES

**1. API Contract is KING**
- If there's a conflict between api-contract.md and system-design.md, follow api-contract.md
- All FE/BE integration MUST match api-contract.md field names and types

**2. Know Your Environment**
- Frontend tasks: Focus on API consumption, UI components, state management
- Backend tasks: Focus on API implementation, business logic, data persistence
- NEVER mix concerns: Frontend doesn't define APIs, Backend doesn't do UI

**3. Don't Duplicate Contract**
- ❌ DON'T copy-paste DTO definitions from api-contract.md
- ✅ DO import/reference types: `import type { LoginRequest } from 'api-contract'`
- ✅ DO focus on HOW to implement, not WHAT the interface is

**4. When in Doubt**
- Check api-contract.md for interface definitions
- Check system-design.md for implementation patterns
- Follow the architecture layers described in system-design.md

════════════════════════════════════════════════════════════════════════════════

