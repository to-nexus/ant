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
- Component hierarchy (Pages → Containers → Presentational)
- Component responsibilities (1 sentence: WHAT it does)
- Component interfaces (props only, ≤5 key fields):
  ```typescript
  interface LoginFormProps {
    onSubmit: (credentials: LoginRequest) => Promise<void>;
    isLoading: boolean;
  }
  ```

**WRITE AT THIS LEVEL** - Component purpose, props interface
**DON'T WRITE** - useState calls, useEffect logic, event handlers, validation code

#### 2.1 ⚠️ Game-Specific Frontend Constraint

**If this is a game project (physics, rendering, animation):**

Frontend System Design MUST NOT contain game physics or rendering formulas.

**Describe only:**
- Roles of game screen components (e.g., PlayField/GameField: renders game world, HUD: shows score/balls)
- Engine abstraction interface name and high-level contract (e.g., `GameEngine.update(input, time) → GameState`)
- State flow at boundary level: Input → InputAdapter/InputProvider → Runtime/Orchestration → Domain Engine → GameState → Presentation components
- React components as the concrete renderer for GameState (no separate “Renderer layer” beyond the Presentation components)

**FORBIDDEN in frontend design:**
- ❌ Physics formulas, collision algorithms, movement equations
- ❌ Rendering-specific commands (CSS transforms, Canvas API, WebGL calls)
- ❌ Animation parameters (angles, durations, easing functions)
- ❌ Game loop implementation details (requestAnimationFrame logic)
- ❌ Concrete field structures for internal game state (e.g., `{ x, y, vx, vy }`)

Treat the game engine as an abstract domain service (like a backend API): describe **how UI depends on it**, not **how it works internally**.

#### 2.2 Example: Responsibility Boundaries in Frontend-Only Game Architectures
- This is **one common mapping** when you choose a layered/clean-style separation; you MAY adopt other patterns (e.g., ECS, actor), but you MUST still respect the high-level rules below.
- **View / Presentation Boundary** (e.g., `GameRoomView`, `GameFieldView`):
  - Renders visual output based on current game/session state passed in as props
  - Handles user input events and translates them into abstract commands (e.g., `MoveLeft`, `PauseGame`) via callbacks to an InputAdapter/InputProvider or container boundary
  - Does NOT own authoritative game/domain state or the main loop
- **Container / Orchestration / Runtime Boundary** (e.g., `GameRuntime`, `GameRoomController`):
  - Coordinates game/session lifecycle, navigation events, and overall orchestration
  - Owns the main loop/tick scheduling for real-time games (without mentioning specific APIs like `requestAnimationFrame`)
  - Invokes domain engine/services and updates stored state, then passes state/handlers down to views
- **Domain / Rules Boundary** (framework-agnostic):
  - Encapsulates game rules and state transitions; exposed via clear, framework-neutral contracts (see system design contract pattern)
- **Platform / Adapter Boundary**:
  - Wraps platform details (timers, storage, network, input devices) behind interfaces/ports; may host InputAdapter implementations
- **Key Rules (pattern-agnostic)**:
  - Single Source of Truth for game/domain state must be explicitly assigned (in a specific boundary) and never duplicated in multiple components
  - Routing/navigation APIs live in the Presentation layer; Application/Runtime emits high-level events or state changes only
  - Avoid naming framework primitives (hooks, specific components, DOM tags) when describing architecture; use neutral terms like "screen component", "UI state store", "rendering loop"

#### 3. State Management
- State strategy choice (Context API, Redux, Zustand, React Query - pick one)
- Global state structure (list key categories only: auth, settings, cache)
- Server state management approach (caching, invalidation strategy)

**WRITE AT THIS LEVEL** - State organization, where state lives
**DON'T WRITE** - Action types, reducer switch cases, selector memoization, middleware

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
import type { LoginRequest, LoginResponse, User } from 'api-contract-types';

export const authAPI = {
  login(credentials: LoginRequest): Promise<LoginResponse>;
  getProfile(): Promise<User>;
};
```

**Implementation Strategy** (describe in prose, NO code):
- HTTP client: fetch with base URL
- Headers: Content-Type, Authorization (Bearer token)
- Error handling: APIError class wraps HTTP errors
- Token management: Store in localStorage, attach to requests

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
