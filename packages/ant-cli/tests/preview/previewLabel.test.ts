/**
 * Phase 2 foundation: urlKey → DNS label + Host → label extraction.
 */

import { describe, it, expect } from 'vitest';
import { toDnsLabel, extractLabelFromHost, labelForPackage } from '../../src/periphery/adapters/http/services/PreviewService/utils/previewLabel';

describe('toDnsLabel', () => {
  it('maps dots to hyphens and preserves -- part separators for a typical urlKey', () => {
    expect(toDnsLabel('to.nexus--probe--todo-app--feature-login'))
      .toBe('to-nexus--probe--todo-app--feature-login');
  });

  it('produces a DNS-valid label (only [a-z0-9-], no leading/trailing hyphen)', () => {
    const label = toDnsLabel('Org.Example--User--Proj--Feat');
    expect(label).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
  });

  it('truncates + hashes keys over the 63-char DNS limit (deterministic, distinct)', () => {
    const long = 'a'.repeat(70) + '--user--project--feature';
    const l1 = toDnsLabel(long);
    const l2 = toDnsLabel(long);
    expect(l1).toBe(l2);
    expect(l1.length).toBeLessThanOrEqual(63);
    // A different long key yields a different label (hash suffix disambiguates).
    expect(toDnsLabel('b'.repeat(70) + '--user--project--feature')).not.toBe(l1);
  });

  it('is stable/idempotent for the same input', () => {
    expect(toDnsLabel('x--y--z--w')).toBe(toDnsLabel('x--y--z--w'));
  });
});

describe('extractLabelFromHost', () => {
  const BASE = 'ant-preview.cross.nexus';

  it('strips the known base domain suffix', () => {
    expect(extractLabelFromHost('to-nexus--probe--app--feat.ant-preview.cross.nexus', BASE))
      .toBe('to-nexus--probe--app--feat');
  });

  it('ignores the port', () => {
    expect(extractLabelFromHost('lbl.ant-preview.cross.nexus:443', BASE)).toBe('lbl');
  });

  it('returns null at the apex (no per-app subdomain)', () => {
    expect(extractLabelFromHost('ant-preview.cross.nexus', BASE)).toBeNull();
  });

  it('returns null when the label would span multiple DNS levels', () => {
    // A stray dot in the label position is invalid — must be encoded, not raw.
    expect(extractLabelFromHost('a.b.ant-preview.cross.nexus', BASE)).toBeNull();
  });

  it('falls back to the first segment when no base domain given', () => {
    expect(extractLabelFromHost('lbl.example.com')).toBe('lbl');
  });

  it('returns null for undefined/bare host', () => {
    expect(extractLabelFromHost(undefined)).toBeNull();
    expect(extractLabelFromHost('localhost')).toBeNull();
  });
});

describe('labelForPackage', () => {
  const KEY = 'org:user:proj:feat';
  it('single frontend → 4-part urlKey label', () => {
    expect(labelForPackage(KEY, { isMulti: false })).toBe('org--user--proj--feat');
  });
  it('multi frontend → 5-part urlKey label with slug', () => {
    expect(labelForPackage(KEY, { isMulti: true, slug: 'web' })).toBe('org--user--proj--feat--web');
  });
  it('uses an explicit pkgUrlKey verbatim when provided', () => {
    expect(labelForPackage(KEY, { pkgUrlKey: 'org--user--proj--feat--api' }))
      .toBe('org--user--proj--feat--api');
  });
});
