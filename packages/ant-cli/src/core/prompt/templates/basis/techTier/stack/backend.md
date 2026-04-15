## Backend Environment — Single Application

**Context**: This project is a backend-only application. There is no frontend UI in this workspace.

**Important**: The language and framework profiles determine the specific runtime, HTTP framework, and conventions. This file covers scope boundaries that apply regardless of language or framework choice.

---

### Scope Boundary

**Principle**: All code in this workspace targets a server runtime. There are no browser-targeted outputs to build, bundle, or render.

**Constraint**: Do NOT create frontend-scoped tasks or artifacts:
- No UI components, pages, or layouts
- No CSS, design tokens, or visual styling
- No client-side routing or state management
- No browser bundle configuration (Vite, webpack, etc.)

**Constraint**: If the specification describes a UI or client-side behavior, it is out of scope for this workspace. API responses are data contracts, not rendered views.

### Task Planning Observations

| Checkpoint | What to observe |
|-----------|----------------|
| **UI references in spec** | Are they describing an API response shape, or a rendered view? In backend scope, only the response shape matters. |
| **Authentication** | Server-side session/token validation and middleware — not login forms or protected routes. |
| **Data persistence** | Database, cache, file storage — all server-side. |
| **External services** | Outbound HTTP calls, message queues, third-party APIs — integration logic, not UI wiring. |

### API Contract Responsibility

**Principle**: The backend defines and implements API contracts. If a design document prescribes specific endpoint signatures, the backend MUST implement them exactly.

**Constraint**: Do NOT invent API shapes that differ from the specification. If the spec is silent on an endpoint's contract, derive it from the described behavior — do not assume a frontend preference.

⚠️ **Blind Spot**: A specification written from a user-facing perspective may describe interactions as UI flows. Extract the underlying data operations — those are the backend's responsibility.
