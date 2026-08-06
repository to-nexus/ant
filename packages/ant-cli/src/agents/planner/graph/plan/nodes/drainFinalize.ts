/**
 * No-output tool-strip salvage for the planner job (cyan-catching-cedar
 * follow-up — parity with the design job's `applyDrainFinalization`).
 *
 * Both planner loops (plan⟷tool research, execute⟷tool authoring) were bounded
 * only by `recursionLimit`. When a run keeps issuing tool calls without making
 * forward output (no `<plan>` seal, no file write) for
 * `NO_OUTPUT_HARD_CAP − DRAIN_FINALIZE_MARGIN` rounds, this strips the tool list
 * for the next LLM call and injects a "finish now" note.
 *
 * Phase split under the tool-call authoring protocol:
 * - `plan` phase: `toolChoice: 'none'` — the `<plan>` seal is a TEXT tag, so
 *   forbidding tool calls forces the terminal turn structurally (the plan
 *   node seals a best-effort brief when no `<plan>` tag is present).
 * - `execute` phase: `{ allow: [create_file, append_file] }` — the document
 *   IS written through tools now, so the write channel must stay open;
 *   exploration tools disappear. `_noOutputCallCount` resets on a successful
 *   write, and `recursionLimit` remains the ultimate backstop.
 * In both shapes the declarations are narrowed or constrained, never deleted:
 * deleting them while the history carries tool_calls is the GLM degeneration
 * trigger (sage-causing-rover axis).
 */

import type { PlanGraphState } from '../state';
import { NO_OUTPUT_HARD_CAP, DRAIN_FINALIZE_MARGIN } from '../state';
import type { LLMToolChoice } from '../../../../../core/ports/llm';

export interface PlanDrainResult<TTool> {
  tools: TTool[];
  /** Constraint while draining — see the phase split in the header. */
  toolChoice?: LLMToolChoice;
  drainFinalizing: boolean;
}

/**
 * Mutates `messages` in place (appends the finalization note to the last user
 * message) and returns the (possibly stripped) tool list plus the active-turn
 * flag. `phase` selects the phase-appropriate terminal instruction.
 */
export function applyPlanDrainFinalization<TTool>(
  state: Pick<PlanGraphState, '_noOutputCallCount'>,
  messages: Array<{ role: string; content: string | any[] }>,
  tools: TTool[],
  phase: 'plan' | 'execute',
): PlanDrainResult<TTool> {
  const noOutputCount = state._noOutputCallCount || 0;
  const drainFinalizing = noOutputCount >= NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN;

  if (!drainFinalizing) {
    return { tools, drainFinalizing: false };
  }

  const terminalInstruction = phase === 'plan'
    ? `Stop researching and seal your brief NOW inside a \`<plan>\` tag from the ` +
      `context you have already gathered (or state your synthesis in plain text).`
    : `Write the FINAL document NOW by calling create_file (continue with append_file ` +
      `if it is large) from the context you have already gathered.`;
  const availabilityNote = phase === 'plan'
    ? 'Tools are no longer available.'
    : 'Exploration tools are no longer available; only create_file and append_file remain.';
  const finalizeNote = `\n\n[SYSTEM] You have used ${noOutputCount} consecutive tool rounds ` +
    `without producing any output. ${availabilityNote} ${terminalInstruction}`;

  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    if (Array.isArray(lastMsg.content)) {
      (lastMsg.content as any[]).push({ type: 'text', text: finalizeNote });
    } else if (typeof lastMsg.content === 'string') {
      lastMsg.content = [
        { type: 'text', text: lastMsg.content },
        { type: 'text', text: finalizeNote },
      ];
    }
  }
  const toolChoice: LLMToolChoice = phase === 'plan'
    ? 'none'
    : { allow: ['create_file', 'append_file'] };
  console.warn(
    `🧯 [Planner:${phase === 'plan' ? 'Plan' : 'Execute'}] No-output salvage ` +
    `(streak=${noOutputCount} ≥ ${NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN}) → toolChoice=${phase === 'plan' ? "'none'" : '{allow: create_file, append_file}'}, forcing terminal turn`,
  );
  return { tools, toolChoice, drainFinalizing: true };
}
