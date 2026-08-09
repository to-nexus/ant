/**
 * Custom-job system block — the inert, boundary-tagged definition block the
 * universal agent node appends to its system prompt.
 *
 * Lives in core (not agents/universal/graph) so the settings API's
 * prompt-preview endpoint can render the exact runtime block without an
 * HTTP→graph dependency. Pure: `(resolved, activeIntents) → block`.
 */

import { wrapCustomJobContent } from '../prompt/builder/InputSanitizer.js';
import type { ResolvedCustomJob } from './types.js';

/**
 * Virtual read-only mount of the custom agent definition dir inside the tool
 * sandbox — lets the LLM `read_file` the job's `injections/` prose
 * (progressive disclosure) without widening the write surface beyond
 * `universal/artifacts/`.
 */
export const DEFINITION_MOUNT_PREFIX = '_agent-definition/';

/**
 * Budget for intent-inlined injection bodies (separate from the base/ 8k
 * prose cap). On overflow, files demote WHOLESALE back to the TOC (in TOC
 * order) with an "applies now" marker — a truncated instruction file is
 * worse than a pointered one.
 */
export const INJECTION_INLINE_CAP = 12_000;

export interface CustomJobSystemBlock {
  /** The assembled boundary-tagged block text. */
  text: string;
  /** Injection files inlined in full for the given active intents. */
  inlined: string[];
  /** Injection files left as TOC pointers. */
  toc: string[];
}

/**
 * Render the custom definition as one inert boundary-tagged block:
 * merged base prose → intent-matched injections INLINED in full → remaining
 * injections as a TOC (progressive disclosure via read_file on the read-only
 * definition mount).
 *
 * `general` semantics: implicit/reserved/unmappable — when activeIntents is
 * `['general']` even mapped injections stay TOC-only (always-on prose belongs
 * in `base/`, not in an injection).
 */
export function buildCustomJobSystemBlock(
  resolved: ResolvedCustomJob,
  activeIntents: string[] = [],
): CustomJobSystemBlock {
  const parts: string[] = [resolved.prose];

  const active = new Set(activeIntents);
  const inlined: Array<{ entry: (typeof resolved.injectionsToc)[number]; matched: string[] }> = [];
  const demoted = new Set<string>();
  let inlineBudget = INJECTION_INLINE_CAP;
  for (const entry of resolved.injectionsToc) {
    const matched = (entry.intents ?? []).filter((i) => active.has(i));
    if (matched.length === 0 || !entry.body) continue;
    if (entry.body.length > inlineBudget) {
      demoted.add(entry.file);
      continue;
    }
    inlineBudget -= entry.body.length;
    inlined.push({ entry, matched });
  }

  if (inlined.length > 0) {
    const sections = inlined.map(
      ({ entry, matched }) => `### ${entry.file} (intents: ${matched.join(', ')})\n\n${entry.body!.trim()}`,
    );
    parts.push(`## Active Situation Instructions (intents: ${activeIntents.join(', ')})\n\n${sections.join('\n\n')}`);
  }

  const inlinedFiles = new Set(inlined.map(({ entry }) => entry.file));
  const tocEntries = resolved.injectionsToc.filter((e) => !inlinedFiles.has(e.file));
  if (tocEntries.length > 0) {
    const toc = tocEntries
      .map((e) => {
        const marker = demoted.has(e.file)
          ? ' (applies to the current request — load with `read_file` before acting)'
          : '';
        return `- \`${DEFINITION_MOUNT_PREFIX}jobs/${resolved.jobId}/injections/${e.file}\` — ${e.summary}${marker}`;
      })
      .join('\n');
    parts.push(
      `## Conditional Instructions (load on demand)\n` +
      `The following instruction files exist. When the base instructions above say a situation applies, load the file with \`read_file\` before acting:\n${toc}`,
    );
  }

  return {
    text: wrapCustomJobContent(parts.join('\n\n'), `${resolved.agentId}/${resolved.jobId}`),
    inlined: [...inlinedFiles],
    toc: tocEntries.map((e) => e.file),
  };
}
