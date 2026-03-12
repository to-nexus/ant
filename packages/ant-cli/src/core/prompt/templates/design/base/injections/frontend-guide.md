## 🎨 FRONTEND SYSTEM DESIGN GUIDE

**Document**: `fe-system-{name}.md` (e.g., `fe-system-main.md`, `fe-system-web.md`)  
**Role**: Client-side architecture derived from PRD requirements  
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

### 3. API Layer Scope

**Principle**: This document describes the architecture of API consumption — adapter boundaries, error propagation policies, auth lifecycle ownership — NOT the API interface specification (endpoints, DTOs, schemas). Interface details are defined separately and consumed during the coding phase.

- Infrastructure/external communication boundary receives external responses → orchestration boundary transforms to domain models
- Describe expected API consumption patterns based on PRD requirements
- External services: List only if PRD explicitly requires (with PRD reference)

---

### 4. Infrastructure Independence

**Observation target**: Does the project consume backend APIs or external services whose implementing service is unavailable during development (unconstructed backend, third-party API, cross-project dependency)?

| Checkpoint | What to observe |
|-----------|----------------|
| **Backend API consumption** | Does the PRD describe backend API consumption where the backend may not yet exist? |
| **External service adapters** | Does PRD specify third-party APIs or cross-project service dependencies? |

**Principle**: When the implementing service is unavailable, each infrastructure port consuming that service MUST define production and mock implementation strategies in the catalog section where that adapter is introduced.

**Constraint**: State ONLY the port name, its role, and the two strategy labels (production + mock). Do NOT specify implementation details (class names, in-memory data structures, environment variable names, mock libraries).

**Constraint**: Mock implementations MUST follow the same DTO contracts as production (as derived from PRD requirements).

---

## Section Catalog (CLOSED LIST)

**Constraint**: The sections below are the ONLY sections allowed in this document (`fe-system-{name}.md`). Do NOT create sections outside this catalog. Decompose task descriptions are topic HINTS — the actual sections written MUST come from this catalog.

Adapt sections based on the architecture pattern selected in §1. Skip sections marked "conditional" when the condition is not met.

{{#if filteredCatalog}}
{{{filteredCatalog}}}
{{else}}
{{> design/base/catalogs/frontend-catalog}}
{{/if}}

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
| PRD formula / calculation reproduction | Reference PRD section; domain boundary owns the calculation |
| HTTP status codes / transport-level classifications | Describe error FLOW between boundaries, not status codes |
| Routing as a standalone section | Route access policy belongs in Architecture Boundaries |

---

## Anti-Patterns

❌ Listing backend DTOs as "Domain models"  
❌ Putting business logic in orchestration/coordination boundary  
❌ Naming specific components (e.g., "GNB", "TradingPanel", "FilterBar")  
❌ Specifying props/interfaces  
❌ Defining API interface details (endpoints, DTOs, schemas) — belongs in API contract and coding phase  
❌ Framework-specific details (hooks, lifecycle)  
❌ Step-by-step numbered procedures (describe POLICY instead)  
❌ HTTP status codes or transport details (describe error FLOW between boundaries)  
❌ Reproducing PRD formulas/calculations verbatim (REFERENCE the PRD section instead)  
❌ View-model field-by-field property listings (describe what domain concepts are aggregated)  
❌ Validation rules as implementation-ready expressions (reference PRD section for concrete values)  

---

## Key Reminders

- **Describe architecture, not implementation**
- **Trust LLM to infer specifics from principles**
- **Keep abstractions framework-agnostic**
- **Reference PRD for all requirements — API interface details are consumed during the coding phase**
- **Decompose task descriptions are HINTS — this section catalog is the scope ceiling**
