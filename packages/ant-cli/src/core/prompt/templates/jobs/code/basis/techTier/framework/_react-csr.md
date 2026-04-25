# React CSR Hints

Blind-spot reminders for client-rendered React on Vite-style toolchains (non-SSR). Pre-training gap only.

## Forbidden Patterns

- `<img src="foo.svg">` mixed with SVGR imports → inconsistent bundling.

## Toolchain Compatibility

- Vite built-in `?react` SVG and `vite-plugin-svgr` register different transforms — pick one.
- SWC vs Babel Vite plugins differ on JSX runtime defaults — confirm active plugin before transform config.
