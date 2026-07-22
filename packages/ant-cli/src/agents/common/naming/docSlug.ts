/**
 * Doc-slug naming SSOT — shared by every job that lets the LLM NAME the
 * document(s) it authors (spec decompose, planner seal). Keeps the sanitize
 * rule and the disk-collision policy in one place so the two call sites cannot
 * drift.
 */

import { generateMnemonic } from '../../../utils/humanId';

/**
 * Sanitize an LLM-proposed doc slug to a safe `[a-z0-9-]` token. Capped at 30
 * chars to leave room for an optional `-{adj}-{noun}` collision mnemonic. When
 * the raw value sanitizes to empty, `fallback` is returned verbatim (callers
 * pass a unique fallback, e.g. `feature-${Date.now()}`).
 */
export function sanitizeDocSlug(raw: string | undefined, fallback: string): string {
  const cleaned = (typeof raw === 'string' ? raw : '').replace(/[^a-z0-9-]/g, '').slice(0, 30);
  return cleaned || fallback;
}

/**
 * Resolve a collision-free `${slug}.md` filename. `exists` probes whether a
 * candidate basename is already present in the target directory; on collision
 * a mnemonic suffix is appended (`${slug}-{adj}-{noun}.md`). Pure w.r.t. the
 * filesystem — the caller supplies the probe so unit harnesses can stub it.
 */
export async function collisionFreeDocFilename(
  slug: string,
  exists: (filename: string) => Promise<boolean>,
): Promise<string> {
  const base = `${slug}.md`;
  if (!(await exists(base))) return base;
  return `${slug}-${generateMnemonic()}.md`;
}
