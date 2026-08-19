/**
 * Custom-job system block — the inert, boundary-tagged definition block the
 * universal agent node appends to its system prompt.
 *
 * Lives in core (not agents/universal/graph) so the settings API's
 * prompt-preview endpoint can render the exact runtime block without an
 * HTTP→graph dependency. Pure: `(resolved, activeIntents) → block`.
 */

import { INTENTS_DIR_NAME, INTENT_PROMPT_FILE_NAME } from '@ant/shared';
import { wrapCustomJobContent } from '../prompt/builder/InputSanitizer.js';
import type { ResolvedCustomJob } from './types.js';

/**
 * Virtual read-only mount of the custom agent definition dir inside the tool
 * sandbox — lets the LLM `read_file` the intent prompt files (progressive
 * disclosure) without widening the write surface beyond
 * `universal/artifacts/`.
 */
export const DEFINITION_MOUNT_PREFIX = '_agent-definition/';

/**
 * Budget for active-intent prompt.md bodies inlined into the block (separate
 * from the base/ 8k prose cap). On overflow, a prompt demotes WHOLESALE back
 * to its read_file pointer with an "applies now" marker — a truncated
 * instruction file is worse than a pointered one.
 */
export const INTENT_PROMPT_INLINE_CAP = 12_000;

export interface CustomJobSystemBlock {
  /** The assembled boundary-tagged block text. */
  text: string;
  /** Intent ids whose prompt.md is inlined in full for the given active intents. */
  inlined: string[];
  /** Intent ids whose prompt.md is left as a read_file pointer. */
  toc: string[];
}

/**
 * Neutralize author text rendered into a single catalog line: newlines would
 * break the list structure, `|` would restructure a table if a row ever moves
 * into one, and a literal closing boundary tag would escape the inert block.
 */
export function sanitizeCell(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '¦')
    .replace(/<\/(custom_job_instructions)/gi, '&lt;/$1')
    .trim();
}

/**
 * Neutralize author prose rendered as an indented catalog block: `|` and the
 * closing boundary tag are neutralized like {@link sanitizeCell}, but
 * newlines are KEPT — every line after the first is indented two extra spaces
 * so the criterion cannot fabricate sibling list rows or headings at column 0.
 */
export function sanitizeBlock(text: string): string {
  return text
    .replace(/\|/g, '¦')
    .replace(/<\/(custom_job_instructions)/gi, '&lt;/$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\n')
    .map((l, i) => (i === 0 || l.trim() === '' ? l.trimEnd() : `    ${l.trimEnd()}`))
    .join('\n');
}

/**
 * Render the custom definition as one inert boundary-tagged block:
 * merged base prose → active intents' `prompt.md` bodies INLINED in full →
 * the Intent Catalog (each declared situation's id + authored criterion + the
 * state of its prompt file).
 *
 * The catalog is what makes an unpinned turn's self-selection informed: the
 * `infer.md` criterion an author writes is the matching criterion, rendered
 * for every intent on every turn. There is no runtime classification and no
 * catalog default — an unpinned turn runs as `general` and the model's own
 * read_file judgment against these criteria selects what applies.
 *
 * `general` semantics: implicit/reserved/unmappable — it is not a catalog
 * member, so when activeIntents is `['general']` nothing inlines (always-on
 * prose belongs in `base/`, not in an intent prompt).
 */
export function buildCustomJobSystemBlock(
  resolved: ResolvedCustomJob,
  activeIntents: string[] = [],
): CustomJobSystemBlock {
  const parts: string[] = [resolved.prose];

  const active = new Set(activeIntents);
  const promptOf = (intentId: string): string | undefined => resolved.intentPrompts[intentId];
  const mountFor = (intentId: string): string =>
    `${DEFINITION_MOUNT_PREFIX}jobs/${resolved.jobId}/${INTENTS_DIR_NAME}/${intentId}/${INTENT_PROMPT_FILE_NAME}`;

  // Inline decision in catalog order — an active intent's prompt inlines in
  // full while the budget holds; overflow demotes it WHOLESALE to its pointer.
  const inlined: string[] = [];
  const demoted = new Set<string>();
  let inlineBudget = INTENT_PROMPT_INLINE_CAP;
  for (const intent of resolved.intents) {
    const body = promptOf(intent.id);
    if (!active.has(intent.id) || body === undefined) continue;
    if (body.length > inlineBudget) {
      demoted.add(intent.id);
      continue;
    }
    inlineBudget -= body.length;
    inlined.push(intent.id);
  }

  if (inlined.length > 0) {
    const sections = inlined.map(
      (id) => `### ${id} — ${INTENTS_DIR_NAME}/${id}/${INTENT_PROMPT_FILE_NAME}\n\n${promptOf(id)!.trim()}`,
    );
    parts.push(`## Active Intent Instructions (intents: ${activeIntents.join(', ')})\n\n${sections.join('\n\n')}`);
  }

  const inlinedSet = new Set(inlined);
  if (resolved.intents.length > 0) {
    const entries = resolved.intents.map((intent) => {
      // Stop-hook suffix — the catalog row names the deterministic completion
      // contract a turn under this intent must satisfy (runtime-verified).
      const hookSuffix = (intent.hooks?.stop ?? [])
        .map((h) =>
          'artifact' in h
            ? `write \`${sanitizeCell(h.artifact)}\``
            : `perform \`${sanitizeCell(h.action)}\``,
        )
        .join(', ');
      const head = `- **${sanitizeCell(intent.id)}**${hookSuffix ? ` — stop hook: ${hookSuffix}` : ''}`;
      const criterion = `  applies when: ${sanitizeBlock(intent.infer)}`;
      // A loadable path next to already-present content invites a wasted
      // round-trip, so an inlined prompt is marked instead of pathed.
      const promptLine = inlinedSet.has(intent.id)
        ? `  prompt: (inlined above — do not re-read)`
        : demoted.has(intent.id)
          ? `  prompt: \`${mountFor(intent.id)}\` (applies to the current request — load with \`read_file\` before acting)`
          : promptOf(intent.id) !== undefined
            ? `  prompt: \`${mountFor(intent.id)}\` — load with \`read_file\` when this situation applies`
            : `  prompt: (none — this intent adds no additional instructions)`;
      return [head, criterion, promptLine].join('\n');
    });
    parts.push(
      `## Intent Catalog\n` +
      `Each entry is one situation this definition declares. "applies when" is the author's criterion for that situation; the entry's prompt file carries that situation's instructions.\n\n` +
      entries.join('\n'),
    );
  }

  const toc = resolved.intents
    .filter((i) => promptOf(i.id) !== undefined && !inlinedSet.has(i.id))
    .map((i) => i.id);

  return {
    text: wrapCustomJobContent(parts.join('\n\n'), `${resolved.agentId}/${resolved.jobId}`),
    inlined,
    toc,
  };
}
