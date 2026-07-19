/**
 * @ant/shared — Feature name validation
 *
 * A feature's git branch name is EXACTLY the feature name (no `feature/`
 * prefix, no sanitization), so feature names must satisfy git branch naming
 * rules plus ant's own constraints. This module is the single validator shared
 * by BE (createFeature / worktree / branchBase) and FE (inline input UX).
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

export type FeatureNameViolation =
  | 'empty'
  | 'reserved'
  | 'slash'
  | 'whitespace'
  | 'invalidChars'
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

const ALLOWED_CHARS = /^[A-Za-z0-9._-]+$/;

/**
 * Validate a feature name against git branch rules + ant constraints.
 * Most specific violation wins (checked in order).
 */
export function validateFeatureName(name: string): FeatureNameCheck {
  if (!name || name.trim().length === 0) return { ok: false, violation: 'empty' };
  const lower = name.toLowerCase();
  if (RESERVED_FEATURE_NAMES.some((r) => r.toLowerCase() === lower)) {
    return { ok: false, violation: 'reserved' };
  }
  if (name.includes('/')) return { ok: false, violation: 'slash' };
  if (/\s/.test(name)) return { ok: false, violation: 'whitespace' };
  if (name.startsWith('-')) return { ok: false, violation: 'leadingDash' };
  if (name.startsWith('.')) return { ok: false, violation: 'leadingDot' };
  if (name.includes('..')) return { ok: false, violation: 'doubleDot' };
  if (lower.endsWith('.lock')) return { ok: false, violation: 'lockSuffix' };
  if (name.endsWith('.')) return { ok: false, violation: 'trailingDot' };
  if (!ALLOWED_CHARS.test(name)) return { ok: false, violation: 'invalidChars' };
  if (name.length > FEATURE_NAME_MAX_LENGTH) return { ok: false, violation: 'tooLong' };
  return { ok: true };
}

export function isValidFeatureName(name: string): boolean {
  return validateFeatureName(name).ok;
}
