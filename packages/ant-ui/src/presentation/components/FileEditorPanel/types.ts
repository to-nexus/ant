
/**
 * Editor-local types (SSOT for FileEditorPanel + IdeFrame + VirtualDocumentViewer).
 *
 * Kept in a leaf module with NO domain / application imports so cycles
 * cannot accidentally form between presentation components.
 */

/**
 * Explicit 5-case lifecycle enum surfaced to IdeFrame, per spec §5.8.
 *
 * Derived from the richer `IdeSessionState` discriminated union in
 * `@/domain/store/types` by collapsing transient sub-states:
 *
 *   IdeSessionState.kind          → IdeLifecycleState
 *   ───────────────────────────── → ──────────────────
 *   'idle'                        → 'idle'
 *   'starting' | 'frameLoading'   → 'connecting'
 *   'reconnecting'                → 'connecting'
 *   'connected'                   → 'running'
 *   'failed'                      → 'error'
 *   'disconnected'                → 'disconnected'
 */
export type IdeLifecycleState =
  | 'idle'
  | 'connecting'
  | 'running'
  | 'error'
  | 'disconnected';

/**
 * Editor tab source — drives VirtualSourceChip gradient selection.
 *
 * Note: the live `EditorTab.source` union in `@/domain/store/types` only
 * emits `'plan' | 'design'` today. We still expose the four spec-mandated
 * sources here so VirtualSourceChip can render the full palette when (a)
 * the store widens its union, (b) callers explicitly pass `'code'` /
 * `'chat'`, or (c) the fallback path maps an undefined source to `'code'`.
 */
export type EditorSource = 'design' | 'plan' | 'code' | 'chat';

/**
 * Editor body solid surface — shared SSOT for the streaming
 * (VirtualDocumentViewer) and non-streaming (FileEditorPanel /
 * LineNumberedEditor) views. A solid fill that LIFTS off the canvas
 * wrapper for readability. Both views reference this one constant so the
 * tone cannot drift apart again (cf. commit a2f57eda which split them).
 */
export const EDITOR_BODY_SURFACE: import('react').CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-1)',
  borderRadius: 'var(--r-lg)',
};
