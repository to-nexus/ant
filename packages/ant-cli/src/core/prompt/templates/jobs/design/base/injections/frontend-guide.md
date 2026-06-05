## 🎨 FRONTEND SYSTEM DESIGN GUIDE

**Document**: `fe-system-{name}.md` (e.g., `fe-system-main.md`, `fe-system-web.md`)  
**Role**: Client-side architecture derived from PRD requirements  
**Focus**: Client-side architecture selected based on observed project complexity

---

## Core Principles

### 1. Architecture Decisions

#### 1.1 Architecture Observation

| Checkpoint | Observation Target |
|-----------|-------------------|
| **Domain complexity** | Are there client-side business rules, calculations, or state invariants beyond simple data display? |
| **Integration breadth** | Does the client consume or coordinate multiple external interfaces? |
| **State coordination** | Does state cross multiple view boundaries or require real-time synchronization? |

#### 1.2 Architecture Decision Dimensions

Architecture is not a single label — it is the combination of independent design decisions. Evaluate each dimension separately based on observed complexity.

**Dimension 1 — Code Organization**: What primary axis groups the codebase?
- Observe: number of independent feature areas, proportion of shared code across features, overall codebase size
- Principle: If the codebase is small enough that grouping adds no value, keep it flat. If distinct feature areas emerge, organize by feature. If technical layers dominate interaction patterns, organize by layer. The observed structure must justify the chosen axis.

**Dimension 2 — Internal Structure**: How are responsibilities separated and dependency directions controlled within each unit?
- Observe: presence of domain logic vs. pure display, need for external dependency substitution, test independence requirements
- Principle: If no domain logic exists, a flat internal structure suffices. If framework conventions naturally enforce separation, follow them. If domain logic must be isolated from infrastructure, define explicit boundaries with dependency rules. The observed complexity must justify the separation level.

**Dimension 3 — Composition Topology**: Dimension 1 (organization axis) and Dimension 2 (internal structure) are complementary, not alternatives — Dimension 1 picks the 1st-order grouping, and Dimension 2's structure repeats inside each 1st-order unit. When BOTH a feature axis (Dimension 1) AND explicit internal layers (Dimension 2) are chosen, state which axis is the 1st-order directory boundary; otherwise the layout is underdetermined and the coding phase picks one arbitrarily.
- Observe: change locality (does a typical change touch one feature across all its layers, or one layer across all features?), the dominant growth axis, expected collaboration / frequency of feature-level change.
- Two compositions (name one):
  - **feature-primary** — each feature owns its layer subtree (the layer set repeats inside every feature). Feature-Sliced Design (FSD) is the named instance of this composition.
  - **layer-primary** — each layer owns its feature subtree (the feature set repeats inside every layer).
- Principle: Neither is the default. Choose feature-primary when features are the dominant growth axis and the project expects collaboration or frequent feature-level change; choose layer-primary when cross-feature layer reasoning dominates. A unit small enough that grouping adds no value needs neither.

**Constraint**: Do NOT default to the most complex option in any dimension. Observed complexity must justify the decision.
**Constraint**: When Dimension 1 = feature grouping AND Dimension 2 = explicit layers, the composition (Dimension 3) MUST be stated with rationale. Stating the two dimensions without their composition is an incomplete decision.
**Constraint**: Each dimension's decision MUST be stated with rationale in the design document.
**Constraint**: If the user names a specific architecture (e.g., "Clean Architecture"), decompose it into these dimensions and evaluate each against observed complexity. Do NOT adopt the name as-is.
**Constraint**: Do NOT output a single architecture label as the decision.

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

**Constraint (Wire-internal mapping boundary)**: Wire-format DTO field identifiers come from the api-contract document and are preserved verbatim by the coding phase. If frontend display models / view-models use a different identifier style, mapping between wire DTOs and display models MUST happen at a designated adapter / mapper boundary (e.g., infrastructure ↔ application edge) — NOT by silently renaming wire fields. Identify the boundary that owns this mapping; do NOT let the renaming leak into wire-facing types.

---

### 4. Infrastructure Independence (Service Virtualization)

**Observation target**: Does the project consume backend APIs or external services whose implementing service is unavailable during development (unconstructed backend, third-party API, cross-project dependency)?

| Checkpoint | What to observe |
|-----------|----------------|
| **Backend API consumption** | Does the PRD describe backend API consumption where the backend may not yet exist? |
| **External service adapters** | Does PRD specify third-party APIs or cross-project service dependencies? |

**Principle**: When the implementing service is unavailable, each infrastructure port consuming that service MUST define production and mock implementation strategies (Service Virtualization) in the catalog section where that adapter is introduced.

**Constraint**: For each external-dependency port, state the port name, its role, the two strategy labels (production + mock), and the toggle env var NAME. The toggle name MUST encode the frontend bundler's client-bundle visibility prefix (`NEXT_PUBLIC_USE_MOCK_<NAME>` for Next.js, `VITE_USE_MOCK_<NAME>` for Vite, `REACT_APP_USE_MOCK_<NAME>` for CRA, where `<NAME>` is uppercase snake of the connection name). A bare `USE_MOCK_<NAME>` resolves to `undefined` in client code and the production adapter activates silently — a defect, not a benign warning. Master fallback (same framework prefix as the per-connection toggles) MAY also be named. See `preview-env-contract.md §4.5` for the full naming table. Do NOT specify implementation details (class names, in-memory data structures, mock libraries, switching code).

**Constraint**: Mock implementations MUST follow the same DTO contracts as production (as derived from PRD requirements).

---

## Section Catalog (CLOSED LIST)

**Constraint**: The sections below are the ONLY sections allowed in this document (`fe-system-{name}.md`). Do NOT create sections outside this catalog. Decompose task descriptions are topic HINTS — the actual sections written MUST come from this catalog.

Adapt sections based on the architecture decisions in §1. Skip sections marked "conditional" when the condition is not met.

{{#if filteredCatalog}}
{{{filteredCatalog}}}
{{else}}
{{> jobs/design/base/catalogs/frontend-catalog}}
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
