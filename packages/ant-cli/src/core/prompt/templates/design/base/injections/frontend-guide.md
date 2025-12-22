## 🎨 FRONTEND SYSTEM DESIGN GUIDE

**Document**: `fe-system-design.md`  
**Role**: Consumer of `api-contract.md`  
**Focus**: Client-side architecture with Domain/Application/Presentation/Infrastructure layers

---

## Core Principles

### 1. Layered Architecture

Frontend uses **4 layers** with clear separation:

**Domain Layer (Client-Side Business Rules)**
- UI-specific models (NOT backend DTOs)
- Client-side validation and calculations
- Display transformation logic
- UI state invariants

**Application Layer (Use Case Orchestration)**
- Coordinates Domain, Presentation, Infrastructure
- Owns application state (loading, errors, current context)
- Transforms DTOs → Domain models
- No business logic (delegate to Domain)

**Presentation Layer (UI Boundaries)**
- Captures user intent → Application commands
- Observes Application state → renders views
- No API calls, no business logic
- Describe responsibilities, not component names

**Infrastructure Layer (External Communication)**
- API client (uses api-contract.md DTOs)
- HTTP error → Domain error translation
- Authentication, WebSocket, external services (if PRD specifies)
- Returns DTOs (Application transforms them)

---

### 2. Frontend Domain ≠ Backend Domain

**Critical Distinction:**
- Backend Domain: Server-side rules (DB transactions, price calculations, authorization)
- Frontend Domain: Client-side rules (pre-validation, UI calculations, display models)

**Frontend Domain owns:**
- Display models combining multiple DTOs
- Client-side validation before API calls
- Real-time update merging logic
- Phase/state-dependent UI rules

**Example**: Trading page combines `TokenInfo` + `GraduationStatus` + `WalletBalance` DTOs into a single `TradingContext` domain model.

---

### 3. API Contract Compliance

- **Never redefine** DTOs from api-contract.md
- **Always reference** contract sections: "Uses LoginRequest from api-contract.md §3.1"
- Infrastructure receives DTOs → Application transforms to Domain models
- External services: List only if PRD explicitly requires (with PRD reference)

---

## Required Sections

### § Overview
- System purpose
- Architecture (4-layer pattern)
- API contract compliance statement

### § Domain Layer
- Display models (what they aggregate/derive)
- Client-side rules and validations
- UI calculation logic
- Domain invariants

### § Application Layer
- Use case flows (Presentation → Domain → Infrastructure → state update)
- State ownership strategy
- Error handling coordination

### § Presentation Layer
- Screen/view responsibilities (not names!)
- User flow patterns
- Domain models consumed

### § Infrastructure Layer
- API integration pattern (reference api-contract.md)
- Error translation mapping
- External services (if PRD specifies)

### § State Management
- Ownership by layer (Domain/Application/Presentation/Infrastructure)
- Caching strategy
- Optimistic updates (if applicable)

---

## Anti-Patterns to Avoid

❌ Listing backend DTOs as "Domain models"  
❌ Putting business logic in Application layer  
❌ Naming specific components (`LoginForm`, `TradingCard`)  
❌ Specifying props/interfaces  
❌ Redefining APIs or DTOs  
❌ Framework-specific details (hooks, lifecycle)  
❌ Technology stack (move to appendix or omit)

---

## Key Reminders

- **Describe architecture, not implementation**
- **Trust LLM to infer specifics from principles**
- **Keep abstractions framework-agnostic**
- **Reference PRD for requirements, api-contract.md for DTOs**

