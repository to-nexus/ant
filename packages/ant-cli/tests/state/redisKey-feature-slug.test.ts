/**
 * Redis key SSOT — the feature segment is stored as a `/`-free slug so the
 * IDE serverKey (embedded in the `/ide/{key}` proxy URL) stays a single path
 * segment. create slugifies, parse decodes; slash-free names are byte-identical.
 */

import { describe, it, expect } from 'vitest';
import {
  createIDEKey,
  parseIDEKey,
  createPreviewKey,
  parsePreviewKey,
} from '../../src/infrastructure/state/redisKeyUtils';

describe('redisKeyUtils feature slug', () => {
  it('IDE key: slash feature → `/`-free key, decodes back to raw name', () => {
    const key = createIDEKey('o', 'u', 'proj', 'release/1.0');
    expect(key).toBe('o:u:proj:release~1.0');
    expect(key.includes('/')).toBe(false);
    expect(parseIDEKey(key)).toEqual({
      tenantId: 'o',
      userId: 'u',
      projectId: 'proj',
      feature: 'release/1.0',
    });
  });

  it('Preview key round-trips a slash feature', () => {
    const key = createPreviewKey('o', 'u', 'proj', 'feature/base');
    expect(key).toBe('o:u:proj:feature~base');
    expect(parsePreviewKey(key)?.feature).toBe('feature/base');
  });

  it('slash-free feature is byte-identical (zero migration)', () => {
    expect(createIDEKey('o', 'u', 'proj', 'main')).toBe('o:u:proj:main');
    expect(parseIDEKey('o:u:proj:main')?.feature).toBe('main');
  });
});
