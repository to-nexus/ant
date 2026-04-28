# System Design Evaluation Rubric

> Rubric for evaluating the quality of auto-generated System Design documents (`architecture/system/`) in the Ant CLI pipeline.

## Table of Contents

1. [Overview](#1-overview)
2. [System Design Role in the Ant Pipeline](#2-system-design-role-in-the-ant-pipeline)
3. [Document Types and Layer Hierarchy](#3-document-types-and-layer-hierarchy)
4. [Evaluation Categories](#4-evaluation-categories)
5. [Evaluation Checklist](#5-evaluation-checklist)
6. [Scoring Guide](#6-scoring-guide)
7. [Report Template](#7-report-template)
8. [Usage](#8-usage)

---

## 1. Overview

### Purpose

- Evaluate whether auto-generated System Design documents contain sufficient and correct information for the Code Job to produce correct implementations.
- The central question: **"Can the Code Job generate production-quality code from these design documents alone (with PRD as supplementary context)?"**
- Identify gaps that would force the Code Job to make assumptions or produce incorrect implementations.

### System Design Definition

**System Design Documents** are auto-generated outputs from the Design Job, serving as the primary input for the Code Job.

**Location**: `architecture/system/`

**Core Principles**:
- System Design describes **HOW** the system is structured (architecture, boundaries, contracts).
- PRD describes **WHAT** the system does (requirements, behavior, content).
- System Design must be faithful to PRD — it translates WHAT into HOW without inventing requirements.

### System Design vs PRD vs Code — Responsibility Boundary

| Responsibility | PRD (WHAT) | System Design (HOW) | Code (Implementation) |
|---------------|------------|---------------------|----------------------|
| Product goals, non-goals | Defines | — | — |
| Functional requirements | Defines | Translates to architecture | Implements |
| API contracts (endpoints, types, behavior) | — | Defines (Layer 0) | Implements exactly |
| Architecture patterns, boundaries | — | Defines (Layer 1) | Follows |
| Domain models, data structures | — | Defines | Implements |
| Component hierarchy, UI wiring | — | — | Decides |
| Framework-specific code | — | — | Decides |

---

## 2. System Design Role in the Ant Pipeline

### 2.1 Data Flow

```
PRD (plan/prd.md)
    ↓ read by Design Job
Design Job
    ├─ detect: determines domain/environment from PRD
    ├─ decompose: breaks into document generation tasks
    └─ docGen: generates design documents treating PRD as "ABSOLUTE TRUTH"
        └─► architecture/system/
            ├─ api-contract-*.md   (Layer 0: WHAT — immutable spec)
            ├─ fe-system-*.md      (Layer 1: HOW — frontend guide)
            └─ be-system-*.md      (Layer 1: HOW — backend guide)
                ↓
Code Job (consumes PRD + design documents simultaneously)
    ├─ decompose: plans implementation tasks
    ├─ plan: creates per-task implementation plans using designDoc
    └─ execute: generates code from designDoc + prdSpec
```

### 2.2 What the Code Job Needs from Design Documents

| Document | What Code Job reads | Why it matters |
|----------|-------------------|----------------|
| **API Contract** | Endpoints, types, fields, constraints, error codes | Source of truth for ALL integration work — frontend and backend must match exactly |
| **FE System Design** | Architecture boundaries, state management, routing, API integration patterns | Determines frontend project structure and implementation approach |
| **BE System Design** | Architecture boundaries, database schema, business logic placement, auth strategy | Determines backend project structure and implementation approach |
| **PRD** (supplementary) | Original requirements, content, constraints | Fills gaps and verifies design completeness |

### 2.3 Design Document Priority Hierarchy in Code Job

```
┌─────────────────────────────────────────┐
│ API Contract (Layer 0)                  │  ← Defines WHAT (immutable)
│ - Endpoints, types, behavior            │
├─────────────────────────────────────────┤
│ System Design (Layer 1)                 │  ← Describes HOW (guide)
│ - Architecture, patterns, flow          │
├─────────────────────────────────────────┤
│ Your Code (Layer 2)                     │  ← Implements (concrete)
└─────────────────────────────────────────┘
```

**Golden Rule**: Layer 0 > Layer 1 > Code conventions. When layers conflict, higher layer wins.

---

## 3. Document Types and Layer Hierarchy

Each document type serves a distinct purpose and requires a different evaluation lens.

### 3.1 API Contract (`api-contract-*.md`) — Layer 0

**Role**: Immutable specification. Defines WHAT endpoints, types, and behaviors exist.

**Abstraction level**: Concrete and precise. Exact field names, types, response codes, and validation rules are REQUIRED.

**Evaluation lens**: Completeness and precision. Every endpoint must be fully specified. Ambiguity here directly causes frontend-backend mismatches.

**Expected content**:
- Endpoint specifications (identifier, method, request/response schemas)
- Shared DTO definitions (field names, types, constraints)
- Authentication and authorization requirements
- Error handling conventions and codes
- Real-time communication schemas (if applicable)

### 3.2 Frontend System Design (`fe-system-*.md`) — Layer 1

**Role**: Implementation guide. Describes HOW the frontend consumes the API Contract.

**Abstraction level**: Architectural. Boundaries, responsibilities, and data flow patterns — not component trees or prop definitions.

**Evaluation lens**: Architectural clarity and implementability. A developer should understand project structure and boundary interactions without being told exact code.

**Expected content**:
- Architecture boundaries and responsibilities
- State management ownership per boundary
- API integration and error strategy (as policies, not procedures)
- Domain rules placement
- External integration adapter patterns
- Directory structure mapping (when framework augmentation present)

### 3.3 Backend System Design (`be-system-*.md`) — Layer 1

**Role**: Implementation guide. Describes HOW the backend implements the API Contract.

**Abstraction level**: Architectural, with permitted concreteness for database schemas and technology choices.

**Evaluation lens**: Architectural clarity and implementability. Business logic placement and data flow should be clear.

**Expected content**:
- Architecture boundaries and responsibilities
- Database design (conceptual schema, relationships, constraints)
- Authentication and authorization boundary placement
- Business logic vs orchestration vs data access ownership
- Caching, async processing, real-time strategies (if applicable)
- Technology stack selection with rationale
- Directory structure mapping (when framework augmentation present)

---

## 4. Evaluation Categories

System Design is evaluated across **6 categories**, weighted by impact on Code Job output quality.

### 4.1 PRD Coverage & Faithfulness (25 points)

**"Does the design document account for ALL PRD requirements without inventing new ones?"**

This is the highest-weighted category because missing coverage causes the Code Job to either skip features entirely or hallucinate implementations.

**Evaluation targets:**
- Every functional requirement in the PRD has a corresponding architectural decision or contract specification.
- Non-functional requirements from PRD are reflected as architectural constraints.
- External services named in PRD are documented with exact names (not generic substitutes).
- PRD exclusions are respected — excluded items do not appear anywhere in design.
- No requirements are invented that the PRD does not state (no "best practice" additions).

**Document-specific application:**

| Document | What to check |
|----------|--------------|
| API Contract | Every PRD-described interaction has a corresponding endpoint/event specification |
| FE System Design | Every user-facing feature has an owning boundary and state management approach |
| BE System Design | Every business rule has an owning boundary with data access and logic placement |

**Signals of weak coverage:**
- PRD functional requirement with no corresponding design element.
- External service mentioned in PRD but absent from design.
- Design includes features not in PRD ("analytics dashboard" when PRD has no analytics requirement).
- PRD exclusion violated (excluded technology/service appears in design).

### 4.2 Architectural Abstraction Quality (20 points)

**"Does the design maintain the correct abstraction level for its document type?"**

The critical distinction: API Contracts MUST be concrete and precise. System Designs (FE/BE) MUST be architectural, not implementation-level.

**Document-specific abstraction standards:**

| Document | Correct Level | Too Abstract | Too Concrete |
|----------|--------------|-------------|--------------|
| API Contract | Exact endpoints, field names, types, constraints | "API exists for user management" | N/A — concreteness is required |
| FE System Design | Boundaries, responsibilities, state ownership | "Frontend talks to backend" | Component trees, prop definitions, hook usage |
| BE System Design | Boundaries, business logic placement, data model | "Backend handles requests" | Function signatures, SQL queries, algorithm steps |

**Strong indicators (3–4 for respective document type):**
- API Contract: Every endpoint has method, path, request schema, response schema, error responses.
- FE/BE System Design: Focuses on conceptual architecture (boundaries, flows, ownership).
- FE/BE System Design: Describes modules through contracts and responsibilities, not methods/code.
- Architecture decisions include rationale and tradeoffs.
- PRD-specified technology choices documented as architectural constraints with exact names.

**Weak indicators (0–2):**
- API Contract: Endpoints described vaguely ("user endpoints exist") without specifications.
- FE/BE System Design: Contains framework-internal APIs (lifecycle hooks, state primitives).
- FE/BE System Design: Hardcodes component names, prop definitions, function signatures.
- FE/BE System Design: Reads like code disguised as design (step-by-step procedures, view-model field enumerations).

**Exemptions (not penalized):**
- PRD-specified technology choices stated as architectural constraints (e.g., "Use React 18 with Next.js App Router").
- Environment variable names required for runtime configuration.
- External service endpoints or API base URLs that the Code Job must know.
- Package registry configuration needed for project setup.

### 4.3 Layered Separation & Responsibility Clarity (15 points)

**"Does each boundary have clearly defined, non-overlapping responsibilities?"**

**Strong indicators (3–4):**
- Clear separation of concerns: each boundary owns distinct responsibilities.
- Dependency direction is unidirectional and explicit.
- Domain contains business rules; orchestration/application coordinates; infrastructure handles technical details.
- State ownership is explicit — single source of truth for each domain concept.
- What crosses each boundary is defined (data types, commands, events).

**Weak indicators (0–2):**
- Boundary responsibilities are blurry or overlapping.
- Domain layer contains framework references or technical implementation.
- UI/presentation bypasses application layer to directly access APIs or storage.
- Same responsibility claimed by multiple boundaries in different sections.

**Document-specific application:**

| Document | What to check |
|----------|--------------|
| API Contract | Resource grouping is coherent; shared DTOs defined once and referenced elsewhere |
| FE System Design | Presentation / Application / Domain / Infrastructure clearly separated |
| BE System Design | API layer / Business logic / Data access / Infrastructure clearly separated |

### 4.4 Domain Model Quality & Invariants (15 points)

**"Are domain concepts explicit, stable, and independent of framework/UI?"**

**Strong indicators (3–4):**
- Domain entities named clearly with stable identifiers.
- Business rules, invariants, and validation policies described explicitly.
- Domain logic is free from infrastructure concerns.
- Transformation and normalization policies exist at domain level.
- API Contract DTOs match domain concepts (no misnamed or split entities).

**Weak indicators (0–2):**
- Domain missing or reduced to pass-through DTOs.
- Business rules described inside UI or application layer.
- No invariants or validation rules.
- Domain tightly coupled to external API response formats.
- API Contract field names inconsistent with domain entity definitions.

**Document-specific application:**

| Document | What to check |
|----------|--------------|
| API Contract | DTO definitions are domain-aligned; field names, types, and constraints are explicit |
| FE System Design | Domain boundary ownership is clear; domain rules are not in presentation layer |
| BE System Design | Entity relationships defined; business rule ownership stated; transactional boundaries clear |

### 4.5 Code Job Readiness (15 points)

**"Can the Code Job produce correct, complete code from this document without guessing?"**

This category evaluates the practical implementability of the design — the primary purpose of these documents.

**Evaluation targets:**

- **Gap-free integration specification** (API Contract): Every endpoint the frontend calls is fully specified so both frontend and backend Code Jobs produce compatible code.
- **Unambiguous architecture** (FE/BE System Design): The Code Job can determine project structure, file organization, and dependency direction without guessing.
- **Infrastructure independence**: External service adapters have mock implementation strategies so the Code Job can produce runnable code without external dependencies.
- **Cross-document consistency**: API Contract DTO definitions match System Design domain models. No contradictions between documents.
- **Technology stack actionability** (BE System Design): When technology is selected, it is specific enough to scaffold (e.g., "Express.js" not just "web framework").

**Strong indicators (3–4):**
- A developer reading only the design documents (with PRD as supplementary) can implement the system without making architectural assumptions.
- API Contract fully covers all integration points between frontend and backend.
- Mock adapter strategies are defined for all external service dependencies.
- Directory structure principles are stated when framework augmentation is present.
- No circular references or contradictions between API Contract and System Design documents.

**Weak indicators (0–2):**
- Integration points mentioned in System Design but absent from API Contract.
- System Design references technologies or patterns not specified in API Contract or PRD.
- No mock adapter strategy for external services.
- Backend technology stack absent or stated generically ("use appropriate database").
- Frontend state management approach unclear or contradicted by API Contract data flow.

### 4.6 Extensibility & Change Resilience (10 points)

**"Can the architecture handle new requirements with minimal modification?"**

**Strong indicators (3–4):**
- Clear extension points (adapters, strategies, ports).
- New API sources or features can be added without refactoring existing modules.
- External service adapters are isolated behind boundaries.
- Infrastructure concerns replaceable without touching domain or application logic.

**Weak indicators (0–2):**
- Hardcoded logic tied to specific APIs, libraries, or UI structures.
- Adding a new data source requires changes across multiple boundaries.
- No abstraction for future growth.
- External SDK details leak into domain or orchestration boundaries.

---

## 5. Evaluation Checklist

### 5.1 Document Presence Check

| Document | Required | Check |
|----------|----------|-------|
| `api-contract-*.md` | Required (if fullstack or backend) | Layer 0 specification exists |
| `fe-system-*.md` | Required (if frontend present) | Layer 1 frontend guide exists |
| `be-system-*.md` | Required (if backend present) | Layer 1 backend guide exists |

### 5.2 API Contract Checklist

- [ ] **Overview**: API purpose, scope, base URL, protocol stated?
- [ ] **Authentication**: Auth mechanism, token format, refresh flow specified (if PRD requires auth)?
- [ ] **Endpoints**: Every PRD-required interaction has a corresponding endpoint specification?
- [ ] **Endpoint completeness**: Each endpoint has identifier, method, auth requirement, request schema, response schema, error responses?
- [ ] **DTO definitions**: Shared types defined in ONE dedicated section, referenced by name elsewhere?
- [ ] **Field specificity**: Every DTO has field names, types, and validation constraints (not just "user object")?
- [ ] **Error conventions**: Standard error format defined? Error code taxonomy stated?
- [ ] **Real-time** (if applicable): Event schemas with direction, event name, payload DTO reference, delivery guarantee?
- [ ] **No implementation leakage**: No framework-specific code, no database queries, no internal implementation details?

### 5.3 Frontend System Design Checklist

- [ ] **Overview**: Architecture decisions per dimension with rationale?
- [ ] **Architecture boundaries**: Named, with responsibilities and dependency direction?
- [ ] **State ownership**: Per-boundary state ownership explicit (global vs route-scoped vs view-local)?
- [ ] **API integration**: Infrastructure adapter role defined? Error propagation policy stated?
- [ ] **Auth lifecycle**: Which boundary owns each auth phase (not step-by-step procedure)?
- [ ] **Domain rules** (if applicable): Calculation ownership stated with PRD references (not reproduced formulas)?
- [ ] **External integrations**: Adapter isolation principle stated? Mock implementation strategies defined for external dependencies?
- [ ] **Directory structure** (if framework augmentation present): Boundary-to-directory mapping and import direction rules stated?
- [ ] **Abstraction level**: No component names, prop definitions, hook usage, CSS properties?
- [ ] **PRD coverage**: Every user-facing feature has an owning boundary?

### 5.4 Backend System Design Checklist

- [ ] **Overview**: System purpose, architecture decisions with rationale?
- [ ] **Database design** (if applicable): Entity relationships, constraints, field types as conceptual schema?
- [ ] **Auth boundary**: Placement, context propagation, authorization model (if PRD requires auth)?
- [ ] **Business logic**: Domain vs orchestration vs data access ownership clear?
- [ ] **Technology stack**: Framework, database, cache/queue technologies selected with rationale?
- [ ] **External integrations** (if applicable): Adapter isolation, mock strategies for external dependencies?
- [ ] **Directory structure** (if framework augmentation present): Boundary-to-directory mapping and import direction rules?
- [ ] **Abstraction level**: No SQL queries, function signatures, or algorithm steps (database schema structure is acceptable)?
- [ ] **PRD coverage**: Every business rule has an owning boundary?

### 5.5 Cross-Document Consistency Check

- [ ] **DTO alignment**: API Contract DTOs match domain models in FE/BE System Design?
- [ ] **Endpoint coverage**: Every endpoint in API Contract has a corresponding consumer in FE System Design and provider in BE System Design?
- [ ] **Auth consistency**: Auth mechanism in API Contract matches auth boundary design in FE/BE System Design?
- [ ] **Technology consistency**: No contradictions between API Contract protocol choices and System Design technology selections?
- [ ] **Naming consistency**: Same domain concepts use the same terms across all documents?

### 5.6 PRD Faithfulness Check

- [ ] **Coverage**: Every PRD functional requirement has a design counterpart?
- [ ] **External services**: All PRD-named services documented with exact names?
- [ ] **Exclusions**: PRD-excluded items absent from all design documents?
- [ ] **No invention**: No requirements added that PRD does not state?
- [ ] **Constraints preserved**: PRD technology constraints and prohibitions reflected in design?

---

## 6. Scoring Guide

### 6.1 Grade Scale

| Grade | Range | Description |
|-------|-------|-------------|
| **S (Excellent)** | 90–100 | Complete coverage, correct abstractions, fully implementable. Code Job needs zero architectural assumptions. |
| **A (Good)** | 80–89 | Minor gaps but structurally sound. Code Job needs minimal assumptions. |
| **B (Acceptable)** | 65–79 | Core architecture correct but gaps exist. Code Job needs some assumptions. |
| **C (Insufficient)** | 45–64 | Significant gaps. Code Job must make many assumptions. |
| **D (Poor)** | 0–44 | Fundamental rewrite required. Code Job cannot produce reliable output. |

### 6.2 Category Weights

| Category | Points | Core question |
|----------|--------|--------------|
| **PRD Coverage & Faithfulness** | 25 | Does the design cover ALL PRD requirements without inventing new ones? |
| **Architectural Abstraction Quality** | 20 | Is the abstraction level correct for each document type? |
| **Layered Separation & Responsibility Clarity** | 15 | Are boundary responsibilities clear and non-overlapping? |
| **Domain Model Quality & Invariants** | 15 | Are domain concepts explicit and infrastructure-independent? |
| **Code Job Readiness** | 15 | Can Code Job produce correct code without guessing? |
| **Extensibility & Change Resilience** | 10 | Can the architecture accommodate new requirements? |
| **Total** | 100 | |

### 6.3 Category Scoring Anchors

#### PRD Coverage & Faithfulness (25 points)

| Score | Criteria |
|-------|----------|
| **25** | 100% of PRD FRs have design counterparts. All external services documented. No invented requirements. All exclusions respected. |
| **20** | >= 90% coverage. 1–2 minor PRD requirements without explicit design element. No invented requirements. |
| **15** | 70–90% coverage. Several PRD features lack design counterparts. Minor invented additions. |
| **10** | 50–70% coverage. Significant PRD requirements missing from design. Some invented features. |
| **5** | < 50% coverage. Design loosely related to PRD. Multiple invented requirements. |
| **0–4** | Design does not reflect the PRD. Mostly hallucinated architecture. |

#### Architectural Abstraction Quality (20 points)

| Score | Criteria |
|-------|----------|
| **20** | Every document at correct abstraction level. API Contract precise. System Designs architectural. Rationale provided. |
| **16** | Mostly correct. 1–2 sections at wrong level (too concrete for System Design or too vague for API Contract). |
| **12** | Mixed quality. API Contract partially specified. System Design contains some implementation details. |
| **8** | Significant level violations. API Contract vague. System Design reads like implementation guide. |
| **4** | Pervasive level violations. Documents are at wrong abstraction level throughout. |
| **0–3** | No clear distinction between specification and implementation. |

#### Layered Separation & Responsibility Clarity (15 points)

| Score | Criteria |
|-------|----------|
| **15** | All boundaries named with explicit responsibilities. Unidirectional dependencies. State ownership clear. No overlaps. |
| **12** | Boundaries mostly clear. Minor overlaps or unclear ownership in 1–2 areas. |
| **9** | Boundaries exist but some responsibilities blurry. Dependency direction unclear in places. |
| **6** | Weak separation. Multiple responsibilities shared between boundaries. |
| **0–5** | No meaningful boundary separation. Monolithic or undefined structure. |

#### Domain Model Quality & Invariants (15 points)

| Score | Criteria |
|-------|----------|
| **15** | Domain entities explicit. Business rules stated. Invariants defined. API Contract DTOs domain-aligned. Infrastructure-independent. |
| **12** | Domain mostly clear. 1–2 missing invariants or business rules. DTOs mostly aligned. |
| **9** | Domain present but incomplete. Several missing rules or invariants. Some DTO misalignment. |
| **6** | Domain thin — mostly DTOs with no business rules. |
| **0–5** | No domain model. Data shapes only. No business logic placement. |

#### Code Job Readiness (15 points)

| Score | Criteria |
|-------|----------|
| **15** | Zero guessing required. API Contract complete. Mock strategies defined. Cross-document consistent. Technology choices actionable. |
| **12** | Minor gaps. 1–2 integration points underspecified. Mock strategies mostly present. |
| **9** | Several gaps. Code Job must make 3–5 architectural assumptions. Some cross-document inconsistencies. |
| **6** | Significant gaps. Code Job must make many assumptions. Missing mock strategies. |
| **0–5** | Design insufficient for implementation. Code Job would produce incorrect or incomplete code. |

#### Extensibility & Change Resilience (10 points)

| Score | Criteria |
|-------|----------|
| **10** | Clear extension points. Adapters isolated. New features addable without refactoring. |
| **8** | Mostly extensible. 1–2 tightly coupled areas. |
| **6** | Partial extensibility. Some adapter isolation. |
| **4** | Weak extensibility. Adding features requires broad changes. |
| **0–3** | Monolithic. Any change cascades throughout. |

---

## 7. Report Template

```markdown
# System Design Evaluation Report

**Date**: YYYY-MM-DD
**Project**: {org}/{group}/{project}
**Feature**: {feature-name}

---

## 1. Summary Score

### 1.1 Overall Score

| Category | Score | Notes |
|----------|-------|-------|
| PRD Coverage & Faithfulness | X / 25 | |
| Architectural Abstraction Quality | X / 20 | |
| Layered Separation & Responsibility Clarity | X / 15 | |
| Domain Model Quality & Invariants | X / 15 | |
| Code Job Readiness | X / 15 | |
| Extensibility & Change Resilience | X / 10 | |
| **Total** | **X / 100** | **Grade: S/A/B/C/D** |

### 1.2 Per-Document Score

| Document | Present | Key Strength | Key Weakness |
|----------|---------|-------------|-------------|
| api-contract-*.md | Yes/No | | |
| fe-system-*.md | Yes/No | | |
| be-system-*.md | Yes/No | | |

---

## 2. Document Presence & Structure

| Document | Present | Section Count | Expected Sections Missing |
|----------|---------|--------------|--------------------------|
| [document] | Yes/No | N | [list missing sections] |

---

## 3. PRD Coverage Analysis

### 3.1 Coverage Summary
- PRD FRs covered: X / N (X%)
- External services documented: X / N
- Invented requirements found: X

### 3.2 Missing Coverage
| PRD Requirement | PRD Location | Missing From | Impact |
|----------------|-------------|-------------|--------|
| [requirement] | §X.X | [document] | [Code Job impact] |

### 3.3 Invented Requirements (not in PRD)
| Invented Item | Found In | Recommendation |
|---------------|----------|---------------|
| [item] | [document §X] | Remove / Keep with justification |

---

## 4. Per-Document Analysis

### 4.1 API Contract Analysis

**Abstraction level**: Correct / Too vague / Too concrete
**Endpoint completeness**: X / N endpoints fully specified

| Issue | Location | Description | Severity |
|-------|----------|------------|----------|
| [issue] | [section] | [description] | 🔴 / 🟡 / 🟢 |

### 4.2 Frontend System Design Analysis

**Abstraction level**: Correct / Contains implementation details / Too vague
**Boundary clarity**: Clear / Partially clear / Blurry

| Issue | Location | Description | Severity |
|-------|----------|------------|----------|
| [issue] | [section] | [description] | 🔴 / 🟡 / 🟢 |

### 4.3 Backend System Design Analysis

**Abstraction level**: Correct / Contains implementation details / Too vague
**Boundary clarity**: Clear / Partially clear / Blurry

| Issue | Location | Description | Severity |
|-------|----------|------------|----------|
| [issue] | [section] | [description] | 🔴 / 🟡 / 🟢 |

---

## 5. Cross-Document Consistency

| Check | Status | Notes |
|-------|--------|-------|
| DTO alignment (API Contract ↔ System Design) | ✅/⚠️/❌ | |
| Endpoint coverage (API ↔ FE consumer ↔ BE provider) | ✅/⚠️/❌ | |
| Auth mechanism consistency | ✅/⚠️/❌ | |
| Naming consistency | ✅/⚠️/❌ | |

---

## 6. Code Job Readiness Assessment

### 6.1 Integration Points
| Integration | API Contract | FE Design | BE Design | Gap |
|------------|-------------|-----------|-----------|-----|
| [integration] | ✅/❌ | ✅/❌ | ✅/❌ | [description] |

### 6.2 Infrastructure Independence
| External Service | Mock Strategy Defined | Impact if Missing |
|-----------------|----------------------|-------------------|
| [service] | Yes/No | [impact] |

### 6.3 Implementability Assessment
- Can Code Job determine project structure? Yes/No
- Can Code Job determine API integration approach? Yes/No
- Can Code Job run generated code without external dependencies? Yes/No

---

## 7. Recommended Actions

### 7.1 Critical (blocks Code Job)
1. **[action]**
   - **Problem**: [description]
   - **Location**: [document §X]
   - **Fix**: [specific content to add/change]

### 7.2 Recommended (quality improvement)
1. **[action]**

### 7.3 Design Job Improvement Suggestions
| Target | Change | Rationale |
|--------|--------|-----------|
| [prompt/rule file] | [change description] | [why] |

---

**Evaluation tool**: Ant CLI System Design Rubric v2.0
**Completed**: YYYY-MM-DD HH:MM
```

---

## 8. Usage

### 8.1 Evaluation Process

```
1. Check document presence
   └─ architecture/system/ — api-contract-*.md, fe-system-*.md, be-system-*.md

2. Read PRD for baseline
   └─ plan/prd.md
   └─ Extract: FRs, external services, exclusions, constraints

3. Per-document evaluation
   ├─ API Contract: Checklist §5.2
   ├─ FE System Design: Checklist §5.3
   └─ BE System Design: Checklist §5.4

4. Cross-document checks
   └─ Checklist §5.5

5. PRD faithfulness check
   └─ Checklist §5.6

6. Category-by-category scoring
   └─ Use scoring anchors (§6.3) — match evidence to closest anchor

7. Report generation
   └─ Template §7
```

### 8.2 Evaluation Timing

**Recommended checkpoints:**
1. **After Design Job**: evaluate design documents before Code Job starts.
2. **After Code Job (issues found)**: trace implementation problems back to design gaps.
3. **Design Job prompt iteration**: evaluate to measure prompt improvement impact.

### 8.3 Scoring Discipline

**Evaluate strictly and without leniency.** The purpose of this rubric is to surface design deficiencies before they propagate to code. An inflated score conceals gaps that will cause the Code Job to produce incorrect implementations.

**Anti-leniency principle:**
LLM evaluators have a systematic tendency to score generously — awarding partial credit for "effort", rounding up when in doubt, and treating structural presence as evidence of quality. This tendency must be actively countered:
- **When in doubt, score lower.** Uncertainty about quality is itself a signal of insufficient specification.
- **Do not give credit for intent.** "The design probably means X" is not evidence. Only what is explicitly written counts.
- **Do not award points for section existence.** A section titled "Architecture Boundaries" that vaguely says "follows clean architecture" without naming boundaries or responsibilities deserves zero credit, not partial credit for being present.
- **Treat every gap as a Code Job failure.** Each underspecified boundary, missing endpoint, or vague policy forces the Code Job to guess. Score as if the guess will be wrong — because it often is.

**Rules:**
- Every score must cite specific evidence (or specific absence of evidence).
- "Section exists" is not sufficient for credit — correctness and completeness matter.
- Do not award credit for placeholder content or vague descriptions.
- Count missing PRD requirements explicitly — do not estimate coverage.
- Evaluate each document type against its own abstraction standard (§3).
- Apply the Layer 0/Layer 1 distinction when scoring abstraction quality — API Contract concreteness is a strength, not a weakness.

---

## 9. Appendix

### 9.1 Abstraction Level Quick Reference

| Content Type | API Contract (Layer 0) | System Design (Layer 1) |
|-------------|----------------------|------------------------|
| Endpoint paths | Required (exact) | Referenced by name only |
| Field names & types | Required (exact) | Referenced by DTO name |
| Validation rules | Required (per field) | Referenced as "domain invariants" |
| Error codes | Required (enumerated) | Referenced as "error policy" |
| Component names | N/A | Forbidden (use boundary roles) |
| Hook/lifecycle usage | N/A | Forbidden (framework detail) |
| Database schema | N/A | Allowed (conceptual, BE only) |
| Technology choices | Protocol selection only | Allowed with rationale |
| Architecture rationale | Minimal (scope/purpose) | Required per decision |
| Directory structure | N/A | Allowed when framework augmentation present |

### 9.2 Common Anti-Patterns

| Anti-Pattern | Document | Description | Fix |
|-------------|----------|------------|-----|
| Vague contract | API Contract | "User endpoints exist" without specifications | Add full endpoint specs |
| Code in design | FE/BE System | Component trees, prop definitions, function signatures | Abstract to boundary responsibilities |
| PRD echo | All | Copying PRD text verbatim instead of translating to architecture | Extract architectural intent |
| Invented features | All | Adding analytics, i18n, monitoring not in PRD | Remove — design only what PRD requests |
| Split ownership | FE/BE System | Same responsibility claimed by multiple boundaries | Designate single owner |
| DTO mismatch | Cross-document | API Contract field names differ from System Design domain models | Align naming across documents |
| Missing mock | FE/BE System | External service adapter without development independence strategy | Add mock implementation approach |
| Step-by-step flow | FE/BE System | "Get token → call API → store result → redirect" | Describe ownership policy instead |

### 9.3 Related Documents

- **PRD Rubric**: `docs/rubric/PRD-RUBRIC.md`
- **Code Rubric**: `docs/rubric/CODE-RUBRIC.md`
- **UI Design Rubric**: `docs/rubric/UI-DESIGN_RUBRIC.md`
- **System Design Guide (Code Job reference)**: `packages/ant-cli/src/core/prompt/templates/code/base/injections/system-design-guide.md`

---

**Document version**: 2.0
**Last updated**: 2026-04-07
**Author**: Ant CLI Team
