/**
 * Normalize language identifier to canonical form.
 * Handles LLM output that may use 'golang' instead of 'go'.
 */
export function normalizeLanguage(lang: string): string {
  const l = lang.toLowerCase();
  if (l === 'golang') return 'go';
  return l;
}

/**
 * Normalize framework identifier to canonical form.
 * Handles LLM output that may use 'next' instead of 'nextjs'.
 */
export function normalizeFramework(framework: string | null): string | null {
  if (!framework) return null;
  const f = framework.toLowerCase();
  if (f === 'next') return 'nextjs';
  return f;
}
