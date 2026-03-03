## 🎨 FRONTEND SYSTEM DESIGN GUIDE

**Document**: `fe-system-{name}.md` (e.g., `fe-system-main.md`, `fe-system-web.md`)  
**Role**: Consumer of the corresponding `api-contract-{name}.md`  
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

- **Never redefine** DTOs from the corresponding api-contract document
- **Always reference** contract sections
- Infrastructure/external communication boundary receives DTOs → orchestration boundary transforms to domain models
- External services: List only if PRD explicitly requires (with PRD reference)

---

## Section Catalog (CLOSED LIST)

**Constraint**: The sections below are the ONLY sections allowed in this document (`fe-system-{name}.md`). Do NOT create sections outside this catalog. Decompose task descriptions are topic HINTS — the actual sections written MUST come from this catalog.

Adapt sections based on the architecture pattern selected in §1. Skip sections marked "conditional" when the condition is not met.

### § Overview
- System purpose, selected architecture pattern with rationale (reference observation from §1.1)
- PRD constraints relevant to architecture (platform, integrations, prohibitions)
- API contract compliance statement (reference the corresponding `api-contract-{name}.md`)

### § Architecture Boundaries
- For each boundary: name, responsibility, what it owns
- Dependency direction between boundaries
- What crosses each boundary (data types, commands, events)
- Rendering strategy per route category (SSR/CSR/hybrid) if applicable

### § API Integration & Error Strategy
- Infrastructure adapter role (single adapter wrapping external communication)
- Auth lifecycle POLICY (describe ownership and boundary flow, not step-by-step procedure)
- Error propagation POLICY (how errors flow across boundaries, not HTTP status codes)

### § State Management & Data Flow
- State ownership per boundary (global vs route-scoped vs view-local)
- Server state caching POLICY (invalidation triggers, staleness handling)
- Optimistic update POLICY (when to apply, reconciliation principle)
- Real-time data strategy if applicable (polling vs push, coordination ownership)

### § Domain Rules (conditional: if explicit domain boundary selected)
- View-model derivation PRINCIPLES (what they aggregate, not field-level definitions)
- Format policy reference (point to PRD section, do NOT redefine formulas)
- Client-side validation invariants

### § Directory Structure & Boundary Mapping (conditional: if framework augmentation injected)
- Boundary-to-directory mapping principle
- Import direction enforcement rules
- Coding phase directives

---

## Scope Ceiling

**Constraint**: The following topics MUST NOT appear as sections in this document. They belong in UI spec, coding phase, or implementation — NOT in system design.

| Forbidden Topic | Reason |
|----------------|--------|
| Component architecture / page composition | UI implementation — coding phase decides component structure |
| Component names, hierarchies, or trees | LLM-invented identifiers forbidden in system design |
| Micro-interactions / animation catalog | Implementation detail |
| Responsive breakpoint specifications | Implementation detail (reference PRD section if needed) |
| Step-by-step procedural flows | System design describes POLICY, not STEPS |
| Props, interfaces, or function signatures | Implementation detail |
| CSS / layout / grid specifications | Implementation detail |

---

## Anti-Patterns

❌ Listing backend DTOs as "Domain models"  
❌ Putting business logic in orchestration/coordination boundary  
❌ Naming specific components (e.g., "GNB", "TradingPanel", "FilterBar")  
❌ Specifying props/interfaces  
❌ Redefining APIs or DTOs already in the corresponding api-contract document  
❌ Framework-specific details (hooks, lifecycle)  
❌ Step-by-step numbered procedures (describe POLICY instead)  
❌ HTTP status codes or transport details (describe error FLOW between boundaries)  

---

## Key Reminders

- **Describe architecture, not implementation**
- **Trust LLM to infer specifics from principles**
- **Keep abstractions framework-agnostic**
- **Reference PRD for requirements, the corresponding api-contract document for DTOs**
- **Decompose task descriptions are HINTS — this section catalog is the scope ceiling**
