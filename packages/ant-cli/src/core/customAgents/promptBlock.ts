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
 * Neutralize author text rendered into the catalog: newlines would break the
 * list structure, `|` would restructure a table if a row ever moves into one,
 * and a literal closing boundary tag would escape the inert block.
 */
export function sanitizeCell(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '¦')
    .replace(/<\/(custom_job_instructions)/gi, '&lt;/$1')
    .trim();
}

/**
 * Render the custom definition as one inert boundary-tagged block:
 * merged base prose → intent-matched injections INLINED in full → the Intent
 * Catalog (each declared situation's id + authored criterion + the files it
 * carries) → residual injections as a TOC (progressive disclosure via
 * read_file on the read-only definition mount).
 *
 * The catalog is what makes an unpinned turn's self-selection informed: the
 * `description` an author writes is the matching criterion, and without this
 * section it never reached the model at all (the TOC shows only each file's
 * first line). There is no runtime classification — a catalog `default`
 * intent activates deterministically in resolve, everything else is the
 * model's own read_file judgment against these criteria.
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
  const tocByFile = new Map(resolved.injectionsToc.map((e) => [e.file, e]));
  const mountFor = (file: string) => `${DEFINITION_MOUNT_PREFIX}jobs/${resolved.jobId}/injections/${file}`;

  // One renderer for every file line, in both sections — the demotion marker
  // must survive regardless of which section a file lands in, and a file
  // already inlined above must not advertise a read_file path (a loadable
  // path next to already-present content invites a wasted round-trip).
  const renderFileLine = (file: string): string => {
    const summary = tocByFile.get(file)?.summary;
    const tail = summary ? ` — ${sanitizeCell(summary)}` : '';
    if (inlinedFiles.has(file)) return `  - \`${file}\`${tail} (inlined above — do not re-read)`;
    const marker = demoted.has(file)
      ? ' (applies to the current request — load with `read_file` before acting)'
      : '';
    return `  - \`${mountFor(file)}\`${tail}${marker}`;
  };

  if (resolved.intents.length > 0) {
    const entries = resolved.intents.map((intent) => {
      const defaultMark = intent.default === true ? ' (default — active when no intent is pinned)' : '';
      const head = `- **${sanitizeCell(intent.id)}**${defaultMark} — applies when: ${sanitizeCell(intent.description)}`;
      const files = (intent.injections ?? []).filter((f) => tocByFile.has(f));
      const fileLines = files.length > 0
        ? files.map(renderFileLine)
        : ['  - (no instruction files — this intent selects no additional prose)'];
      return [head, ...fileLines].join('\n');
    });
    parts.push(
      `## Intent Catalog\n` +
      `Each entry is one situation this definition declares. "applies when" is the author's criterion for that situation; the files listed under it carry that situation's instructions.\n\n` +
      entries.join('\n'),
    );
  }

  const catalogFiles = new Set(resolved.intents.flatMap((i) => i.injections ?? []));
  const tocEntries = resolved.injectionsToc.filter((e) => !inlinedFiles.has(e.file));
  const residual = tocEntries.filter((e) => !catalogFiles.has(e.file));
  if (residual.length > 0) {
    const toc = residual.map((e) => renderFileLine(e.file).replace(/^ {2}/, '')).join('\n');
    const heading = resolved.intents.length > 0
      ? `## Conditional Instructions (not carried by any declared intent)\n` +
        `These instruction files exist and no intent above carries them. When the base instructions above say a situation applies, load the file with \`read_file\` before acting:\n`
      : `## Conditional Instructions (load on demand)\n` +
        `The following instruction files exist. When the base instructions above say a situation applies, load the file with \`read_file\` before acting:\n`;
    parts.push(heading + toc);
  }

  return {
    text: wrapCustomJobContent(parts.join('\n\n'), `${resolved.agentId}/${resolved.jobId}`),
    inlined: [...inlinedFiles],
    toc: tocEntries.map((e) => e.file),
  };
}
