/**
 * Feature-name validator matrix — branch name == feature name, so names must
 * satisfy git branch rules. SSOT: @ant/shared `validateFeatureName`.
 */

import { describe, it, expect } from 'vitest';
import { validateFeatureName, isValidFeatureName } from '@ant/shared';

describe('validateFeatureName', () => {
  it.each([
    'main',
    'master',
    'login-v2',
    'ant-1',
    'fix.v2',
    'Feature_X',
    'a',
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
    ['feat/login', 'slash'],
    ['my feature', 'whitespace'],
    ['-x', 'leadingDash'],
    ['.x', 'leadingDot'],
    ['a..b', 'doubleDot'],
    ['x.lock', 'lockSuffix'],
    ['x.', 'trailingDot'],
    ['a~b', 'invalidChars'],
    ['a^b', 'invalidChars'],
    ['a:b', 'invalidChars'],
    ['a?b', 'invalidChars'],
    ['a*b', 'invalidChars'],
    ['a[b', 'invalidChars'],
    ['a@{b', 'invalidChars'],
    ['한글', 'invalidChars'],
    ['a'.repeat(101), 'tooLong'],
  ])('rejects %s (%s)', (name, violation) => {
    expect(validateFeatureName(name)).toEqual({ ok: false, violation });
  });

  it('isValidFeatureName mirrors the check', () => {
    expect(isValidFeatureName('main')).toBe(true);
    expect(isValidFeatureName('feat/login')).toBe(false);
  });
});
