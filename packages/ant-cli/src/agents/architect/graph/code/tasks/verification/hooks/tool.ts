/**
 * verification/hooks/tool.ts — TaskToolHook.onEvent
 *
 * Translates `ToolExecutionEvent` side effects into `VerificationSession`
 * mutations. Single writer for gate invalidation and per-cycle command
 * bookkeeping — the common `nodes/tool/index.ts` side-effect handler is
 * phase-blind and delegates here.
 *
 * Dependency install status is NOT handled here (F3). It is observed
 * directly from the codebase by `invalidationScope.areDepsInstalled` at
 * each plan entry; tool side effects do not propagate install signals.
 *
 * R2 — depends only on `model/` (gates, Session). No imports from `nodes/`,
 * `routers/`, or `parallel/`.
 */

import type { ArchitectGraphState } from '../../../state';
import type { ToolExecutionEvent, ToolSideEffect } from '../../../../../../common/tool/types';

/**
 * Translate a single side effect into a Session mutation. Extracted so the
 * top-level `onEvent` can iterate without pushing branching into the
 * iteration loop; also simplifies unit tests that exercise one effect at a
 * time.
 *
 * Gate flips are driven by the LLM's `verifies` declaration on the
 * `run_command` call (carried through on `effect.verifies`). The previous
 * regex-based command-string inference (`gateForCommand`) was retired
 * because it was the SSOT-misplaced inverse of information the sequencer
 * already knew — see `docs/tmp/gate-classification-postmortem.md`.
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
