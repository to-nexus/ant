## Mock Adapter Contract

### Principle
**When the design specification defines mock implementation strategies for infrastructure ports, the switching mechanism MUST be an explicit boolean environment variable — NOT derived from NODE_ENV, build mode, or any environment-level flag.**

Mock adapters provide local substitutes when external services are unavailable. Activating them is a runtime configuration choice, independent of whether the application runs in development or production mode.

### Contract

| Aspect | Requirement |
|--------|------------|
| Switching variable | A single boolean env var (e.g., `USE_MOCK=true`) controls mock activation |
| `.env.example` | MUST include the variable with a descriptive comment |
| `.env` | MUST default to `true` when `@connection` targets are unavailable or cross-project |
| Adapter-specific config | Variables consumed only by mock adapters (e.g., simulated geo-block flag) MUST also appear in `.env.example` |
| Framework prefix | Follow framework convention for client-exposed vars (`NEXT_PUBLIC_`, `VITE_`, none for backend) |

### Constraint
- The variable MUST NOT be named with "DEV" or "DEVELOPMENT" in it — mock activation is orthogonal to environment mode
- Code that reads a mock-switching env var but does not document it in `.env.example` is a configuration defect
- `.env` and `.env.example` MUST stay in sync: every variable in one MUST exist in the other

### Blind Spot
**Mock-related environment variables are EASILY FORGOTTEN in `.env.example`.** When adapter switching logic reads an env var, verify it appears in BOTH `.env.example` (with comment) and `.env` (with default value). This applies to the main switching variable AND any mock-adapter-specific configuration variables.
