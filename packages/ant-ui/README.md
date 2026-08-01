# @ant/ui

Ant's frontend — a React + Vite SPA served at `/app/*`, organised in Clean
Architecture layers.

Runs on **port 4200** (`ANT_UI_PORT`, `strictPort: true` — it fails rather
than drifting to another port). In dev it also proxies every non-`/app` route
to `ant-site` on 4300, so `http://localhost:4200/` mirrors the single-origin
layout production uses.

## Layout

```
src/
    main.tsx                entry point
    i18n/                   en / ko locales, split by domain
    presentation/           UI layer
        App.tsx
        components/
            chat/           ChatPanel, ChatHistory, ChatInput, ChoiceCard, MessageItem
            kanban/         task board
            workflow/       workflow graph (ReactFlow)
            layout/         MainContentArea, panel layout
            auth/           sign-in surfaces
            common/async/   AsyncBoundary + the five async surfaces
            Transfer/       code transfer
            FeatureSection/ feature management
            PreviewConfigEditor/, ConfigEditor/
        pages/              WelcomePage, QuickStart
        providers/          AlertModal, Toast
    application/            use-case layer
        hooks/
            features/       useJobExecution, useKanban, useWorkflow
            ui/             useToast, useLayoutState, useChatPolicy
            git/            useGitErrorRouting, …
        git-world/          createGitWorldSlice (composed into the store)
    domain/                 domain layer
        store/
            index.ts        Zustand store — the spread order is the SSOT
            slices/         one file per slice
        models/             task, chat, session, workflow
    infrastructure/         infrastructure layer
        http/api.ts         HTTP client
        sse/SSEManager.ts   SSE connection manager (singleton)
    shared/utils/           path-utils, workspace-path
```

## Store

A single Zustand store composed from **17 slices** in
[`domain/store/index.ts`](src/domain/store/index.ts) — that spread order is
the source of truth:

```
project, file, job, sse, ui, gitWorld, preview, auth, config,
projectConfig, reset, chat, featureLog, transfer, deploy,
projectDeletion, featureDeletion
```

`gitWorld` is the one slice not under `slices/` — it is composed from
`application/git-world/createGitWorldSlice`. Slices that represent remote
resources store flat `AsyncFields<T>` (status / data / error / refreshing).

## Architecture rules

```
Presentation -> Application -> Domain <- Infrastructure
```

- Presentation uses Application hooks only — no direct Domain access.
- Application uses Domain (the store).
- Infrastructure does not import Domain.

**Async UI policy.** Every loading / empty / error state goes through
`<AsyncBoundary>` with one of five surfaces (page / panel / region / modal /
inline), plus an ambient nav-bar progress bar. `Loader2`, `animate-spin`, and
`animate-pulse` are confined to `common/async/primitives/`; ESLint and
`pnpm legacy:sweep` enforce the boundary. Read
[docs/internals/ui-async-policy.md](../../docs/internals/ui-async-policy.md)
before adding a fetch, spinner, or status indicator.

## Backend communication

- **HTTP** — `infrastructure/http/api.ts`. Local goes through the Vite proxy;
  cloud uses `VITE_CLOUD_BACKEND_BASE`. An empty value means local mode.
- **SSE** — `infrastructure/sse/SSEManager.ts`, a singleton holding two
  connections: unified (project/feature) and workflow (jobId). Auto-reconnects
  with exponential backoff.

## Dependencies

| Category | Packages |
|---|---|
| Core | react, react-dom |
| State | zustand |
| Styling | tailwindcss, tailwind-merge, class-variance-authority |
| UI | @radix-ui/react-slot, lucide-react, framer-motion |
| Visualization | reactflow, dagre |
| i18n | i18next, react-i18next |
| Build | vite, typescript |
| Workspace | @ant/shared, @ant/auth-client |

## Commands

```bash
pnpm dev:ui                    # from the repo root
pnpm --filter @ant/ui test     # vitest — tests/ plus co-located src/**/__tests__/
pnpm typecheck:ui
```
