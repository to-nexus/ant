/**
 * R5 self-check trailing user message.
 *
 * When the prior docGen turn produced an artifact mutation but the LLM
 * did NOT emit `<done>true</done>`, the docGen node sets
 * `state._pendingDoneCheck = true` and increments
 * `state._doneCheckEscalation`. The next docGen turn reads those
 * fields here to swap the default `'Continue.'` trailing message for a
 * self-check that asks the model whether the assigned scope is
 * satisfied.
 *
 * Shared between spec / system-design / (future) UI variants so the
 * tone and meaning-axis stay aligned across all design docGen
 * intents. Keeps the FPOP discipline: What-only, no MUST repetitions,
 * no tool-name lists, no system behaviour exposition. The codebase
 * mutation rejection is described by the gate's own error message
 * (R1/R6), not duplicated here (MECE).
 */

import type { DesignGraphState } from '../../../state';

export interface SelfCheckOptions {
  /** Feature-relative path of the artifact being produced this task. */
  artifactPath: string;
  /** Optional scope label (chapter / section text); falls back to the document. */
  sectionScope?: string;
}

export function buildSelfCheckTrailingMessage(
  state: DesignGraphState,
  options: SelfCheckOptions,
): string | undefined {
  const pending = state._pendingDoneCheck === true;
  if (!pending) return undefined;
  const escalation = state._doneCheckEscalation || 0;
  const scopeLabel = options.sectionScope?.trim() || 'full document';

  if (escalation >= 2) {
    return (
      `Second self-check: the artifact at \`${options.artifactPath}\` was updated again ` +
      `without <done>true</done>. If the assigned scope is now satisfied, output ` +
      `<done>true</done> next; otherwise complete the remaining content in the same ` +
      `artifact and then output <done>true</done>.`
    );
  }
  return (
    `The previous turn updated the artifact at \`${options.artifactPath}\` but did not ` +
    `output <done>true</done>.\n\n` +
    `Decide whether this task's assigned scope (sectionScope: "${scopeLabel}") is satisfied:\n` +
    `- Satisfied → output <done>true</done> next.\n` +
    `- Not satisfied → continue updating the same artifact and then output <done>true</done>.`
  );
}
