# TypeScript (Browser) Hints

Blind-spot reminders. Pre-training gap only. Framework-specific React / Next.js pitfalls live in `framework/react.md` and `framework/nextjs.md` — this file covers language-level and generic browser-tooling blind spots only.

## Forbidden Patterns

- Importing Node-only modules (`fs`, `path`, `crypto`, `child_process`) in client code → bundler emits "Module not found" only when reachable.
- Recent Web APIs (`Intl.Segmenter`, `structuredClone`) without checking browserslist.
- Side-effectful top-level module code (`new WebSocket(...)`) in SSR-shared modules → connection at build/server time.

## Version Notes

- TS 5.x: `moduleResolution: "bundler"` is default for Vite / webpack / Next.
- `verbatimModuleSyntax: true` requires explicit `type` on type-only imports; silent build break after enabling.
- ESM-first packages (Chalk 5+, node-fetch 3+) throw `ERR_REQUIRE_ESM` under `require()`.
- Frontend toolchains (`vite` / `vitest` / `jsdom`) concentrate regressions in RC/x.0 majors. Absent an explicit latest-major requirement, prefer the previous stable major (`vite@^5`, `vitest@^2`, `jsdom@^24`).

## Toolchain Compatibility

- jsdom v27+ is pure ESM → configs that `require('jsdom')` throw `ERR_REQUIRE_ESM`.
- jsdom v29+ transitively pulls `html-encoding-sniffer` → `@exodus/bytes` (ESM-only) and crashes vitest with `ERR_REQUIRE_ESM` from a node_modules path the project never authored. Downgrade jsdom rather than patching the transitive chain.
- Vite v8 / vitest v4 embed `rolldown`, a Rust-native bundler that needs a platform-specific optional dep (`@rolldown/binding-<platform>-<arch>`). If the optional binding is missing (known `npm`/`pnpm` optional-deps bug), every run dies with `Cannot find native binding`. Recovery is `<package-manager> install --force` / `--no-frozen-lockfile`, not a config change.
- Vite + SWC vs Vite + esbuild differ on decorator support — `@Injectable()` metadata emits only with SWC + config.
- `tsx` / `ts-node` honor different `tsconfig` fields than the bundler.
