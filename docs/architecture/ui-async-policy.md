# UI Async Policy (ant-ui)

This document defines how the frontend expresses **loading, empty, error,
refreshing, and job-running** states across every surface of the app. It
replaces the previous ad-hoc mix of `if (!data) return "..."`,
`Loader2 + animate-spin`, `animate-pulse` divs, and per-component
`useState(isLoading)` hooks.

If you are about to add a network fetch, a status indicator, or a spinner
to an ant-ui component, read this document first.

---

## 1. Axes

Every async UI is defined by three axes.

### 1.1 Surface (5 + ambient)

| Surface | Where it lives |
|---------|----------------|
| `page`   | Full-screen (boot, route/view switch, auth gate) |
| `panel`  | Main panel / Explorer / Chat sidebar |
| `region` | A card or section inside a panel |
| `modal`  | Modal / dialog body |
| `inline` | Button / row / tab / dropdown |
| `ambient` | Nav bar only. Never blocks body content. |

### 1.2 State (5 + refreshing)

`idle | loading | ready | empty | error` plus a boolean `refreshing` flag
for "ready, but a re-fetch is in flight". Loading and empty must never
share the same rendering.

### 1.3 Timing

- `delay 200ms` — loading UI does not appear if the fetch resolves faster.
- `min-visible 400ms` — once shown, the loading UI stays at least this long.
- `long-wait 5000ms` — "still loading…" affordance with Cancel/Retry.
- There is no stale-timeout-as-error transition. Only slice actions may
  move to `status: 'error'`.

---

## 2. Contracts

### 2.1 SSOT in slices

Every slice that represents a remote resource stores a flat
`AsyncFields<T>` and nothing else for async bookkeeping:

```ts
interface AsyncFields<T> {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
  data: T | null;
  error: Error | null;
  refreshing: boolean;
}
```

The view type `AsyncResource<T>` is composed by a selector; the slice
never stores it directly. Retry is a slice action (`retryXxx()`), not a
field on the view.

### 2.2 Hook: `useAsyncResource`

Components consume a resource through the dedicated hook:

```ts
const projectConfigResource = useAsyncResource<ProjectConfig>(
  (s) => s.projectConfig,
);
```

The hook subscribes to the four primitive fields separately and memoises
the composed view. Do **not** call `useStore(s => selectAsync(s.foo))`
directly — the fresh object on every render would invalidate zustand's
reference equality and cause unnecessary re-subscriptions.

### 2.3 Component: `<AsyncBoundary>`

A single component handles loading / empty / error / ready for every
surface:

```tsx
<AsyncBoundary
  surface="panel"
  resource={projectConfigResource}
  retry={() => fetchProjectConfig(projectId)}
  empty={<EmptyFallback description={t('empty.projectConfig')} />}
>
  {(config) => <ConfigEditor config={config} onSave={…} />}
</AsyncBoundary>
```

The `surface` prop picks a preset (delay / min-visible / long-wait / loading
shape). Custom overrides are passed as `loading` / `empty` / `error` props
when a surface needs a distinct empty state or error layout.

### 2.4 Component: `<AmbientActivityBar>`

A thin 2-px progress bar mounted inside `AppNavBar`. Aggregates:

- `jobSlice.isRunning`
- `sseSlice.connectionStatus !== 'connected'`
- `projectConfigSlice.refreshing`

It represents *any* background activity without blocking body content.
Domain badges (StatusChip, AgentJobToolbar) continue to show specific
state — they are *not* replaced by ambient.

---

## 3. Module layout

```
packages/ant-ui/src/
├─ domain/async/
│   ├─ types.ts               AsyncStatus / AsyncFields / AsyncResource
│   ├─ selectors.ts           selectAsync (pure)
│   └─ index.ts
├─ domain/store/selectors/    projectConfig / projects helpers
└─ presentation/components/common/async/
    ├─ primitives/            Spinner / Skeleton / ProgressBar (SOLE home
    │                         of Loader2, animate-spin, animate-pulse)
    ├─ hooks/                 useAsyncDisplay / useAsyncResource
    ├─ boundary/              AsyncBoundary + presets + ErrorBoundary
    │    └─ fallbacks/        LoadingFallback / EmptyFallback / ErrorFallback
    ├─ ambient/               AmbientActivityBar / useAmbientSources
    └─ index.ts               Public barrel — import ONLY from here
```

