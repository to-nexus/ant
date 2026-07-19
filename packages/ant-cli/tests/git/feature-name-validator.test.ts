/**
 * Feature-name validator matrix — branch name == feature name, so names must
 * satisfy git branch rules (`/` allowed, git-style nesting). SSOT: @ant/shared
 * `validateFeatureName` + the `/ ↔ ~` slug codec.
 */

import { describe, it, expect } from 'vitest';
import {
  validateFeatureName,
  isValidFeatureName,
  featureNameToSlug,
  featureSlugToName,
  FEATURE_SLUG_SENTINEL,
} from '@ant/shared';

describe('validateFeatureName', () => {
  it.each([
    'main',
    'master',
    'login-v2',
    'ant-1',
    'fix.v2',
    'Feature_X',
    'a',
    // git-style nested names are now valid
    'feature/base',
    'release/1.0',
    'feat/login',
    'a/b/c',
  ])('accepts %s', (name) => {
    expect(validateFeatureName(name)).toEqual({ ok: true });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['_base', 'reserved'],
    ['HEAD', 'reserved'],
    ['head', 'reserved'],
    ['codebase', 'reserved'],
    ['repo.git', 'reserved'],
    ['features', 'reserved'],
    ['my feature', 'whitespace'],
    // `~` is the slug sentinel — must be rejected to keep name↔slug injective
    ['a~b', 'sentinel'],
    ['feat~1', 'sentinel'],
    ['a^b', 'invalidChars'],
    ['a:b', 'invalidChars'],
    ['a?b', 'invalidChars'],
    ['a*b', 'invalidChars'],
    ['a[b', 'invalidChars'],
    ['a@{b', 'invalidChars'],
    ['한글', 'invalidChars'],
    ['a..b', 'doubleDot'],
    ['a/../b', 'doubleDot'],
    // slash structure
    ['/x', 'leadingSlash'],
    ['x/', 'trailingSlash'],
    ['a//b', 'emptySegment'],
    // per-segment git rules
    ['-x', 'leadingDash'],
    ['a/-b', 'leadingDash'],
    ['.x', 'leadingDot'],
    ['a/.b', 'leadingDot'],
    ['x.', 'trailingDot'],
    ['a/b.', 'trailingDot'],
    ['x.lock', 'lockSuffix'],
    ['a/b.lock', 'lockSuffix'],
    ['a'.repeat(101), 'tooLong'],
  ])('rejects %s (%s)', (name, violation) => {
    expect(validateFeatureName(name)).toEqual({ ok: false, violation });
  });

  it('isValidFeatureName mirrors the check', () => {
    expect(isValidFeatureName('main')).toBe(true);
    expect(isValidFeatureName('feat/login')).toBe(true);
    expect(isValidFeatureName('a//b')).toBe(false);
  });
});

describe('feature slug codec (/ ↔ ~)', () => {
  it.each([
    ['main', 'main'],
    ['feature/base', 'feature~base'],
    ['release/1.0', 'release~1.0'],
    ['a/b/c', 'a~b~c'],
  ])('encodes %s → %s and round-trips', (name, slug) => {
    expect(featureNameToSlug(name)).toBe(slug);
    expect(featureSlugToName(slug)).toBe(name);
    expect(featureSlugToName(featureNameToSlug(name))).toBe(name);
  });

  it('sentinel is git-illegal in a name, guaranteeing injectivity', () => {
    expect(FEATURE_SLUG_SENTINEL).toBe('~');
    expect(isValidFeatureName(`a${FEATURE_SLUG_SENTINEL}b`)).toBe(false);
  });

  it('slug is always free of path separators', () => {
    expect(featureNameToSlug('a/b/c').includes('/')).toBe(false);
  });
});
