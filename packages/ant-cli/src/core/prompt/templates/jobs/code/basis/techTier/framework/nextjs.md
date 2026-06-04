{{> jobs/code/basis/techTier/framework/_react-core}}

# Next.js Framework Hints

Blind-spot reminders for pre-training gaps. Verify current behaviour via `search_code` / `read_file` on `node_modules/next/**` when an error cites Next.js internals.

## Root Entry Coordinates

The App Router root entry is the group-less pair `app/page.tsx` + `app/layout.tsx` (or under `src/app/` when the codebase uses the `src/` convention). Route groups `(group)/page.tsx` route to `/` semantically, but they are organizational layers (group-scoped `layout`/`loading`/`error`), not substitutes for the root entry — emitting only `(group)/page.tsx` and omitting `app/page.tsx` leaves the framework root coordinate empty even when `/` superficially serves traffic. The `integration` band task owns both literal coordinates; route groups attach in addition, not instead.

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

- `next` + `react` + `react-dom` are ONE version set — pin all three with the same strategy (all `"latest"`, or all pinned to a compatible release). Never pair `"next": "latest"` with a fixed older `"react"`/`"react-dom"` range (e.g. `^18`): the peer mismatch passes `pnpm install` but breaks hydration at runtime, with no build or type error. (Reference: `next@15` ⇒ React 19, `next@14` ⇒ React 18.)
- Next.js 15: `headers()`, `cookies()`, `params`, `searchParams` are async — sync destructuring throws.
- Next.js 14: `next.config.ts` unsupported — use `.mjs` / `.js` / `.cjs`.

## Toolchain Compatibility

- Turbopack vs Webpack loaders are not interchangeable — custom Webpack config is ignored under `--turbo`.
- `next build` on Node < 18.17 → cryptic fetch errors; confirm Node before fetch-polyfill deps.
- A `babel.config.{js,cjs,mjs}` file disables SWC project-wide → `next/font`, Server Actions, and the SWC JSX transform all break silently. For Jest, prefer `next/jest` over hand-rolled `babel-jest`.
