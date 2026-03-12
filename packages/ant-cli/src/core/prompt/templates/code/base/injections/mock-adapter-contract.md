## Mock Adapter Contract

### Principle
**When implementing infrastructure adapters for external services (backend APIs,
third-party services, cross-project dependencies), ALWAYS include mock
implementations alongside production implementations.**

This is a default code job behavior. The design document defines the
architectural contracts (ports/adapters); the coding phase provides both
production and mock implementations for any port with external dependencies.

### Switching Contract

| Aspect | Requirement |
|--------|------------|
| Switching variable | A single boolean env var (e.g., `USE_MOCK=true`) controls mock activation |
| `.env.example` | MUST include the variable with a descriptive comment |
| `.env` | MUST default to `true` when `@connection` targets are unavailable or cross-project |
| Adapter-specific config | Variables consumed only by mock adapters MUST also appear in `.env.example` |
| Framework prefix | Follow framework convention for client-exposed vars (`NEXT_PUBLIC_`, `VITE_`, none for backend) |

### Constraint
- Mock activation MUST be controlled by an explicit boolean env var — NOT derived
  from NODE_ENV, build mode, or any environment-level flag
- The variable MUST NOT be named with "DEV" or "DEVELOPMENT" — mock activation
  is orthogonal to environment mode
- Mock implementations MUST satisfy the same interface contract as production
- Code that reads a mock-switching env var but does not document it in
  `.env.example` is a configuration defect

### Blind Spot
**Mock adapters are EASILY FORGOTTEN when focusing on production behavior.**
External service dependencies imply mock adapters — verify mock implementations
and env var documentation are included alongside production adapters.
