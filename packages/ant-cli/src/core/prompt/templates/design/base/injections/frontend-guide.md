## 🎨 FRONTEND SYSTEM DESIGN GUIDE

**Document**: `fe-system-main.md`  
**Role**: Consumer of `api-contract-main.md`  
**Focus**: Client-side architecture selected based on observed project complexity

---

## Core Principles

### 1. Architecture Pattern Selection

#### 1.1 Architecture Observation

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Domain complexity** | Are there client-side business rules, calculations, or state invariants beyond simple data display? |
| **Integration breadth** | Does the client consume or coordinate multiple external interfaces? |
| **State coordination** | Does state cross multiple view boundaries or require real-time synchronization? |

#### 1.2 Architecture Selection Principle

| Complexity Observed | Pattern Direction |
|--------------------|--------------------|
| Minimal domain logic, single integration, view-local state | Flat structure sufficient; framework conventions adequate for boundaries |
| Moderate domain rules, multiple views or integrations | Feature-based or module-based separation |
| Rich domain logic with invariants, cross-cutting state, multiple external boundaries | Explicit layer separation with distinct domain, orchestration, and infrastructure boundaries |

**Constraint**: Do NOT default to the most complex pattern. Observed complexity must justify layer separation.  
**Constraint**: Selected pattern MUST be stated in the design document with explicit boundary responsibilities.

#### 1.3 Directory Structure Principle

**Constraint**: Each architecture boundary specified in this document MUST correspond to a directory-level boundary in the codebase.

**Principle**: Framework wiring mechanisms and architecture boundaries serve complementary purposes:
- Framework mechanisms handle dependency resolution, runtime wiring, and module lifecycle
- Architecture boundaries handle concern separation and dependency direction
- Both coexist; neither substitutes for the other

**Constraint**: Framework conventions alone do NOT satisfy architecture boundary separation when this document specifies explicit boundaries.

---

### 2. Frontend Domain ≠ Backend Domain

**Critical Distinction:**
- Backend Domain: Server-side rules (authorization, data integrity, transactional logic)
- Frontend Domain: Client-side rules (pre-validation, display transformation, UI state invariants)

**Frontend Domain owns:**
- Display models combining multiple DTOs into unified view contexts
- Client-side validation before API calls
- Real-time update merging logic
- Phase/state-dependent UI rules

---

### 3. API Contract Compliance

- **Never redefine** DTOs from api-contract-main.md
- **Always reference** contract sections
- Infrastructure/external communication boundary receives DTOs → orchestration boundary transforms to domain models
- External services: List only if PRD explicitly requires (with PRD reference)

---

## Required Sections

Adapt sections based on the architecture pattern selected in §1:

### § Overview
- System purpose
- Selected architecture pattern with rationale (reference observation from §1.1)
- API contract compliance statement

### § Boundary Responsibilities
- For each boundary in the selected pattern: name, responsibility, what it owns
- Dependency direction between boundaries
- What crosses each boundary (data types, commands, events)

### § Domain Rules (if explicit domain boundary selected)
- Display models (what they aggregate/derive)
- Client-side rules and validations
- Domain invariants

### § State Management
- State ownership per boundary
- Caching strategy
- Optimistic updates (if applicable)

---

## Anti-Patterns to Avoid

❌ Listing backend DTOs as "Domain models"  
❌ Putting business logic in orchestration/coordination boundary  
❌ Naming specific components  
❌ Specifying props/interfaces  
❌ Redefining APIs or DTOs  
❌ Framework-specific details (hooks, lifecycle)  
❌ Technology stack (move to appendix or omit)

---

## Key Reminders

- **Describe architecture, not implementation**
- **Trust LLM to infer specifics from principles**
- **Keep abstractions framework-agnostic**
- **Reference PRD for requirements, api-contract-main.md for DTOs**
