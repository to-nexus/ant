{{> jobs/code/basis/techTier/framework/_react-core}}

# Next.js Framework Hints

Blind-spot reminders for pre-training gaps. Verify current behaviour via `search_code` / `read_file` on `node_modules/next/**` when an error cites Next.js internals.

## Forbidden Patterns

- `typeof window` / `document` guards that change JSX between server render and client initial render → hydration mismatch.
- `createPortal(..., document.body)` without a mount guard → server `null` vs client portal.
- Date / random / locale rendered directly (not gated by `useEffect`) → drift.
- Both `app/` and `src/app/` present → only one resolves.
- Server Component (no top-level `'use client'` directive) passing event handler or callback function props to children → `next build` fails at prerender with "Event handlers cannot be passed to Client Component props". Colocate the interactive subtree in its own `'use client'` file.
- `next/image` `<Image>` for raster — TEMPORARY policy until the ANT preview-server image pipeline is fixed: render every raster slot with plain `<img>` and do NOT add `images.remotePatterns` entries. `/_next/image` follows redirects then content-sniffs the body; unreliable in preview, and `remotePatterns` is downstream of the failure. Use native attributes for responsive/lazy (`loading="lazy"`, `srcset`, `sizes`, `width`/`height`). SVG handled by `_react-core`.
- `process.env.X` in client code without the `NEXT_PUBLIC_` prefix → inlined as `undefined` in the browser bundle; no build or type error, feature just stops working. Prefix = client-visible; un-prefixed = server-only (prefixing a secret leaks it to the client).

## Version Notes

- Next.js 15: `headers()`, `cookies()`, `params`, `searchParams` are async — sync destructuring throws.
- Next.js 14: `next.config.ts` unsupported — use `.mjs` / `.js` / `.cjs`.

## Toolchain Compatibility

- Turbopack vs Webpack loaders are not interchangeable — custom Webpack config is ignored under `--turbo`.
- `next build` on Node < 18.17 → cryptic fetch errors; confirm Node before fetch-polyfill deps.
- A `babel.config.{js,cjs,mjs}` file disables SWC project-wide → `next/font`, Server Actions, and the SWC JSX transform all break silently. For Jest, prefer `next/jest` over hand-rolled `babel-jest`.

## Execution-Context Instantiation

This section is the Next.js instantiation of the universal `execution-context-discipline` partial (see `code/base/injections/execution-context-discipline.md` for the principle). Use the syntax below to satisfy the **authored declaration** and **integrator graph integrity** requirements stated there.

### Declaration syntax

| Module characteristic | Declaration | Effect |
|-----------------------|-------------|--------|
| Uses browser-only globals (`window`, `document`, `Audio`, `localStorage`, `IntersectionObserver`, …) anywhere — including transitive imports' module-load side effects | `'use client'` as the file's first non-comment line | Forces the module (and any tree that imports it from a server component) into the client bundle |
| Uses server-only resources (DB clients, `fs`, secrets) | `'use server'` (for server actions) or place under a server-component file with no `'use client'` boundary above it | Keeps the code out of the client bundle |
| Reads node-only globals at module top-level inside what would otherwise be a server-rendered tree | Wrap the consuming component in `dynamic(() => import(...), { ssr: false })` from `next/dynamic` | Defers evaluation until client mount |
| Both runtimes need it but with different bodies | `'use client'` file imported lazily from a server component via `dynamic(..., { ssr: false })` | Server entry compiles without ever evaluating the client body |

### Integrator graph-integrity steps (integration-band tasks)

When you create an `app/page.tsx`, `app/layout.tsx`, route segment, or middleware:

1. Identify whether the file is a server component (default) or client component (`'use client'` directive at top). Default in Next.js App Router is **server**.
2. For each top-level import, follow the chain. If any transitively-imported module's *module evaluation* touches a browser-only API (e.g. `export const x = new Audio()` at module scope, or a class instantiated at module-load whose constructor touches one), you have a graph violation.
3. Resolve by either:
   - Marking the entry as `'use client'` (if the whole subtree is client-side anyway), OR
   - Importing the offending module lazily via `dynamic(() => import(...), { ssr: false })`, OR
   - Pushing the offending side effect inside a method/effect so module evaluation stays inert.
4. Verify by simulating a Node import of the entry — `new Audio()` at module top is the canonical failure mode (`ReferenceError: Audio is not defined` during `next build` SSG).

### Forbidden patterns (extends the section above)

- Module-top-level construction of browser-only objects (e.g. `export const audio = new Audio()`) imported from any server component or layout. The import alone triggers evaluation and crashes SSG. Use lazy construction (`get audio() { return this._audio ??= new Audio(); }`) AND ensure the consuming component is `'use client'` or dynamically imported with `{ ssr: false }`.
