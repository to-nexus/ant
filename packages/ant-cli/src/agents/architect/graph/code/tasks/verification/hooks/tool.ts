/**
 * verification/hooks/tool.ts — TaskToolHook.onEvent
 *
 * Translates `ToolExecutionEvent` side effects into `VerificationSession`
 * mutations. Single writer for gate invalidation, dep-hash stamping, and
 * per-cycle command bookkeeping — the common `nodes/tool/index.ts` side-
 * effect handler is phase-blind and delegates here.
 *
 * R2 — depends only on `model/` (gates, Session). No imports from `nodes/`,
 * `routers/`, or `parallel/`.
 */

import type { ArchitectGraphState } from '../../../state';
import type { ToolExecutionEvent, ToolSideEffect } from '../../../../../../common/tool/types';
import { gateForCommand } from '../model/gates';

/**
 * Translate a single side effect into a Session mutation. Extracted so the
 * top-level `onEvent` can iterate without pushing branching into the
 * iteration loop; also simplifies unit tests that exercise one effect at a
 * time.
 */
function applyEffect(state: ArchitectGraphState, effect: ToolSideEffect): void {
  const session = state.verification;
  if (!session) return;

  switch (effect.type) {
    case 'verificationInvalidated': {
      session.onFileChanged(effect.scope, effect.installNeeded);
      break;
    }
    case 'depFileHashChanged': {
      session.onInstallResolved(effect.newHash);
      break;
    }
    case 'commandExecuted': {
      // `exitCode === -1` is our sentinel for "policy rejection" — these
      // never actually ran so they must not flip gate state.
      if (effect.exitCode === -1) break;
      const gate = gateForCommand(effect.command);
      session.onCommand(gate, effect.success);
      break;
    }
    default:
      break;
  }
}

/**
 * Primary hook entry. Iterates through every side effect emitted by the
 * tool execution and delegates to `applyEffect`. Safe to call when the
 * session is undefined — useful for tests that only exercise non-
 * verification tasks.
 */
export function onEvent(state: ArchitectGraphState, event: ToolExecutionEvent): void {
  const effects = event.result.sideEffects;
  if (!effects || effects.length === 0) return;
  for (const effect of effects) {
    applyEffect(state, effect);
  }
}
