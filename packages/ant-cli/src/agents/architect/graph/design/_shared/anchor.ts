/**
 * Single source of truth for "what is the last section identifier
 * in a ui-spec-like JSON document?". Used by docGen to surface the
 * insertion anchor to append-mode chapters without making the LLM
 * scan the (potentially huge) target file.
 *
 * The anchor is computed live at docGen turn time against the current
 * disk state — earlier (failed) approaches pre-computed it at decompose
 * time, which returns null for new-build scenarios where the target
 * file is still empty when decompose runs.
 */
export function extractLastSectionKey(content: string): string | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    const map = parsed?.sections ?? parsed?.pages;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    const ids = Object.keys(map);
    return ids[ids.length - 1] ?? null;
  } catch {
    return null;
  }
}
