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

### File Naming & Placement

**Principle**: Follow the project's existing convention. If none exists, use the ecosystem standard for the detected test runner.

| Observation | Placement |
|-------------|-----------|
| **Existing test files found** | Follow the same directory and naming pattern exactly |
| **Vitest detected** | Co-locate with source — `*.test.ts` next to the source file |
| **Jest detected** | `__tests__/` directory mirroring the source structure (e.g., `src/utils/foo.ts` → `src/__tests__/utils/foo.test.ts`) |
| **No runner configured** | Co-locate with source — Vitest will be added as the default |

**Constraint**: Do NOT mix placements within the same project. Pick one pattern and apply it consistently across all test files written in this task.

---

### Config Property Names

**Principle**: Test runner config files use specific property names. Misspelled keys are silently ignored.

| Config File | Commonly Confused | Correct Property |
|-------------|-------------------|-----------------|
| `jest.config.*` | `setupFilesAfterSetup` | `setupFilesAfterEnv` |
| `vitest.config.*` | `setupFiles` | `setupFiles` (Vitest) or `setupFilesAfterEnv` (Jest) |

⚠️ **Blind spot**: `setupFilesAfterSetup` does NOT exist. The correct Jest key is `setupFilesAfterEnv`. Jest ignores unknown keys silently — the setup file never loads and tests fail with missing matchers.
