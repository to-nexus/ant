# System Design Task Decomposition

You are analyzing requirements to break them into chapter-based design tasks.

---

## 📥 INPUT CONTEXT

### Requirements

{{spec}}

{{#if hasExistingDesign}}
### 📄 Existing Design Detected

Previous design:
{{designPreview}}
{{else}}
### 🆕 New Design (no previous design)
{{/if}}

{{#if hasExistingCode}}
### 📂 Existing Codebase Detected

This is an evolution or refactor task. Consider the current implementation:
{{codePreview}}
{{/if}}

---

## 📊 PROJECT SCOPE ANALYSIS

**Analyze requirements complexity before breaking down tasks.**

### Step 1: Complexity Questions

1. **Backend Complexity**: Does it need a backend? Database? How many tables/entities?
2. **Feature Count**: How many distinct user-facing features?
3. **Pages/Views**: How many different screens/pages?
4. **External Systems**: Does it integrate with external APIs, payment, auth services?
5. **User Roles**: Multiple user types with different permissions?

### Step 2: Score the Project

| Condition | Score |
|-----------|-------|
| ❌ NO backend | → Simple (STOP counting) |
| Backend with 1-3 tables | +1 |
| Backend with 4+ tables | +2 |
| Multiple user roles/auth | +1 |
| 5+ distinct features | +1 |
| External integrations | +1 |
| Multiple pages (5+) | +1 |

### Step 3: Determine Budget

| Score | Complexity | Total Lines | Tasks |
|-------|------------|-------------|-------|
| 0 | Simple | 100-150 | 2 tasks |
| 1-2 | Medium | 180-300 | 3 tasks |
| 3+ | Complex | 360-600 | 4 tasks |

### Step 4: Divide Budget

- Divide total budget by number of tasks
- Each task description MUST include its line budget

---

## 🎯 WHAT SYSTEM DESIGN SHOULD COVER

**Focus on architecture, NOT implementation.**

### ✅ INCLUDE

- **Component boundaries and responsibilities** (WHAT each does, WHY it exists)
- **Interface definitions** (WHAT data flows, not HOW it's processed)
- **Abstraction layers** (WHY separated, WHAT each layer owns)
- **Interaction patterns** (call sequence, data flow direction)
- **Design rationale** (WHY this architecture vs alternatives)

### ❌ EXCLUDE

- Specific algorithms, formulas, calculation steps
- Exact parameter values (timeouts, coefficients, thresholds)
- Library/framework usage details (API calls, syntax)
- Performance optimization tricks
- Storage implementation details (key names, serialization format)

---

## 🔀 CONTRACT-FIRST DETECTION

**When project has BOTH Frontend AND Backend, use 3-PHASE approach.**

### Detection Criteria

Use dual design if **BOTH** conditions are true **RIGHT NOW**:

1. Project CURRENTLY requires:
   - Frontend UI (React/Vue/Angular components, pages, routing)
   - Backend API (Express/FastAPI/Django server, database, REST/GraphQL endpoints)

2. The project will ACTUALLY implement both tiers in this iteration

### Examples

**✅ Require dual design:**
- "Build SPA frontend + Express API server with PostgreSQL"
- "React dashboard calling REST API backed by MySQL database"

**❌ Single document (system-design.md):**
- "React SPA with localStorage" → Frontend-only
- "Frontend calling EXISTING third-party API" → Frontend-only
- "REST API service only" → Backend-only
- "Next.js with tightly coupled FE/BE" → Fullstack SSR

**IF dual detected → Use CONTRACT-FIRST (api-contract.md → fe-system-design.md → be-system-design.md)**
**ELSE → Use unified system-design.md**

---

{{> design/phases/decompose/rules-system-design}}
