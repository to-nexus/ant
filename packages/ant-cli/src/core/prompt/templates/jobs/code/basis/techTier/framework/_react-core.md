# React Core Hints

Blind-spot reminders for React (hooks, types, lifecycle). Pre-training gap only. Verify current `@types/react` contract with `search_code` / `read_file` on `node_modules/@types/react/**` when the error references React types.

## Forbidden Patterns

- Conditional hook calls (`if (cond) useX()`) → ordering violation; runtime throws on re-render.
- Missing deps in `useEffect` / `useMemo` / `useCallback` closing over stale props → silent incorrect behavior.
- Index-as-key in reorderable / filterable lists → state leaks between unrelated items.
- Bare `JSX.*` type reference (`JSX.Element`, `JSX.IntrinsicElements`) under React 19 → TS2304 "Cannot find namespace 'JSX'"; use `React.JSX.*` or named import `import { JSX } from "react"`. A project-local `declare global { namespace JSX { ... } }` shim is a workaround, not a fix.
- `React.X` namespace type (`React.JSX.Element`, `React.ReactNode`, `React.ComponentProps`, `React.FC`, ...) in a file that does NOT `import React from "react"` → TS2304 "Cannot find name 'React'". Prefer named imports (`import { ReactNode, ComponentProps } from "react"`) unless React is already imported.

## Version Notes

- React 19: global `JSX` namespace removed — scoped under `React.JSX`.
- React 19: `forwardRef` mostly unnecessary — `ref` is a regular prop on function components.
- React 18+: `useEffect` runs twice in dev StrictMode by design — fix the effect, do NOT add guards.

## Toolchain Compatibility

- React 19 + Testing Library < 16: older `act()` shims throw under concurrent rendering.
