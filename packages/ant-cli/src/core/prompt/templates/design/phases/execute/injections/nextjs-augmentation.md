## Framework Augmentation — Next.js App Router

**Applies when**: Next.js App Router detected (via PRD, directive, or codebase profile)

---

### Goal

Treat `app/` as a routing/composition shell only. Ensure reusable UI, business logic, and I/O adapters reside outside `app/`.

---

### A. Route Layer Scope

**Principle**: The `app/` directory contains ONLY route-layer artifacts.

| Belongs in `app/` | Does NOT belong in `app/` |
|--------------------|---------------------------|
| `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` | Domain/business rules |
| `route.ts` (API routes) | Application orchestration or state machines |
| Route-level providers and composition wiring | Data-access code, SDK/API client calls |
| `template.tsx`, `default.tsx` | Reusable UI components |

**Constraint**: `app/` MUST NOT contain domain rules, application orchestration, or data-access code — even if the file is a Server Component with access to Node.js APIs.

**Constraint**: Server vs Client boundary (`'use client'` directive) is orthogonal to architecture boundary. A Server Component in `app/` is still route-layer; moving logic into a server-side service module does not require `'use client'`.

---

### B. Boundary Map

**Principle**: Define architecture boundaries explicitly. Each boundary has a single responsibility.

For each boundary in the design document, specify:

| Attribute | What to define |
|-----------|---------------|
| **Responsibility** | What this boundary owns (state, rules, I/O, rendering) |
| **Import direction** | What it may import from other boundaries |
| **Prohibition** | What MUST NOT be inside this boundary |

**Constraint**: Do NOT prescribe a specific architecture name (Clean, Hexagonal, etc.) unless PRD mandates it. Instead, define boundaries appropriate to the project's observed complexity.

---

### C. Dependency Rules

**Principle**: Import direction flows inward — outer boundaries depend on inner, never the reverse.

| Rule | Description |
|------|-------------|
| **Route layer → any boundary** | Route-layer files import and compose from all boundaries |
| **Presentation → Application** | View components may call application-layer hooks/functions |
| **Application → Domain** | Orchestration depends on domain rules |
| **Domain → nothing** | Domain rules are pure; no imports from other boundaries |
| **Infrastructure → Domain (interfaces)** | Adapters implement domain-defined ports |

**Constraint**: State the allow/deny import directions between boundaries. The coding phase enforces these as structural constraints.

---

### D. Directory Structure Principle

**Principle**: Each architecture boundary maps to a directory outside `app/`.
`app/` location follows the project's source root convention: if the project uses a `src/` directory,
`app/` resides at `src/app/` and boundary directories reside alongside it under `src/`.
If no `src/` directory is used, `app/` and boundary directories are at project root.

**Constraint**: Do NOT output a full directory tree. Output the invariant: route-layer (`app/`) is structurally separate from boundary directories.

**Constraint**: Directory names are placeholders — the coding phase chooses concrete names based on conventions. The design specifies the boundary-to-directory mapping principle, not exact names.

---

### E. Placement Classifier

**Principle**: Provide rules to classify files into boundaries at coding time.

| Observation Target | Boundary Assignment |
|-------------------|---------------------|
| Pure calculation, validation, domain invariant | Domain boundary |
| API/SDK call, storage adapter, external I/O | Infrastructure boundary |
| Use-case orchestration, state coordination | Application boundary |
| Visual rendering, user interaction wiring | Presentation boundary |
| Route entry, layout composition, provider wiring | Route layer (`app/`) |

**Constraint**: If a file fits multiple boundaries, it violates single-responsibility. Split it.

---

### F. Coding Phase Directives

**Principle**: Include a concise checklist of structural constraints the coding phase must enforce.

The design document SHOULD include a "Coding Phase Directives" section with:
- Which boundary directories to create outside `app/`
- What must be moved out of `app/` if found there
- Import direction enforcement rules
- Server vs Client boundary identification criteria

**Constraint**: Keep directives at principle level. Do NOT list specific file names, component names, or implementation details.
