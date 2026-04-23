## Self-Contained Dependency Principle

**Principle**: If this task writes code that uses a library, global, or config key, that library MUST be declared in the project's dependency manifest AND installed — within this task, before `<done>`. Do NOT defer to a future task.

### Observation targets

Before emitting `<done>`, verify for every symbol this task introduces:

| Observation | Target |
|-------------|--------|
| **Import path** (`import ... from 'X'`) | `X` MUST appear in `dependencies ∪ devDependencies` of the manifest and be resolvable under `node_modules/` |
| **Typed runtime global** (`jest.*`, `describe`, `it`, `expect`, `vi.*`, `beforeEach`, custom DSLs) | The runner's runtime package AND its types package (`@types/{runner}` when the runner ships runtime-only) MUST be declared |
| **Runtime-only augmentation** (`@testing-library/jest-dom`, etc.) | Both the package itself AND a setup entry that imports it MUST be wired — a declared package never loaded is equivalent to a missing package |
| **Config key** written to any `*.config.*` | Key name MUST match the library's published schema / `.d.ts` — not memory. Verify via one of: existing config in this repo, `node_modules/{pkg}/**/*.d.ts`, published documentation |

### Constraints

- **Close the loop within this task.** After editing the manifest, run the detected package manager's install command and confirm the new package resolves. The subsequent build/test gate will NOT forgive a manifest-only edit.
- **Symbol presence ≠ dep completeness.** Observing a runtime package in the manifest proves only that the runtime is declared; its typed-support and augmentation packages are independent observations and may be absent.
- **No implicit installs.** Every import is local project state; the platform installs nothing implicitly. Do NOT skip a declaration on the assumption that a dep is "standard" or "surely present."
- **Config keys are silent failures.** An unknown key produces no error — the config section never takes effect. Verification by eye at write time is the only cheap detector.

### Package manager detection

| Indicator present | Install invocation |
|-------------------|--------------------|
| `pnpm-lock.yaml` / `pnpm-workspace.yaml` | `pnpm add [-D] <pkgs>` (run with `working_directory: codebase`) |
| `yarn.lock` | `yarn add [-D] <pkgs>` |
| `package-lock.json` or only `package.json` | `npm install [-D] <pkgs>` |
| `go.mod` | Edit `require` block with exact versions; `go mod tidy` runs in verification |
| `Cargo.toml` | `cargo add <pkgs>` |
| `pyproject.toml` | `poetry add <pkgs>` or `pip install <pkgs>` |
| `requirements.txt` | `pip install <pkgs>` |

### Blind spot

⚠️ **Typed runner trap**: A task writes tests using `describe` / `it` / `expect` globals while the manifest declares only `jest` + `jest-environment-jsdom`. The code runs at runtime (jest injects the globals) but `tsc --noEmit` fails because `@types/jest` is absent. The failure is reported against every test file, not against the manifest — misattributing root cause costs a verification cycle. The symptom repeats verbatim for Mocha (`@types/mocha`), Jasmine (`@types/jasmine`), Tap, and any other runner whose runtime package ships without type declarations.

⚠️ **Config-key hallucination trap**: `setupFilesAfterFramework`, `setupFilesAfterSetup`, `setupFilesAfterRun`, `setupFilesBeforeEach` are all non-existent Jest keys. The correct Jest key is `setupFilesAfterEnv`. Jest silently ignores unknown keys — the hallucinated setup file never loads, and the failure surfaces as missing matchers at test time, not as a config error. The same class of bug applies to any library whose config is keyed by string literals. Verify every key against the library's `.d.ts` or published schema before writing.
