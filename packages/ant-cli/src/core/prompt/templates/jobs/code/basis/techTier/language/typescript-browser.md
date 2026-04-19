# TypeScript (Browser) Hints

Blind-spot reminders. Pre-training gap only.

## Forbidden Patterns

- Importing Node-only modules (`fs`, `path`, `crypto`, `child_process`) in client code → bundler emits "Module not found" only when reachable.
- `typeof window` / `document` branches changing rendered JSX → SSR hydration mismatch.
- Recent Web APIs (`Intl.Segmenter`, `structuredClone`) without checking the project's browserslist.
- Side-effectful top-level module code (`const ws = new WebSocket(...)`) in SSR-shared modules → connection at build/server time.

## Symptom → Upstream Cues

If the shim repeats across ≥ 5 files, fix upstream:

- Many files adding `import type { JSX } from 'react'` → React 19. Verify `@types/react` and `tsconfig.json` `jsx`.
- Repeated `// @ts-expect-error` near one library → types are wrong; `skipLibCheck` or a declaration override.
- Every component re-exporting its own props type → a shared `types.ts` is missing.

## Version Notes

- TS 5.x: `moduleResolution: "bundler"` is the default for Vite / webpack / Next.
- `verbatimModuleSyntax: true` requires explicit `type` on type-only imports; silent build breaks after enabling.
- ESM-first packages (Chalk 5+, node-fetch 3+) throw `ERR_REQUIRE_ESM` under `require()`.

## Toolchain Compatibility

- jsdom v27+ is pure ESM → configs that `require('jsdom')` throw `ERR_REQUIRE_ESM`.
- Vite + SWC vs Vite + esbuild differ on decorator support — `@Injectable()` metadata emits only with SWC + config.
- `tsx` / `ts-node` honor different `tsconfig` fields than the bundler.
