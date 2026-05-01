/**
 * Three-stage rescue:
 *   1. strip whole-string ```json ... ``` fence,
 *   2. slice from first `{` to last `}` when prose wraps a JSON body,
 *   3. fall through to trimmed input.
 * Module-private to `tasks/_shared/batchSplit/` and the sibling
 * `verify/emptyImpl.ts` predicate; not exported from the barrel.
 */
export function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();

  if (trimmed.length > 0 && trimmed[0] !== '{') {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  return trimmed;
}
