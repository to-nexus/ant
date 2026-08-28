/**
 * Search-result size bounds — single owner for search_code / search_reference_code.
 *
 * A line-count cap alone is not a size bound: one matching line can be
 * arbitrarily long (bundled JS, session/plan JSON), so four uncapped
 * `search_code` calls once fed ~313k chars into a single round and blew the
 * message token budget past every recovery stage (marble-curling-clasp RCA).
 * rg-backed callers also pass MAX_COLUMNS_RG_ARGS so ripgrep truncates long
 * lines at the source; `boundSearchResultLines` is the process-side bound that
 * also covers git-grep output and the NFC-tolerant retry path.
 */

export const SEARCH_MAX_RESULT_LINES = 500;
export const SEARCH_PER_FILE_MAX_COUNT = 200;
export const SEARCH_MAX_LINE_CHARS = 800;
export const SEARCH_MAX_RESULT_CHARS = 24_000;

export const MAX_COLUMNS_RG_ARGS = [
  '--max-columns', String(SEARCH_MAX_LINE_CHARS),
  '--max-columns-preview',
] as const;

/**
 * Apply the per-line, line-count, and total-char caps in that order.
 * Returns the bounded lines plus a notice to append when anything was cut.
 */
export function boundSearchResultLines(lines: string[]): { lines: string[]; notice: string } {
  const total = lines.length;
  let bounded = lines.map(l =>
    l.length > SEARCH_MAX_LINE_CHARS
      ? `${l.slice(0, SEARCH_MAX_LINE_CHARS)} [... line truncated]`
      : l,
  );
  if (bounded.length > SEARCH_MAX_RESULT_LINES) {
    bounded = bounded.slice(0, SEARCH_MAX_RESULT_LINES);
  }
  const kept: string[] = [];
  let used = 0;
  for (const l of bounded) {
    if (used + l.length + 1 > SEARCH_MAX_RESULT_CHARS) break;
    kept.push(l);
    used += l.length + 1;
  }
  // Only reachable if the first line alone exceeds the total budget, which the
  // per-line cap rules out — kept defensively so the result is never empty.
  const shown = kept.length > 0 ? kept : bounded.slice(0, 1);
  const notice = shown.length < total
    ? `\n\n[Search truncated: showing first ${shown.length} of ${total} matches ` +
      `(${SEARCH_MAX_RESULT_LINES}-line / ${SEARCH_MAX_RESULT_CHARS}-char cap). ` +
      'Narrow the pattern or use `file_pattern` to reduce scope.]'
    : '';
  return { lines: shown, notice };
}
