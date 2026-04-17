/**
 * SSE Event Types — Cross-boundary contract for realtime messaging.
 *
 * Both Backend (ant-cli) and Frontend (ant-ui) import these types.
 * Single source of truth for SSE message discrimination and payload shapes.
 *
 * Legacy duplicates in `ant-cli/src/core/realtime/types.ts` and
 * `ant-ui/src/infrastructure/sse/SSEManager.ts` now re-export from here.
 */

/**
 * Discriminator for SSE messages routed through the unified stream.
 *
 * Union is intentionally the superset of what either side currently uses —
 * BE emits {kanban, chat, fileTree, workflow, preview, deploy, gitChange, unseenArtifacts, bridge}
 * FE additionally declares `transfer` for local-only routing.
 */
export type SSEMessageType =
  | 'kanban'
  | 'chat'
  | 'fileTree'
  | 'workflow'
  | 'preview'
  | 'deploy'
  | 'gitChange'
  | 'transfer'
  | 'unseenArtifacts'
  | 'bridge';

/**
 * Payload shape for `gitChange` events.
 *
 * Emitted whenever the working tree or index of a feature's codebase changes —
 * by file tree co-emit (FileTreeBroadcaster) or by `.git/index` polling
 * (GitWatcherService).
 */
export interface GitChangeEventData {
  project: string;
  feature: string;
  timestamp: string;
}

/**
 * Map of event type → payload shape. Only events with a stable, shared
 * contract are listed here. Other events remain `any`-typed pending their
 * own payload migration.
 */
export interface SSEMessageMap {
  gitChange: GitChangeEventData;
}
