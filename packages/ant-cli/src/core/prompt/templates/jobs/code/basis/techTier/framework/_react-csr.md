# React CSR Hints

Blind-spot reminders for client-rendered React on Vite-style toolchains (non-SSR). Pre-training gap only.

## Entry-Point Topology

Routing is a **central registry**: routes are declared in one place (a React Router `<Routes>` / `createBrowserRouter` config, usually in the app root). That registry is an **`integration`-band-owned** file — many screens register into it. Screen *components* are authored in the **feature band** (so they exist before the registry wires them); a ui/restyle task refines an existing screen, it does NOT add a new route. Feature tasks must not each edit the central route config in parallel (write-contention) — the integration band consolidates registration.

## Forbidden Patterns

- `<img src="foo.svg">` mixed with SVGR imports → inconsistent bundling.

## Toolchain Compatibility

- Vite built-in `?react` SVG and `vite-plugin-svgr` register different transforms — pick one.
- SWC vs Babel Vite plugins differ on JSX runtime defaults — confirm active plugin before transform config.
