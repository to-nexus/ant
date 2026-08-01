# @ant/shared

The contract layer between `ant-cli` (backend), `ant-ui` and `ant-site`
(frontends). It holds the cross-package **types** and the shared **runtime**
those types describe — matrices, registries, canonical paths, and pure
helpers that both sides must agree on.

Anything that would drift if it were implemented twice belongs here.

## Layout

`src/` is flat — one module per contract, re-exported through `index.ts`.
The groupings below are conceptual, not directories.

| Area | Modules |
|---|---|
| **Jobs & tasks** | `job`, `task`, `workflow`, `interruption`, `session-log`, `baseline` |
| **Detection & routing** | `detection`, `actions`, `action-config-matrix`, `rac`, `clarify-policy-matrix`, `prompt-policy-matrix`, `llm-slots` |
| **Tiers & registries** | `tier-matrix`, `tech-tier-registry`, `visual-tier-registry`, `game-art-tier-registry` |
| **Workspace & artifacts** | `canonical`, `artifact-dir-policy`, `feature-name`, `codebase-presence`, `file-resource`, `file-descriptions`, `folders-compressed`, `binary-extensions` |
| **Transport** | `sse-events`, `chat-events`, `chat-status`, `bridge`, `system-config` |
| **Platform** | `git`, `preview`, `deploy`, `figma`, `org`, `approval` |
| **Models & billing** | `models`, `pricing`, `billing`, `context-lens` |
| **Verification** | `verification-scenario` |

Several of these are **single-owner SSOTs** that other packages must read
rather than re-derive — `action-config-matrix` (which artifacts each intent
takes as refs vs. context), `tier-matrix` (`isTierActive`), `canonical`
(every canonical workspace path), `models` (provider → env-var mapping),
and `pricing` (the model rate card).

## Usage

```typescript
import { JobType, KanbanData, isTierActive } from '@ant/shared';
```

Consumers resolve `types` straight to `src/`, so **type-only changes need no
build**. The package also ships a bundled `dist/index.js` (esbuild) that
serves the `import` condition, so **runtime changes do**:

```bash
pnpm --filter @ant/shared build
```

Forgetting this is the usual cause of "my new constant is `undefined` at
runtime but type-checks fine".
