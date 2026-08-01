# Frontend Architecture

## Overview

ant-ui is a React 19 + Vite SPA. It follows a Clean Architecture layer structure, manages state with Zustand, and communicates with the backend in real time via SSEManager. The brand name is **Ant**.

## Layer Structure

```
Presentation -> Application -> Domain <- Infrastructure
```

| Layer | Role | Directory |
|--------|------|----------|
| Presentation | React UI components, pages, layouts | `src/presentation/` |
| Application | Use-case hooks, connecting domain and UI | `src/application/` |
| Domain | Zustand store, slices, models | `src/domain/` |
| Infrastructure | HTTP client, SSE, storage | `src/infrastructure/` |
| Shared | Utilities, constants, canonical-dirs | `src/shared/` |

### Dependency Direction

- Presentation uses Application hooks (direct Domain access is forbidden)
- Application uses Domain (the store)
- Domain uses Infrastructure (SSE, HTTP)
- Infrastructure does not import Domain

## State Management (Zustand)

The single Zustand store is composed of the slices below (the official list after the Phase 7 cutover).

| Slice | Role |
|----------|------|
| projectSlice | Project/feature selection, lists, session restore flags. On switch, only performs the project-config scrub (git-world reset is owned by `useProjectLifecycle`) |
| fileSlice | File tree, file editing |
| jobSlice | Job execution state, currentJobId |
| sseSlice | Single EventSource connection manager. Registers handlers for 10 SSE types including `gitState` |
| uiSlice | UI state (tabs, layout, pendingClarifyAnswers) |
| git-world (`domain/git-world`) | Git SSOT — `snapshot: AsyncFields<GitSnapshot>`, `operation: GitOperationState` (FSM), `pat: AsyncFields<GitPatState>`. 3 writers (`fetchGitWorldState`, `runGitOperation`, `savePat/deletePat`). Details in [24-git-operations.md §0](24-git-operations.md) |
| projectConfigSlice | `.ant/config.json` contents (`AsyncFields<ProjectConfig>`) |
| previewSlice | Preview state |
| authSlice | Auth state (`userEmail` / `userOrganization` / `userId` / `userOrgKind` / `memberships`). `userId`, `userOrgKind`, and `memberships` are re-supplied from `/auth/me` on every mount (non-persisted). `selectUserOrgKind` / `selectOrgDisplayLabel` handle kind branching/display. AppNavBar shows the active account indicator plus (when memberships > 1) the switcher (`switchOrg`). Full model: [40-org-model.md](40-org-model.md) |
| configSlice | System settings (`serverMode: AsyncFields<'local'\|'cloud'>` from `/system/config`, localBackendPort, recursionLimit) |
| chatSlice | Chat messages |
| transferSlice | Transfer state |
| deploySlice | Deploy state |
| resetSlice | State reset |

### Git / ProjectConfig SSOT

Git state has the `domain/git-world/` slice as its single SSOT. Presentation never accesses git-world slice fields directly via `useStore`; it uses the shared hooks only:

- Read: `useGitSnapshot` · `useGitOperation` · `useGitPat` · `useGitCta` · `useGitMenu` · `useGitBadge` · `useGitSetupCta`
- Write: `useGitDispatch().runGitOperation` / `fetchGitWorldState` / `clearGitOperation`, `useGitPatDispatch().savePat / deletePat / fetchGitPat`
- SSE entry: `registerGitStateHandler()` (normally auto-registered by `sseSlice.initializeSSE`)

`projectConfigSlice` holds an AsyncFields envelope (`{status, data, error, refreshing}`). `githubRepo` exists only at the `data.githubRepo` position inside this envelope. The `domain/project-world/useProjectConfigSnapshot` and `useGithubRepo` hooks handle envelope unwrapping and primitive-level reads so that non-primitive objects are never created inside `useStore` (preventing Zustand reference-equality violations). Details in [24-git-operations.md §0](24-git-operations.md).

### Project Lifecycle Orchestration

All side effects that must happen on a `(selectedProject, selectedFeature)` switch are owned by the `useProjectLifecycle` hook in **one place, the app root** — `clearGitWorld()` → `clearProjectConfig()` → `initializeSSE()` (inducing a `reconnectRefill` SSE) → `fetchProjectConfig()` → `fetchGitWorldState()`. Slice setters stay close to pure setters, and session-restore polling is owned solely by `useSessionLoader`.

### Persistence

- `localStorage`: theme, user email, backend mode, local backend port
- `sessionStorage`: selected project/feature

## Backend Integration

### HTTP

Base URL resolution logic lives in `infrastructure/http/api/client.ts`. Accessed via the `API_BASE()` and `REALTIME_BASE()` functions:
- Local: relative paths (Vite proxy routes to `localhost:4100`/`4101`)
- Cloud: the `VITE_CLOUD_BACKEND_BASE` environment variable

Auth: the `x-user-email` header is sent in cloud mode.

### SSE

`infrastructure/sse/SSEManager.ts` manages it as a singleton:
- Unified connection: `REALTIME_BASE()/projects/{project}/features/{feature}/stream`
- Workflow connection: `/jobs/{jobId}/workflow/stream`
- Message types: `kanban`, `chat`, `fileTree`, `workflow`, `preview`, `deploy`, `gitChange`, `transfer`, `unseenArtifacts`, `bridge` (the canonical union is `SSEMessageType` in `@ant/shared/sse-events.ts`)
- Auto-reconnect: exponential backoff, including logic to prevent loss of in-flight streaming chat messages on reconnection

## Agent Watermarks

Per-agent character watermarks are shown in the chat panel's empty state:

| Agent | Files |
|----------|------|
| architect | `public/watermarks/architect-color.png`, `architect-mono.png` |
| creator | `public/watermarks/creator-color.png`, `creator-mono.png` |
| planner | `public/watermarks/planner-color.png`, `planner-mono.png` |

## Visual Job UI

The Visual Job (creator agent) has dedicated UI for the image generation/revision workflow:
- `ImageLightbox`: enlarged view of generated images
- Draft selection UI: a clarify card for choosing among sketch results
- Inline image display within chat

## Main Panel Tabs

| Tab | Component | Purpose |
|----|----------|------|
| `job` | Kanban + Workflow | Task queue, workflow |
| `projectConfig` | ConfigEditor | Project settings |
| `accountConfig` | ConfigEditor | Account settings |
| `fileEdit` | CodeEditor | File editing |
| `transfer` | TransferPanel | Code transfer |
| `previewConfig` | PreviewConfigEditor | Preview settings |

## Internationalization (i18n)

Based on i18next. Managed as JSON files in the `en/` and `ko/` locale directories. Split by domain: artifacts, auth, chat, common, config, explorer, kanban, nav, onboarding, transfer.

## Boundaries

- SSE connection details: [21-realtime-system.md](21-realtime-system.md)
- Chat UI: [31-chat-system.md](31-chat-system.md)
- Shared types: [01-shared-contracts.md](01-shared-contracts.md)
- Figma Desktop integration: [26-figma-integration-infra.md](26-figma-integration-infra.md)
