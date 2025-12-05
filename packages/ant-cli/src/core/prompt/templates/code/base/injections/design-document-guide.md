## 📐 DESIGN DOCUMENTS GUIDE

**Design documents are organized in a hierarchy. Higher layers take precedence.**

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

**Golden Rule: When lower layer is silent, check higher layer. Higher layer always fills gaps.**

════════════════════════════════════════════════════════════════════════════════

### 📋 API Contract (api-contract.md) - LAYER 0: SOURCE OF TRUTH

**Purpose**: Immutable specification for Frontend-Backend integration

**Critical Understanding:**
- **Defines WHAT**: endpoints, fields, types, constraints, behavior
- **Always check first**: Before implementing any integration point
- **Silence in Layer 1 ≠ freedom**: If System Design doesn't mention something from API Contract, API Contract still applies

**What it contains:**
- REST API endpoints (method, path, parameters)
- Request/response types and field specifications
- WebSocket events and data formats
- Error responses and status codes
- Authentication/authorization requirements

**How to use (Frontend & Backend):**
- ✅ Start here for ANY integration work
- ✅ Use exact specifications (paths, field names, types)
- ✅ Apply ALL constraints (validation, required fields)
- ❌ Don't modify specifications to fit your preferences
- ❌ Don't assume "not in System Design" means "not required"

════════════════════════════════════════════════════════════════════════════════

### 🎨 Frontend System Design - LAYER 1: IMPLEMENTATION GUIDE

**Purpose**: How to implement consumer side of API Contract

**Relationship:**
- Describes HOW to call endpoints defined in Layer 0
- Describes WHERE to manage state from Layer 0 responses
- **Cannot override or omit Layer 0 specifications**

**What it contains:**
- Component architecture
- State management approach
- Routing structure
- API client patterns
- UI/UX guidelines

**How to use (Frontend only):**
- ✅ Follow architecture patterns described here
- ✅ For integration details, always check Layer 0 first
- ❌ Don't let architecture preferences override API specifications

════════════════════════════════════════════════════════════════════════════════

### ⚙️ Backend System Design - LAYER 1: IMPLEMENTATION GUIDE

**Purpose**: How to implement provider side of API Contract

**Relationship:**
- Describes HOW to implement endpoints defined in Layer 0
- Describes WHERE to apply business logic for Layer 0 responses
- **Cannot override or omit Layer 0 specifications**

**What it contains:**
- Architecture layers (Controller/Service/Repository)
- Database schema
- Business logic flows
- Authentication implementation

**How to use (Backend only):**
- ✅ Follow architecture patterns described here
- ✅ For API specifications, always check Layer 0 first
- ❌ Don't let architecture preferences override API specifications

════════════════════════════════════════════════════════════════════════════════

### 🔑 CORE PRINCIPLES

**1. Layer Hierarchy**
```
Question: "What endpoint path should I use?"
→ Check Layer 0 (API Contract) first
→ Use exact path specified there

Question: "What architecture should I use?"
→ Check Layer 1 (System Design)
→ Follow patterns described there
```

**2. Gap Filling Rule**
```
If Layer 1 is silent on something from Layer 0:
→ Layer 0 still applies (always!)
→ "Not mentioned" ≠ "not required"
→ Check upward in hierarchy
```

**3. Conflict Resolution**
```
If Layer 1 contradicts Layer 0:
→ Layer 0 wins (always!)
→ Higher layer = higher authority
```

**4. Implementation Sequence**
```
For ANY integration work:
1. Read Layer 0 (what to build)
2. Read Layer 1 (how to build it)
3. Implement Layer 2 (build it)
```

════════════════════════════════════════════════════════════════════════════════

### ⚠️ CRITICAL MISCONCEPTIONS TO AVOID

**❌ "System Design doesn't mention X, so I can skip it"**
- Wrong! Check API Contract. If it specifies X, implement X.

**❌ "My architecture preference is better than the spec"**
- Wrong! API Contract is immutable. Your preferences don't override it.

**❌ "I'll interpret the spec to be more consistent/RESTful/modern"**
- Wrong! Implement EXACTLY as specified. No interpretation.

**❌ "This is just a guide, I can adapt it"**
- Wrong for Layer 0 (immutable spec). Acceptable for Layer 1 (guide) only if no conflicts.

════════════════════════════════════════════════════════════════════════════════

### 💡 PRACTICAL WORKFLOW

**Before implementing ANY integration point:**

```
Step 1: Open API Contract
  ↓
Step 2: Find the exact specification
  ↓
Step 3: Note ALL details (path, fields, constraints)
  ↓
Step 4: Check System Design for HOW to implement
  ↓
Step 5: Implement following BOTH layers
```

**During implementation:**
- If confused about "what" → Check Layer 0
- If confused about "how" → Check Layer 1
- If layers conflict → Layer 0 wins

════════════════════════════════════════════════════════════════════════════════

