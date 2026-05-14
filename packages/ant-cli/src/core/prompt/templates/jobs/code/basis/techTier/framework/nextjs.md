{{> jobs/code/basis/techTier/framework/_react-core}}

# Next.js Framework Hints

Blind-spot reminders for pre-training gaps. Verify current behaviour via `search_code` / `read_file` on `node_modules/next/**` when an error cites Next.js internals.

## Forbidden Patterns

- `typeof window` / `document` guards that change JSX between server render and client initial render → hydration mismatch.
- `createPortal(..., document.body)` without a mount guard → server `null` vs client portal.
- Date / random / locale rendered directly (not gated by `useEffect`) → drift.
- Both `app/` and `src/app/` present → only one resolves.
- Server Component (no top-level `'use client'` directive) passing event handler or callback function props to children → `next build` fails at prerender with "Event handlers cannot be passed to Client Component props". Colocate the interactive subtree in its own `'use client'` file.
- `<Image src="https://...">` without the host in `next.config.*` `images.remotePatterns` → client-hydration throw "hostname not configured"; build passes (validation is browser-only). Component and `next.config.*` MUST update together. For service-virtualization placeholders, see `service-virtualization-imagery` Rendering Contract — do NOT enumerate redirect-target hosts as a fix path.
- `process.env.X` in client code without the `NEXT_PUBLIC_` prefix → inlined as `undefined` in the browser bundle; no build or type error, feature just stops working. Prefix = client-visible; un-prefixed = server-only (prefixing a secret leaks it to the client).

## Version Notes

- Next.js 15: `headers()`, `cookies()`, `params`, `searchParams` are async — sync destructuring throws.
- Next.js 14: `next.config.ts` unsupported — use `.mjs` / `.js` / `.cjs`.

## Toolchain Compatibility

- Turbopack vs Webpack loaders are not interchangeable — custom Webpack config is ignored under `--turbo`.
- `next build` on Node < 18.17 → cryptic fetch errors; confirm Node before fetch-polyfill deps.
- A `babel.config.{js,cjs,mjs}` file disables SWC project-wide → `next/font`, Server Actions, and the SWC JSX transform all break silently. For Jest, prefer `next/jest` over hand-rolled `babel-jest`.
