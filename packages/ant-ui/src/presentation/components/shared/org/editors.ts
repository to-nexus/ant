/** Order-insensitive equality for delegated-editor lists (org access cards + dirty selectors). */
export function editorsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
