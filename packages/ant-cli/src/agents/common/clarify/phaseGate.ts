/**
 * Phase-level clarify gate — the ONE shared core that unifies the former
 * ad-hoc clarify emit sites (planner generate, design execute, code decompose,
 * detect, visual direct) onto a single mechanism.
 *
 * Distinct from `gate.ts` (intent-commit facade for `<specClarify>`): this
 * gate governs CONTENT clarify — "I cannot proceed without a bounded answer"
 * at a pre-fan-out commitment boundary. It never fires inside a parallel
 * worker (no post-fan-out phase is policy-enabled), so it never freezes a
 * live task queue.
 *
 * The gate owns the COMMON core only:
 *   - policy activation check (`isClarifyActive`)
 *   - parse + batch + option-min + job-scoped budget enforcement
 *   - `sendClarify` transport
 *   - `default-and-proceed` on budget exhaustion
 *   - canonical state updates (`awaitingClarify` / `clarifyPhase` / `clarifyRoundsUsed`)
 *
 * Each caller keeps its own session-persistence + workflow bookkeeping and
 * merges `result.stateUpdates` into its node return. The caller is
 * responsible for persisting `resolvedAction` in the pause checkpoint so the
 * continuation job reconstructs the artifact pool (state.artifacts Post-RAC
 * SSOT) with zero context loss.
 */

import {
  getClarifyPolicy,
  isClarifyActive,
  type ClarifyPhase,
  type IntentId,
  ExecutionTierId,
} from '@ant/shared';
import type { ClarifyBlock } from './types';
import { parseClarifyTags, stripClarifyTags } from './tags';
import { sendClarify } from './transport';
import { logger } from '../../../utils/logger';

export interface ClarifyGateInput {
  /** Final LLM response text (the single trigger surface — `<clarify>` tag). */
  responseText: string;
  intent: IntentId;
  phase: ClarifyPhase;
  /** Execution tier when the job has one (code/design). Omit for plan/visual. */
  tier?: ExecutionTierId;
  /** Job-scoped rounds already spent (read from state; never mutated here). */
  clarifyRoundsUsed?: number;
  /**
   * When true, only blocks carrying ≥1 option are eligible (planner PRD
   * surface — every clarify must render lettered options). Default false.
   */
  requireOptions?: boolean;
  /**
   * Invoked exactly once, immediately before the clarify cards are sent
   * (only on the pause path). Lets a caller flush a buffered lead-in
   * message so chat ordering is prose → card. No-op when the gate does not
   * pause.
   */
  onBeforeSend?: () => Promise<void> | void;
  /**
   * Presentation override. Defaults to `sendClarify` (choice cards). A caller
   * with a different surface (e.g. design execute forwards free-form spec
   * questions as a chat message) passes its own sender. The gate owns the
   * DECISION (active? budget? pause?); the caller owns the PRESENTATION.
   */
  send?: (blocks: ClarifyBlock[]) => Promise<void>;
}

export interface ClarifyGateResult {
  /** true → caller must terminate the turn and persist the pause marker. */
  paused: boolean;
  /** response text with `<clarify>` stripped, for clean chat display. */
  cleanedText: string;
  /** the blocks sent to the user (empty unless paused). */
  blocks: ClarifyBlock[];
  /** canonical fields to merge into the node's state return. */
  stateUpdates: {
    awaitingClarify?: boolean;
    clarifyPhase?: ClarifyPhase;
    clarifyRoundsUsed?: number;
  };
  /**
   * Set when the model asked but the gate declined to pause (budget exhausted
   * or clarify inactive here). The caller should inject this as a synthetic
   * assistant/user note so the model proceeds with a reasonable default
   * instead of dead-ending. Undefined when there was nothing to proceed past.
   */
  proceedNote?: string;
}

const PROCEED_NOTE =
  'No further clarification is available this turn. Proceed now with the most ' +
  'reasonable default given the information already provided, and state the ' +
  'assumption you made.';

/**
 * Evaluate the LLM response for a `<clarify>` request and decide whether to
 * pause the turn. Sends the clarify cards as a side effect when it pauses.
 */
export async function applyClarifyGate(
  input: ClarifyGateInput,
): Promise<ClarifyGateResult> {
  const { responseText, intent, phase, tier, requireOptions } = input;

  const parsed = parseClarifyTags(responseText);
  const blocks = requireOptions
    ? parsed.filter((b) => b.options.length > 0)
    : parsed;

  // Observability: a `<clarify>` was emitted but dropped for lacking lettered
  // options (requireOptions). Silent-dropping it would look like "no clarify
  // asked" to the caller — surface it so a prompt/model drift is visible.
  if (requireOptions && parsed.length > 0 && blocks.length === 0) {
    logger.warn(
      `[ClarifyGate] Dropped ${parsed.length} option-less <clarify> block(s) ` +
        `(intent=${intent}, phase=${phase}); proceeding as no-clarify. ` +
        `Every clarify must carry lettered a)/b)/c) options.`,
      { component: 'ClarifyGate' },
    );
  }

  // Not a clarify turn — pass through untouched.
  if (blocks.length === 0) {
    return { paused: false, cleanedText: responseText, blocks: [], stateUpdates: {} };
  }

  const cleanedText = stripClarifyTags(responseText);

  // Model emitted clarify where policy forbids it → strip and proceed.
  if (!isClarifyActive(intent, phase, tier)) {
    return {
      paused: false,
      cleanedText,
      blocks: [],
      stateUpdates: {},
      proceedNote: PROCEED_NOTE,
    };
  }

  const policy = getClarifyPolicy(intent);
  const roundsUsed = input.clarifyRoundsUsed ?? 0;

  // Budget exhausted — never pause again; fall through to default-and-proceed.
  // This bounds re-asks for BOTH modes (visual's former MAX_CLARIFY force-proceed
  // generalizes here).
  if (roundsUsed >= policy.clarifyBudget) {
    return {
      paused: false,
      cleanedText,
      blocks: [],
      stateUpdates: {},
      proceedNote: PROCEED_NOTE,
    };
  }

  // Active + budget available → pause the turn and ask.
  if (input.onBeforeSend) await input.onBeforeSend();
  await (input.send ?? sendClarify)(blocks);

  return {
    paused: true,
    cleanedText,
    blocks,
    stateUpdates: {
      awaitingClarify: true,
      clarifyPhase: phase,
      clarifyRoundsUsed: roundsUsed + 1,
    },
  };
}
