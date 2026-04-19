# Next.js Framework Hints

Blind-spot reminders. Pre-training gap only.

## Forbidden Patterns

- `typeof window` / `document` guards that change JSX between server render and client initial render → hydration mismatch.
- `createPortal(..., document.body)` without mount guard → server `null` vs client portal.
- Date / random / locale rendered directly (not gated by `useEffect`) → drift.
- Both `app/` and `src/app/` present → only one resolves.

## Symptom → Upstream Cues

If the same patch repeats across ≥ 5 files, fix upstream:

- `import type { JSX } from 'react'` added to many components → check `tsconfig.json` `jsx`, `@types/react`, React 19 JSX runtime. Not file-local.
- `'use client'` re-added leaf after leaf → the boundary is too deep; convert an ancestor.
- Recurring `next/dynamic({ ssr: false })` → the import graph is client-only; colocate under a client boundary.

## Version Notes

- React 19: global `JSX` removed — use `React.JSX.Element` or omit the annotation.
- Next.js 15: `headers()`, `cookies()`, `params`, `searchParams` are async — sync destructuring throws.
- App Router: `experimental.appDir` no longer exists; remove from migrated configs.

## Toolchain Compatibility

- `next build` on Node < 18.17 → cryptic fetch errors; confirm Node before fetch-polyfill deps.
- Turbopack vs Webpack loaders are not interchangeable — custom Webpack config is ignored under `--turbo`.
- `generateStaticParams` with mismatched segment `dynamic` emits errors pointing to the wrong file.
