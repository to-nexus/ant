/**
 * @ant/shared — Feature name validation + filesystem/URL slug codec
 *
 * A feature's git branch name is EXACTLY the feature name (no `feature/`
 * prefix, no sanitization), so feature names must satisfy git branch naming
 * rules plus ant's own constraints. Feature names MAY contain `/` (git
 * branches nest: `feature/base`, `release/1.0`).
 *
 * Because a feature name is also used as a single filesystem directory
 * segment (`features/{name}/codebase`) and as a URL path segment, the raw
 * name is projected to a `/`-free SLUG at those physical boundaries via
 * `featureNameToSlug` / `featureSlugToName`. The `/ ↔ ~` mapping is a lossless
 * bijection: `~` is git-illegal in a ref (a revision operator), URL-unreserved
 * (RFC 3986), and excluded from `ALLOWED_CHARS`, so it can never appear in a
 * valid raw name and `/` can never appear in a slug. Slash-free legacy names
 * are their own slug — zero migration.
 *
 * Pure string checks only — no git spawn, no i18n. Callers map `violation`
 * to user-facing messages.
 */

/** Names that can never be a feature (workspace layout / git collisions). */
export const RESERVED_FEATURE_NAMES = [
  '_base', // legacy no-feature sentinel — permanently reserved
  'HEAD',
  'codebase',
  'repo.git',
  'features',
] as const;

/**
 * Character that stands in for `/` in a filesystem/URL slug. Git forbids `~`
 * in ref names and `ALLOWED_CHARS` excludes it, so the substitution is
 * injective without a lookup table.
 */
export const FEATURE_SLUG_SENTINEL = '~';

export type FeatureNameViolation =
  | 'empty'
  | 'reserved'
  | 'sentinel'
  | 'whitespace'
  | 'invalidChars'
  | 'leadingSlash'
  | 'trailingSlash'
  | 'emptySegment'
  | 'leadingDash'
  | 'leadingDot'
  | 'trailingDot'
  | 'doubleDot'
  | 'lockSuffix'
  | 'tooLong';

export type FeatureNameCheck =
  | { ok: true }
  | { ok: false; violation: FeatureNameViolation };

export const FEATURE_NAME_MAX_LENGTH = 100;

// `/` is allowed (git-style nesting); `~` is deliberately excluded so it stays
// available as the slug sentinel.
const ALLOWED_CHARS = /^[A-Za-z0-9._/-]+$/;

/**
 * Validate a feature name against git branch rules + ant constraints.
 * Operates on the raw name (with `/`). Most specific violation wins.
 */
export function validateFeatureName(name: string): FeatureNameCheck {
  if (!name || name.trim().length === 0) return { ok: false, violation: 'empty' };
  const lower = name.toLowerCase();
  if (RESERVED_FEATURE_NAMES.some((r) => r.toLowerCase() === lower)) {
    return { ok: false, violation: 'reserved' };
  }
  if (/\s/.test(name)) return { ok: false, violation: 'whitespace' };
  // `~` is the slug sentinel — reject before the generic char check for a
  // precise message (and to keep name↔slug injective).
  if (name.includes(FEATURE_SLUG_SENTINEL)) return { ok: false, violation: 'sentinel' };
  if (!ALLOWED_CHARS.test(name)) return { ok: false, violation: 'invalidChars' };
  if (name.length > FEATURE_NAME_MAX_LENGTH) return { ok: false, violation: 'tooLong' };
  if (name.includes('..')) return { ok: false, violation: 'doubleDot' };

  // Slash structure (git check-ref-format).
  if (name.startsWith('/')) return { ok: false, violation: 'leadingSlash' };
  if (name.endsWith('/')) return { ok: false, violation: 'trailingSlash' };
  if (name.includes('//')) return { ok: false, violation: 'emptySegment' };

  // Per-segment rules — a mid-name segment starting with `-` would otherwise
  // reach `git branch -b <seg>` as a flag; leading/trailing dot & `.lock` are
  // git-illegal per component, not just at the whole-name edges.
  for (const seg of name.split('/')) {
    if (seg.startsWith('-')) return { ok: false, violation: 'leadingDash' };
    if (seg.startsWith('.')) return { ok: false, violation: 'leadingDot' };
    if (seg.endsWith('.')) return { ok: false, violation: 'trailingDot' };
    if (seg.toLowerCase().endsWith('.lock')) return { ok: false, violation: 'lockSuffix' };
  }
  return { ok: true };
}

export function isValidFeatureName(name: string): boolean {
  return validateFeatureName(name).ok;
}

/** Project a raw feature name (may contain `/`) to a `/`-free slug. */
export function featureNameToSlug(name: string): string {
  return name.split('/').join(FEATURE_SLUG_SENTINEL);
}

/** Recover the raw feature name from a slug. Inverse of `featureNameToSlug`. */
export function featureSlugToName(slug: string): string {
  return slug.split(FEATURE_SLUG_SENTINEL).join('/');
}

/** A slug never contains `/` (it has been projected to the sentinel). */
export function isFeatureSlug(value: string): boolean {
  return !value.includes('/');
}
