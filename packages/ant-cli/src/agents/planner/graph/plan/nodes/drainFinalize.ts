/**
 * No-output tool-strip salvage for the planner job (cyan-catching-cedar
 * follow-up — parity with the design job's `applyDrainFinalization`).
 *
 * Both planner loops (plan⟷tool research, execute⟷tool authoring) were bounded
 * only by `recursionLimit`. When a run keeps issuing tool calls without making
 * forward output (no `<plan>` seal, no `<file>` write) for
 * `NO_OUTPUT_HARD_CAP − DRAIN_FINALIZE_MARGIN` rounds, this strips the tool list
 * for the next LLM call and injects a "finish now" note.
 *
 * Unlike the design/code jobs, NO router hard-divert is needed: both planner
 * phases terminate structurally on a tool-less round (the plan node seals a
 * best-effort brief when no `<plan>` tag is present; the execute node writes the
 * document or hits its writer-integrity guard). `toolChoice: 'none'` makes a
 * tool call impossible at the provider layer, so the very next round terminates
 * the loop — the constraint is the whole mechanism, with `recursionLimit` as
 * the ultimate backstop. The tools stay DECLARED: deleting the declarations
 * while the history carries tool_calls is the GLM degeneration trigger
 * (sage-causing-rover axis).
 */

import type { PlanGraphState } from '../state';
import { NO_OUTPUT_HARD_CAP, DRAIN_FINALIZE_MARGIN } from '../state';

export interface PlanDrainResult<TTool> {
  tools: TTool[];
  /** `'none'` while draining — tools declared, calls forbidden. */
  toolChoice?: 'none';
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
    : `Emit the FINAL document NOW inside \`<file path="...">\` tag(s) from the ` +
      `context you have already gathered.`;
  const finalizeNote = `\n\n[SYSTEM] You have used ${noOutputCount} consecutive tool rounds ` +
    `without producing any output. Tools are no longer available. ${terminalInstruction}`;

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
  console.warn(
    `🧯 [Planner:${phase === 'plan' ? 'Plan' : 'Execute'}] No-output salvage ` +
    `(streak=${noOutputCount} ≥ ${NO_OUTPUT_HARD_CAP - DRAIN_FINALIZE_MARGIN}) → toolChoice='none', forcing terminal turn`,
  );
  return { tools, toolChoice: 'none', drainFinalizing: true };
}