External consumers import from `@/presentation/components/common/async`
only. Reaching into `primitives/` / `boundary/` / `ambient/` directly
bypasses the narrowing the barrel provides.

---

## 4. Error boundary hierarchy

| Boundary | Role | Scope |
|----------|------|-------|
| `RootErrorBoundary` (`main.tsx`) | Last line of defence; full-screen reload UI | Whole render tree |
| `AsyncErrorBoundary` (inside `AsyncBoundary`) | Surface-aware error fallback with Retry | Resource subtree |

Resource-level failures MUST surface through `AsyncBoundary`, not the
root boundary. The slice transitions its `AsyncFields.status` to
`'error'` and the boundary renders `ErrorFallback` with a Retry button.

---

## 5. Animation vocabulary

`animate-spin` and `animate-pulse` are private CSS hooks of the
primitives. Other components use named domain keyframes defined in
`tailwind.config.js`:

| Keyframe | Meaning | Used by |
|----------|---------|---------|
| `animate-ambient-progress` | Nav bar indeterminate progress | ProgressBar primitive only |
| `animate-status-pulse` | Domain "live/active" dot | StatusChip, reset steps, node rings, AgentJobToolbar active-job dot |
| `animate-cog-spin` | Domain "gear turning" | Workflow nodes (ActorNode, WorkflowNode) |

Adding a new domain animation? Add a keyframe+animation pair in
`tailwind.config.js` and name it to avoid matching the `\banimate-(spin|pulse)\b`
ESLint pattern.

---

## 6. Enforcement

### 6.1 ESLint (`packages/ant-ui/.eslintrc.cjs`)

- `no-restricted-imports` blocks `Loader2` from `lucide-react` everywhere
  except `primitives/`.
- `no-restricted-imports` blocks re-introducing `useConfigLoader`.
- `no-restricted-syntax` catches `className="… animate-(spin|pulse) …"`
  string literals outside `primitives/`.

### 6.2 CI grep guard (`pnpm legacy:sweep`)

`scripts/legacy-sweep.mjs` scans `src/` for:

```
Loader2, animate-spin, animate-pulse,
projectConfigExists, useConfigLoader, connection.noConfig
```

Allowed directories: `primitives/`, `i18n/locales/`. Any hit elsewhere
fails the build. ESLint catches literals; the grep guard catches
template strings, `clsx(...)` arguments, and stale references in
comments.

### 6.3 Build gate

`pnpm build:ui` runs `legacy:sweep` before Vite. The pipeline is
`legacy:sweep → vite build`. Any policy regression aborts the build.

---

## 7. Writing new code

1. The slice stores `AsyncFields<T>`. Its actions mutate `status` / `data` /
   `error` / `refreshing` together.
2. The component pulls an `AsyncResource<T>` via `useAsyncResource`.
3. The component wraps its ready-state render in `<AsyncBoundary surface="…">`.
4. For new domain indicators, add a keyframe to `tailwind.config.js`.
5. For a new surface preset, edit `boundary/presets.ts` — not individual
   components.

---

## 8. Rollback

Each migration step is one commit behind its predecessor. The order
is:

1. Add the module (`domain/async` + `common/async`).
2. Migrate one slice (pilot: `projectConfigSlice`).
3. Migrate remaining slices (`projectSlice`, `configSlice`).
4. Replace `Loader2` / `animate-(spin|pulse)` at call sites.
5. Add ESLint + CI guards.
6. Remove legacy code (`useConfigLoader`, legacy i18n keys).

Reverting the call-site replacement (step 4) alone is safe. Reverting
the slice migration (step 2) requires reverting its pilot consumer
(`MainContentArea`) in the same commit.
