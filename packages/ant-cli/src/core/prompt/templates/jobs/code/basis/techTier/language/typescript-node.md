# TypeScript (Node) Hints

Blind-spot reminders. Pre-training gap only.

## Forbidden Patterns

- `fs.readFileSync(__dirname + '/...')` in ESM → `__dirname` is undefined; use `import.meta.url` + `fileURLToPath`.
- `require('node:crypto')` in an ESM-compiled module → throws; use `import { createHash } from 'node:crypto'`.
- Mixing `await import('x')` with top-level `import x from 'x'` for one package → bundler and Node resolve inconsistently.
- Top-level `unhandledRejection` / `uncaughtException` handler that does NOT exit → process enters undefined state.

## Symptom → Upstream Cues

If the shim repeats across files, fix upstream:

- `dotenv.config()` at the top of every module → call once at process entry.
- Repeated `new PrismaClient()` instances → singleton in a module or DI container.
- Many `try { … } catch (e: any)` blocks → TS 4.4+ `useUnknownInCatchVariables`; fix tsconfig once.

## Version Notes

- Node 20+: `node:` prefix is mandatory in strict ESM resolvers; omission emits warnings some lints promote to errors.
- Native `fetch` is stable from Node 18.17+ — `node-fetch` is no longer required.
- Top-level `await` requires ESM (`"type": "module"` or `.mts`); adding it to CJS fails at parse time.

## Toolchain Compatibility

- `tsx` vs `ts-node` resolve CJS / ESM differently — a project that runs under `tsx` may fail under `ts-node --esm`.
- Vitest uses Vite's ESM pipeline even for CJS projects — use `vi.mock`, not `jest.mock`.
- TS 5.x `moduleResolution: "bundler"` is for bundlers only — Node-run projects must use `"node16"` or `"nodenext"`.
