/**
 * Normalize language identifier to canonical form.
 * Handles LLM output that may use 'golang' instead of 'go'.
 */
export function normalizeLanguage(lang: string): string {
  const l = lang.toLowerCase();
  if (l === 'golang') return 'go';
  return l;
}
