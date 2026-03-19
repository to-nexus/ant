## TypeScript Test Generation Hints

### Test Framework

**Principle**: Observe `package.json` and existing config files to determine the project's test framework. Do NOT introduce a new framework if one is already configured.

| Checkpoint | Observation Target |
|-----------|-------------------|
| **`jest.config.*` or `jest` in package.json** | Use Jest |
| **`vitest.config.*` or `vitest` in package.json** | Use Vitest |
| **No test framework configured** | Prefer Vitest for modern projects. Add minimal config. |

**Constraint**: Do NOT mix test frameworks. If the project uses Jest, write all tests with Jest.

---

### Mock Patterns

**Principle**: TypeScript's structural typing enables test doubles through plain objects conforming to interfaces.

| Observation | Pattern |
|-------------|---------|
| **Interface or type defined for dependency** | Create plain object or class satisfying the interface |
| **Constructor/factory accepts dependencies** | Pass test doubles via constructor |
| **No abstraction, direct imports** | Use framework mocking (jest.mock / vi.mock) for module-level mocks |
| **HTTP client calls** | Use MSW or nock if available; otherwise mock the client interface |

⚠️ **Blind spot**: ES module mocking has different semantics than CommonJS. Observe `"type": "module"` in package.json and `tsconfig` module settings before choosing mock strategy.

---

### File Naming

| Convention | Rule |
|-----------|------|
| **Test file** | `*.test.ts` or `*.spec.ts` — observe existing convention |
| **Test location** | Co-locate with source, or `__tests__/` directory if project uses it |

**Constraint**: Follow the project's existing naming convention. If none exists, use `*.test.ts` co-located with source files.
