# React Framework Hints

Blind-spot reminders for client-rendered React. Pre-training gap only. Verify current `@types/react` contract with `search_code` / `read_file` on `node_modules/@types/react/**` when the error references React types.

## Forbidden Patterns

- Conditional hook calls (`if (cond) useX()`) → ordering violation; runtime throws on re-render.
- Missing deps in `useEffect` / `useMemo` / `useCallback` closing over stale props → silent incorrect behavior.
- Index-as-key in reorderable / filterable lists → state leaks between unrelated items.
- `<img src="foo.svg">` mixed with SVGR imports → inconsistent bundling.
- `React.X` namespace type (`React.JSX.Element`, `React.ReactNode`, `React.ComponentProps`, `React.FC`, ...) in a file that does NOT `import React from "react"` / `import * as React from "react"` → TS2304 "Cannot find name 'React'". `jsx: "react-jsx"` wires the runtime only; the `React` identifier for type references is not auto-injected. Prefer named imports (`import { ReactNode, ComponentProps } from "react"`) unless the file already imports React.

## Version Notes

- React 19: global `JSX` removed — scoped under `React.JSX`.
- React 19: `forwardRef` mostly unnecessary — `ref` is a regular prop on function components.
- React 18+: `useEffect` runs twice in dev StrictMode by design — fix the effect, do NOT add guards.

## Toolchain Compatibility

- Vite built-in `?react` SVG and `vite-plugin-svgr` register different transforms — pick one.
- SWC vs Babel Vite plugins differ on JSX runtime defaults — confirm active plugin before transform config.
- React 19 + Testing Library < 16: older `act()` shims throw under concurrent rendering.
