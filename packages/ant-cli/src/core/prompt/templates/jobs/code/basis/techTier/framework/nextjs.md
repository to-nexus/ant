{{> jobs/code/basis/techTier/framework/_react-core}}

# Next.js Framework Hints

Blind-spot reminders. Pre-training gap only. Verify current library behaviour with `search_code` / `read_file` on `node_modules/next/**` when the error references Next.js internals.

## Forbidden Patterns

- `typeof window` / `document` guards that change JSX between server render and client initial render → hydration mismatch.
- `createPortal(..., document.body)` without a mount guard → server `null` vs client portal.
- Date / random / locale rendered directly (not gated by `useEffect`) → drift.
- Both `app/` and `src/app/` present → only one resolves.
- Server Component (= no `'use client'` directive at top of the file) passing event handler or callback function props to children → `next build` fails at prerender with "Event handlers cannot be passed to Client Component props". Colocate the interactive subtree in its own `'use client'` file.
- `<Image src="https://...">` without the host in `next.config.*` `images.remotePatterns` → client-hydration throw "hostname not configured"; `next build` / `next start` pass because validation runs only in the browser. Component file and `next.config.*` MUST be updated together. ⚠️ pravatar / picsum / unsplash are training-data reflex offenders; rule is host-agnostic. **Redirect targets count**: if the listed host responds with a 3xx Location to a different host (`picsum.photos` → `fastly.picsum.photos` is the canonical case), the optimizer rejects the redirect target with 400 "not a valid image" unless THAT host is ALSO in `remotePatterns`. Service-virtualization placeholder URLs avoid this entirely via the `unoptimized` prop or plain `<img>` per `service-virtualization-imagery` pathway 3.
- `process.env.X` read in client code without the `NEXT_PUBLIC_` prefix → inlined as `undefined` in the browser bundle; no build or type error, feature just stops working. Prefix = client-visible; un-prefixed = server-only (prefixing a secret leaks it to the client). ⚠️ Plain `process.env.X` is a universal non-Next reflex that silently breaks here.

## Version Notes

- Next.js 15: `headers()`, `cookies()`, `params`, `searchParams` are async — sync destructuring throws.
- Next.js 14: `next.config.ts` unsupported — use `.mjs` / `.js` / `.cjs`.

## Toolchain Compatibility

- Turbopack vs Webpack loaders are not interchangeable — custom Webpack config is ignored under `--turbo`.
- `next build` on Node < 18.17 → cryptic fetch errors; confirm Node before fetch-polyfill deps.
- A `babel.config.{js,cjs,mjs}` file disables SWC project-wide → `next/font`, Server Actions, and the SWC JSX transform all break silently. For Jest, prefer `next/jest` (Next.js SWC pipeline) over hand-rolled `babel-jest`.
