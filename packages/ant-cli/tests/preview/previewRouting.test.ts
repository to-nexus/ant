/**
 * Regression guard for preview per-package routing (`resolvePreviewTarget`),
 * the SSOT shared by the HTTP proxy and the WebSocket upgrade handler.
 *
 * Root cause it locks: in a multi-frontend monorepo (e.g. apps/app + apps/admin)
 * each frontend dev server runs on its own port under its own 5-part basePath.
 * The HMR websocket carries the 5th `serviceName` segment; if routing ignores it
 * and tunnels to the entry port, a non-entry frontend's HMR socket lands on the
 * wrong dev server (basePath mismatch) and the upgrade is rejected — a perpetual
 * HMR failure. The 5-part urlKey MUST resolve to the matching package's port.
 */

import { describe, it, expect } from 'vitest';
import { resolvePreviewTarget } from '../../src/periphery/adapters/http/middleware/previewRouting';

const HOST = '10.0.0.7';
const pool = {
  host: HOST,
  packages: [
    { slug: 'apps-app', type: 'frontend', port: 30001 },
    { slug: 'apps-admin', type: 'frontend', port: 30002 },
    { slug: 'apps-api', type: 'backend', port: 30003 },
  ],
};

describe('resolvePreviewTarget', () => {
  it('routes a 5-part urlKey to the matching frontend package port (not the entry)', () => {
    const target = resolvePreviewTarget(pool, 'apps-admin', 'org--u--p--f--apps-admin');
    expect(target).toEqual({ targetHost: HOST, targetPort: 30002, isFrontend: true });
  });

  it('flags a matched backend package as non-frontend (caller strips the prefix)', () => {
    const target = resolvePreviewTarget(pool, 'apps-api', 'org--u--p--f--apps-api');
    expect(target).toEqual({ targetHost: HOST, targetPort: 30003, isFrontend: false });
  });

  it('returns null for a 4-part urlKey (no serviceName) → caller falls back to entry', () => {
    expect(resolvePreviewTarget(pool, undefined, 'org--u--p--f')).toBeNull();
  });

  it('returns null for an unknown serviceName → caller falls back to entry', () => {
    expect(resolvePreviewTarget(pool, 'apps-nope', 'org--u--p--f--apps-nope')).toBeNull();
  });

  it('returns null when packages lack slugs (stale record) → entry fallback', () => {
    const stale = { host: HOST, packages: [{ type: 'frontend', port: 30001 }] };
    expect(resolvePreviewTarget(stale, 'apps-app', 'org--u--p--f--apps-app')).toBeNull();
  });

  it('normalizes a non-slugified serviceName via packageSlug before matching', () => {
    // `apps/app` cannot appear as a URL path segment, but historical raw names
    // are rescued through packageSlug → 'apps-app'.
    const target = resolvePreviewTarget(pool, 'apps/app', 'org--u--p--f--apps-app');
    expect(target?.targetPort).toBe(30001);
  });

  it('defaults host to localhost when the record has none', () => {
    const target = resolvePreviewTarget(
      { packages: [{ slug: 'apps-app', type: 'frontend', port: 30001 }] },
      'apps-app',
      'org--u--p--f--apps-app',
    );
    expect(target?.targetHost).toBe('localhost');
  });
});
