/**
 * `codebase/ANTRULES.md` loader — ant-agent settings file for the target
 * codebase.
 *
 * See `docs/architecture/35-codebase-meta-policy.md` for the full policy:
 * ANTRULES.md is a **live document** that records cross-task invariants
 * ant must follow when creating or modifying files in a given codebase —
 * export style, library version compatibility, decided test runner,
 * import conventions, lint status, anti-pattern avoidance, etc.
 *
 * Write ownership is shared by all code-job tasks: setup seeds an initial
 * skeleton with only what it is confident about, and every subsequent
 * task may append or modify as it discovers new invariants during its
 * own work. There is no "writer-only" task — this loader simply reads
 * the current snapshot for prompt injection.
 *
 * The loader returns a single `string | undefined`:
 *   - `undefined` when the file is missing, unreadable, or empty
 *   - the trimmed content (with a truncation footer when > 1500 chars)
 *     when present
 *
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Policy-driven size ceiling for ANTRULES.md content that gets injected into
 * every plan / execute prompt. Content above this is truncated with a
 * pointer so the LLM knows to `read_file` the full file.
 *
 * The 1500-character limit is documented in the policy (see
 * docs/architecture/35-codebase-meta-policy.md §2 "크기 상한: 1500자").
 */
export const ANTRULES_MAX_CHARS = 1500;

/**
 * Filename resolved relative to a feature workspace's root. The policy
 * mandates the file lives at `codebase/ANTRULES.md` exactly — no hidden
 * directories, no nested paths. Callers pass the feature workspace root
 * (the parent of `codebase/`).
 */
export const ANTRULES_RELATIVE_PATH = 'codebase/ANTRULES.md';

/**
 * Synchronously load `codebase/ANTRULES.md` from a feature workspace root.
 *
 * Returns `undefined` when:
 *   - `featureRoot` is undefined / empty,
 *   - the file does not exist,
 *   - the file cannot be read (permission error, etc.),
 *   - the file is empty after trimming.
 *
 * Failure is silent by design — ANTRULES.md is optional and missing is a
 * legitimate state for projects that have not yet adopted the policy.
 * Callers forward the result directly to `promptBuilder.render` as the
 * `antrulesContent` variable; the partial gates on `{{#if antrulesContent}}`
 * so `undefined` suppresses the block entirely.
 */
export function loadAntrules(featureRoot: string | undefined): string | undefined {
  if (!featureRoot) return undefined;
  const full = path.join(featureRoot, ANTRULES_RELATIVE_PATH);
  let raw: string;
  try {
    raw = fs.readFileSync(full, 'utf8');
  } catch {
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  if (trimmed.length <= ANTRULES_MAX_CHARS) return trimmed;

  const clipped = trimmed.slice(0, ANTRULES_MAX_CHARS).trimEnd();
  const footer = `\n\n[...truncated; file exceeds ${ANTRULES_MAX_CHARS}-char cap. Call \`read_file codebase/ANTRULES.md\` for the full content.]`;
  console.warn(
    `⚠️ [ANTRULES.md] Content exceeds ${ANTRULES_MAX_CHARS}-char cap (${trimmed.length} chars). Truncated for prompt injection.`,
  );
  return `${clipped}${footer}`;
}
