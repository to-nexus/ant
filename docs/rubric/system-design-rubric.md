# System Design Evaluation Rubric (Universal, Domain-Independent)

This rubric is used to evaluate **System Design Documents** for correctness, abstraction quality, architectural clarity, and domain-appropriate boundaries.  
It is optimized for AI-driven design pipelines (PRD → System Design → Implementation).

Scoring: Each category is scored **0–4**, total **0–20**.

---

## 1. Architectural Abstraction Quality (0–4)
**Goal:** The design must maintain the correct abstraction level for a System Design document.

### ✔ Strong Indicators (3–4)
- Focuses on *conceptual architecture* (layers, boundaries, flows).
- Avoids implementation details (hooks, lifecycle, component props, storage keys).
- Describes modules/services through **contracts**, not methods/code.
- Includes rationale and tradeoffs where appropriate.

### ✘ Weak Indicators (0–2)
- Mentions concrete React/Vue/Unity APIs, lifecycle events, state hooks.
- Hardcodes data structures, DTO shapes, LocalStorage keys, URL formats.
- Reads like an implementation guide instead of an architecture document.

---

## 2. Layered Separation & Responsibility Clarity (0–4)
**Goal:** Each layer must have clearly defined responsibilities with unidirectional dependencies.

### ✔ Strong Indicators (3–4)
- Clear separation: Presentation / Application / Domain / Infrastructure.
- Responsibilities are coherent, non-overlapping, and framework-independent.
- Domain contains business rules; Application orchestrates; Infrastructure handles tech details.
- UI never bypasses Application to talk to APIs or storage.

### ✘ Weak Indicators (0–2)
- Layer boundaries blurry or reversed.
- Domain contains technical logic or framework references.
- UI directly touches API or persistence.
- Application layer overloaded with domain logic.

---

## 3. Domain Model Quality & Invariants (0–4)
**Goal:** Domain concepts must be explicit, stable, and independent of UI/framework.

### ✔ Strong Indicators (3–4)
- Domain concepts named clearly (e.g., Article, Bookmark, GameState).
- Domain rules, invariants, and policies are described explicitly.
- Transformation/normalization policies exist and are domain-level.
- Domain logic is free from infrastructure concerns.

### ✘ Weak Indicators (0–2)
- Domain missing or reduced to DTOs.
- Policies implicitly described inside UI/Application.
- No invariants or business rules.
- Domain tightly coupled to external API formats.

---

## 4. Extensibility & Change Resilience (0–4)
**Goal:** The architecture should handle new requirements with minimal modification.

### ✔ Strong Indicators (3–4)
- Clear extension points (adapters, strategies, ports).
- New API sources / new gameplay modes / new storage engines can be added without refactoring existing modules.
- Backends can replace frontend-only logic cleanly via ports.
- Engine or domain rules replaceable without touching UI.

### ✘ Weak Indicators (0–2)
- Hardcoded logic tied to specific APIs, libraries, or UI structures.
- Changes in data source or platform require broad rewrites.
- No abstraction boundaries for future growth.

---

## 5. Implementation Leakage Check (0–4)
**Goal:** Detect whether implementation details contaminate System Design.

### ✔ Strong Indicators (3–4)
- No references to concrete hooks (useState/useEffect), CSS classes, timers, recoil atoms, redux slices.
- No mention of data schema specifics unless cross-layer contract.
- No component prop details or DOM structures.
- No localStorage key names, routing syntax, HTTP URLs, or library configs.

### ✘ Weak Indicators (0–2)
- Contains many direct implementation details.
- Reads like code disguised as design.
- System Design includes concrete state shapes, method names, or UI event wiring.

---

# Scoring Interpretation

**18–20 (Excellent)**  
- Clean architecture, correct abstractions, domain rules captured, minimal leakage.

**15–17 (Strong)**  
- Minor leaks but overall structurally correct and production-quality.

**11–14 (Moderate)**  
- Useful but contains architecture violations or implementation details.

**7–10 (Weak)**  
- Blurry layers, poor abstractions, significant implementation leakage.

**0–6 (Unusable)**  
- Not a System Design; resembles implementation notes or UI wiring.

---

# Evaluation Output Format

When evaluating a System Design, the bot must output:

1. **Category-by-category numeric score (0–4)**  
2. **Short justification for each category**  
3. **Total score (0–20)**  
4. **Verdict with recommended rewrite depth**  
   - "Rewrite required (heavy)"  
   - "Rewrite required (moderate)"  
   - "Minor cleanup needed"  
   - "Strong design"  
   - "Excellent design"

This rubric MUST be applied automatically to ALL System Design evaluations.
