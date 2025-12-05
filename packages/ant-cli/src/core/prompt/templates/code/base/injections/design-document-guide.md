## 📐 DESIGN DOCUMENTS GUIDE

**You have access to design documents that guide your implementation:**

════════════════════════════════════════════════════════════════════════════════

### 📋 API Contract (api-contract.md)

**Purpose**: SHARED SPECIFICATION for Frontend-Backend integration

**🚨 CRITICAL: This is NOT an external repository!**
- ✅ API Contract is a SPECIFICATION DOCUMENT in THIS project
- ✅ It defines the integration interface between Frontend and Backend
- ✅ Both Frontend and Backend implement their respective sides of this specification
- ✅ Think of it as a "blueprint" or "interface definition", NOT a codebase
- ❌ It is NOT an external project repository
- ❌ You CANNOT search it using `search_reference_code` tool
- ❌ When you see "api-contract.md", think "specification to follow", NOT "code to reference"

**What it contains:**
- Exact REST API endpoints with request/response types
- WebSocket event definitions
- Data transfer object (DTO) specifications
- Error response formats
- Authentication flow

**How to use it (for BOTH Frontend & Backend):**
- ✅ Use EXACT field names from the specification (camelCase/snake_case must match!)
- ✅ Implement ALL required fields (no optional fields unless marked with `?`)
- ✅ Follow validation rules (min/max length, format constraints)
- ✅ Return exact HTTP status codes specified
- ❌ DO NOT invent new fields or endpoints not in the specification
- ❌ DO NOT change field types or names
- ❌ DO NOT confuse this specification document with an external project repository

════════════════════════════════════════════════════════════════════════════════

### 🎨 Frontend System Design (fe-system-design.md OR system-design.md)

**Purpose**: HOW FRONTEND IMPLEMENTS the consumer side of api-contract.md

**What it contains:**
- Component architecture and hierarchy
- State management strategy (Redux, Context, Zustand)
- Routing structure and protected routes
- API client wrappers (how to call endpoints)
- UI/UX layout and design system

**How to use it (for FRONTEND tasks ONLY):**
- ✅ Follow component structure (Pages → Containers → Components)
- ✅ Use specified state management library
- ✅ Implement routing as described
- ✅ Create API client wrappers calling api-contract.md endpoints
- ✅ Apply UI/UX guidelines (colors, spacing, responsive breakpoints)
- ❌ DO NOT define API endpoints (they're already specified in api-contract.md!)
- ❌ DO NOT add backend logic or server-side code

════════════════════════════════════════════════════════════════════════════════

### ⚙️ Backend System Design (be-system-design.md OR system-design.md)

**Purpose**: HOW BACKEND IMPLEMENTS the provider side of api-contract.md

**What it contains:**
- Architecture layers (Controller, Service, Repository)
- API endpoint implementation details
- Database schema and entity definitions
- Business logic flows
- Authentication and authorization

**How to use it (for BACKEND tasks ONLY):**
- ✅ Follow layered architecture (Controller → Service → Repository)
- ✅ Implement ALL endpoints from api-contract.md
- ✅ Use database schema as specified
- ✅ Apply business logic rules described
- ✅ Return responses matching api-contract.md EXACTLY
- ❌ DO NOT change API response structure
- ❌ DO NOT add frontend code or UI components

════════════════════════════════════════════════════════════════════════════════

### 🔑 KEY RULES

**1. API Contract is ABSOLUTE LAW - Follow from Initial Implementation**
- API Contract is IMMUTABLE - implement exactly as specified from the start
- If there's a conflict between api-contract.md and system-design.md, follow api-contract.md
- All FE/BE integration MUST match api-contract.md field names and types
- Your "best practices" or conventions do NOT override specification
- **Example violations:**
  - Spec: `POST /rooms/create` → You: `POST /rooms` (❌ "more RESTful")
  - Spec: `userId` field → You: `user_id` (❌ "more consistent")
  - Spec: no validation → You: add validation (❌ "safer")
- **TERMINOLOGY**: "API Contract" = "Integration Specification" (NOT an external repo!)

**2. Know Your Environment**
- Frontend tasks: Focus on API consumption, UI components, state management
- Backend tasks: Focus on API implementation, business logic, data persistence
- NEVER mix concerns: Frontend doesn't define APIs, Backend doesn't do UI

**3. Don't Duplicate the Specification**
- ❌ DON'T copy-paste type definitions from api-contract.md into code
- ✅ DO define types based on specification once, then reuse
- ✅ DO focus on HOW to implement, not WHAT the interface is

**4. When in Doubt**
- Check api-contract.md for interface definitions (specification)
- Check system-design.md for implementation patterns (guide)
- Follow the architecture layers described in system-design.md

**5. CRITICAL: "Reference" Terminology**
- ❌ DON'T say "reference api-contract.md" (sounds like external code search)
- ✅ DO say "follow api-contract.md specification" or "implement according to api-contract.md"
- api-contract.md is a SPECIFICATION DOCUMENT to read, not a code repository to search

════════════════════════════════════════════════════════════════════════════════

