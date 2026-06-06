{{> jobs/code/basis/techTier/framework/_react-core}}

# Next.js Framework Hints

Blind-spot reminders for pre-training gaps. Verify current behaviour via `search_code` / `read_file` on `node_modules/next/**` when an error cites Next.js internals.

## Entry-Point Topology

{{> jobs/code/basis/techTier/framework/_entry-points-file-per-route}}

Next.js (App & Pages Router) concrete coordinates:

- **Per-unit entries (authoring task owns)**: every page file and `route.ts`, **including the root `/` page `app/page.tsx`**.
- **Host entry (`integration` band owns)**: the root `app/layout.tsx` (or `src/app/layout.tsx` under the `src/` convention), the provider/host tree, and global navigation — the shared frame.

The framework still REQUIRES the root coordinate `app/page.tsx` to exist. Route groups `(group)/page.tsx` route to `/` semantically but are organizational layers (group-scoped `layout`/`loading`/`error`), **not substitutes** for the literal `app/page.tsx` — omitting it leaves `/` empty even when traffic superficially serves. Because `app/page.tsx` is the home `/` route's per-unit entry, its **author** owns and MUST create it (closure: no placeholder); `integration` owns `app/layout.tsx` only.

A `(group)` segment is **excluded from the URL**: a page at `app/(auth)/login/page.tsx` is served at `/login`, NOT `/auth/login`. Navigation targets (`router.push`/`replace`, `<Link href>`, `redirect()`, middleware rewrites) MUST equal the URL the route tree produces — every parenthesized segment dropped — derived from the route folders, not from intent. If a segment must appear in the URL, use a plain folder (`app/auth/login/`), not a group.

## Forbidden Patterns

- `typeof window` / `document` guards that change JSX between server render and client initial render → hydration mismatch.
- `createPortal(..., document.body)` without a mount guard → server `null` vs client portal.
- Date / random / locale rendered directly (not gated by `useEffect`) → drift.
- Both `app/` and `src/app/` present → only one resolves.
- Server Component (no top-level `'use client'` directive) passing event handler or callback function props to children → `next build` fails at prerender with "Event handlers cannot be passed to Client Component props". Colocate the interactive subtree in its own `'use client'` file.
- `next/image` `<Image>` for raster — TEMPORARY policy until the ANT preview-server image pipeline is fixed: render every raster slot with plain `<img>` and do NOT add `images.remotePatterns` entries. `/_next/image` follows redirects then content-sniffs the body; unreliable in preview, and `remotePatterns` is downstream of the failure. Use native attributes for responsive/lazy (`loading="lazy"`, `srcset`, `sizes`, `width`/`height`). SVG handled by `_react-core`.
- `process.env.X` in client code without the `NEXT_PUBLIC_` prefix → inlined as `undefined` in the browser bundle; no build or type error, feature just stops working. Prefix = client-visible; un-prefixed = server-only (prefixing a secret leaks it to the client).
- Module-evaluation side effects on browser-only globals reachable from a server component (App Router default) → `next build` SSG crash; the `import` alone triggers evaluation. Isolate via `'use client'` on the consuming subtree or `dynamic(import, { ssr: false })`.

## Version Notes

- `next` + `react` + `react-dom` are ONE version set, decided **framework-led** (see `config.md §0` set-coherence). Do NOT use the floating `"latest"` tag for the set — the set is peer-coupled, and floating `"latest"` silently jumps majors on a later install, breaking the peer match. Instead pin the set to its **latest stable release** (concrete ranges): pin `next` to its current stable major (e.g. `next@^16`) and let `react`/`react-dom` follow Next's peer requirement for that major as ONE set (`next@16` ⇒ `react@^19` + `react-dom@^19`). ⚠️ Never split majors across the set — pinning `next` with a fixed older `"react"`/`"react-dom"` (e.g. `^18`) passes `pnpm install` but breaks hydration at runtime with no build or type error; the renderer major is dictated by the chosen Next major, not chosen independently. (Reference: `next@16`/`next@15` ⇒ React 19; `next@14` ⇒ React 18 + no `next.config.ts`.)
- Next.js 15: `headers()`, `cookies()`, `params`, `searchParams` are async — sync destructuring throws.
- Next.js 14: `next.config.ts` unsupported — use `.mjs` / `.js` / `.cjs`.

## Toolchain Compatibility

- Turbopack vs Webpack loaders are not interchangeable — custom Webpack config is ignored under `--turbo`.
- `next build` on Node < 18.17 → cryptic fetch errors; confirm Node before fetch-polyfill deps.
- A `babel.config.{js,cjs,mjs}` file disables SWC project-wide → `next/font`, Server Actions, and the SWC JSX transform all break silently. For Jest, prefer `next/jest` over hand-rolled `babel-jest`.
