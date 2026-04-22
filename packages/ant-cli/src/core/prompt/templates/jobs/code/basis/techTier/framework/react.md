# React Framework Hints

Blind-spot reminders for client-rendered React. Pre-training gap only.

## Forbidden Patterns

- Conditional hook calls (`if (cond) useX()`) → ordering violation; runtime throws on re-render.
- Missing deps in `useEffect` / `useMemo` / `useCallback` closing over stale props → silent incorrect behavior.
- Index-as-key in reorderable / filterable lists → state leaks between unrelated items.
- `<img src="foo.svg">` mixed with SVGR imports → inconsistent bundling.
- `React.X` namespace type (`React.JSX.Element`, `React.ReactNode`, `React.ComponentProps`, `React.FC`, ...) in a file that does NOT `import React from "react"` / `import * as React from "react"` → TS2304 "Cannot find name 'React'". `jsx: "react-jsx"` only wires the runtime; the `React` identifier for type references is NOT auto-injected.

## Symptom → Upstream Cues

If the patch repeats across ≥ 5 files, fix upstream:

- Many components annotating `JSX.Element` → React 19. Verify `@types/react` and `tsconfig.json` `jsx`, not file-by-file.
- `React.memo` + `useCallback` chains without measured benefit → fan-out source (context identity, parent setter) is the cause.
- Many files adopting `useReducer` for one domain → a shared store (Zustand / Jotai / Redux).
- Many files adding `import React` solely for one `React.X` type annotation → switch those annotations to named imports project-wide (`ReactNode`, `ComponentProps`) instead of per-file React imports.

## Version Notes

- React 19: global `JSX` removed — omit return annotations or use `React.JSX.Element` (requires `import React`; see Forbidden Patterns).
- React 19: `forwardRef` mostly unnecessary — `ref` is a regular prop on function components.
- React 18+: `useEffect` runs twice in dev StrictMode by design — fix the effect, do NOT add guards.
- Prefer named imports (`import { ReactNode, ComponentProps } from "react"`) over `React.ReactNode` when the file has no existing `import React`.

## Toolchain Compatibility

- Vite built-in `?react` SVG and `vite-plugin-svgr` register different transforms — pick one.
- SWC vs Babel Vite plugins differ on JSX runtime defaults — confirm active plugin before transform config.
- React 19 + Testing Library < 16: older `act()` shims throw under concurrent rendering.
