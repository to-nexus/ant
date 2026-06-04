# React CSR Hints

Blind-spot reminders for client-rendered React on Vite-style toolchains (non-SSR). Pre-training gap only.

## Entry-Point Topology

{{> jobs/code/basis/techTier/framework/_entry-points-shared-registry}}

For React Router (CSR), the central registry is the `<Routes>` / `createBrowserRouter` config (usually at the app root) — that config is the `integration`-owned host entry; screen components are authored in the feature band so they exist before the registry wires them.

## Forbidden Patterns

- `<img src="foo.svg">` mixed with SVGR imports → inconsistent bundling.

## Toolchain Compatibility

- Vite built-in `?react` SVG and `vite-plugin-svgr` register different transforms — pick one.
- SWC vs Babel Vite plugins differ on JSX runtime defaults — confirm active plugin before transform config.
