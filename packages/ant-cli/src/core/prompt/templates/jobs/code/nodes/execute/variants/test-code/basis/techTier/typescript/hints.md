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

**Principle**: Test runner config files accept a fixed, documented set of keys. Runners silently ignore unknown keys — a misspelling produces no error but the config section never takes effect.

**Constraint**: Do NOT write a config key from memory. Variants that feel plausible but are hallucinated share a family shape (`setupFiles*`, `moduleNameMapper*`, `testMatch*`, `transform*`). Before writing a key, verify via one of:
- reading an existing `*.config.*` in this repo with the same runner,
- reading the runner's published type declarations (e.g. `node_modules/jest/.../Config.d.ts`),
- reading the runner's documented schema.

**Constraint**: After writing a config, re-read the file and check each key against the verified source. Unknown-key failure mode is silent; eyeball review is the only cheap detector.

⚠️ **Blind spot** — known hallucinated Jest key families, all non-existent: `setupFilesAfterSetup`, `setupFilesAfterFramework`, `setupFilesAfterRun`, `setupFilesBeforeEach`. The correct key is `setupFilesAfterEnv` (singular surface, array value). Any variant ending in a different suffix is a hallucination.

⚠️ **Blind spot** — Vitest uses `setupFiles` (plural array), NOT `setupFilesAfterEnv`. Do NOT port a Jest config's key to Vitest without checking.

---

### Type Augmentation Discoverability

**Principle**: A test-runner setup file must be reachable by the TypeScript compiler for its type-augmentation side effects (`@testing-library/jest-dom`, `vitest-axe`, etc.) to register custom matchers on the global `expect`.

Observe:
- Setup file extension: `.ts` vs `.js` under a TS project
- `tsconfig.json` `include` / `files` — whether the setup path is covered
- The augmentation package: does it ship a types entry (`/types`, `/matchers`, `/vitest`) or a plain side-effect import?

Constraint: The augmentation import must land in a file the type checker actually compiles. A `.js` setup file under a TS project registers the runtime matchers but contributes no ambient types — `expect(...).toBeInTheDocument()` then fails type check even though the runtime works.

Constraint: Prefer a `.ts` setup file OR a separate `.d.ts` ambient reference (e.g. `/// <reference types="@testing-library/jest-dom" />`). Do NOT copy random augmentation snippets into source files.

⚠️ **Blind spot**: `jest.config.js` + `jest.setup.js` is the most common silent-failure combination. Runtime tests pass; typecheck fails with TS2339 "Property 'toBeInTheDocument' does not exist".

---

### Browser-Emulation Reality Gap

**Principle**: Browser emulators (jsdom, happy-dom, linkedom) implement a SUBSET of Web APIs. Any API your component touches must either be implemented by the emulator or stubbed in the setup file.

Observe:
- Which Web APIs the component under test references (directly or via dependencies)
- Whether those APIs are `undefined` in the emulator by default
- The setup-file hook exposed by the runner (`setupFilesAfterEnv`, `setupFiles`, etc.)

Constraint: Stub missing APIs via plain global assignment in the setup file. Do not use runner-specific stubbing DSLs for platform-level gaps — globals work identically across runners.

Constraint: Stub to a minimum contract the component exercises. Overbroad stubs hide real integration problems.

⚠️ **Blind spot** — commonly missing under jsdom: `IntersectionObserver`, `ResizeObserver`, `matchMedia`, `requestAnimationFrame`, `navigator.clipboard`, `crypto.subtle`, `fetch`, `URL.createObjectURL`, `scrollTo`.

---

### Query-to-Rendered-Accessibility Alignment

**Principle**: Every test query matches something the component actually renders. Queries are only as reliable as the accessible name / role the component produces.

Observe:
- The component source's `aria-label`, `role`, and visible text BEFORE writing the query
- How many elements in the rendered tree could share the same text or label substring
- Whether the rendered text is affected by translation / locale

Constraint: Prefer role-scoped queries (`getByRole(role, { name })`) over free-text queries when the test runs against a component that renders more than one text node. Broad text queries collide whenever the same word appears in brand / nav / footer.

Constraint: When the component's accessible name is dynamic (i18n, prop-driven), match against the SAME source — import the translation key or the prop value rather than hard-coding the expected string.

⚠️ **Blind spot**: `getByText(/keyword/i)` fails with "Found multiple elements" when the keyword appears in brand copy AND body copy. The failure surfaces at runtime, not at compile time, and is indistinguishable from a rendering bug until you inspect the DOM.

---

### Module Export Contract

**Principle**: The import syntax in the test is constrained by the component module's export style. Default vs named exports are not interchangeable.

Observe:
- The target module's final lines: `export default` vs `export { X }` vs `export const X`
- The project's convention for components across existing test files (usually one style dominates)
- Barrel re-exports: a barrel can expose the same symbol under either shape

Constraint: Read the target module's export declarations before writing the import. Do not assume one style from the component name alone.

Constraint: A fix that adds a `named export` to accommodate a test must preserve any existing default export if downstream code imports it. Removing the default to appease one test can break the rest of the codebase.

⚠️ **Blind spot**: `export default function Foo() {}` paired with `import { Foo } from './foo'` surfaces as TS2614 "Module has no exported member". The component works everywhere else and only the test fails — easy to misdiagnose as a test setup problem.

---

### Mock Factory Shape vs Target Export

**Principle**: A `jest.mock(modulePath, factory)` (or `vi.mock`) replaces the ENTIRE module exports. The factory's shape must exactly mirror the real module's export style — not an approximation.

Observe:
- Target file's export line: `export default Foo` → the mock factory MUST return `{ default: FakeFoo }`.
- Target file's `export { Foo }` → the mock factory returns `{ Foo: FakeFoo }`.
- The `__esModule: true` flag is required when mocking a default export under esModuleInterop; without it `import Foo from '...'` resolves to the whole module object, not the default key.

Constraint: Read the target file's exports BEFORE writing the mock. A mock with the wrong shape causes the imported symbol to be `undefined` at runtime, and the failure surfaces as render-crash noise unrelated to the actual bug.

⚠️ **Blind spot**: Mixing up `{ default: X }` and `{ X }` across many mocks in one test file produces a cascade of "X is not a function" failures. Fix the shape once and the cascade clears; chasing symptoms one-by-one wastes a diagnostic cycle.
