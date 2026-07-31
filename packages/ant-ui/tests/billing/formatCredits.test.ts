/**
 * Credit display formatting — currency-style, cents preserved.
 *
 * Moved out of ant-cli's `tests/billing/pricing-rescale.test.ts`, which reached
 * across the package boundary (`import … from '../../../ant-ui/src/…'`). That
 * import is forbidden — FE regularity checks are owned by the ant-ui suite —
 * and it was also an unresolvable path under ant-cli's tsconfig, so it surfaced
 * as a type error once tests entered typecheck (tsconfig.test.json).
 *
 * The @ant/shared credit MATH stays in the ant-cli test; only this display
 * formatter is FE-owned.
 */
import { describe, it, expect } from 'vitest';
import { formatCredits } from '../../src/shared/utils/tokenUtils';
import { selectCanViewCredits } from '../../src/domain/store/selectors/auth';
import type { StoreState } from '../../src/domain/store/types';

describe('formatCredits — currency-style credit display', () => {
  it('keeps two decimals so cents are never dropped', () => {
    expect(formatCredits(19.756)).toBe('19.76');
    expect(formatCredits(0.1)).toBe('0.10');
    expect(formatCredits(2)).toBe('2.00');
    expect(formatCredits(0)).toBe('0.00');
  });

  it('compacts only very large balances', () => {
    expect(formatCredits(250_000)).not.toContain('.');
    // just below the compaction threshold still shows cents
    expect(formatCredits(99_999.5)).toBe('99999.50');
  });

  it('preserves the sign for negative balances', () => {
    expect(formatCredits(-3.5)).toBe('-3.50');
  });
});

/**
 * Credits are the ANT billing unit and exist only in cloud — local mode calls
 * the provider with the user's own key. Fails CLOSED while `/system/config` is
 * still in flight so no credit label flashes in a local launch.
 */
describe('selectCanViewCredits — credit-vocabulary gate', () => {
  const withServerMode = (serverMode: StoreState['serverMode']) =>
    ({ serverMode }) as StoreState;

  it.each([
    ['cloud', { status: 'ready', data: 'cloud' }, true],
    ['local', { status: 'ready', data: 'local' }, false],
    ['still loading', { status: 'loading' }, false],
  ] as const)('%s → %s', (_label, serverMode, expected) => {
    expect(selectCanViewCredits(withServerMode(serverMode as StoreState['serverMode']))).toBe(expected);
  });
});
