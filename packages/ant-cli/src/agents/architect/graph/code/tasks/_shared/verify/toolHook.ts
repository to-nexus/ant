/**
 * `_shared/verify/toolHook` — TaskToolHook.onEvent shared by every
 * verification responsibility holder.
 *
 * SSOT: previously `tasks/verification/hooks/tool.ts`. Moved here so
 * self-verify Tier 2 tasks update the Session from tool side effects
 * the same way Tier 3/4 verification tasks do once they enter verify-mode.
 *
 * Translates `ToolExecutionEvent` side effects into `VerificationSession`
 * mutations. Single writer for gate invalidation and per-cycle command
 * bookkeeping — the common `nodes/tool/index.ts` side-effect handler is
 * phase-blind and delegates here through `composeBundle`.
 *
 * Safe for apply-phase: `state.verification` is undefined before
 * `initSession` fires, and `applyEffect` early-returns on missing
 * session. So composing this hook into apply-phase task bundles produces
 * a no-op until verify-mode begins.
 *
 * R2 — depends only on `gates`/`Session` and the graph state shape.
 */

import type { ArchitectGraphState } from '../../../state';
import type { ToolExecutionEvent, ToolSideEffect } from '../../../../../common/tool/types';

/**
 * Translate a single side effect into a Session mutation. Extracted so the
 * top-level `onEvent` can iterate without pushing branching into the
 * iteration loop; also simplifies unit tests that exercise one effect at a
 * time.
 *
 * Gate flips are driven by the LLM's `verifies` declaration on the
 * `run_command` call (carried through on `effect.verifies`).
 */
function applyEffect(state: ArchitectGraphState, effect: ToolSideEffect): void {
  const session = state.verification;
  if (!session) return;

  switch (effect.type) {
    case 'verificationInvalidated': {
      session.onFileChanged(effect.scope);
      break;
    }
    case 'commandExecuted': {
      // `exitCode === -1` is our sentinel for "policy rejection" — these
      // never actually ran so they must not flip gate state.
      if (effect.exitCode === -1) break;
      // `verifies` undefined → not a gate command; no Session mutation.
      session.onCommand(effect.verifies, effect.success);
      break;
    }
    default:
      break;
  }
}

/**
 * Primary hook entry. Iterates through every side effect emitted by the
 * tool execution and delegates to `applyEffect`. Safe to call when the
 * session is undefined — useful for apply-phase tasks where the tool
 * hook composes in but no verification has started yet.
 */
export function onEvent(state: ArchitectGraphState, event: ToolExecutionEvent): void {
  const effects = event.result.sideEffects;
  if (!effects || effects.length === 0) return;
  for (const effect of effects) {
    applyEffect(state, effect);
  }
}
